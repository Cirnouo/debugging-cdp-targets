import { isRecord } from '../shared/errors.ts';

export type AppDistribution = Readonly<{
    schemaVersion: 1;
    kind: 'installed' | 'portable';
    platform: 'win32';
    architecture: 'x64' | 'arm64';
}>;

export function supportsWindowsApp(platform: string, architecture: string): boolean {
    return platform === 'win32' && (architecture === 'x64' || architecture === 'arm64');
}

export function parseAppDistribution(
    value: unknown,
    native: { platform: string; architecture: string },
): AppDistribution {
    if (
        !isRecord(value) ||
        Object.keys(value).length !== 4 ||
        value.schemaVersion !== 1 ||
        (value.kind !== 'installed' && value.kind !== 'portable') ||
        typeof value.platform !== 'string' ||
        (value.architecture !== 'x64' && value.architecture !== 'arm64') ||
        !supportsWindowsApp(value.platform, value.architecture) ||
        value.platform !== native.platform ||
        value.architecture !== native.architecture
    )
        throw new Error('Invalid App distribution identity.');
    return Object.freeze({
        schemaVersion: 1,
        kind: value.kind,
        platform: 'win32',
        architecture: value.architecture,
    });
}
