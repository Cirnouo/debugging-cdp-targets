import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    applyAppConfiguration,
    defaultAppConfiguration,
    migrateAppConfiguration,
    parseAppConfiguration,
    runConfigurationMigrations,
} from '../src/domains/app-configuration.ts';

test('real schema 1 migrates purely to host selections without changing the saved port or appearance', () => {
    const original = Object.freeze({ schemaVersion: 1, port: 28761, appearance: 'dark' });
    const result = migrateAppConfiguration(original);
    assert.deepEqual(result, {
        configuration: {
            schemaVersion: 2,
            port: 28761,
            appearance: 'dark',
            hosts: {
                codex: { configRoot: null, executable: null, pluginRoot: null },
                claude: { configRoot: null, executable: null, pluginRoot: null },
            },
        },
        migrated: true,
        sourceVersion: 1,
    });
    assert.deepEqual(original, { schemaVersion: 1, port: 28761, appearance: 'dark' });
});

test('App defaults use the loopback MCP port and a cheap system appearance setting', () => {
    assert.deepEqual(defaultAppConfiguration(), {
        schemaVersion: 2,
        port: 27637,
        appearance: 'system',
        hosts: {
            codex: { configRoot: null, executable: null, pluginRoot: null },
            claude: { configRoot: null, executable: null, pluginRoot: null },
        },
    });
});

test('current schema is stable and unpublished or incomplete schemas are refused', () => {
    assert.deepEqual(migrateAppConfiguration(defaultAppConfiguration()), {
        configuration: defaultAppConfiguration(),
        migrated: false,
        sourceVersion: 2,
    });
    for (const invalid of [
        null,
        {},
        { schemaVersion: 2, port: 27637 },
        { schemaVersion: 0.5, port: 27637 },
        { schemaVersion: 0, port: 27637 },
        { schemaVersion: 0, port: 0 },
        { schemaVersion: 0, port: 65536 },
        { schemaVersion: 0, port: 27637, bearer: 'never-persist' },
        { schemaVersion: 1, port: 27637, appearance: 'unknown' },
        { schemaVersion: 1, port: 27637, appearance: 'system', connections: [] },
    ])
        assert.throws(() => migrateAppConfiguration(invalid));
});

test('sequential migrations validate both sides of every step without mutating source data', () => {
    const source = Object.freeze({ schemaVersion: 1, value: 4 });
    const observed: string[] = [];
    const result = runConfigurationMigrations(source, {
        currentVersion: 3,
        steps: [1, 2].map((fromVersion) => ({
            fromVersion,
            validateSource(value) {
                assert.equal(value.schemaVersion, fromVersion);
                observed.push(`source-${fromVersion}`);
            },
            migrate(value) {
                return { schemaVersion: fromVersion + 1, value: Number(value.value) + 1 };
            },
            validateDestination(value) {
                assert.equal(value.schemaVersion, fromVersion + 1);
                observed.push(`destination-${fromVersion + 1}`);
            },
        })),
        validateCurrent(value) {
            assert.equal(value.schemaVersion, 3);
            return value;
        },
    });
    assert.deepEqual(result, { configuration: { schemaVersion: 3, value: 6 }, migrated: true, sourceVersion: 1 });
    assert.deepEqual(source, { schemaVersion: 1, value: 4 });
    assert.deepEqual(observed, ['source-1', 'destination-2', 'source-2', 'destination-3']);
});

test('migration chains reject a missing link, wrong destination version and failed intermediate validation', () => {
    const source = { schemaVersion: 1, value: 4 };
    const step = {
        fromVersion: 1,
        validateSource() {},
        migrate: () => ({ schemaVersion: 2, value: 5 }),
        validateDestination() {},
    };
    const options = {
        currentVersion: 3,
        validateCurrent: (value: Record<string, unknown>) => value,
        steps: [step],
    };
    assert.throws(() => runConfigurationMigrations(source, options), /missing/i);
    assert.throws(
        () =>
            runConfigurationMigrations(source, {
                ...options,
                steps: [{ ...step, migrate: () => ({ schemaVersion: 3 }) }],
            }),
        /sequential/i,
    );
    assert.throws(
        () =>
            runConfigurationMigrations(source, {
                ...options,
                steps: [
                    {
                        ...step,
                        validateDestination() {
                            throw new Error('Invalid intermediate schema.');
                        },
                    },
                ],
            }),
        /intermediate/,
    );
    assert.deepEqual(source, { schemaVersion: 1, value: 4 });
});

test('configuration applies cheap settings hot while desired port awaits a successful restart', () => {
    const effective = defaultAppConfiguration();
    const desired = parseAppConfiguration({ ...effective, port: 28761, appearance: 'dark' });
    assert.deepEqual(applyAppConfiguration(effective, desired), {
        desired,
        effective: { ...effective, appearance: 'dark' },
        restartRequired: true,
    });
    assert.equal(applyAppConfiguration(effective, effective).restartRequired, false);
});
