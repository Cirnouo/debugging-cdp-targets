import { spawn } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { errorCode, isRecord } from '../shared/errors.ts';
import type { AppParentIdentity, AppParentWatch } from './app-parent-exit.ts';
export type AppParentHelper = Readonly<{
    lines: AsyncIterable<string>;
    closed: Promise<void>;
    write(value: string): void;
    end(): void;
}>;
export type AppParentWatchIO = Readonly<{
    platform: NodeJS.Platform;
    processId(): number;
    parentProcessId(): number;
    windowsDirectory(): string | undefined;
    account(): Readonly<{ real: number; effective: number }>;
    readText(file: string, signal: AbortSignal): Promise<string>;
    readLink(file: string, signal: AbortSignal): Promise<string>;
    clockTicks(signal: AbortSignal): Promise<string>;
    openHelper(file: string, args: string[]): AppParentHelper;
    pause(milliseconds: number, signal: AbortSignal): Promise<void>;
}>;

const failure = () => new Error('Exact read-only App parent observation is unavailable.');
const sameIdentity = (left: AppParentIdentity, right: AppParentIdentity) =>
    left.processId === right.processId &&
    left.startedAtUtc === right.startedAtUtc &&
    left.executablePath === right.executablePath;

function fields(value: unknown, names: string[]): Record<string, unknown> {
    if (
        !isRecord(value) ||
        Object.keys(value).length !== names.length ||
        names.some((name) => !Object.hasOwn(value, name))
    )
        throw failure();
    return value;
}

function identity(value: unknown): AppParentIdentity {
    const record = fields(value, ['processId', 'startedAtUtc', 'executablePath']);
    if (
        !Number.isSafeInteger(record.processId) ||
        Number(record.processId) < 1 ||
        Number(record.processId) > 2147483647 ||
        typeof record.startedAtUtc !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6,18}Z$/.test(record.startedAtUtc) ||
        !Number.isFinite(Date.parse(record.startedAtUtc)) ||
        typeof record.executablePath !== 'string' ||
        !/^(\/|[A-Za-z]:\\)/.test(record.executablePath) ||
        /[\0\r\n]/.test(record.executablePath)
    )
        throw failure();
    return Object.freeze({
        processId: Number(record.processId),
        startedAtUtc: record.startedAtUtc,
        executablePath: record.executablePath,
    });
}

function openHelper(file: string, args: string[]): AppParentHelper {
    const child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let error: unknown;
    let stderr = false;
    let code: number | null = null;
    child.once('error', (cause) => {
        error = cause;
    });
    child.stdin.on('error', (cause) => {
        error ??= cause;
    });
    child.stderr.on('data', () => {
        stderr = true;
    });
    const closed = new Promise<void>((resolve) =>
        child.once('close', (exitCode) => {
            code = exitCode;
            resolve();
        }),
    );
    const lines = (async function* () {
        let buffer = '';
        let bytes = 0;
        child.stdout.setEncoding('utf8');
        for await (const chunk of child.stdout) {
            if (typeof chunk !== 'string') throw failure();
            bytes += Buffer.byteLength(chunk);
            buffer += chunk;
            if (bytes > 16384 || buffer.length > 8192) throw failure();
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                yield buffer.slice(0, newline).replace(/\r$/, '');
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
            }
        }
        await closed;
        if (buffer || error || stderr || code !== 0) throw failure();
    })();
    return Object.freeze({
        lines,
        closed,
        write: (value: string) => {
            if (!child.stdin.destroyed) child.stdin.write(value);
        },
        end: () => {
            if (!child.stdin.destroyed) child.stdin.end();
        },
    });
}

const nativeSystemRoot = process.env.SystemRoot;
const nativeIO: AppParentWatchIO = {
    platform: process.platform,
    processId: () => process.pid,
    // Node's public native process.ppid is the current bridge's actual parent,
    // independent of JSON, arguments, environment or renderer input.
    parentProcessId: () => process.ppid,
    // Interpreter bootstrap keeps the established ordinary-user process-env trust
    // boundary. This value never supplies account, parent or target identity.
    windowsDirectory: () => nativeSystemRoot,
    account: () => {
        if (!process.getuid || !process.geteuid) throw failure();
        return { real: process.getuid(), effective: process.geteuid() };
    },
    readText: (file, signal) => readFile(file, { encoding: 'utf8', signal }),
    readLink: (file) => readlink(file),
    openHelper,
    pause: async (milliseconds, signal) => {
        await pause(milliseconds, undefined, { signal });
    },
    clockTicks: async (signal) => {
        const helper = openHelper('/usr/bin/getconf', ['CLK_TCK']);
        const cancel = () => helper.end();
        signal.addEventListener('abort', cancel, { once: true });
        helper.end();
        try {
            const lines: string[] = [];
            for await (const line of helper.lines) lines.push(line);
            if (signal.aborted || lines.length !== 1) throw failure();
            return lines[0] ?? '';
        } finally {
            signal.removeEventListener('abort', cancel);
            await helper.closed;
        }
    },
};

type Account = Readonly<{ real: number; effective: number }>;
function account(io: AppParentWatchIO): Account {
    const result = io.account();
    if (!Number.isSafeInteger(result.real) || result.real < 0 || result.real !== result.effective) throw failure();
    return result;
}

function instant(seconds: bigint, fraction: string): string {
    const milliseconds = Number(seconds * 1000n);
    if (!Number.isSafeInteger(milliseconds)) throw failure();
    // Only whole seconds enter Date. The native fractional birth never does.
    const date = new Date(milliseconds).toISOString();
    if (!/^\d{4}-/.test(date)) throw failure();
    return `${date.slice(0, 19)}.${fraction}Z`;
}

function decimal(value: unknown): bigint {
    if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) throw failure();
    return BigInt(value);
}

function procStat(text: string, pid: number) {
    const match = text.trimEnd().match(/^(\d+) \([\s\S]*\) ([^\n]+)$/);
    const parts = match?.[2]?.split(/\s+/);
    if (Number(match?.[1]) !== pid || !parts || !/^[RSDTtXZPIW]$/.test(parts[0] ?? '')) throw failure();
    return { birth: decimal(parts[19]), state: parts[0] };
}

function procUid(text: string, expected: Account) {
    const matches = [...text.matchAll(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/gm)];
    if (
        matches.length !== 1 ||
        Number(matches[0]?.[1]) !== expected.real ||
        Number(matches[0]?.[2]) !== expected.effective
    )
        throw failure();
}

function bootTime(text: string) {
    const matches = [...text.matchAll(/^btime (\d+)$/gm)];
    if (matches.length !== 1) throw failure();
    return decimal(matches[0]?.[1]);
}

type LinuxClock = Readonly<{ boot: bigint; ticks: bigint; ownBirth: bigint }>;
async function linuxAuthority(io: AppParentWatchIO, signal: AbortSignal, expected: Account, clock?: LinuxClock) {
    const pid = io.processId();
    const first = procStat(await io.readText(`/proc/${pid}/stat`, signal), pid);
    procUid(await io.readText(`/proc/${pid}/status`, signal), expected);
    const self = procStat(await io.readText('/proc/self/stat', signal), pid);
    const boot = bootTime(await io.readText('/proc/stat', signal));
    if (
        first.birth !== self.birth ||
        first.state === 'Z' ||
        self.state === 'Z' ||
        (clock && (first.birth !== clock.ownBirth || boot !== clock.boot)) ||
        account(io).real !== expected.real
    )
        throw failure();
    return { ownBirth: first.birth, boot };
}

function linuxTime(birth: bigint, clock: LinuxClock) {
    let scale = 1n;
    let digits = 0;
    while (scale % clock.ticks !== 0n && digits < 18) {
        scale *= 10n;
        digits++;
    }
    if (scale % clock.ticks !== 0n) throw failure();
    const fraction = ((birth % clock.ticks) * (scale / clock.ticks)).toString().padStart(digits, '0').padEnd(9, '0');
    return instant(clock.boot + birth / clock.ticks, fraction);
}

async function linuxSnapshot(
    pid: number,
    io: AppParentWatchIO,
    signal: AbortSignal,
    owner: Account,
    clock: LinuxClock,
) {
    let first: ReturnType<typeof procStat>;
    try {
        first = procStat(await io.readText(`/proc/${pid}/stat`, signal), pid);
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw failure();
        await linuxAuthority(io, signal, owner, clock);
        return { absent: true } as const;
    }
    procUid(await io.readText(`/proc/${pid}/status`, signal), owner);
    const executablePath = first.state === 'Z' ? undefined : await io.readLink(`/proc/${pid}/exe`, signal);
    const last = procStat(await io.readText(`/proc/${pid}/stat`, signal), pid);
    // Scheduling can change without changing identity. Keep zombie classification
    // stable across the bracket because its executable may be unavailable.
    if (first.birth !== last.birth || (first.state === 'Z') !== (last.state === 'Z')) throw failure();
    return {
        absent: false,
        birth: first.birth,
        zombie: first.state === 'Z',
        startedAtUtc: linuxTime(first.birth, clock),
        executablePath,
    } as const;
}

function windowsIdentity(value: unknown, pid: number) {
    const record = fields(value, [
        'event',
        'identity',
        'accountSid',
        'observerAccountSid',
        'sessionId',
        'observerSessionId',
    ]);
    const result = identity(record.identity);
    if (
        record.event !== 'parent-native-ready-v1' ||
        result.processId !== pid ||
        typeof record.accountSid !== 'string' ||
        !/^S-1-\d+(?:-\d+)+$/.test(record.accountSid) ||
        record.accountSid !== record.observerAccountSid ||
        !Number.isSafeInteger(record.sessionId) ||
        Number(record.sessionId) < 0 ||
        record.sessionId !== record.observerSessionId
    )
        throw failure();
    return result;
}

type Bsd = Readonly<{ birth: string; startedAtUtc: string; zombie: boolean }>;
function bsdInfo(value: unknown, pid: number, owner: Account): Bsd {
    const record = fields(value, [
        'size',
        'errno',
        'processId',
        'realUid',
        'effectiveUid',
        'startSeconds',
        'startMicroseconds',
        'status',
    ]);
    const seconds = decimal(record.startSeconds);
    const microseconds = decimal(record.startMicroseconds);
    if (
        record.size !== 136 ||
        record.errno !== 0 ||
        record.processId !== pid ||
        record.realUid !== owner.real ||
        record.effectiveUid !== owner.effective ||
        !Number.isInteger(record.status) ||
        Number(record.status) < 1 ||
        Number(record.status) > 5 ||
        microseconds > 999999n
    )
        throw failure();
    return {
        birth: `${seconds}:${microseconds}`,
        startedAtUtc: instant(seconds, microseconds.toString().padStart(6, '0')),
        zombie: record.status === 5,
    };
}

function darwinSnapshot(value: unknown, pid: number, ownPid: number, owner: Account) {
    if (!isRecord(value) || value.event !== 'parent-native-snapshot-v1') throw failure();
    const authority = bsdInfo(value.authority, ownPid, owner);
    if (authority.zombie) throw failure();
    if (isRecord(value.before) && value.before.size === 0 && value.before.errno === 3) {
        fields(value, ['event', 'before', 'authority']);
        fields(value.before, ['size', 'errno']);
        return { absent: true } as const;
    }
    const before = bsdInfo(value.before, pid, owner);
    const after = bsdInfo(value.after, pid, owner);
    if (before.birth !== after.birth || before.zombie !== after.zombie) throw failure();
    let executablePath: string | undefined;
    if (before.zombie) fields(value, ['event', 'before', 'after', 'authority']);
    else {
        fields(value, ['event', 'before', 'path', 'after', 'authority']);
        const executable = fields(value.path, ['size', 'errno', 'value']);
        if (
            executable.errno !== 0 ||
            typeof executable.value !== 'string' ||
            !executable.value.startsWith('/') ||
            /[\0\r\n]/.test(executable.value) ||
            executable.size !== Buffer.byteLength(executable.value) ||
            Number(executable.size) < 1 ||
            Number(executable.size) >= 4096
        )
            throw failure();
        executablePath = executable.value;
    }
    return { absent: false, ...before, executablePath } as const;
}

function helperPath(file: string) {
    return fileURLToPath(new URL(file, import.meta.url));
}
function windowsHelper(io: AppParentWatchIO) {
    const directory = io.windowsDirectory();
    if (typeof directory !== 'string' || !/^[A-Za-z]:[\\/]/.test(directory) || /[\0\r\n]/.test(directory))
        throw failure();
    return io.openHelper(path.win32.join(directory, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helperPath('./windows-parent-watch.ps1'),
    ]);
}

function observe(io: AppParentWatchIO, parent?: AppParentIdentity): AppParentWatch {
    const ready = Promise.withResolvers<unknown>();
    const exited = Promise.withResolvers<unknown>();
    void ready.promise.catch(() => {});
    void exited.promise.catch(() => {});
    const controller = new AbortController();
    const helpers = new Set<AppParentHelper>();
    const own = (helper: AppParentHelper) => {
        helpers.add(helper);
        void helper.closed.then(
            () => {
                helpers.delete(helper);
            },
            () => {},
        );
        return helper;
    };
    const fail = (error: unknown) => {
        ready.reject(error);
        exited.reject(error);
    };
    const cancel = () => {
        controller.abort();
        for (const helper of helpers) {
            helper.write('{"cancel":true}\n');
            helper.end();
        }
    };
    const deadline = setTimeout(() => {
        fail(failure());
        cancel();
    }, 10000);
    const check = () => {
        if (controller.signal.aborted) throw failure();
    };
    const accept = (result: AppParentIdentity) => {
        check();
        if (parent && (!sameIdentity(result, parent) || io.parentProcessId() !== parent.processId)) throw failure();
        clearTimeout(deadline);
        ready.resolve({ event: 'parent-ready-v1', ...result });
    };
    const task = (async () => {
        try {
            const pid = parent?.processId ?? io.processId();
            if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647 || (parent && io.parentProcessId() !== pid))
                throw failure();
            if (io.platform === 'win32') {
                const helper = own(windowsHelper(io));
                helper.write(
                    `${JSON.stringify({ action: parent ? 'watch-parent' : 'inspect-current', processId: pid, ...(parent ? { parent } : {}) })}\n`,
                );
                let observed: AppParentIdentity | undefined;
                let terminal: unknown;
                for await (const line of helper.lines) {
                    check();
                    const record: unknown = JSON.parse(line);
                    if (!observed) {
                        observed = windowsIdentity(record, pid);
                        if (parent) accept(observed);
                    } else if (parent && terminal === undefined) {
                        const proof = fields(record, [
                            'event',
                            'processId',
                            'startedAtUtc',
                            'executablePath',
                            'processExited',
                            'waitResult',
                            'waitError',
                            'exitCode',
                        ]);
                        if (
                            proof.event !== 'parent-exited-v1' ||
                            proof.processId !== parent.processId ||
                            proof.startedAtUtc !== parent.startedAtUtc ||
                            proof.executablePath !== parent.executablePath ||
                            proof.processExited !== true ||
                            proof.waitResult !== 0 ||
                            proof.waitError !== 0 ||
                            !Number.isInteger(proof.exitCode)
                        )
                            throw failure();
                        terminal = record;
                    } else throw failure();
                }
                await helper.closed;
                check();
                if (!observed || (parent && terminal === undefined)) throw failure();
                if (!parent) accept(observed);
                if (parent) exited.resolve(terminal);
                return;
            }
            if (io.platform !== 'linux' && io.platform !== 'darwin') throw failure();
            const owner = account(io);
            let clock: LinuxClock | undefined;
            if (io.platform === 'linux') {
                const authority = await linuxAuthority(io, controller.signal, owner);
                const ticks = decimal((await io.clockTicks(controller.signal)).trim());
                if (ticks < 1n || ticks > 1000000000n) throw failure();
                clock = { ...authority, ticks };
            }
            const snapshot = async () => {
                check();
                if (account(io).real !== owner.real) throw failure();
                if (clock) return linuxSnapshot(pid, io, controller.signal, owner, clock);
                const helper = own(
                    io.openHelper('/usr/bin/osascript', [
                        '-l',
                        'JavaScript',
                        helperPath('./macos-parent-identity.jxa'),
                        String(pid),
                        String(io.processId()),
                    ]),
                );
                helper.end();
                const queryDeadline = setTimeout(() => {
                    fail(failure());
                    cancel();
                }, 10000);
                try {
                    const records: unknown[] = [];
                    for await (const line of helper.lines) {
                        if (records.length) throw failure();
                        records.push(JSON.parse(line));
                    }
                    await helper.closed;
                    check();
                    return darwinSnapshot(records[0], pid, io.processId(), owner);
                } finally {
                    clearTimeout(queryDeadline);
                }
            };
            const initial = await snapshot();
            if (initial.absent || initial.zombie || !initial.executablePath) throw failure();
            const observed = identity({
                processId: pid,
                startedAtUtc: initial.startedAtUtc,
                executablePath: initial.executablePath,
            });
            accept(observed);
            if (!parent) return;
            while (true) {
                await io.pause(100, controller.signal);
                const current = await snapshot();
                check();
                if (current.absent) {
                    exited.resolve({ event: 'parent-absent-v1', ...observed, processAbsent: true });
                    return;
                }
                if (
                    current.birth !== initial.birth ||
                    current.startedAtUtc !== observed.startedAtUtc ||
                    (!current.zombie && current.executablePath !== observed.executablePath)
                )
                    throw failure();
            }
        } catch (error) {
            fail(error);
            cancel();
        } finally {
            clearTimeout(deadline);
        }
    })();
    return Object.freeze({
        method: io.platform === 'win32' ? 'windows-handle' : 'unix-absence',
        ready: ready.promise,
        exited: exited.promise,
        dispose: async () => {
            fail(failure());
            cancel();
            await task;
            await Promise.all([...helpers].map((helper) => helper.closed));
        },
    });
}

/** Native self-capture for the old App. No environment/JSON value grants account or parent authority. */
export async function inspectCurrentAppParentIdentity(io: AppParentWatchIO = nativeIO): Promise<AppParentIdentity> {
    const observer = observe(io);
    try {
        const record = fields(await observer.ready, ['event', 'processId', 'startedAtUtc', 'executablePath']);
        return identity({
            processId: record.processId,
            startedAtUtc: record.startedAtUtc,
            executablePath: record.executablePath,
        });
    } finally {
        await observer.dispose();
    }
}

/** Internal platform I/O injection is test-owned; no serialized caller can select the native method. */
export async function watchAppParentExit(
    parent: AppParentIdentity,
    io: AppParentWatchIO = nativeIO,
): Promise<AppParentWatch> {
    return observe(io, identity(parent));
}
