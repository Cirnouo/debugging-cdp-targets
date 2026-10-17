import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
    type AppConfigurationState,
    applyAppConfiguration,
    type ConfigurationMigrationResult,
    defaultAppConfiguration,
    migrateAppConfiguration,
    parseAppConfiguration,
} from '../domains/app-configuration.ts';
import { errorCode } from '../shared/errors.ts';
import { readRegularFile } from './file-evidence.ts';

async function commitConfiguration(file: string, value: unknown) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
        try {
            await handle.writeFile(`${JSON.stringify(value, null, 4)}\n`, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        await rename(temporary, file);
    } finally {
        await unlink(temporary).catch((error: unknown) => {
            if (errorCode(error) !== 'ENOENT') throw error;
        });
    }
}

export async function loadAppConfigurationDocument<T>(
    directory: string,
    admission: { ownsSingleton: boolean },
    options: {
        defaults: T;
        migrate: (value: unknown) => ConfigurationMigrationResult<T>;
    },
): Promise<T> {
    if (admission.ownsSingleton !== true) throw new Error('App settings require singleton ownership.');
    const file = path.join(directory, 'configuration.json');
    let original: Buffer | undefined;
    try {
        original = await readRegularFile(file);
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
    }
    // No filesystem writes occur until the complete pure chain, including final validation, succeeds.
    const loaded = options.migrate(original === undefined ? options.defaults : JSON.parse(original.toString('utf8')));
    if (original !== undefined && loaded.migrated) {
        if (!Number.isSafeInteger(loaded.sourceVersion) || loaded.sourceVersion < 1)
            throw new Error('Invalid configuration backup schema.');
        const backup = path.join(directory, `configuration.schema-${loaded.sourceVersion}.backup.json`);
        try {
            const handle = await open(backup, 'wx', 0o600);
            try {
                await handle.writeFile(original);
                await handle.sync();
            } finally {
                await handle.close();
            }
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') throw error;
            if (!(await readRegularFile(backup)).equals(original))
                throw new Error('Existing migration backup differs.');
        }
    }
    if (original === undefined || loaded.migrated) await commitConfiguration(file, loaded.configuration);
    return loaded.configuration;
}

export async function openAppConfiguration(directory: string, admission: { ownsSingleton: boolean }) {
    const file = path.join(directory, 'configuration.json');
    const initial = await loadAppConfigurationDocument(directory, admission, {
        defaults: defaultAppConfiguration(),
        migrate: migrateAppConfiguration,
    });
    let state: AppConfigurationState = applyAppConfiguration(initial, initial);
    let pending = Promise.resolve();
    return {
        state: () => state,
        save(value: unknown): Promise<void> {
            const write = pending.then(async () => {
                const desired = parseAppConfiguration(value);
                await commitConfiguration(file, desired);
                state = applyAppConfiguration(state.effective, desired);
            });
            pending = write.catch(() => {});
            return write;
        },
    };
}
