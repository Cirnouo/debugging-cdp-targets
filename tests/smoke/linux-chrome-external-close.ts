import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createPlatformAdapter, type ProcessResult } from '../../src/adapters/platform-process.ts';
import { type ProcessTarget, validateCdpIdentity } from '../../src/domains/cdp-target.ts';
import type { ConnectionStatus } from '../../src/domains/control-contract.ts';

// These limits apply to real I/O as well as injected OS boundaries. No generic,
// unbounded platform executor or whole-response JSON reader is used here.
const limits = {
    operationMs: 5_000,
    ioMs: 1_000,
    proc: 16_384,
    boot: 262_144,
    command: 262_144,
    stderr: 8_192,
    endpoint: 16_384,
    path: 4_096,
};

export interface LinuxExternalCloseIo {
    readText(file: string, signal: AbortSignal): Promise<string>;
    readlink(file: string, signal: AbortSignal): Promise<string>;
    realpath(file: string, signal: AbortSignal): Promise<string>;
    run(executable: string, args: string[], signal: AbortSignal): Promise<ProcessResult>;
    fetch(url: string, signal: AbortSignal): Promise<Response>;
    currentUser(): number;
    signal(pid: number, signal: 'SIGTERM'): void;
}

function capped(text: string, bytes: number): string {
    if (typeof text !== 'string' || Buffer.byteLength(text) > bytes || text.includes('\0'))
        throw new Error('External Close evidence exceeds its byte limit or is malformed.');
    return text;
}

async function completed<T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(limits.ioMs)]);
    bounded.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        const aborted = () => reject(bounded.reason);
        bounded.addEventListener('abort', aborted, { once: true });
        Promise.resolve()
            .then(() => {
                bounded.throwIfAborted();
                return action(bounded);
            })
            .then((value) => {
                bounded.throwIfAborted();
                resolve(value);
            }, reject)
            .catch(reject)
            .finally(() => bounded.removeEventListener('abort', aborted));
    });
}

async function readProc(file: string, signal: AbortSignal): Promise<string> {
    const handle = await fs.open(file, 'r');
    try {
        const limit = file === '/proc/stat' ? limits.boot : limits.proc;
        const buffer = Buffer.alloc(limit + 1);
        let used = 0;
        for (;;) {
            signal.throwIfAborted();
            const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
            signal.throwIfAborted();
            used += bytesRead;
            if (used > limit) throw new Error('External Close proc evidence exceeds its byte limit.');
            if (!bytesRead) return buffer.subarray(0, used).toString('utf8');
        }
    } finally {
        await handle.close();
    }
}

function runCommand(executable: string, args: string[], signal: AbortSignal): Promise<ProcessResult> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = childProcess.spawn(executable, args, {
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outBytes = 0;
        let errBytes = 0;
        let finished = false;
        const finish = (error?: unknown, code?: number | null) => {
            if (finished) return;
            finished = true;
            signal.removeEventListener('abort', aborted);
            if (error) {
                child.stdout.destroy();
                child.stderr.destroy();
                child.kill('SIGTERM'); // Only this short-lived inspection command.
                child.unref();
                reject(error);
            } else
                resolve({
                    code: code ?? null,
                    stdout: Buffer.concat(stdout).toString('utf8'),
                    stderr: Buffer.concat(stderr).toString('utf8'),
                });
        };
        const aborted = () => finish(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
        child.stdout.on('data', (chunk: Buffer) => {
            outBytes += chunk.length;
            if (outBytes > limits.command) finish(new Error('External Close command stdout exceeds its byte limit.'));
            else if (!finished) stdout.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
            errBytes += chunk.length;
            if (errBytes > limits.stderr) finish(new Error('External Close command stderr exceeds its byte limit.'));
            else if (!finished) stderr.push(chunk);
        });
        child.once('error', (error) => finish(error));
        child.once('close', (code) => finish(undefined, code));
        if (signal.aborted) aborted();
    });
}

const nativeIo: LinuxExternalCloseIo = {
    readText: readProc,
    readlink: (file) => fs.readlink(file),
    realpath: (file) => fs.realpath(file),
    run: runCommand,
    fetch: (url, signal) => fetch(url, { signal, redirect: 'error' }),
    currentUser: () => {
        if (!process.getuid) throw new Error('The Linux user identity is unavailable.');
        return process.getuid();
    },
    signal: (pid, signal) => {
        process.kill(pid, signal);
    },
};

function ticks(text: string, pid: number): bigint {
    // Linux stat fields resume after the last closing comm parenthesis. Require
    // a complete single record, including field 52, rather than a field-22 prefix.
    const match = text.match(/^([1-9]\d*) \([^\n]*\) ([RSDZTtXxKWPI]) ((?:-?\d+ )*-?\d+)\n$/);
    const fields = match?.[3]?.split(' ');
    const q = fields?.[18];
    if (
        !match ||
        BigInt(match[1] ?? '0') !== BigInt(pid) ||
        !fields ||
        fields.length < 49 ||
        fields.length > 63 ||
        !q ||
        !/^\d+$/.test(q) ||
        BigInt(q) > 18_446_744_073_709_551_615n
    )
        throw new Error('The raw Linux start_ticks record is incomplete or malformed.');
    return BigInt(q);
}

function completeNativeOutput(command: string, args: string[], text: string): void {
    if (command === 'getconf') return;
    if (text && !text.endsWith('\n')) throw new Error('Native identity output is incomplete.');
    const lines = text ? text.slice(0, -1).split('\n') : [];
    if (command === 'ps') {
        const seen = new Set<string>();
        for (const line of lines) {
            const row = line.match(/^\s*([1-9]\d*)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
            if (
                !row ||
                seen.has(row[1] ?? '') ||
                ![row[1], row[2], row[3]].every((v) => Number.isSafeInteger(Number(v))) ||
                !Number.isFinite(Date.parse(row[4] ?? ''))
            )
                throw new Error('Native process evidence is malformed or ambiguous.');
            seen.add(row[1] ?? '');
        }
        return;
    }
    if (command !== 'lsof') throw new Error('Unexpected external Close inspection command.');
    const port = args.find((arg) => arg.startsWith('-iTCP:'))?.slice('-iTCP:'.length);
    let owner = false;
    let listener = false;
    for (const line of lines) {
        if (/^p[1-9]\d*$/.test(line) && Number.isSafeInteger(Number(line.slice(1)))) {
            if (owner && !listener) throw new Error('Native listener owner evidence is incomplete.');
            owner = true;
            listener = false;
        } else if (owner && /^f\d+$/.test(line)) {
            // lsof versions may include a file descriptor selector.
            listener = false;
        } else {
            const endpoint = line.match(/^n(?:\[[^\]]+\]|[^:]+):(\d+)$/);
            if (!owner || !endpoint || endpoint[1] !== port)
                throw new Error('Native listener evidence is malformed or incomplete.');
            listener = true;
        }
    }
    if (owner && !listener) throw new Error('Native listener owner evidence is incomplete.');
}

const fields = ['processId', 'port', 'executablePath', 'targetKind', 'startedAtUtc'] as const;
type FixtureFields = Pick<ProcessTarget, (typeof fields)[number]>;
type Capability = Readonly<{
    fixture: Readonly<FixtureFields>;
    q: bigint;
    h: bigint;
    uid: number;
    executable: string;
    endpoint: string;
}>;

function matches(fixture: ProcessTarget, pinned: Readonly<FixtureFields>): boolean {
    try {
        return fields.every((field) => {
            const descriptor = Object.getOwnPropertyDescriptor(fixture, field);
            return descriptor && 'value' in descriptor && descriptor.value === pinned[field];
        });
    } catch {
        return false;
    }
}

/** Private capabilities are admitted only by this inspector, never by adoption. */
export function createLinuxChromeExternalClose(
    overrides: Partial<LinuxExternalCloseIo>,
    version: (endpoint: unknown) => string,
) {
    const io = { ...nativeIo, ...overrides };
    const capabilities = new WeakMap<ProcessTarget, Capability>();
    const pending = new WeakSet<ProcessTarget>();
    const operationSignal = (signal?: AbortSignal) =>
        AbortSignal.any([AbortSignal.timeout(limits.operationMs), ...(signal ? [signal] : [])]);
    const raw = async (pid: number, signal: AbortSignal) =>
        ticks(
            await completed(signal, async (s) => capped(await io.readText(`/proc/${pid}/stat`, s), limits.proc)),
            pid,
        );
    const command = (executable: string, args: string[], signal: AbortSignal) =>
        completed(signal, async (s) => {
            const result = await io.run(executable, args, s);
            capped(result.stdout, limits.command);
            capped(result.stderr, limits.stderr);
            if (
                result.stderr.trim() ||
                (result.code !== 0 && !(executable === 'lsof' && result.code === 1 && !result.stdout))
            )
                throw new Error('The native external Close inspection command is unavailable.');
            completeNativeOutput(executable, args, result.stdout);
            return result;
        });
    const clock = async (signal: AbortSignal) => {
        const result = await command('getconf', ['CLK_TCK'], signal);
        const value = result.stdout.trim();
        if (
            result.code !== 0 ||
            result.stderr.trim() ||
            !/^[1-9]\d*$/.test(value) ||
            !Number.isSafeInteger(Number(value))
        )
            throw new Error('The Linux CLK_TCK evidence is unavailable.');
        return BigInt(value);
    };
    const canonical = (file: string, signal: AbortSignal) =>
        completed(signal, async (s) => {
            const result = capped(await io.realpath(file, s), limits.path);
            if (!result.startsWith('/') || result.endsWith(' (deleted)'))
                throw new Error('The canonical executable is unavailable.');
            return result;
        });
    async function inspect(pid: number, port: number, executable: string, signal: AbortSignal) {
        const q = await raw(pid, signal);
        const evidence = await completed(signal, async (snapshotSignal) => {
            const platform = createPlatformAdapter({
                platform: 'linux',
                unix: {
                    currentUser: io.currentUser,
                    readText: (file) =>
                        completed(snapshotSignal, async (s) =>
                            capped(await io.readText(file, s), file === '/proc/stat' ? limits.boot : limits.proc),
                        ),
                    readlink: (file) =>
                        completed(snapshotSignal, async (s) => capped(await io.readlink(file, s), limits.path)),
                    run: (file, args) => command(file, args, snapshotSignal),
                },
            });
            return platform.snapshot(pid, port);
        });
        if (
            !evidence.root.exists ||
            !Number.isSafeInteger(evidence.root.sessionId) ||
            evidence.root.sessionId < 0 ||
            evidence.currentSessionId !== evidence.root.sessionId
        )
            throw new Error('The Linux root or numeric user identity is unavailable.');
        const expectedPath = await canonical(executable, signal);
        if ((await canonical(evidence.root.executablePath, signal)) !== expectedPath)
            throw new Error('The Linux executable identity changed.');
        const h = await clock(signal);
        const endpoint: unknown = await completed(signal, async (s) => {
            const response = await io.fetch(`http://127.0.0.1:${port}/json/version`, s);
            if (!response.ok || !response.body) {
                void response.body?.cancel().catch(() => {});
                throw new Error('The owned browser endpoint is unavailable.');
            }
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            const cancel = () => {
                void reader.cancel().catch(() => {});
            };
            s.addEventListener('abort', cancel, { once: true });
            try {
                for (;;) {
                    s.throwIfAborted();
                    const item = await reader.read();
                    s.throwIfAborted();
                    if (item.done) break;
                    bytes += item.value.byteLength;
                    if (bytes > limits.endpoint) throw new Error('The browser endpoint exceeds its byte limit.');
                    chunks.push(item.value);
                }
                return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
            } finally {
                s.removeEventListener('abort', cancel);
                await reader.cancel().catch(() => {});
            }
        });
        const identity = validateCdpIdentity({
            endpoint,
            port,
            listeners: evidence.listeners,
            processIds: evidence.processIds,
            targetKind: 'chrome',
        });
        const chromeVersion = version(endpoint);
        if ((await clock(signal)) !== h || (await raw(pid, signal)) !== q)
            throw new Error('The Linux raw identity bracket changed.');
        signal.throwIfAborted();
        return {
            q,
            h,
            uid: evidence.root.sessionId,
            executable: expectedPath,
            endpoint: identity.webSocketDebuggerUrl,
            startedAtUtc: evidence.root.startedAtUtc,
            chromeVersion,
            listeners: evidence.listeners,
        };
    }
    return {
        async inspect(
            target: ConnectionStatus,
            executable: string,
            cancellation?: AbortSignal,
        ): Promise<ProcessTarget> {
            const { processId: pid, port, targetKind } = target;
            if (
                !pid ||
                !Number.isSafeInteger(pid) ||
                !port ||
                !Number.isSafeInteger(port) ||
                port < 1 ||
                port > 65535 ||
                targetKind !== 'chrome' ||
                !target.sessionId ||
                target.status !== 'active'
            )
                throw new Error('An owned current Chrome connection is required.');
            const signal = operationSignal(cancellation);
            const evidence = await inspect(pid, port, executable, signal);
            const fixture: ProcessTarget = {
                processId: pid,
                port,
                targetKind,
                executablePath: executable,
                startedAtUtc: evidence.startedAtUtc,
            };
            if (!Number.isFinite(Date.parse(fixture.startedAtUtc)))
                throw new Error('The public creation label is unavailable.');
            signal.throwIfAborted();
            capabilities.set(
                fixture,
                Object.freeze({
                    fixture: Object.freeze({ ...fixture }),
                    q: evidence.q,
                    h: evidence.h,
                    uid: evidence.uid,
                    executable: evidence.executable,
                    endpoint: evidence.endpoint,
                }),
            );
            console.log(
                JSON.stringify({
                    chromeSmokeEnvironment: {
                        platform: 'linux',
                        osRelease: os.release(),
                        architecture: process.arch,
                        nodeVersion: process.version,
                        chromeVersion: evidence.chromeVersion,
                        executable,
                        processId: pid,
                        startedAtUtc: fixture.startedAtUtc,
                        userOrSessionId: evidence.uid,
                        listeners: evidence.listeners,
                    },
                }),
            );
            return fixture;
        },
        async request(fixture: ProcessTarget, cancellation?: AbortSignal): Promise<boolean> {
            const capability = capabilities.get(fixture);
            if (!capability || pending.has(fixture) || !matches(fixture, capability.fixture))
                throw new Error('The external Close fixture capability is unavailable or changed.');
            pending.add(fixture);
            try {
                const signal = operationSignal(cancellation);
                const pinned = capability.fixture;
                const evidence = await inspect(pinned.processId, pinned.port, pinned.executablePath, signal);
                // Sole signal commit: completed evidence, cancellation, exact object,
                // immutable capability and own data descriptors, with no await.
                signal.throwIfAborted();
                if (
                    capabilities.get(fixture) !== capability ||
                    !matches(fixture, pinned) ||
                    evidence.q !== capability.q ||
                    evidence.h !== capability.h ||
                    evidence.uid !== capability.uid ||
                    evidence.executable !== capability.executable ||
                    evidence.endpoint !== capability.endpoint
                )
                    throw new Error('The external Close fixture identity changed.');
                capabilities.delete(fixture);
                io.signal(pinned.processId, 'SIGTERM');
                return true;
            } finally {
                capabilities.delete(fixture);
                pending.delete(fixture);
            }
        },
    };
}
