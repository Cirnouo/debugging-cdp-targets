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
import { errorCode, isRecord } from '../shared/errors.ts';

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
    if (matches.length !== 1 || executable === undefined)
        throw new Error('The Darwin executable path is unverifiable or ambiguous.');
    return executable;
}

async function unixSnapshot(pid: number, port: number): Promise<ProcessEvidence> {
    const processes = await run('ps', ['-ww', '-axo', 'pid=,ppid=,uid=,lstart=,comm=']);
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
    const result = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn']);
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
                      platform: process.platform,
                      pid,
                      comm: root.executable,
                  }),
                  sessionId: root.uid,
                  startedAtUtc: root.started,
              }
            : { exists: false },
        currentSessionId:
            process.getuid?.() ??
            (() => {
                throw new Error('Unix user identity unavailable.');
            })(),
        processIds: [...owned],
        listeners,
    };
}

export function createPlatformAdapter(): PlatformAdapter {
    if (!['win32', 'linux', 'darwin'].includes(process.platform)) throw new Error('Unsupported operating system.');
    const snapshot: PlatformAdapter['snapshot'] =
        process.platform === 'win32'
            ? async (pid, port) => parseSnapshot(await windowsHelper('Snapshot', { RootProcessId: pid, Port: port }))
            : unixSnapshot;
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
            if (!evidence.root.exists) return evidence.listeners.length === 0;
            validateProcessIdentity(evidence, target);
            if (process.platform === 'win32') {
                const result = await windowsHelper('Close', {
                    RootProcessId: target.processId,
                    Port: target.port,
                    ExecutablePath: target.executablePath,
                    StartedAtUtc: target.startedAtUtc,
                    ListenerPolicy: requireListener ? 'OwnedExclusive' : 'ProcessIdentityOnly',
                    TimeoutSeconds: CLOSE_TIMEOUT_SECONDS,
                });
                return result.closed === true;
            }
            const owned = new Set(evidence.processIds);
            if (
                requireListener &&
                (!evidence.listeners.length ||
                    evidence.listeners.some((listener) => !owned.has(listener.owningProcess)))
            ) {
                throw new Error('The CDP listener ownership changed.');
            }
            // SIGTERM asks the recorded process to exit; no escalation to SIGKILL.
            process.kill(target.processId, 'SIGTERM');
            for (let attempt = 0; attempt < CLOSE_TIMEOUT_SECONDS * 5; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                const after = await snapshot(target.processId, target.port);
                if (!after.root.exists && after.listeners.length === 0) return true;
                if (after.root.exists) validateProcessIdentity(after, target);
            }
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
