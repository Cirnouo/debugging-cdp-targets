import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../shared/errors.ts';
import {
    decodeWindowsDeploymentFacts,
    decodeWindowsDeploymentQuery,
    packWindowsDeploymentQueries,
} from './windows-deployment-protocol.ts';
import { runWindowsDeploymentStream } from './windows-deployment-stream.ts';

declare const __DCT_DEPLOYMENT_QUERY__: unknown;
const moduleFile = fileURLToPath(import.meta.url);
const sibling = path.join(path.dirname(moduleFile), 'windows-deployment-query.exe');

/** Internal source-owned expectation only; callers cannot supply a backend or digest. */
export function requireWindowsDeploymentQueryBinding() {
    const value: unknown =
        typeof __DCT_DEPLOYMENT_QUERY__ === 'undefined' ? { kind: 'unbound' } : __DCT_DEPLOYMENT_QUERY__;
    if (!isRecord(value)) throw new Error('Invalid intrinsic deployment query binding.');
    if (value.kind === 'unbound' && Object.keys(value).length === 1)
        throw new Error('Deployment query is unbound; native delivery is required.');
    if (
        Object.keys(value).sort().join(',') !== 'architecture,bytes,kind,machine,name,platform,runtime,sha256' ||
        value.kind !== 'bound' ||
        value.platform !== 'win32' ||
        value.architecture !== 'x64' ||
        value.name !== 'windows-deployment-query.exe' ||
        value.machine !== 'x64' ||
        value.runtime !== 'v4.0.30319' ||
        typeof value.bytes !== 'number' ||
        !Number.isSafeInteger(value.bytes) ||
        value.bytes < 1 ||
        value.bytes > 16 * 1024 * 1024 ||
        typeof value.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(value.sha256)
    )
        throw new Error('Invalid intrinsic deployment query binding.');
    return Object.freeze({ bytes: value.bytes, sha256: value.sha256 });
}

/** Ordinary Windows read capability, intrinsically bound to its exact delivered sibling. */
export async function openWindowsDeploymentQuery() {
    const binding = requireWindowsDeploymentQueryBinding();
    if (process.platform !== 'win32' || process.arch !== 'x64')
        throw new Error('Deployment query native cell is unsupported.');
    const appDirectory = path.dirname(moduleFile),
        resources = path.dirname(appDirectory),
        buildRoot = path.dirname(resources);
    if (
        !['app-main.mjs', 'deployment-worker.mjs'].includes(path.basename(moduleFile)) ||
        path.basename(appDirectory) !== 'app' ||
        path.basename(resources) !== 'resources' ||
        path.basename(path.dirname(buildRoot)) !== 'builds' ||
        !/^[0-9a-f]{64}$/.test(path.basename(buildRoot))
    )
        throw new Error('Deployment query requires its canonical enrolled build placement.');
    const same = (a: BigIntStats, b: BigIntStats) =>
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.nlink === b.nlink &&
        a.size === b.size &&
        a.mtimeNs === b.mtimeNs &&
        a.ctimeNs === b.ctimeNs;
    let identity: BigIntStats | undefined;
    let moduleIdentity: BigIntStats | undefined;
    async function current() {
        if ((await realpath(moduleFile)) !== moduleFile || (await realpath(sibling)) !== sibling)
            throw new Error('Deployment query placement is aliased.');
        const own = await lstat(moduleFile, { bigint: true });
        if (!own.isFile() || own.isSymbolicLink() || own.nlink !== 1n || (moduleIdentity && !same(moduleIdentity, own)))
            throw new Error('Deployment query module identity changed.');
        moduleIdentity ??= own;
        const handle = await open(sibling, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let primary: unknown,
            failed = false;
        try {
            const before = await handle.stat({ bigint: true });
            if (
                !before.isFile() ||
                before.isSymbolicLink() ||
                before.nlink !== 1n ||
                before.size !== BigInt(binding.bytes)
            )
                throw new Error('Unsafe deployment query identity.');
            const bytes = Buffer.alloc(binding.bytes + 1);
            let used = 0;
            while (used < bytes.length) {
                const result = await handle.read(bytes, used, bytes.length - used, used);
                if (!result.bytesRead) break;
                used += result.bytesRead;
            }
            const after = await handle.stat({ bigint: true }),
                named = await lstat(sibling, { bigint: true });
            if (
                !same(before, after) ||
                !same(after, named) ||
                !named.isFile() ||
                named.isSymbolicLink() ||
                used !== binding.bytes ||
                createHash('sha256').update(bytes.subarray(0, used)).digest('hex') !== binding.sha256 ||
                (identity && !same(identity, after))
            )
                throw new Error('Deployment query identity/bytes changed.');
            inspectWindowsDeploymentExecutable(bytes.subarray(0, used));
            identity ??= after;
        } catch (error) {
            primary = error;
            failed = true;
        }
        try {
            await handle.close();
        } catch (close) {
            throw failed ? new AggregateError([primary, close], 'Query identity and close failures.') : close;
        }
        if (failed) throw primary;
    }
    await current();
    let active = false;
    return Object.freeze({
        async query(names: readonly string[]) {
            if (active) throw new Error('Deployment query is busy.');
            active = true;
            const facts: unknown[] = [];
            try {
                for (const batch of packWindowsDeploymentQueries(names)) {
                    await current();
                    const child = spawn(sibling, [], {
                        shell: false,
                        windowsHide: true,
                        cwd: path.dirname(sibling),
                        env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' },
                        stdio: ['pipe', 'pipe', 'pipe'],
                    });
                    async function* input() {
                        yield batch;
                    }
                    const pending = runWindowsDeploymentStream(child, input(), {
                        stdout: 16 * 1024 * 1024,
                        stderr: 65536,
                    }).then(
                        (bytes) => ({ bytes, error: undefined }),
                        (error: unknown) => ({ bytes: undefined, error }),
                    );
                    let failure: unknown;
                    try {
                        await current();
                    } catch (error) {
                        failure = error;
                    }
                    const terminal = await pending;
                    if (terminal.error)
                        failure = failure ? new AggregateError([failure, terminal.error]) : terminal.error;
                    try {
                        await current();
                    } catch (error) {
                        failure = failure ? new AggregateError([failure, error]) : error;
                    }
                    if (failure) throw failure;
                    if (!terminal.bytes) throw new Error('Missing deployment query result.');
                    facts.push(...decodeWindowsDeploymentFacts(terminal.bytes, decodeWindowsDeploymentQuery(batch)));
                }
                return facts;
            } finally {
                active = false;
            }
        },
    });
}

/** Structure only; compilation and runtime/native acceptance are distinct gates. */
export function inspectWindowsDeploymentExecutable(bytes: Buffer) {
    const fail = () => {
        throw new Error('Invalid Windows x64 CLR4 deployment executable.');
    };
    const bound = (offset: number, length: number) => {
        if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.length) fail();
    };
    const word = (offset: number) => {
        bound(offset, 2);
        return bytes.readUInt16LE(offset);
    };
    const uint = (offset: number) => {
        bound(offset, 4);
        return bytes.readUInt32LE(offset);
    };
    if (bytes.length > 16 * 1024 * 1024 || word(0) !== 0x5a4d) fail();
    const pe = uint(0x3c);
    if (uint(pe) !== 0x4550 || word(pe + 4) !== 0x8664) fail();
    const count = word(pe + 6),
        optionalSize = word(pe + 20),
        characteristics = word(pe + 22);
    if (count < 1 || count > 96 || optionalSize < 240 || (characteristics & 2) === 0 || characteristics & 0x2000)
        fail();
    const optional = pe + 24;
    bound(optional, optionalSize);
    if (word(optional) !== 0x20b || word(optional + 68) !== 3 || uint(optional + 108) < 15) fail();
    const sections = optional + optionalSize;
    bound(sections, 40 * count);
    function fileOffset(rva: number, size: number) {
        const matches: number[] = [];
        for (let index = 0; index < count; index++) {
            const section = sections + 40 * index;
            const virtual = uint(section + 12),
                rawSize = uint(section + 16),
                raw = uint(section + 20);
            if (rva >= virtual && rva + size <= virtual + rawSize) {
                bound(raw + rva - virtual, size);
                matches.push(raw + rva - virtual);
            }
        }
        if (matches.length !== 1 || matches[0] === undefined) return fail();
        return matches[0];
    }
    const cliSize = uint(optional + 228);
    if (cliSize < 72) fail();
    const cli = fileOffset(uint(optional + 224), cliSize);
    const token = uint(cli + 20);
    if (uint(cli) < 72 || uint(cli + 16) !== 1 || token >>> 24 !== 6 || (token & 0xffffff) === 0) fail();
    const metadataSize = uint(cli + 12);
    if (metadataSize < 28) fail();
    const metadata = fileOffset(uint(cli + 8), metadataSize);
    const versionSize = uint(metadata + 12);
    if (uint(metadata) !== 0x424a5342 || versionSize < 11 || versionSize > 64 || 16 + versionSize > metadataSize)
        fail();
    const version = bytes.subarray(metadata + 16, metadata + 16 + versionSize);
    if (
        !version.subarray(0, 11).equals(Buffer.from('v4.0.30319\0')) ||
        version.subarray(11).some((value) => value !== 0)
    )
        fail();
    return Object.freeze({ machine: 'x64', runtime: 'v4.0.30319' });
}
