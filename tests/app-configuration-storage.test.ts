import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadAppConfigurationDocument, openAppConfiguration } from '../src/adapters/app-configuration.ts';
import { defaultAppConfiguration, runConfigurationMigrations } from '../src/domains/app-configuration.ts';

async function fixture(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-app-settings-'));
    try {
        await run(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('settings require singleton admission before reading, backing up or writing selected data', async () => {
    await fixture(async (directory) => {
        await assert.rejects(openAppConfiguration(directory, { ownsSingleton: false }), /singleton/i);
        assert.deepEqual(await readdir(directory), []);
    });
});

test('the whole successful migration chain commits once with original bytes backed up', async () => {
    await fixture(async (directory) => {
        const original = '{"schemaVersion":1,"port":28765}\n';
        await writeFile(path.join(directory, 'configuration.json'), original);
        const configuration = await loadAppConfigurationDocument(
            directory,
            { ownsSingleton: true },
            {
                defaults: defaultAppConfiguration(),
                migrate: (value) =>
                    runConfigurationMigrations(value, {
                        currentVersion: 3,
                        steps: [1, 2].map((fromVersion) => ({
                            fromVersion,
                            validateSource(document) {
                                assert.equal(document.schemaVersion, fromVersion);
                            },
                            migrate(document) {
                                return { ...document, schemaVersion: fromVersion + 1, appearance: 'system' };
                            },
                            validateDestination(document) {
                                assert.equal(document.schemaVersion, fromVersion + 1);
                            },
                        })),
                        validateCurrent(document) {
                            return document;
                        },
                    }),
            },
        );
        assert.equal(configuration.schemaVersion, 3);
        assert.equal(await readFile(path.join(directory, 'configuration.schema-1.backup.json'), 'utf8'), original);
        assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'configuration.json'), 'utf8')), {
            schemaVersion: 3,
            port: 28765,
            appearance: 'system',
        });
        assert.equal(
            (await readdir(directory)).some((name) => name.endsWith('.tmp')),
            false,
        );
    });
});

test('failed intermediate migration preserves original bytes without a backup or partial commit', async () => {
    await fixture(async (directory) => {
        const original = '{"schemaVersion":1,"port":28765}\n';
        await writeFile(path.join(directory, 'configuration.json'), original);
        await assert.rejects(
            loadAppConfigurationDocument(
                directory,
                { ownsSingleton: true },
                {
                    defaults: defaultAppConfiguration(),
                    migrate: (value) =>
                        runConfigurationMigrations(value, {
                            currentVersion: 3,
                            steps: [
                                {
                                    fromVersion: 1,
                                    validateSource() {},
                                    migrate: () => ({ schemaVersion: 2 }),
                                    validateDestination() {
                                        throw new Error('Invalid intermediate data.');
                                    },
                                },
                            ],
                            validateCurrent(document) {
                                return document;
                            },
                        }),
                },
            ),
            /intermediate/,
        );
        assert.equal(await readFile(path.join(directory, 'configuration.json'), 'utf8'), original);
        assert.deepEqual(await readdir(directory), ['configuration.json']);
    });
});

test('desired port stays cold and appearance applies hot', async () => {
    await fixture(async (directory) => {
        const settings = await openAppConfiguration(directory, { ownsSingleton: true });
        await settings.save({ schemaVersion: 1, port: 29111, appearance: 'dark' });
        assert.equal(settings.state().desired.port, 29111);
        assert.equal(settings.state().effective.port, 27637);
        assert.equal(settings.state().effective.appearance, 'dark');
        assert.equal(settings.state().restartRequired, true);
        assert.deepEqual(await readdir(directory), ['configuration.json']);
        assert.equal(
            (await readdir(directory)).some((name) => name.endsWith('.tmp')),
            false,
        );
    });
});

test('future and malformed settings refuse writes and leave original bytes untouched', async () => {
    await fixture(async (directory) => {
        for (const original of ['{bad json', '{"schemaVersion":999,"port":27637}', '{"schemaVersion":0,"port":0}']) {
            await writeFile(path.join(directory, 'configuration.json'), original);
            await assert.rejects(openAppConfiguration(directory, { ownsSingleton: true }));
            assert.equal(await readFile(path.join(directory, 'configuration.json'), 'utf8'), original);
            assert.deepEqual(await readdir(directory), ['configuration.json']);
        }
    });
});

test('invalid desired configuration cannot mutate memory or disk', async () => {
    await fixture(async (directory) => {
        const settings = await openAppConfiguration(directory, { ownsSingleton: true });
        const before = await readFile(path.join(directory, 'configuration.json'), 'utf8');
        await assert.rejects(settings.save({ schemaVersion: 1, port: 2, appearance: 'dark' }));
        assert.equal(await readFile(path.join(directory, 'configuration.json'), 'utf8'), before);
        assert.equal(settings.state().desired.port, 27637);
    });
});

test('a prior migration backup is reusable only when its bytes equal the original document', async () => {
    await fixture(async (directory) => {
        const file = path.join(directory, 'configuration.json');
        const backup = path.join(directory, 'configuration.schema-1.backup.json');
        const original = '{"schemaVersion":1,"port":28765}\n';
        const options = {
            defaults: {},
            migrate: () => ({ configuration: { schemaVersion: 2 }, sourceVersion: 1, migrated: true }),
        };
        await writeFile(file, original);
        await writeFile(backup, 'older protected backup\n');
        await assert.rejects(
            loadAppConfigurationDocument(directory, { ownsSingleton: true }, options),
            /backup differs/,
        );
        assert.equal(await readFile(file, 'utf8'), original);
        assert.equal(await readFile(backup, 'utf8'), 'older protected backup\n');
        assert.deepEqual((await readdir(directory)).sort(), [
            'configuration.json',
            'configuration.schema-1.backup.json',
        ]);
        await writeFile(backup, original);
        await loadAppConfigurationDocument(directory, { ownsSingleton: true }, options);
        assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 2 });
        assert.equal(await readFile(backup, 'utf8'), original);
    });
});

test('a failed atomic replacement cleans its temporary file and preserves effective and desired memory', async () => {
    await fixture(async (directory) => {
        const file = path.join(directory, 'configuration.json');
        const settings = await openAppConfiguration(directory, { ownsSingleton: true });
        const original = await readFile(file);
        await unlink(file);
        await mkdir(file);
        await assert.rejects(settings.save({ schemaVersion: 1, port: 29111, appearance: 'dark' }));
        assert.equal(settings.state().desired.port, 27637);
        assert.equal(settings.state().effective.appearance, 'system');
        assert.deepEqual(await readdir(directory), ['configuration.json']);
        assert.deepEqual(await readdir(file), []);
        await rm(file, { recursive: true });
        await writeFile(file, original);
        await settings.save({ schemaVersion: 1, port: 29111, appearance: 'dark' });
        assert.equal(settings.state().desired.port, 29111);
    });
});
