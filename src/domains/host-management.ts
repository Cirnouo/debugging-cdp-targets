import { isRecord } from '../shared/errors.ts';
import { compareVersions, isSemVer, isStableVersion } from './software-version.ts';

export type PluginHost = 'codex' | 'claude';

export interface StablePluginRecord {
    schemaVersion: 1;
    version: string;
    minimumAppVersion: string;
    source: { url: string; sha: string };
}

export const OWN_PLUGIN = 'debugging-cdp-targets';
export const OWN_PLUGIN_ID = `${OWN_PLUGIN}@${OWN_PLUGIN}`;

export function pluginSourcePath(host: PluginHost): string {
    return `plugins/${host === 'codex' ? 'codex' : 'claude-code'}/${OWN_PLUGIN}`;
}

export function pluginManifestPath(host: PluginHost): string {
    return host === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json';
}

export function pluginMcpPath(host: PluginHost): string {
    return host === 'codex' ? 'mcp.json' : '.mcp.json';
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function isGitRepositoryUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return false;
    try {
        const url = new URL(value);
        return (
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            (url.protocol === 'https:' ||
                (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))
        );
    } catch {
        return false;
    }
}

/** Null is the current unreleased production state; malformed data is never absence. */
export function parseStablePluginRecord(value: unknown): StablePluginRecord | null {
    if (value === null) return null;
    if (
        !isRecord(value) ||
        !exactKeys(value, ['schemaVersion', 'version', 'minimumAppVersion', 'source']) ||
        value.schemaVersion !== 1 ||
        !isStableVersion(value.version) ||
        !isSemVer(value.minimumAppVersion) ||
        !isRecord(value.source) ||
        !exactKeys(value.source, ['url', 'sha']) ||
        !isGitRepositoryUrl(value.source.url) ||
        typeof value.source.sha !== 'string' ||
        !/^[a-f0-9]{40}$/.test(value.source.sha)
    ) {
        throw new Error('Invalid stable plugin record.');
    }
    return {
        schemaVersion: 1,
        version: value.version,
        minimumAppVersion: value.minimumAppVersion,
        source: { url: value.source.url, sha: value.source.sha },
    };
}

export type PluginUpdateDecision =
    | 'no-candidate'
    | 'app-update-required'
    | 'newer-installed'
    | 'install'
    | 'update'
    | 'sync';

export function decidePluginUpdate(
    appVersion: string,
    record: StablePluginRecord | null,
    installedVersion?: string,
): PluginUpdateDecision {
    if (!isSemVer(appVersion)) throw new Error('Invalid App version.');
    if (!record) return 'no-candidate';
    if (compareVersions(appVersion, record.minimumAppVersion) < 0) return 'app-update-required';
    if (installedVersion === undefined) return 'install';
    const comparison = compareVersions(installedVersion, record.version);
    return comparison > 0 ? 'newer-installed' : comparison === 0 ? 'sync' : 'update';
}

export function validateAppEndpoint(value: string): string {
    try {
        const url = new URL(value);
        if (
            url.protocol === 'http:' &&
            ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
            url.port &&
            url.pathname === '/mcp' &&
            !url.search &&
            !url.hash &&
            !url.username &&
            !url.password &&
            url.href === value
        )
            return value;
    } catch {
        /* Return the same bounded error for every invalid endpoint. */
    }
    throw new Error('Invalid effective App endpoint.');
}
