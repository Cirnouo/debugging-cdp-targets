import { isRecord } from '../shared/errors.ts';

export type AppAppearance = 'system' | 'light' | 'dark';
export type AppConfiguration = Readonly<{ schemaVersion: 1; port: number; appearance: AppAppearance }>;
export type AppConfigurationState = Readonly<{
    desired: AppConfiguration;
    effective: AppConfiguration;
    restartRequired: boolean;
}>;

export function defaultAppConfiguration(): AppConfiguration {
    return { schemaVersion: 1, port: 27637, appearance: 'system' };
}

function validPort(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseAppConfiguration(value: unknown): AppConfiguration {
    if (
        !isRecord(value) ||
        !exactKeys(value, ['schemaVersion', 'port', 'appearance']) ||
        value.schemaVersion !== 1 ||
        !validPort(value.port) ||
        !['system', 'light', 'dark'].some((appearance) => appearance === value.appearance)
    )
        throw new Error('Invalid or unsupported App configuration.');
    const appearance = value.appearance;
    if (appearance !== 'system' && appearance !== 'light' && appearance !== 'dark')
        throw new Error('Invalid App appearance.');
    return Object.freeze({ schemaVersion: 1, port: value.port, appearance });
}

type ConfigurationDocument = Record<string, unknown>;
export type ConfigurationMigrationResult<T> = { configuration: T; migrated: boolean; sourceVersion: number };
export type ConfigurationMigrationStep = {
    fromVersion: number;
    validateSource: (value: ConfigurationDocument) => void;
    migrate: (value: ConfigurationDocument) => unknown;
    validateDestination: (value: ConfigurationDocument) => void;
};

function configurationDocument(value: unknown): ConfigurationDocument {
    if (
        !isRecord(value) ||
        typeof value.schemaVersion !== 'number' ||
        !Number.isSafeInteger(value.schemaVersion) ||
        value.schemaVersion < 1
    )
        throw new Error('App configuration requires a positive integer schemaVersion.');
    return value;
}

/** A small pure runner; production introduces migration steps only when a real schema changes. */
export function runConfigurationMigrations<T>(
    value: unknown,
    options: {
        currentVersion: number;
        steps: readonly ConfigurationMigrationStep[];
        validateCurrent: (value: ConfigurationDocument) => T;
    },
): ConfigurationMigrationResult<T> {
    if (!Number.isSafeInteger(options.currentVersion) || options.currentVersion < 1)
        throw new Error('Invalid current App configuration schema.');
    let document = configurationDocument(structuredClone(value));
    const sourceVersion = Number(document.schemaVersion);
    if (sourceVersion > options.currentVersion) throw new Error('Future App configuration schema is unsupported.');
    const versions = new Set<number>();
    for (const step of options.steps) {
        if (!Number.isSafeInteger(step.fromVersion) || step.fromVersion < 1 || versions.has(step.fromVersion))
            throw new Error('Invalid or duplicate App configuration migration step.');
        versions.add(step.fromVersion);
    }
    for (let version = sourceVersion; version < options.currentVersion; version++) {
        const step = options.steps.find((candidate) => candidate.fromVersion === version);
        if (!step) throw new Error('Missing sequential App configuration migration.');
        step.validateSource(document);
        const next = configurationDocument(step.migrate(document));
        if (next.schemaVersion !== version + 1) throw new Error('App configuration migrations must be sequential.');
        step.validateDestination(next);
        document = next;
    }
    return {
        configuration: options.validateCurrent(document),
        migrated: sourceVersion !== options.currentVersion,
        sourceVersion,
    };
}

export function migrateAppConfiguration(value: unknown): ConfigurationMigrationResult<AppConfiguration> {
    // Schema 1 is the initial delivered format. No unpublished schema 0 is accepted.
    return runConfigurationMigrations(value, { currentVersion: 1, steps: [], validateCurrent: parseAppConfiguration });
}

export function applyAppConfiguration(effective: AppConfiguration, desired: AppConfiguration): AppConfigurationState {
    return {
        desired,
        effective: Object.freeze({ ...effective, appearance: desired.appearance }),
        restartRequired: desired.port !== effective.port,
    };
}
