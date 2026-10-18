import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
    type PluginHost,
    parseStablePluginRecord,
    pluginManifestPath,
    pluginMcpPath,
    type StablePluginRecord,
    validateAppEndpoint,
} from '../domains/host-management.ts';
import { errorCode, isRecord } from '../shared/errors.ts';
import { readRegularFile } from './file-evidence.ts';
import {
    canonicalPluginRoot,
    overlayPluginEndpoint,
    type PluginFiles,
    pluginMcpEndpointEvidence,
    readPluginTree,
    verifyPluginFiles,
} from './verified-plugin-files.ts';

export interface ReceiptHostSelection {
    configRoot: string;
    marketplaceSource: string;
    executable?: string;
    pluginRoot?: string;
}
export interface NativeManagedReceipt {
    root: string;
    version: string;
    configuration: string;
}
export interface ManagedPluginReceipt {
    schemaVersion: 1;
    host: PluginHost;
    selection: { configRoot: string; marketplaceSource: string; executable: string | null; pluginRoot: string | null };
    native: NativeManagedReceipt;
    record: StablePluginRecord;
    files: { path: string; size: number; sha256: string }[];
    mcpSourceEndpoint: string;
    mcpSourceUrlOffset: number;
}

export interface HostPluginReceiptStore {
    read(host: PluginHost): Promise<unknown>;
    write(host: PluginHost, receipt: ManagedPluginReceipt): Promise<void>;
}

function keys(value: Record<string, unknown>, expected: string[]) {
    return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function absolute(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 8192 && !value.includes('\0') && path.isAbsolute(value);
}

export function receiptMatchesSelection(receipt: ManagedPluginReceipt, selection: ReceiptHostSelection): boolean {
    return (
        receipt.selection.configRoot === selection.configRoot &&
        receipt.selection.marketplaceSource === selection.marketplaceSource &&
        receipt.selection.executable === (selection.executable ?? null) &&
        receipt.selection.pluginRoot === (selection.pluginRoot ?? null)
    );
}

export function parseManagedPluginReceipt(value: unknown): ManagedPluginReceipt {
    try {
        if (
            !isRecord(value) ||
            !keys(value, [
                'schemaVersion',
                'host',
                'selection',
                'native',
                'record',
                'files',
                'mcpSourceEndpoint',
                'mcpSourceUrlOffset',
            ]) ||
            value.schemaVersion !== 1 ||
            (value.host !== 'codex' && value.host !== 'claude') ||
            !isRecord(value.selection) ||
            !keys(value.selection, ['configRoot', 'marketplaceSource', 'executable', 'pluginRoot']) ||
            !absolute(value.selection.configRoot) ||
            !(value.selection.executable === null || absolute(value.selection.executable)) ||
            !(value.selection.pluginRoot === null || absolute(value.selection.pluginRoot)) ||
            !isRecord(value.native) ||
            !keys(value.native, ['root', 'version', 'configuration']) ||
            !absolute(value.native.root) ||
            typeof value.native.configuration !== 'string' ||
            value.native.configuration.length > 65536 ||
            !Array.isArray(value.files) ||
            value.files.length < 2 ||
            value.files.length > 512 ||
            typeof value.mcpSourceEndpoint !== 'string' ||
            typeof value.mcpSourceUrlOffset !== 'number' ||
            !Number.isSafeInteger(value.mcpSourceUrlOffset) ||
            value.mcpSourceUrlOffset < 0
        )
            throw new Error();
        const record = parseStablePluginRecord(value.record);
        const host = value.host;
        if (
            !record ||
            value.native.version !== record.version ||
            value.selection.marketplaceSource !== record.source.url
        )
            throw new Error();
        const configuration: unknown = JSON.parse(value.native.configuration);
        if (
            !isRecord(configuration) ||
            !keys(configuration, ['marketplace', 'enabled']) ||
            configuration.enabled !== true ||
            !isRecord(configuration.marketplace) ||
            !keys(configuration.marketplace, ['source', 'url', 'ref', 'sparse', 'autoUpdate']) ||
            configuration.marketplace.url !== record.source.url ||
            configuration.marketplace.source !== 'git' ||
            configuration.marketplace.ref !== null ||
            !Array.isArray(configuration.marketplace.sparse) ||
            !configuration.marketplace.sparse.every((entry: unknown) => typeof entry === 'string') ||
            !(
                configuration.marketplace.autoUpdate === null ||
                typeof configuration.marketplace.autoUpdate === 'boolean'
            ) ||
            JSON.stringify(configuration) !== value.native.configuration
        )
            throw new Error();
        const files: ManagedPluginReceipt['files'] = [];
        let total = 0;
        for (const item of value.files) {
            if (!isRecord(item) || typeof item.path !== 'string') throw new Error();
            const candidatePath = item.path;
            if (
                !keys(item, ['path', 'size', 'sha256']) ||
                item.path.length > 8192 ||
                item.path
                    .split('/')
                    .some((part) => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part)) ||
                item.path.split('/')[0]?.toLowerCase() === '.in_use' ||
                !Number.isSafeInteger(item.size) ||
                typeof item.size !== 'number' ||
                item.size < 0 ||
                item.size > 8 * 1024 * 1024 ||
                typeof item.sha256 !== 'string' ||
                !/^[a-f0-9]{64}$/.test(item.sha256) ||
                files.some((prior) => prior.path.toLowerCase() === candidatePath.toLowerCase())
            )
                throw new Error();
            total += item.size;
            if (total > 16 * 1024 * 1024) throw new Error();
            files.push({ path: item.path, size: item.size, sha256: item.sha256 });
        }
        if (
            !files.some((item) => item.path === pluginManifestPath(host)) ||
            !files.some((item) => item.path === pluginMcpPath(host))
        )
            throw new Error();
        validateAppEndpoint(value.mcpSourceEndpoint);
        const mcp = files.find((item) => item.path === pluginMcpPath(host));
        if (!mcp || value.mcpSourceUrlOffset + Buffer.byteLength(JSON.stringify(value.mcpSourceEndpoint)) > mcp.size)
            throw new Error();
        return {
            schemaVersion: 1,
            host: value.host,
            selection: {
                configRoot: value.selection.configRoot,
                marketplaceSource: record.source.url,
                executable: value.selection.executable,
                pluginRoot: value.selection.pluginRoot,
            },
            native: { root: value.native.root, version: record.version, configuration: value.native.configuration },
            record,
            files,
            mcpSourceEndpoint: value.mcpSourceEndpoint,
            mcpSourceUrlOffset: value.mcpSourceUrlOffset,
        };
    } catch {
        throw new Error('invalid-managed-receipt');
    }
}

function digest(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export function createManagedPluginReceipt(
    host: PluginHost,
    selection: ReceiptHostSelection,
    native: NativeManagedReceipt,
    record: StablePluginRecord,
    files: PluginFiles,
): ManagedPluginReceipt {
    const mcp = files.get(pluginMcpPath(host));
    if (!mcp) throw new Error('invalid-managed-receipt');
    const sourceEndpoint = pluginMcpEndpointEvidence(mcp, host);
    return parseManagedPluginReceipt({
        schemaVersion: 1,
        host,
        selection: {
            configRoot: selection.configRoot,
            marketplaceSource: selection.marketplaceSource,
            executable: selection.executable ?? null,
            pluginRoot: selection.pluginRoot ?? null,
        },
        native,
        record,
        files: [...files]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: digest(bytes) })),
        mcpSourceEndpoint: sourceEndpoint.endpoint,
        mcpSourceUrlOffset: sourceEndpoint.byteOffset,
    });
}

export async function restoreReceiptFiles(receipt: ManagedPluginReceipt): Promise<Map<string, Buffer>> {
    try {
        const actual = await readPluginTree(receipt.native.root, receipt.host);
        if (actual.size !== receipt.files.length) throw new Error();
        const expected = new Map<string, Buffer>();
        for (const item of receipt.files) {
            const observed = actual.get(item.path);
            if (!observed) throw new Error();
            const bytes =
                item.path === pluginMcpPath(receipt.host)
                    ? overlayPluginEndpoint(
                          observed,
                          receipt.host,
                          receipt.mcpSourceEndpoint,
                          receipt.mcpSourceUrlOffset,
                      )
                    : observed;
            if (!bytes || bytes.length !== item.size || digest(bytes) !== item.sha256) throw new Error();
            expected.set(item.path, bytes);
        }
        verifyPluginFiles(receipt.host, receipt.record.version, expected, actual);
        return expected;
    } catch {
        throw new Error('managed-receipt-payload-changed');
    }
}

/** App-owned metadata only. Construct after singleton/data-root admission; never in a renderer. */
export class JsonHostPluginReceiptStore implements HostPluginReceiptStore {
    private readonly directory: string;
    constructor(directory: string) {
        this.directory = directory;
    }

    async read(host: PluginHost): Promise<unknown> {
        try {
            if (host !== 'codex' && host !== 'claude') throw new Error();
            const root = await canonicalPluginRoot(this.directory);
            const file = path.join(root, `${host}-managed-plugin.json`);
            const identity = await lstat(file);
            if (
                !identity.isFile() ||
                identity.isSymbolicLink() ||
                identity.nlink !== 1 ||
                identity.size > 16 * 1024 * 1024
            )
                throw new Error();
            return JSON.parse((await readRegularFile(file)).toString('utf8'));
        } catch (error) {
            if (errorCode(error) === 'ENOENT') return undefined;
            throw new Error('invalid-managed-receipt');
        }
    }

    async write(host: PluginHost, receipt: ManagedPluginReceipt): Promise<void> {
        let temporary: string | undefined;
        try {
            const validated = parseManagedPluginReceipt(receipt);
            if (validated.host !== host) throw new Error();
            const old = await this.read(host);
            if (old !== undefined) parseManagedPluginReceipt(old);
            const root = await canonicalPluginRoot(this.directory);
            const rootIdentity = await lstat(root, { bigint: true });
            const file = path.join(root, `${host}-managed-plugin.json`);
            let previous: BigIntStats | undefined;
            try {
                previous = await lstat(file, { bigint: true });
            } catch (error) {
                if (errorCode(error) !== 'ENOENT') throw error;
            }
            temporary = path.join(root, `.dct-receipt-${randomUUID()}.tmp`);
            const handle = await open(temporary, 'wx', 0o600);
            try {
                await handle.writeFile(`${JSON.stringify(validated, null, 4)}\n`);
                await handle.sync();
            } finally {
                await handle.close();
            }
            const currentRoot = await lstat(root, { bigint: true });
            if (
                (await canonicalPluginRoot(this.directory)) !== root ||
                rootIdentity.ino !== currentRoot.ino ||
                rootIdentity.dev !== currentRoot.dev
            )
                throw new Error();
            if (previous) {
                const current = await lstat(file, { bigint: true });
                if (
                    current.nlink !== 1n ||
                    current.isSymbolicLink() ||
                    previous.ino !== current.ino ||
                    previous.dev !== current.dev ||
                    previous.mtimeNs !== current.mtimeNs ||
                    previous.ctimeNs !== current.ctimeNs
                )
                    throw new Error();
            } else {
                try {
                    await lstat(file);
                    throw new Error('receipt-file-appeared');
                } catch (error) {
                    if (errorCode(error) !== 'ENOENT') throw error;
                }
            }
            await rename(temporary, file);
            const after = parseManagedPluginReceipt(await this.read(host));
            if (JSON.stringify(after) !== JSON.stringify(validated)) throw new Error();
        } catch {
            throw new Error('managed-receipt-write-failed');
        } finally {
            if (temporary) await rm(temporary, { force: true });
        }
    }
}
