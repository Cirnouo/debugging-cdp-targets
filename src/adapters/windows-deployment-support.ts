import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    decodeWindowsDeploymentCopyHeader,
    decodeWindowsDeploymentCopyReply,
    decodeWindowsDeploymentFacts,
    decodeWindowsDeploymentQuery,
    encodeWindowsDeploymentMutation,
    packWindowsDeploymentQueries,
} from './windows-deployment-protocol.ts';
import { runWindowsDeploymentStream } from './windows-deployment-stream.ts';

const helperDirectory = fileURLToPath(new URL('.', import.meta.url));
// This explicit build-only toolchain profile has no PATH/env/compiler fallback.
const compilerDirectory = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319';
const compiler = path.join(compilerDirectory, 'csc.exe');
const referenceNames = ['mscorlib.dll', 'System.dll', 'System.Core.dll'] as const;
const sourceNames = ['windows-deployment-authority.cs', 'windows-deployment-create.cs'] as const;
const outputNames = ['windows-deployment-query.exe', 'windows-deployment-create.exe'] as const;
type Record = Readonly<{ name: string; stats: BigIntStats; bytes: Buffer; sha256: string; singleLink: boolean }>;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a: BigIntStats, b: BigIntStats) =>
    same(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

async function record(name: string, maximum: number, singleLink = true): Promise<Record> {
    const handle = await open(name, 'r');
    let result: Record | undefined;
    try {
        const before = await handle.stat({ bigint: true });
        if (
            !before.isFile() ||
            before.isSymbolicLink() ||
            before.nlink < 1n ||
            (singleLink && before.nlink !== 1n) ||
            before.size < 1n ||
            before.size > BigInt(maximum) ||
            (await realpath(name)) !== name
        )
            throw new Error('Unsafe deployment build input.');
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let used = 0;
        while (used < bytes.length) {
            const result = await handle.read(bytes, used, bytes.length - used, used);
            if (!result.bytesRead) break;
            used += result.bytesRead;
        }
        const after = await handle.stat({ bigint: true }),
            named = await lstat(name, { bigint: true });
        if (
            used !== Number(before.size) ||
            !unchanged(before, after) ||
            !unchanged(after, named) ||
            !after.isFile() ||
            !named.isFile() ||
            named.isSymbolicLink()
        )
            throw new Error('Deployment build input identity changed.');
        const content = bytes.subarray(0, used);
        result = Object.freeze({ name, stats: after, bytes: content, sha256: hash(content), singleLink });
    } catch (error) {
        try {
            await handle.close();
        } catch (close) {
            throw new AggregateError([error, close], 'Deployment input and close failures.');
        }
        throw error;
    }
    await handle.close();
    if (!result) throw new Error('Missing actual deployment input.');
    return result;
}
async function current(expected: Record) {
    const actual = await record(expected.name, expected.bytes.length, expected.singleLink);
    if (!unchanged(actual.stats, expected.stats) || actual.sha256 !== expected.sha256)
        throw new Error('Deployment support identity/bytes changed.');
}
async function writeOwned(name: string, bytes: Buffer): Promise<Record> {
    const handle = await open(name, 'wx');
    let created: BigIntStats;
    try {
        await handle.writeFile(bytes);
        await handle.sync();
        created = await handle.stat({ bigint: true });
        if (
            !created.isFile() ||
            created.isSymbolicLink() ||
            created.nlink !== 1n ||
            created.size !== BigInt(bytes.length)
        )
            throw new Error('Unsafe deployment materialization descriptor.');
    } catch (error) {
        try {
            await handle.close();
        } catch (close) {
            throw new AggregateError([error, close], 'Deployment materialization and close failures.');
        }
        throw error;
    }
    await handle.close();
    const actual = await record(name, bytes.length);
    // Writer close may finalize timestamps. Bind ownership by the actual wx identity;
    // record independently enforces stable post-close metadata and complete bytes.
    if (!same(created, actual.stats) || created.nlink !== actual.stats.nlink || created.size !== actual.stats.size)
        throw new Error('Deployment support materialization identity changed.');
    if (!actual.bytes.equals(bytes)) throw new Error('Deployment support materialization changed.');
    return actual;
}
async function fixedInputs(names: readonly string[], maximum: number, singleLink = true) {
    const outcomes = await Promise.allSettled(names.map((name) => record(name, maximum, singleLink)));
    const errors = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Deployment fixed input failures.');
    return outcomes.filter((outcome) => outcome.status === 'fulfilled').map((outcome) => outcome.value);
}

/** Actual build producer; no inputs permit a caller to select helper source, compiler, receipt or executable. */
export async function buildWindowsDeploymentSupport() {
    if (process.platform !== 'win32' || process.arch !== 'x64')
        throw new Error('Deployment support build requires the Windows x64 fixed compiler profile.');
    const reservationName = path.join(helperDirectory, '.windows-deployment-build.lock');
    const reservation = await open(reservationName, 'wx');
    let reservationIdentity: BigIntStats;
    try {
        reservationIdentity = await reservation.stat({ bigint: true });
    } catch (error) {
        try {
            await reservation.close();
        } catch (close) {
            throw new AggregateError([error, close], 'Deployment reservation and close failures.');
        }
        // No verified named identity exists; retain the reservation rather than unlink by spelling.
        throw error;
    }
    const artifacts: Record[] = [];
    let scratch: string | undefined;
    let scratchIdentity: BigIntStats | undefined;
    let sourceInputs: Record[] = [];
    let closed = false;
    let active = false;
    async function clean() {
        const errors: unknown[] = [];
        for (const artifact of [...artifacts].reverse()) {
            try {
                await current(artifact);
                await unlink(artifact.name);
            } catch (error) {
                errors.push(error);
            }
        }
        let ownedReservation = false;
        try {
            const named = await lstat(reservationName, { bigint: true });
            if (!same(named, reservationIdentity) || named.nlink !== 1n || named.size !== 0n)
                throw new Error('Deployment build reservation identity changed.');
            ownedReservation = true;
        } catch (error) {
            errors.push(error);
        }
        let reservationClosed = false;
        try {
            await reservation.close();
            reservationClosed = true;
        } catch (error) {
            errors.push(error);
        }
        if (ownedReservation && reservationClosed) {
            try {
                const named = await lstat(reservationName, { bigint: true });
                if (!same(named, reservationIdentity) || named.nlink !== 1n || named.size !== 0n)
                    throw new Error('Deployment build reservation changed before removal.');
                await unlink(reservationName);
            } catch (error) {
                errors.push(error);
            }
        }
        if (scratch && scratchIdentity) {
            try {
                const actual = await lstat(scratch, { bigint: true });
                if (!same(actual, scratchIdentity) || (await realpath(scratch)) !== scratch)
                    throw new Error('Deployment compiler scratch identity changed; retained.');
                await rm(scratch, { recursive: true });
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length) throw new AggregateError(errors, 'Deployment support identity/cleanup failures.');
    }
    try {
        // Collision checks precede any compilation; existing bytes are never an output or fallback.
        for (const name of outputNames) {
            try {
                await lstat(path.join(helperDirectory, name));
            } catch (error) {
                if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
                throw error;
            }
            throw new Error('Deployment executable already exists; collision.');
        }
        const compilerInput = await record(compiler, 64 * 1024 * 1024, false);
        sourceInputs = await fixedInputs(
            sourceNames.map((name) => path.join(helperDirectory, name)),
            1024 * 1024,
        );
        const references = await fixedInputs(
            referenceNames.map((name) => path.join(compilerDirectory, name)),
            64 * 1024 * 1024,
            false,
        );
        scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-deployment-support-')));
        const buildDirectory = scratch;
        scratchIdentity = await lstat(scratch, { bigint: true });
        const frozen = [];
        for (const input of [...sourceInputs, ...references])
            frozen.push(await writeOwned(path.join(buildDirectory, path.basename(input.name)), input.bytes));
        const recipes: string[][] = [];
        for (const [index, name] of outputNames.entries()) {
            const output = path.join(buildDirectory, name);
            const sources = index === 0 ? sourceNames.slice(0, 1) : sourceNames;
            const args = [
                '/nologo',
                '/noconfig',
                '/nostdlib+',
                '/target:exe',
                '/platform:x64',
                `/main:${index === 0 ? 'DctDeploymentQueryProgram' : 'DctDeploymentCreateProgram'}`,
                `/out:${output}`,
                ...referenceNames.map((reference) => `/reference:${path.join(buildDirectory, reference)}`),
                ...sources.map((source) => path.join(buildDirectory, source)),
            ];
            for (const item of [compilerInput, ...frozen]) await current(item);
            await new Promise<void>((resolve, reject) => {
                execFile(
                    compiler,
                    args,
                    {
                        shell: false,
                        windowsHide: true,
                        cwd: scratch,
                        env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' },
                        encoding: 'utf8',
                        maxBuffer: 1024 * 1024,
                    },
                    (error, stdout, stderr) => {
                        if (error || stdout || stderr)
                            reject(
                                new Error('Deployment compiler failed or emitted diagnostics.', {
                                    cause: { error, stdout, stderr },
                                }),
                            );
                        else resolve();
                    },
                );
            });
            for (const item of [compilerInput, ...frozen, ...sourceInputs, ...references]) await current(item);
            const built = await record(output, 16 * 1024 * 1024);
            inspectWindowsDeploymentExecutable(built.bytes);
            artifacts.push(await writeOwned(path.join(helperDirectory, name), built.bytes));
            recipes.push(args);
        }
        const receipt = Object.freeze({
            compiler: { path: compilerInput.name, bytes: compilerInput.bytes.length, sha256: compilerInput.sha256 },
            inputs: [...sourceInputs, ...references].map((input) =>
                Object.freeze({ path: input.name, bytes: input.bytes.length, sha256: input.sha256 }),
            ),
            recipes: recipes.map((args) => Object.freeze([...args])),
            outputs: artifacts.map((artifact) =>
                Object.freeze({
                    name: path.basename(artifact.name),
                    bytes: artifact.bytes.length,
                    sha256: artifact.sha256,
                    ...inspectWindowsDeploymentExecutable(artifact.bytes),
                }),
            ),
        });
        async function run(index: number, args: string[], input: AsyncIterable<Buffer>, maximum: number) {
            if (closed || active) throw new Error('Deployment build lifetime is closed or busy.');
            active = true;
            const artifact = artifacts[index];
            try {
                if (!artifact) throw new Error('Missing actual deployment build output.');
                for (const source of sourceInputs) await current(source);
                const locked = await lstat(reservationName, { bigint: true });
                if (!same(locked, reservationIdentity)) throw new Error('Deployment build reservation changed.');
                await current(artifact);
                const child = spawn(artifact.name, args, {
                    shell: false,
                    windowsHide: true,
                    cwd: helperDirectory,
                    env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                const inputFailure = new AbortController();
                let inputCompleted = false;
                async function* finiteInput() {
                    const iterator = input[Symbol.asyncIterator]();
                    let primary: unknown,
                        failed = false;
                    async function closeInput() {
                        if (!inputCompleted && iterator.return) {
                            try {
                                await iterator.return();
                            } catch (close) {
                                throw failed
                                    ? new AggregateError(
                                          [primary, close],
                                          'Deployment input and source close failures.',
                                      )
                                    : close;
                            }
                        }
                    }
                    try {
                        while (true) {
                            const next = await iterator.next();
                            if (next.done) {
                                inputCompleted = true;
                                break;
                            }
                            yield next.value;
                        }
                    } catch (error) {
                        primary = error;
                        failed = true;
                        throw error;
                    } finally {
                        await closeInput();
                    }
                }
                // All three fixed entry protocols produce their sole result only after exact input EOF.
                // Malformed premature output stops bodies immediately while the pump continues draining.
                const premature = (bytes: unknown) => {
                    if (Buffer.isBuffer(bytes) && bytes.length && !inputCompleted)
                        inputFailure.abort(new Error('Deployment result arrived before complete input EOF.'));
                };
                child.stdout.on('data', premature);
                // Observe/drain immediately; post-spawn replacement checks cannot abandon this child.
                const pending = runWindowsDeploymentStream(
                    child,
                    finiteInput(),
                    { stdout: maximum, stderr: 65536 },
                    inputFailure.signal,
                )
                    .then(
                        (bytes) => ({ bytes, error: undefined }),
                        (error: unknown) => ({ bytes: undefined, error }),
                    )
                    .finally(() => child.stdout.removeListener('data', premature));
                let failure: unknown;
                try {
                    await current(artifact);
                } catch (error) {
                    failure = error;
                    inputFailure.abort(error);
                }
                const terminal = await pending;
                const bytes = terminal.bytes;
                if (terminal.error) failure = failure ? new AggregateError([failure, terminal.error]) : terminal.error;
                try {
                    await current(artifact);
                } catch (error) {
                    failure = failure ? new AggregateError([failure, error]) : error;
                }
                if (failure) throw failure;
                if (!bytes) throw new Error('Missing deployment helper reply.');
                return bytes;
            } finally {
                active = false;
            }
        }
        return Object.freeze({
            receipt,
            async query(names: readonly string[]) {
                const result: unknown[] = [];
                for (const batch of packWindowsDeploymentQueries(names)) {
                    async function* input() {
                        yield batch;
                    }
                    result.push(
                        ...decodeWindowsDeploymentFacts(
                            await run(0, [], input(), 16 * 1024 * 1024),
                            decodeWindowsDeploymentQuery(batch),
                        ),
                    );
                }
                return result;
            },
            async mutate(
                operation: 'create-root' | 'create-directory' | 'publish',
                request: Readonly<{
                    root: string;
                    relative: string;
                    destination: string;
                    device: string;
                    inode: string;
                    sourceInode: string;
                    parentInode: string;
                }>,
            ) {
                const { root, relative, destination, device, inode, sourceInode, parentInode } = request;
                const bytes = encodeWindowsDeploymentMutation([
                    operation,
                    root,
                    relative,
                    destination,
                    device,
                    inode,
                    sourceInode,
                    parentInode,
                ]);
                const target =
                    operation === 'create-root'
                        ? root
                        : path.win32.join(root, operation === 'publish' ? destination : relative);
                async function* input() {
                    for (let offset = 0; offset < bytes.length; offset += 65536)
                        yield bytes.subarray(offset, offset + 65536);
                }
                return decodeWindowsDeploymentFacts(await run(1, ['mutate'], input(), 65548), [target])[0];
            },
            async copy(header: Buffer, bodies: AsyncIterable<Buffer>) {
                const captured = Buffer.from(header);
                const plan = decodeWindowsDeploymentCopyHeader(captured);
                const expected =
                    2 *
                    (plan.manifestLength +
                        plan.entries.reduce((total, entry) => total + (entry.type === 'file' ? entry.bytes : 0), 0));
                async function* input() {
                    for (let offset = 0; offset < captured.length; offset += 65536)
                        yield captured.subarray(offset, offset + 65536);
                    let used = 0;
                    const iterator = bodies[Symbol.asyncIterator]();
                    let completed = false,
                        primary: unknown,
                        failed = false;
                    async function closeBodies() {
                        if (!completed && iterator.return) {
                            try {
                                await iterator.return();
                            } catch (close) {
                                throw failed
                                    ? new AggregateError([primary, close], 'Deployment body and source close failures.')
                                    : close;
                            }
                        }
                    }
                    try {
                        while (true) {
                            const next = await iterator.next();
                            if (next.done) {
                                completed = true;
                                break;
                            }
                            const bytes = next.value;
                            if (!Buffer.isBuffer(bytes) || bytes.length > 65536 || used + bytes.length > expected)
                                throw new Error('Invalid bounded deployment copy body.');
                            used += bytes.length;
                            yield bytes;
                        }
                        if (used !== expected) throw new Error('Short deployment copy source bodies.');
                    } catch (error) {
                        primary = error;
                        failed = true;
                        throw error;
                    } finally {
                        await closeBodies();
                    }
                }
                return decodeWindowsDeploymentCopyReply(await run(1, ['copy'], input(), 2 * 1024 * 1024), plan);
            },
            async release() {
                if (closed || active) throw new Error('Deployment build lifetime is closed or busy.');
                closed = true;
                await clean();
            },
        });
    } catch (error) {
        try {
            await clean();
        } catch (cleanup) {
            throw new AggregateError([error, cleanup], 'Deployment build and cleanup failures.');
        }
        throw error;
    }
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
