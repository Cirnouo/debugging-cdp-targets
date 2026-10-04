import { spawn } from 'node:child_process';
import { readFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    ListenerEvidence,
    ManagedTarget,
    PortRange,
    ProcessEvidence,
    ProcessTarget,
    RootEvidence,
} from '../domains/cdp-target.ts';
import type { LaunchContext } from '../domains/control-contract.ts';
import { DetailedError, errorCode, errorDetails, errorMessage, isRecord } from '../shared/errors.ts';
import { createWindowsLauncher } from './windows-launch.ts';

export type ProcessResult = { code: number | null; stdout: string; stderr: string };
export type ProcessExecutor = (executable: string, arguments_: string[]) => Promise<ProcessResult>;
type UnixFileIdentity = { dev: bigint; ino: bigint; regularFile: boolean };
export interface PlatformAdapter {
    snapshot(pid: number, port: number): Promise<ProcessEvidence>;
    validateNewRoot(evidence: ProcessEvidence, target: ProcessTarget): void;
    reservedRanges(): Promise<PortRange[]>;
    close(target: ManagedTarget, options?: { requireListener?: boolean }): Promise<boolean>;
    requestNormalClose?(target: ManagedTarget, context?: LaunchContext): Promise<Record<string, unknown>>;
    waitForExit?(target: ManagedTarget, signal?: AbortSignal): Promise<void>;
}

const exitObservations = new WeakMap<NonNullable<ManagedTarget['child']>, { exited: boolean }>();

export function observeTargetExit(target: ManagedTarget) {
    const child = target.child;
    if (!child || exitObservations.has(child)) return;
    const state = { exited: typeof child.exitCode === 'number' || typeof child.signalCode === 'string' };
    exitObservations.set(child, state);
    child.once('exit', () => {
        state.exited = true;
    });
}

export function targetExitObserved(target: ManagedTarget) {
    observeTargetExit(target);
    return target.child !== undefined && exitObservations.get(target.child)?.exited === true;
}

function recordTargetExit(target: ManagedTarget) {
    observeTargetExit(target);
    if (target.child) {
        const state = exitObservations.get(target.child);
        if (state) state.exited = true;
    }
}

export function waitForTargetExit(target: ManagedTarget, signal?: AbortSignal): Promise<void> {
    observeTargetExit(target);
    if (targetExitObserved(target)) return Promise.resolve();
    signal?.throwIfAborted();
    const child = target.child;
    if (!child) return Promise.reject(new Error('No actual application exit observer is available.'));
    return new Promise((resolve, reject) => {
        let releaseMonitoring: (() => void) | undefined;
        const cleanup = () => {
            child.off?.('exit', exited);
            releaseMonitoring?.();
            signal?.removeEventListener('abort', aborted);
        };
        const exited = () => {
            cleanup();
            resolve();
        };
        const failed = () => {
            cleanup();
            reject(new Error('The actual application exit observer failed.'));
        };
        const aborted = () => {
            cleanup();
            reject(signal?.reason);
        };
        child.once('exit', exited);
        signal?.addEventListener('abort', aborted, { once: true });
        releaseMonitoring = child.onMonitorError?.(failed);
        if (targetExitObserved(target)) exited();
        else if (child.monitoringFailure) failed();
    });
}

export function validateNativeExitReceipt(result: Record<string, unknown>, target: ProcessTarget): void {
    if (
        result.processId === target.processId &&
        result.startedAtUtc === target.startedAtUtc &&
        result.closed === true &&
        result.processExited === true &&
        result.waitResult === 0 &&
        result.waitError === 0
    )
        return;
    const error = new DetailedError('The native handle did not supply matching application exit evidence.');
    error.details = {
        phase: result.waitResult === 4294967295 ? 'wait-exit' : (result.phase ?? 'normal-close'),
        nativeError: result.nativeError ?? 0,
        waitResult: result.waitResult,
        waitError: result.waitError,
        closeRequested: result.closeRequested === true,
        processExited: false,
    };
    throw error;
}

function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return pending;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const cancel = () => {
            signal.removeEventListener('abort', cancel);
            reject(signal.reason);
        };
        signal.addEventListener('abort', cancel, { once: true });
        pending.then(
            (value) => {
                signal.removeEventListener('abort', cancel);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', cancel);
                reject(error);
            },
        );
    });
}

async function run(executable: string, arguments_: string[]): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, arguments_, {
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => {
            stdout += data;
        });
        child.stderr.on('data', (data) => {
            stderr += data;
        });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
}

async function windowsHelper(action: string, fields: Record<string, string | number | undefined>) {
    const helper = fileURLToPath(new URL('./windows-cdp-helper.ps1', import.meta.url));
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Action', action];
    for (const [name, value] of Object.entries(fields)) if (value !== undefined) args.push(`-${name}`, String(value));
    const result = await run('powershell.exe', args);
    let output: unknown;
    try {
        output = JSON.parse(result.stdout.trim());
    } catch {
        throw new Error('The Windows process helper did not return valid evidence.');
    }
    if (!isRecord(output) || result.code !== 0 || output.ok !== true)
        throw new Error(
            isRecord(output) && typeof output.message === 'string'
                ? output.message
                : 'Windows process inspection failed.',
        );
    return output;
}

function parseSnapshot(value: Record<string, unknown>): ProcessEvidence {
    const root = value.root;
    if (
        !isRecord(root) ||
        typeof root.exists !== 'boolean' ||
        typeof value.currentSessionId !== 'number' ||
        !Array.isArray(value.processIds) ||
        !value.processIds.every((pid: unknown) => typeof pid === 'number' && Number.isInteger(pid)) ||
        !Array.isArray(value.listeners)
    )
        throw new Error('Invalid process snapshot evidence.');
    let verifiedRoot: RootEvidence = { exists: false };
    if (root.exists) {
        if (
            typeof root.executablePath !== 'string' ||
            typeof root.sessionId !== 'number' ||
            typeof root.startedAtUtc !== 'string'
        )
            throw new Error('Invalid process root evidence.');
        verifiedRoot = {
            exists: true,
            executablePath: root.executablePath,
            sessionId: root.sessionId,
            startedAtUtc: root.startedAtUtc,
            ...(typeof root.productName === 'string' ? { productName: root.productName } : {}),
            ...(typeof root.companyName === 'string' ? { companyName: root.companyName } : {}),
        };
    }
    const listeners = value.listeners.map((listener: unknown): ListenerEvidence => {
        if (
            !isRecord(listener) ||
            typeof listener.localAddress !== 'string' ||
            typeof listener.owningProcess !== 'number'
        )
            throw new Error('Invalid listener evidence.');
        return { localAddress: listener.localAddress, owningProcess: listener.owningProcess };
    });
    return { root: verifiedRoot, currentSessionId: value.currentSessionId, processIds: value.processIds, listeners };
}

function normalizePath(value: string) {
    const normalized = path.resolve(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function validateProcessIdentity(
    evidence: Pick<ProcessEvidence, 'root' | 'currentSessionId'>,
    target: Pick<ProcessTarget, 'executablePath' | 'startedAtUtc' | 'targetKind'>,
    { newlyLaunched = false } = {},
) {
    const root = evidence.root;
    if (!root?.exists) throw new Error('The target root process is absent.');
    if (normalizePath(root.executablePath) !== normalizePath(target.executablePath))
        throw new Error('The process executable identity changed.');
    if (root.sessionId !== evidence.currentSessionId) throw new Error('The process user/session identity changed.');
    const actual = Date.parse(root.startedAtUtc);
    const recorded = Date.parse(target.startedAtUtc);
    if (!Number.isFinite(actual) || !Number.isFinite(recorded))
        throw new Error('The process creation time is unverifiable.');
    if (
        newlyLaunched ? actual < recorded - 1_000 || actual > Date.now() + 1_000 : Math.abs(actual - recorded) > 1_000
    ) {
        throw new Error('The process creation time changed; the PID may have been reused.');
    }
    if (
        target.targetKind === 'chrome' &&
        process.platform === 'win32' &&
        (root.productName !== 'Google Chrome' || root.companyName !== 'Google LLC')
    ) {
        throw new Error('The target executable is not identified as Google Chrome.');
    }
}

export async function resolveUnixExecutable({
    platform,
    pid,
    comm,
    run: execute = run,
    readlink: link = readlink,
    fileIdentity = async (file): Promise<UnixFileIdentity> => {
        const evidence = await stat(file, { bigint: true });
        return { dev: evidence.dev, ino: evidence.ino, regularFile: evidence.isFile() };
    },
}: {
    platform: string;
    pid: number;
    comm: string;
    run?: ProcessExecutor;
    readlink?: (path: string) => Promise<string>;
    fileIdentity?: (file: string) => Promise<UnixFileIdentity>;
}) {
    if (platform === 'linux') return link(`/proc/${pid}/exe`);
    const result = await execute('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-FfDin']);
    if (result.code !== 0 || result.stderr.trim()) throw new Error('The Darwin executable path is unverifiable.');
    const candidates = [
        ...new Set(
            result.stdout
                .split(/\r?\n/)
                .filter((line) => line.startsWith('n/'))
                .map((line) => line.slice(1)),
        ),
    ];
    const matches = candidates.filter((file) =>
        path.posix.isAbsolute(comm) ? file === comm : path.posix.basename(file) === comm,
    );
    const executable = matches[0];
    if (matches.length === 0 && path.posix.isAbsolute(comm)) {
        const mappings: { pid: number | undefined; valid: boolean; name?: string; dev?: bigint; ino?: bigint }[] = [];
        let owner: number | undefined;
        let mapping: (typeof mappings)[number] | undefined;
        for (const field of result.stdout.split(/\r?\n/)) {
            if (field.startsWith('p')) {
                owner =
                    /^p\d+$/.test(field) && Number.isSafeInteger(Number(field.slice(1)))
                        ? Number(field.slice(1))
                        : undefined;
                mapping = undefined;
            } else if (field.startsWith('f')) {
                mapping = field === 'ftxt' ? { pid: owner, valid: true } : undefined;
                if (mapping) mappings.push(mapping);
            } else if (mapping) {
                if (field.startsWith('n')) {
                    if (mapping.name !== undefined || !field.startsWith('n/')) mapping.valid = false;
                    else mapping.name = field.slice(1);
                } else if (field.startsWith('D')) {
                    if (mapping.dev !== undefined || !/^D0x[\da-f]+$/i.test(field)) mapping.valid = false;
                    else mapping.dev = BigInt(field.slice(1));
                } else if (field.startsWith('i')) {
                    if (mapping.ino !== undefined || !/^i\d+$/.test(field)) mapping.valid = false;
                    else mapping.ino = BigInt(field.slice(1));
                }
            }
        }
        try {
            const identity = await fileIdentity(comm);
            // Chrome's code-sign clone hard-links the main executable. Compare the
            // installed file with the kernel mapping's device/inode, never its name alone.
            const aliases = new Set(
                mappings
                    .filter(
                        (file) =>
                            identity.regularFile &&
                            identity.dev > 0n &&
                            identity.ino > 0n &&
                            file.valid &&
                            file.pid === pid &&
                            file.dev === identity.dev &&
                            file.ino === identity.ino &&
                            file.name !== undefined &&
                            path.posix.basename(file.name) === path.posix.basename(comm),
                    )
                    .map((file) => file.name),
            );
            if (aliases.size === 1) return comm;
        } catch {
            // Missing filesystem identity cannot authorize a mapped alias.
        }
    }
    if (matches.length !== 1 || executable === undefined) {
        const error = new DetailedError('The Darwin executable path is unverifiable or ambiguous.');
        error.details = {
            phase: 'executable-identity',
            processId: pid,
            executableClaim: comm.slice(0, 1_024),
            candidateCount: candidates.length,
            matchCount: matches.length,
            mappedExecutablePaths: candidates
                .filter((file) => path.posix.basename(file) === path.posix.basename(comm))
                .slice(0, 32)
                .map((file) => file.slice(0, 1_024)),
        };
        throw error;
    }
    return executable;
}

async function linuxCreationTime(
    pid: number,
    execute: ProcessExecutor,
    readText: (file: string) => Promise<string>,
): Promise<string> {
    const [stat, boot, clock] = await Promise.all([
        readText(`/proc/${pid}/stat`),
        readText('/proc/stat'),
        execute('getconf', ['CLK_TCK']),
    ]);
    // comm may contain spaces and closing parentheses; fields resume after its last ') '.
    const processStat = stat.trim().match(/^(\d+) \([\s\S]*\) (.+)$/);
    const ticks = processStat?.[2]?.split(/\s+/)[19];
    const bootTimes = [...boot.matchAll(/^btime (\d+)$/gm)];
    const clockText = clock.stdout.trim();
    const startTicks = Number(ticks);
    const bootSeconds = Number(bootTimes[0]?.[1]);
    const ticksPerSecond = Number(clockText);
    if (
        Number(processStat?.[1]) !== pid ||
        ticks === undefined ||
        !/^\d+$/.test(ticks) ||
        !Number.isSafeInteger(startTicks) ||
        bootTimes.length !== 1 ||
        !Number.isSafeInteger(bootSeconds) ||
        clock.code !== 0 ||
        clock.stderr.trim() ||
        !/^\d+$/.test(clockText) ||
        !Number.isSafeInteger(ticksPerSecond) ||
        ticksPerSecond <= 0
    ) {
        throw new Error('The Linux process creation evidence is unverifiable.');
    }
    // ps lstart truncates startTicks / CLK_TCK; retain the kernel's fractional seconds.
    const started = new Date(bootSeconds * 1_000 + (startTicks / ticksPerSecond) * 1_000);
    if (!Number.isFinite(started.getTime())) throw new Error('The Linux process creation evidence is unverifiable.');
    return started.toISOString();
}

export async function unixSnapshot(
    pid: number,
    port: number,
    dependencies: {
        platform?: NodeJS.Platform;
        currentUser?: () => number;
        readlink?: (file: string) => Promise<string>;
        readText?: (file: string) => Promise<string>;
        run?: ProcessExecutor;
    } = {},
): Promise<ProcessEvidence> {
    const platform = dependencies.platform ?? process.platform;
    const execute = dependencies.run ?? run;
    const processes = await execute('ps', ['-ww', '-axo', 'pid=,ppid=,uid=,lstart=,comm=']);
    if (processes.code !== 0) throw new Error('Cannot inspect target processes.');
    const rows = processes.stdout.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
        const started = match?.[4];
        const executable = match?.[5];
        return match && started !== undefined && executable !== undefined
            ? [
                  {
                      pid: Number(match[1]),
                      parent: Number(match[2]),
                      uid: Number(match[3]),
                      started: new Date(started).toISOString(),
                      executable,
                  },
              ]
            : [];
    });
    const root = rows.find((row) => row.pid === pid);
    const rootStartedAt =
        root && platform === 'linux'
            ? await linuxCreationTime(pid, execute, dependencies.readText ?? ((file) => readFile(file, 'utf8')))
            : root?.started;
    const owned = new Set(root ? [pid] : []);
    for (let changed = true; changed; ) {
        changed = false;
        for (const row of rows) {
            const parent = rows.find((candidate) => candidate.pid === row.parent);
            if (
                root &&
                parent &&
                !owned.has(row.pid) &&
                owned.has(row.parent) &&
                row.uid === root.uid &&
                row.started >= parent.started
            ) {
                owned.add(row.pid);
                changed = true;
            }
        }
    }
    const result = await execute('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn']);
    if (result.code === null || ![0, 1].includes(result.code) || result.stderr.trim())
        throw new Error('Cannot verify CDP listener ownership (lsof required).');
    const listeners: ListenerEvidence[] = [];
    let owner: number | undefined;
    for (const line of result.stdout.split(/\r?\n/)) {
        if (line.startsWith('p')) owner = Number(line.slice(1));
        const match = line.startsWith('n') ? line.slice(1).match(/^(\S+):\d+$/) : null;
        const address = match?.[1];
        if (address !== undefined && owner !== undefined)
            listeners.push({ localAddress: address.replace(/^\[|\]$/g, ''), owningProcess: owner });
    }
    return {
        root: root
            ? {
                  exists: true,
                  executablePath: await resolveUnixExecutable({
                      platform,
                      pid,
                      comm: root.executable,
                      run: execute,
                      ...(dependencies.readlink ? { readlink: dependencies.readlink } : {}),
                  }),
                  sessionId: root.uid,
                  startedAtUtc: rootStartedAt ?? root.started,
              }
            : { exists: false },
        currentSessionId:
            (dependencies.currentUser ?? process.getuid)?.() ??
            (() => {
                throw new Error('Unix user identity unavailable.');
            })(),
        processIds: [...owned],
        listeners,
    };
}

export function createPlatformAdapter(
    dependencies: {
        platform?: NodeJS.Platform;
        snapshot?: PlatformAdapter['snapshot'];
        closeWindows?: (target: ProcessTarget) => Promise<Record<string, unknown>>;
        requestWindowsClose?: (target: ProcessTarget, context?: LaunchContext) => Promise<Record<string, unknown>>;
        waitWindowsExit?: (target: ProcessTarget, signal?: AbortSignal) => Promise<Record<string, unknown>>;
        requestUnixClose?: (pid: number) => void;
        sleep?: (ms: number) => Promise<void>;
    } = {},
): PlatformAdapter {
    const platform = dependencies.platform ?? process.platform;
    const windows = createWindowsLauncher();
    const closeWindows = dependencies.closeWindows;
    const requestUnixClose = dependencies.requestUnixClose ?? ((pid) => process.kill(pid, 'SIGTERM'));
    if (!['win32', 'linux', 'darwin'].includes(platform)) throw new Error('Unsupported operating system.');
    const snapshot: PlatformAdapter['snapshot'] =
        dependencies.snapshot ??
        (platform === 'win32'
            ? async (pid, port) => parseSnapshot(await windowsHelper('Snapshot', { RootProcessId: pid, Port: port }))
            : unixSnapshot);
    const nativeExit = new WeakMap<ManagedTarget, Promise<Record<string, unknown>>>();
    async function requestNormalClose(
        target: ManagedTarget,
        context: LaunchContext = {},
    ): Promise<Record<string, unknown>> {
        observeTargetExit(target);
        if (targetExitObserved(target)) return { closeRequested: false, processExited: true };
        const evidence = await snapshot(target.processId, target.port);
        if (targetExitObserved(target)) return { closeRequested: false, processExited: true };
        context.signal?.throwIfAborted();
        const owned = new Set(evidence.processIds);
        const listenerState = evidence.listeners.some((listener) => !owned.has(listener.owningProcess))
            ? 'foreign'
            : evidence.listeners.length
              ? 'owned'
              : 'absent';
        if (!evidence.root.exists) {
            const error = new DetailedError('The target root is absent without actual application exit evidence.');
            error.details = { phase: 'process-identity', listenerState, closeRequested: false, processExited: false };
            throw error;
        }
        validateProcessIdentity(evidence, target);
        if (platform !== 'win32') {
            requestUnixClose(target.processId);
            return { closeRequested: true, processExited: targetExitObserved(target), listenerState };
        }
        try {
            if (closeWindows) {
                const result = await closeWindows(target);
                const completion = Promise.resolve(result);
                nativeExit.set(target, completion);
                validateNativeExitReceipt(result, target);
                recordTargetExit(target);
                return { ...result, listenerState };
            }
            const result = await (dependencies.requestWindowsClose ?? windows.requestNormalClose)(target, context);
            const completion = (dependencies.waitWindowsExit ?? windows.waitForExit)(target);
            void completion.catch(() => {});
            nativeExit.set(target, completion);
            if (result.closeRequested !== true && result.processExited !== true) {
                const error = new DetailedError('The application rejected normal close.');
                error.details = { ...result, listenerState, processExited: false };
                throw error;
            }
            return { ...result, listenerState };
        } catch (cause) {
            const error = new DetailedError(errorMessage(cause));
            error.details = { ...errorDetails(cause), listenerState, processExited: false };
            throw error;
        }
    }
    async function waitForExit(target: ManagedTarget, signal?: AbortSignal) {
        if (targetExitObserved(target)) return;
        signal?.throwIfAborted();
        const completion = nativeExit.get(target);
        if (completion) {
            const result = await abortable(completion, signal);
            validateNativeExitReceipt(result, target);
            recordTargetExit(target);
            return;
        }
        await waitForTargetExit(target, signal);
    }
    return {
        snapshot,
        validateNewRoot: (evidence, target) => validateProcessIdentity(evidence, target, { newlyLaunched: true }),
        async reservedRanges() {
            if (process.platform === 'linux') {
                const value = await readFile('/proc/sys/net/ipv4/ip_local_reserved_ports', 'utf8');
                return value
                    .trim()
                    .split(',')
                    .filter(Boolean)
                    .map((part) => {
                        const start = Number(part.split('-')[0]);
                        const end = Number(part.split('-')[1] ?? start);
                        return [start, end];
                    });
            }
            if (process.platform === 'darwin') return [];
            const ranges: PortRange[] = [];
            for (const family of ['ipv4', 'ipv6']) {
                const result = await run('netsh.exe', ['int', family, 'show', 'excludedportrange', 'protocol=tcp']);
                if (result.code !== 0) throw new Error('Windows excluded ports could not be read.');
                for (const match of result.stdout.matchAll(/^\s*(\d+)\s+(\d+)(?:\s+\*)?\s*$/gm))
                    ranges.push([Number(match[1]), Number(match[2])]);
            }
            return ranges;
        },
        requestNormalClose,
        waitForExit,
        async close(target) {
            await requestNormalClose(target);
            await waitForExit(target);
            return true;
        },
    };
}

/** Check Unix SingletonLock ownership without sending a signal. */
export function probeProcessExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (errorCode(error) === 'ESRCH') return false;
        throw error;
    }
}
