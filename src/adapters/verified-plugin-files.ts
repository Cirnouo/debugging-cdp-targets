import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
    OWN_PLUGIN,
    type PluginHost,
    pluginManifestPath,
    pluginMcpPath,
    validateAppEndpoint,
} from '../domains/host-management.ts';
import { isRecord } from '../shared/errors.ts';
import { readRegularFile } from './file-evidence.ts';

export type PluginFiles = ReadonlyMap<string, Buffer>;

/** Claude 2.1.302 creates this directory for PID/creation-time leases and may leave it empty at exit. */
export async function assertClaudePluginUnused(root: string): Promise<void> {
    const lease = path.join(root, '.in_use');
    let identity: BigIntStats;
    try {
        identity = await lstat(lease, { bigint: true });
    } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') return;
        throw new Error('plugin-in-use');
    }
    try {
        if (!identity.isDirectory() || identity.isSymbolicLink() || (await readdir(lease)).length > 0)
            throw new Error('plugin-in-use');
        await canonicalPluginRoot(lease);
        const after = await lstat(lease, { bigint: true });
        if (
            !after.isDirectory() ||
            after.isSymbolicLink() ||
            after.ino !== identity.ino ||
            after.dev !== identity.dev ||
            after.mtimeNs !== identity.mtimeNs ||
            after.ctimeNs !== identity.ctimeNs
        )
            throw new Error('plugin-in-use');
    } catch {
        throw new Error('plugin-in-use');
    }
}

export async function canonicalPluginRoot(root: string): Promise<string> {
    if (!path.isAbsolute(root)) throw new Error('invalid-payload-root');
    const normalized = path.resolve(root);
    const actual = await realpath(normalized);
    const equal =
        process.platform === 'win32' ? actual.toLowerCase() === normalized.toLowerCase() : actual === normalized;
    if (!equal) throw new Error('linked-payload-directory');
    let current = normalized;
    for (;;) {
        const stat = await lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('linked-payload-directory');
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return actual;
}

/** Exact bounded regular-file tree; no symlinks, junctions, hard links or path aliases. */
export async function readPluginTree(root: string, host?: PluginHost): Promise<Map<string, Buffer>> {
    const canonical = await canonicalPluginRoot(root);
    const identity = await lstat(canonical, { bigint: true });
    const files = new Map<string, Buffer>();
    const names = new Set<string>();
    let total = 0;
    let entries = 0;
    async function walk(directory: string, prefix: string) {
        const children = await readdir(directory, { withFileTypes: true });
        if (prefix && children.length === 0) throw new Error('invalid-payload-layout');
        for (const entry of children) {
            if (++entries > 512 || !entry.name || /[\\:\x00-\x1f]/.test(entry.name))
                throw new Error('invalid-payload-layout');
            const relative = prefix + entry.name;
            if (names.has(relative.toLowerCase())) throw new Error('ambiguous-payload-layout');
            names.add(relative.toLowerCase());
            const file = path.join(directory, entry.name);
            const stat = await lstat(file);
            if (host === 'claude' && !prefix && entry.name === '.in_use') {
                await assertClaudePluginUnused(canonical);
                continue;
            }
            if (stat.isSymbolicLink()) throw new Error('linked-payload-file');
            if (stat.isDirectory()) {
                await canonicalPluginRoot(file);
                await walk(file, `${relative}/`);
            } else {
                if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024)
                    throw new Error('invalid-payload-file');
                const bytes = await readRegularFile(file);
                total += bytes.length;
                if (total > 16 * 1024 * 1024) throw new Error('oversized-payload');
                files.set(relative, bytes);
            }
        }
    }
    await walk(canonical, '');
    const after = await lstat(canonical, { bigint: true });
    if (identity.dev !== after.dev || identity.ino !== after.ino || identity.mtimeNs !== after.mtimeNs)
        throw new Error('moved-payload-root');
    return files;
}

function jsonObject(bytes: Buffer | undefined): Record<string, unknown> {
    if (!bytes) throw new Error('invalid-payload-layout');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value)) throw new Error('invalid-payload-json');
    return value;
}

function ownServer(document: Record<string, unknown>, host: PluginHost): Record<string, unknown> {
    if (!isRecord(document.mcpServers) || !isRecord(document.mcpServers['cdp-targets']))
        throw new Error('invalid-payload-transport');
    const server = document.mcpServers['cdp-targets'];
    if (
        server.type !== (host === 'codex' ? 'streamable-http' : 'http') ||
        typeof server.url !== 'string' ||
        ['command', 'args', 'cwd'].some((key) => Object.hasOwn(server, key))
    )
        throw new Error('invalid-payload-transport');
    validateAppEndpoint(server.url);
    return server;
}

/** Let JSON.parse identify the unique own-value literal; no headers or full JSON enter the receipt. */
export function pluginMcpEndpointEvidence(bytes: Buffer, host: PluginHost): { endpoint: string; byteOffset: number } {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) throw new Error('invalid-payload-json');
    const document = jsonObject(bytes);
    const server = ownServer(document, host);
    const endpoint = server.url;
    if (typeof endpoint !== 'string') throw new Error('invalid-payload-transport');
    const original = Buffer.from(JSON.stringify(endpoint));
    server.url = endpoint === 'http://127.0.0.1:1/mcp' ? 'http://127.0.0.1:2/mcp' : 'http://127.0.0.1:1/mcp';
    const replacement = Buffer.from(JSON.stringify(server.url));
    let result: number | undefined;
    let candidates = 0;
    for (
        let offset = bytes.indexOf(original);
        offset !== -1;
        offset = bytes.indexOf(original, offset + original.length)
    ) {
        if (++candidates > 64) throw new Error('ambiguous-payload-overlay');
        const candidate = Buffer.concat([
            bytes.subarray(0, offset),
            replacement,
            bytes.subarray(offset + original.length),
        ]);
        let parsed: unknown;
        try {
            parsed = JSON.parse(candidate.toString('utf8'));
        } catch {
            continue;
        }
        if (!isDeepStrictEqual(document, parsed)) continue;
        if (result !== undefined) throw new Error('ambiguous-payload-overlay');
        result = offset;
    }
    if (result === undefined) throw new Error('invalid-payload-overlay');
    return { endpoint, byteOffset: result };
}

/** Only the proved own string literal may differ from immutable source bytes. */
export function overlayPluginEndpoint(bytes: Buffer, host: PluginHost, endpoint: string, byteOffset?: number): Buffer {
    validateAppEndpoint(endpoint);
    const original = pluginMcpEndpointEvidence(bytes, host);
    if (byteOffset !== undefined && original.byteOffset !== byteOffset) throw new Error('mismatched-payload-overlay');
    if (original.endpoint === endpoint) return bytes;
    return Buffer.concat([
        bytes.subarray(0, original.byteOffset),
        Buffer.from(JSON.stringify(endpoint)),
        bytes.subarray(original.byteOffset + Buffer.byteLength(JSON.stringify(original.endpoint))),
    ]);
}

export function verifyPluginFiles(
    host: PluginHost,
    version: string,
    expected: PluginFiles,
    actual: PluginFiles,
    overlay = true,
) {
    const manifest = jsonObject(actual.get(pluginManifestPath(host)));
    const sourceManifest = jsonObject(expected.get(pluginManifestPath(host)));
    if (
        manifest.name !== OWN_PLUGIN ||
        manifest.version !== version ||
        sourceManifest.name !== OWN_PLUGIN ||
        sourceManifest.version !== version
    )
        throw new Error('invalid-payload-manifest');
    if (actual.size !== expected.size) throw new Error('mismatched-payload-files');
    for (const [name, bytes] of expected) {
        const observed = actual.get(name);
        if (!observed) throw new Error('mismatched-payload-files');
        if (name !== pluginMcpPath(host) || !overlay) {
            if (!bytes.equals(observed)) throw new Error('mismatched-payload-bytes');
        } else {
            const current = jsonObject(observed);
            const endpoint = ownServer(current, host).url;
            if (typeof endpoint !== 'string' || !overlayPluginEndpoint(bytes, host, endpoint).equals(observed))
                throw new Error('mismatched-payload-overlay');
        }
    }
    const mcp = actual.get(pluginMcpPath(host));
    if (!mcp) throw new Error('invalid-payload-layout');
    pluginMcpEndpointEvidence(mcp, host);
}

/** Only the own URL is mutable. Caller has already established exclusive user provenance. */
export async function patchPluginEndpoint(
    host: PluginHost,
    root: string,
    version: string,
    expected: PluginFiles,
    endpoint: string,
    io: { rename?: typeof rename; afterWrite?: () => Promise<void> } = {},
) {
    validateAppEndpoint(endpoint);
    const canonical = await canonicalPluginRoot(root);
    const identity = await lstat(canonical, { bigint: true });
    const before = await readPluginTree(canonical, host);
    verifyPluginFiles(host, version, expected, before);
    const name = pluginMcpPath(host);
    const document = jsonObject(before.get(name));
    if (ownServer(document, host).url === endpoint) return;
    const currentBytes = before.get(name);
    if (!currentBytes) throw new Error('invalid-payload-layout');
    const patched = overlayPluginEndpoint(currentBytes, host, endpoint);
    const file = path.join(canonical, name);
    const original = await lstat(file, { bigint: true });
    const temporary = path.join(canonical, `.dct-url-${randomUUID()}.tmp`);
    try {
        const handle = await open(temporary, 'wx', Number(original.mode & 0o777n));
        try {
            await handle.writeFile(patched);
            await handle.sync();
        } finally {
            await handle.close();
        }
        const current = await lstat(file, { bigint: true });
        const directory = await lstat(canonical, { bigint: true });
        if (host === 'claude') await assertClaudePluginUnused(canonical);
        if (
            (await canonicalPluginRoot(root)) !== canonical ||
            directory.ino !== identity.ino ||
            directory.dev !== identity.dev ||
            current.ino !== original.ino ||
            current.dev !== original.dev ||
            current.nlink !== 1n ||
            current.mtimeNs !== original.mtimeNs ||
            current.ctimeNs !== original.ctimeNs
        )
            throw new Error('moved-payload');
        await (io.rename ?? rename)(temporary, file);
    } catch {
        throw new Error('plugin-url-write-failed');
    } finally {
        await rm(temporary, { force: true });
    }
    try {
        await io.afterWrite?.();
        const directory = await lstat(canonical, { bigint: true });
        if (directory.ino !== identity.ino || directory.dev !== identity.dev) throw new Error('moved-payload');
        const after = await readPluginTree(canonical, host);
        verifyPluginFiles(host, version, expected, after);
        if (ownServer(jsonObject(after.get(name)), host).url !== endpoint) throw new Error('mismatched-url');
    } catch {
        throw new Error('plugin-url-readback-failed');
    }
}
