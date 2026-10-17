import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'smol-toml';
import { OWN_PLUGIN, OWN_PLUGIN_ID, type PluginHost } from '../domains/host-management.ts';
import { errorCode, isRecord } from '../shared/errors.ts';
import { readRegularFile } from './file-evidence.ts';

export interface HostUserIntent {
    snapshot: string;
    marketplaceSource?: string;
    pluginEnabled?: boolean;
    readOnlyReason?: 'pinned-or-ambiguous';
    marketplace: {
        source: string;
        url: string;
        ref: string | null;
        sparse: string[];
        autoUpdate: boolean | null;
    } | null;
}

/** Standard parsers only; unrelated configuration is never serialized, logged or rewritten. */
export function parseHostUserIntent(host: PluginHost, text: string): HostUserIntent {
    try {
        const document: unknown =
            host === 'codex'
                ? parse(text, { unsafeKeyBehaviour: 'throw', integersAsBigInt: 'asNeeded', maxDepth: 64 })
                : JSON.parse(text);
        if (!isRecord(document)) throw new Error();
        const markets = host === 'codex' ? document.marketplaces : document.extraKnownMarketplaces;
        if (markets !== undefined && !isRecord(markets)) throw new Error();
        const own = isRecord(markets) ? markets[OWN_PLUGIN] : undefined;
        const plugins = host === 'codex' ? document.plugins : document.enabledPlugins;
        if (plugins !== undefined && !isRecord(plugins)) throw new Error();
        const plugin = isRecord(plugins) ? plugins[OWN_PLUGIN_ID] : undefined;
        let enabled: boolean | undefined;
        let ambiguous = false;
        if (plugin !== undefined) {
            if (host === 'codex') {
                if (!isRecord(plugin) || typeof plugin.enabled !== 'boolean') throw new Error();
                enabled = plugin.enabled;
                ambiguous ||= Object.keys(plugin).some((key) => key !== 'enabled');
            } else {
                if (typeof plugin !== 'boolean') throw new Error();
                enabled = plugin;
            }
        }
        let market: {
            source: string;
            url: string;
            ref: string | null;
            sparse: string[];
            autoUpdate: boolean | null;
        } | null = null;
        if (own !== undefined) {
            if (!isRecord(own)) throw new Error();
            const source = host === 'codex' ? own : own.source;
            if (!isRecord(source)) throw new Error();
            const kind = host === 'codex' ? source.source_type : source.source;
            const url = host === 'codex' ? source.source : source.url;
            if (typeof kind !== 'string' || typeof url !== 'string' || url.length > 8192) throw new Error();
            if (source.ref !== undefined && typeof source.ref !== 'string') throw new Error();
            const sparse = source.sparse_paths ?? [];
            if (!Array.isArray(sparse) || !sparse.every((entry: unknown) => typeof entry === 'string'))
                throw new Error();
            const allowed =
                host === 'codex' ? ['source_type', 'source', 'ref', 'sparse_paths'] : ['source', 'url', 'ref'];
            ambiguous ||=
                kind !== 'git' || source.ref !== undefined || Object.keys(source).some((key) => !allowed.includes(key));
            if (host === 'claude') {
                ambiguous ||= Object.keys(own).some((key) => !['source', 'autoUpdate'].includes(key));
                if (own.autoUpdate !== undefined && typeof own.autoUpdate !== 'boolean') throw new Error();
            }
            market = {
                source: kind,
                url,
                ref: typeof source.ref === 'string' ? source.ref : null,
                sparse,
                autoUpdate: host === 'claude' && typeof own.autoUpdate === 'boolean' ? own.autoUpdate : null,
            };
        }
        return {
            snapshot: JSON.stringify({ marketplace: market, enabled: enabled ?? null }),
            marketplace: market,
            ...(market ? { marketplaceSource: market.url } : {}),
            ...(enabled === undefined ? {} : { pluginEnabled: enabled }),
            ...(ambiguous ? { readOnlyReason: 'pinned-or-ambiguous' as const } : {}),
        };
    } catch {
        throw new Error('invalid-user-settings');
    }
}

export function assertNativeIntentTransition(
    before: HostUserIntent,
    after: HostUserIntent,
    source: string,
    action: 'marketplace-add' | 'marketplace-refresh' | 'plugin-install',
) {
    if (
        before.readOnlyReason ||
        after.readOnlyReason ||
        before.pluginEnabled === false ||
        after.marketplaceSource !== source
    )
        throw new Error('configuration-changed');
    if (action === 'marketplace-add') {
        if (
            before.marketplace !== null ||
            after.pluginEnabled !== before.pluginEnabled ||
            JSON.stringify(after.marketplace) !==
                JSON.stringify({ source: 'git', url: source, ref: null, sparse: [], autoUpdate: null })
        )
            throw new Error('configuration-changed');
    } else if (
        JSON.stringify(before.marketplace) !== JSON.stringify(after.marketplace) ||
        (action === 'marketplace-refresh' ? before.pluginEnabled !== after.pluginEnabled : after.pluginEnabled !== true)
    )
        throw new Error('configuration-changed');
}

export async function readHostUserIntent(host: PluginHost, configRoot: string): Promise<HostUserIntent> {
    try {
        const file = path.join(configRoot, host === 'codex' ? 'config.toml' : 'settings.json');
        const identity = await lstat(file);
        if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1 || identity.size > 1024 * 1024)
            throw new Error();
        return parseHostUserIntent(host, (await readRegularFile(file)).toString('utf8'));
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return parseHostUserIntent(host, host === 'codex' ? '' : '{}');
        throw new Error('invalid-user-settings');
    }
}
