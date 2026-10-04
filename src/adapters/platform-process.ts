import { spawn } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    ListenerEvidence,
    PortRange,
    ProcessEvidence,
    ProcessTarget,
    RootEvidence,
} from '../domains/cdp-target.ts';
import { CLOSE_TIMEOUT_SECONDS } from '../shared/constants.ts';
import { DetailedError, errorCode, errorDetails, errorMessage, isRecord } from '../shared/errors.ts';
import { createWindowsLauncher } from './windows-launch.ts';

export type ProcessResult = { code: number | null; stdout: string; stderr: string };
export type ProcessExecutor = (executable: string, arguments_: string[]) => Promise<ProcessResult>;
export interface PlatformAdapter {
    snapshot(pid: number, port: number): Promise<ProcessEvidence>;
    validateNewRoot(evidence: ProcessEvidence, target: ProcessTarget): void;
    reservedRanges(): Promise<PortRange[]>;
    close(target: ProcessTarget, options?: { requireListener?: boolean }): Promise<boolean>;
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
}: {
    platform: string;
    pid: number;
    comm: string;
    run?: ProcessExecutor;
    readlink?: (path: string) => Promise<string>;
}) {
    if (platform === 'linux') return link(`/proc/${pid}/exe`);
    const result = await execute('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn']);
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
    if (matches.length !== 1 || executable === undefined) {
        const error = new DetailedError('The Darwin executable path is unverifiable or ambiguous.');
        error.details = {
            phase: 'executable-identity',
            processId: pid,
            command: comm.slice(0, 1_024),
            candidateCount: candidates.length,
            matchCount: matches.length,
            mappedPaths: candidates.slice(0, 32).map((file) => file.slice(0, 1_024)),
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
        requestUnixClose?: (pid: number) => void;
        sleep?: (ms: number) => Promise<void>;
    } = {},
): PlatformAdapter {
    const platform = dependencies.platform ?? process.platform;
    const closeWindows = dependencies.closeWindows ?? createWindowsLauncher().close;
    const requestUnixClose = dependencies.requestUnixClose ?? ((pid) => process.kill(pid, 'SIGTERM'));
    const sleep = dependencies.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    if (!['win32', 'linux', 'darwin'].includes(platform)) throw new Error('Unsupported operating system.');
    const snapshot: PlatformAdapter['snapshot'] =
        dependencies.snapshot ??
        (platform === 'win32'
            ? async (pid, port) => parseSnapshot(await windowsHelper('Snapshot', { RootProcessId: pid, Port: port }))
            : unixSnapshot);
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
        async close(target, { requireListener = true } = {}) {
            const evidence = await snapshot(target.processId, target.port);
            if (!evidence.root.exists)
                return !evidence.listeners.some((listener) => evidence.processIds.includes(listener.owningProcess));
            validateProcessIdentity(evidence, target);
            const owned = new Set(evidence.processIds);
            const listenerState = evidence.listeners.some((listener) => !owned.has(listener.owningProcess))
                ? 'foreign'
                : evidence.listeners.length
                  ? 'owned'
                  : 'absent';
            if (requireListener && listenerState === 'foreign') {
                const error = new DetailedError('The CDP listener belongs to another process.');
                error.details = { phase: 'listener-identity', listenerState, closeRequested: false };
                throw error;
            }
            if (platform === 'win32') {
                let result: Record<string, unknown>;
                try {
                    result = await closeWindows(target);
                } catch (cause) {
                    const error = new DetailedError(errorMessage(cause));
                    error.details = { ...errorDetails(cause), listenerState };
                    throw error;
                }
                const after = await snapshot(target.processId, target.port);
                if (after.root.exists) validateProcessIdentity(after, target);
                const remaining = after.listeners.filter((listener) => owned.has(listener.owningProcess));
                if (result.closed === true && !after.root.exists && !remaining.length) return true;
                const error = new DetailedError('The application did not close normally.');
                error.details = {
                    phase: result.phase ?? 'normal-close',
                    nativeError: result.nativeError ?? 0,
                    closeRequested: result.closeRequested === true,
                    processExited: !after.root.exists,
                    listenerState: remaining.length ? 'owned' : after.listeners.length ? 'foreign' : 'absent',
                };
                throw error;
            }
            // SIGTERM asks the recorded process to exit; no escalation to SIGKILL.
            requestUnixClose(target.processId);
            let inspectionFailure: unknown;
            for (let attempt = 0; attempt < CLOSE_TIMEOUT_SECONDS * 5; attempt += 1) {
                await sleep(200);
                let after: ProcessEvidence;
                try {
                    after = await snapshot(target.processId, target.port);
                    inspectionFailure = undefined;
                } catch (error) {
                    // An exiting process can unmap its executable between ps and lsof.
                    // Wait for complete evidence; never infer exit or send another signal.
                    inspectionFailure = error;
                    continue;
                }
                if (!after.root.exists && !after.listeners.some((listener) => owned.has(listener.owningProcess)))
                    return true;
                if (after.root.exists) validateProcessIdentity(after, target);
            }
            if (inspectionFailure !== undefined) throw inspectionFailure;
            return false;
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
