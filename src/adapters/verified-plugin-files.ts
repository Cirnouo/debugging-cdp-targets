import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { type PluginHost, pluginMcpPath, validateAppEndpoint } from '../domains/host-management.ts';
import {
    overlayPluginEndpoint,
    type PluginPayloadFiles,
    pluginMcpEndpointEvidence,
    verifyPluginPayload,
} from '../host-plugins/payload-integrity.ts';
import { isRecord } from '../shared/errors.ts';
import { readRegularFile } from './file-evidence.ts';

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

/** Only the own URL is mutable. Caller has already established exclusive user provenance. */
export async function patchPluginEndpoint(
    host: PluginHost,
    root: string,
    version: string,
    expected: PluginPayloadFiles,
    endpoint: string,
    io: { rename?: typeof rename; afterWrite?: () => Promise<void> } = {},
) {
    validateAppEndpoint(endpoint);
    const canonical = await canonicalPluginRoot(root);
    const identity = await lstat(canonical, { bigint: true });
    const before = await readPluginTree(canonical, host);
    verifyPluginPayload(host, version, expected, before);
    const name = pluginMcpPath(host);
    const currentBytes = before.get(name);
    if (!currentBytes) throw new Error('invalid-payload-layout');
    if (pluginMcpEndpointEvidence(currentBytes, host).endpoint === endpoint) return;
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
        verifyPluginPayload(host, version, expected, after);
        const currentBytes = after.get(name);
        if (!currentBytes) throw new Error('invalid-payload-layout');
        if (pluginMcpEndpointEvidence(currentBytes, host).endpoint !== endpoint) throw new Error('mismatched-url');
    } catch {
        throw new Error('plugin-url-readback-failed');
    }
}
