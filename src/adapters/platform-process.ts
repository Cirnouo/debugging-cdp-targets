import { spawn } from 'node:child_process';
import { readFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
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
import {
    beginFixtureStage,
    type CreationIdentityFields,
    emitFixtureCreationDecision,
    emitFixtureEvent,
    type FixtureCreationFrame,
    type FixtureFields,
    fixtureCreationFrameActive,
    fixtureCreationObservationEnabled,
    fixtureHasSubscribers,
    reserveFixtureCreationObservation,
    sameFixtureOrigin,
} from './fixture-diagnostics.ts';
import {
    intersectLinuxIntervals,
    type LinuxCalibration,
    linuxBirthInterval,
    linuxPublicTime,
    readLinuxCalibration,
} from './linux-creation-identity.ts';
import { createWindowsLauncher } from './windows-launch.ts';

export type ProcessResult = { code: number | null; stdout: string; stderr: string };
export type ProcessExecutor = (executable: string, arguments_: string[]) => Promise<ProcessResult>;
export interface IdentityValidationContext extends LaunchContext {
    newlyLaunched?: boolean;
    /** Readiness owns this clock/deadline; independent normal cleanup has no such deadline. */
    assertReadinessActive?: () => void;
}
type UnixFileIdentity = { dev: bigint; ino: bigint; regularFile: boolean };
export interface PlatformAdapter {
    snapshot(pid: number, port: number): Promise<ProcessEvidence>;
    prepareLaunch(context?: LaunchContext): Promise<object>;
    registerLaunch(target: ManagedTarget, calibration: object, requestedAt: number): void;
    validateIdentity(
        evidence: ProcessEvidence,
        target: ManagedTarget,
        context?: IdentityValidationContext,
    ): Promise<void>;
    reservedRanges(): Promise<PortRange[]>;
    close(target: ManagedTarget, options?: { requireListener?: boolean }): Promise<boolean>;
    requestNormalClose?(target: ManagedTarget, context?: LaunchContext): Promise<Record<string, unknown>>;
    waitForExit?(target: ManagedTarget, signal?: AbortSignal): Promise<void>;
}

const exitObservations = new WeakMap<NonNullable<ManagedTarget['child']>, { exited: boolean }>();
const exitReferences = new WeakMap<NonNullable<ManagedTarget['child']>, { waiters: number }>();

function retainExitReference(child: NonNullable<ManagedTarget['child']>) {
    if (!child.ref || !child.unref) return () => {};
    let reference = exitReferences.get(child);
    if (!reference) {
        child.ref();
        reference = { waiters: 0 };
        exitReferences.set(child, reference);
    }
    reference.waiters += 1;
    const ownedReference = reference;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (exitReferences.get(child) !== ownedReference) return;
        ownedReference.waiters -= 1;
        if (ownedReference.waiters > 0) return;
        exitReferences.delete(child);
        child.unref?.();
    };
}

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
        const releaseReference = retainExitReference(child);
        let releaseMonitoring: (() => void) | undefined;
        let finished = false;
        const cleanup = () => {
            if (finished) return;
            finished = true;
            child.off?.('exit', exited);
            releaseMonitoring?.();
            signal?.removeEventListener('abort', aborted);
            releaseReference();
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
        if (finished) releaseMonitoring?.();
        else if (targetExitObserved(target)) exited();
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

async function observeNativeCommand(
    command: NonNullable<FixtureFields['command']>,
    execute: ProcessExecutor,
    executable: string,
    args: string[],
): Promise<ProcessResult> {
    const finish = beginFixtureStage('native-command', { command });
    try {
        const result = await execute(executable, args);
        finish('succeeded', { exitCode: result.code, stderrPresent: result.stderr.length > 0 });
        return result;
    } catch (error) {
        finish('failed', {}, error);
        throw error;
    }
}

async function observeNativeFile<T>(command: NonNullable<FixtureFields['command']>, job: () => Promise<T>): Promise<T> {
    const finish = beginFixtureStage('native-file', { command });
    try {
        const result = await job();
        finish('succeeded');
        return result;
    } catch (error) {
        finish('failed', {}, error);
        throw error;
    }
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
    const result = await observeNativeCommand('powershell', run, 'powershell.exe', args);
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

/** Scalar/native policy for non-Linux targets and the legacy diagnostic comparison harness.
 * Production Linux consumers use their adapter's registered validateIdentity policy.
 */
export function validateProcessIdentity(
    evidence: Pick<ProcessEvidence, 'root' | 'currentSessionId'>,
    target: Pick<ProcessTarget, 'executablePath' | 'startedAtUtc' | 'targetKind'>,
    { newlyLaunched = false } = {},
) {
    const root = evidence.root;
    let actual: number | undefined;
    let recorded: number | undefined;
    let upperNow: number | undefined;
    let branch: CreationIdentityFields['creationBranch'];
    let failed = true;
    try {
        if (!root?.exists) throw new Error('The target root process is absent.');
        if (normalizePath(root.executablePath) !== normalizePath(target.executablePath))
            throw new Error('The process executable identity changed.');
        if (root.sessionId !== evidence.currentSessionId) throw new Error('The process user/session identity changed.');
        actual = Date.parse(root.startedAtUtc);
        recorded = Date.parse(target.startedAtUtc);
        if (!Number.isFinite(actual) || !Number.isFinite(recorded)) {
            branch = 'creation-unverifiable';
            throw new Error('The process creation time is unverifiable.');
        }
        let changed: boolean;
        if (newlyLaunched) {
            if (actual < recorded - 1_000) changed = true;
            else {
                upperNow = Date.now();
                changed = actual > upperNow + 1_000;
            }
        } else changed = Math.abs(actual - recorded) > 1_000;
        if (changed) {
            branch = newlyLaunched
                ? upperNow === undefined
                    ? 'new-lower-rejected'
                    : 'new-upper-rejected'
                : 'established-delta-rejected';
            throw new Error('The process creation time changed; the PID may have been reused.');
        }
        branch = newlyLaunched ? 'new-accepted' : 'established-accepted';
        if (
            target.targetKind === 'chrome' &&
            process.platform === 'win32' &&
            (root.productName !== 'Google Chrome' || root.companyName !== 'Google LLC')
        ) {
            throw new Error('The target executable is not identified as Google Chrome.');
        }
        failed = false;
    } finally {
        if (fixtureCreationObservationEnabled()) {
            try {
                observeCreationDecision(root, newlyLaunched, actual, recorded, upperNow, branch, failed);
            } catch {
                /* Observation must never replace an identity decision. */
            }
        }
    }
}

type CreationCarrier = {
    frame: FixtureCreationFrame;
    pid: number;
    port: number;
    fields?: CreationIdentityFields;
    invalid?: boolean;
    clipped?: number;
};
type BoundCreation = CreationCarrier & {
    raw: string;
    clipped: number;
    executablePath: string;
    sessionId: number;
};
const creationSources = new WeakMap<RootEvidence, BoundCreation>();
function boundRootMatches(
    root: RootEvidence,
    source: Pick<BoundCreation, 'raw' | 'executablePath' | 'sessionId'>,
): boolean {
    const prototype: unknown = Object.getPrototypeOf(root);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const [key, value] of [
        ['exists', true],
        ['startedAtUtc', source.raw],
        ['executablePath', source.executablePath],
        ['sessionId', source.sessionId],
    ]) {
        if (typeof key !== 'string') return false;
        const descriptor = Object.getOwnPropertyDescriptor(root, key);
        if (!descriptor || !('value' in descriptor) || descriptor.value !== value) return false;
    }
    return true;
}
function observeCreationDecision(
    root: RootEvidence,
    newlyLaunched: boolean,
    actual: number | undefined,
    recorded: number | undefined,
    upperNow: number | undefined,
    branch: CreationIdentityFields['creationBranch'],
    failed: boolean,
) {
    const source = creationSources.get(root);
    const frame = reserveFixtureCreationObservation(
        false,
        source?.frame,
        source ? { pid: source.pid, port: source.port } : undefined,
    );
    if (!frame) return;
    const sameOrigin = source && sameFixtureOrigin(frame.origin, source.frame.origin);
    let sourceStatus: CreationIdentityFields['creationSourceStatus'] = source ? 'unverifiable' : 'missing';
    if (
        source &&
        sameOrigin &&
        source.pid === frame.origin.pid &&
        source.port === frame.origin.port &&
        !source.invalid &&
        source.fields &&
        boundRootMatches(root, source) &&
        (actual === undefined || actual === source.clipped)
    )
        sourceStatus = 'complete';
    const comparisonStatus =
        branch === undefined ? 'not-reached' : branch === 'creation-unverifiable' ? 'unverifiable' : 'reached';
    if (!fixtureCreationFrameActive(frame)) return;
    const fields: FixtureFields = {
        ...frame.origin,
        phase: 'process-identity',
        outcome: failed ? 'rejected' : 'observed',
        creationNewlyLaunched: newlyLaunched,
        creationToleranceMs: 1_000,
        creationSourceStatus: sourceStatus,
        creationComparisonStatus: comparisonStatus,
        creationUpperNowStatus: upperNow === undefined ? 'not-evaluated' : 'read',
        ...(branch === undefined ? {} : { creationBranch: branch }),
        ...(comparisonStatus === 'reached' && recorded !== undefined && actual !== undefined
            ? { creationExpectedUtcMs: recorded, creationObservedUtcMs: actual }
            : {}),
        ...(upperNow === undefined ? {} : { creationUpperNowUtcMs: upperNow }),
        ...(sourceStatus === 'complete' ? source?.fields : {}),
    };
    emitFixtureCreationDecision(frame, fields);
}
function creationClock(carrier: CreationCarrier): number | undefined {
    try {
        return performance.now();
    } catch {
        carrier.invalid = true;
        return;
    }
}
async function creationRead<T>(
    carrier: CreationCarrier | undefined,
    prefix: 'Stat' | 'Boot' | 'Clk',
    job: () => Promise<T>,
): Promise<T> {
    if (!carrier) return job();
    const started = creationClock(carrier);
    try {
        return await job();
    } finally {
        const ended = creationClock(carrier);
        try {
            if (
                started !== undefined &&
                ended !== undefined &&
                Number.isFinite(started) &&
                Number.isFinite(ended) &&
                started >= 0 &&
                ended >= started
            ) {
                carrier.fields = {
                    ...carrier.fields,
                    [`creation${prefix}ReadStartedMs`]: started,
                    [`creation${prefix}ReadEndedMs`]: ended,
                };
            } else carrier.invalid = true;
        } catch {
            carrier.invalid = true;
        }
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
    if (platform === 'linux') return observeNativeFile('proc-exe', () => link(`/proc/${pid}/exe`));
    const result = await observeNativeCommand('lsof', execute, 'lsof', [
        '-a',
        '-p',
        String(pid),
        '-d',
        'txt',
        '-FfDin',
    ]);
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
            const identity = await observeNativeFile('executable-stat', () => fileIdentity(comm));
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
            emitFixtureEvent('native-file', 'decision', { command: 'executable-stat', valid: aliases.size === 1, pid });
            if (aliases.size === 1) return comm;
        } catch {
            // Missing filesystem identity cannot authorize a mapped alias.
        }
    }
    emitFixtureEvent('native-file', 'decision', {
        command: 'lsof',
        valid: matches.length === 1 && executable !== undefined,
        pid,
        count: matches.length,
    });
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

type LinuxSource = { sequence: number; targets: Map<number, { target: ManagedTarget; port: number; time?: string }> };
type LinuxRootProof = {
    source: LinuxSource;
    sequence: number;
    pid: number;
    port: number;
    ticks: bigint;
    h: bigint;
    boot: bigint | undefined;
    raw: string;
    executablePath: string;
    sessionId: number;
};
const linuxRoots = new WeakMap<RootEvidence, LinuxRootProof>();

async function linuxCreationTime(
    pid: number,
    execute: ProcessExecutor,
    readText: (file: string) => Promise<string>,
    carrier?: CreationCarrier,
    knownTime?: string,
): Promise<{ startedAtUtc: string; ticks: bigint; h: bigint; boot: bigint | undefined }> {
    const [stat, boot, clock] = await Promise.all([
        creationRead(carrier, 'Stat', () => observeNativeFile('proc-stat', () => readText(`/proc/${pid}/stat`))),
        knownTime === undefined
            ? creationRead(carrier, 'Boot', () => observeNativeFile('proc-boot', () => readText('/proc/stat')))
            : Promise.resolve(''),
        creationRead(carrier, 'Clk', () => observeNativeCommand('getconf', execute, 'getconf', ['CLK_TCK'])),
    ]);
    // comm may contain spaces and closing parentheses; fields resume after its last ') '.
    const processStat = stat.trim().match(/^(\d+) \([\s\S]*\) (.+)$/);
    const processFields = processStat?.[2]?.split(/\s+/);
    const ticks = processFields?.[19];
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
        (knownTime === undefined && (bootTimes.length !== 1 || !Number.isSafeInteger(bootSeconds))) ||
        clock.code !== 0 ||
        clock.stderr.trim() ||
        !/^\d+$/.test(clockText) ||
        !Number.isSafeInteger(ticksPerSecond) ||
        ticksPerSecond <= 0
    ) {
        emitFixtureEvent('native-file', 'decision', { command: 'proc-stat', pid, valid: false });
        throw new Error('The Linux process creation evidence is unverifiable.');
    }
    // Preserve the legacy scalar for snapshot compatibility and closed diagnostics.
    // Linux authorization uses private raw proof and calibrated intervals, never this estimate.
    const computedNumberMs =
        knownTime === undefined ? bootSeconds * 1_000 + (startTicks / ticksPerSecond) * 1_000 : Date.parse(knownTime);
    const started = new Date(computedNumberMs);
    if (!Number.isFinite(started.getTime())) throw new Error('The Linux process creation evidence is unverifiable.');
    if (carrier && knownTime === undefined) {
        try {
            carrier.clipped = started.getTime();
            carrier.fields = {
                ...carrier.fields,
                creationBootSeconds: bootSeconds,
                creationStartTicks: startTicks,
                creationClkTck: ticksPerSecond,
                creationComputedNumberMs: computedNumberMs,
            };
        } catch {
            carrier.invalid = true;
        }
    }
    if (fixtureHasSubscribers()) {
        // The kernel's /proc stat field 3 reports a fixed task state:
        // https://docs.kernel.org/filesystems/proc.html#process-specific-subdirectories
        const states: Record<string, NonNullable<FixtureFields['rootProcessState']>> = {
            R: 'running',
            S: 'sleeping',
            D: 'disk-sleep',
            T: 'stopped',
            t: 'tracing-stop',
            X: 'dead',
            Z: 'zombie',
            P: 'parked',
            I: 'idle',
        };
        const state = processFields?.[0];
        const counters: FixtureFields = { rootStartTicks: startTicks };
        // Fields resume at stat field 3: majflt=12, utime=14, stime=15,
        // delayacct_blkio_ticks=42. Optional diagnostics never authorize identity.
        for (const [field, index] of [
            ['rootMajorFaults', 9],
            ['rootUserTicks', 11],
            ['rootSystemTicks', 12],
            ['rootBlockIoTicks', 39],
        ] as const) {
            const text = processFields?.[index];
            if (text === undefined || !/^\d+$/.test(text)) continue;
            const value = Number(text);
            if (Number.isSafeInteger(value)) counters[field] = value;
        }
        emitFixtureEvent('native-file', 'decision', {
            command: 'proc-stat',
            pid,
            valid: true,
            rootProcessState:
                state !== undefined && Object.hasOwn(states, state) ? (states[state] ?? 'unknown') : 'unknown',
            ...counters,
        });
    }
    if (carrier && knownTime !== undefined) carrier.invalid = true;
    return {
        startedAtUtc: started.toISOString(),
        ticks: BigInt(startTicks),
        h: BigInt(ticksPerSecond),
        boot: knownTime === undefined ? BigInt(bootSeconds) : undefined,
    };
}

type UnixProcessRow = { pid: number; parent: number; uid: number; started: string; executable: string };

function classifyListenerOwner(
    owner: number,
    root: UnixProcessRow | undefined,
    rows: readonly UnixProcessRow[],
): NonNullable<FixtureFields['listenerOwnerRelation']> {
    if (!Number.isSafeInteger(owner) || owner <= 0) return 'invalid-owner';
    if (!root) return 'root-absent';
    if (owner === root.pid) return 'root';
    const ownerRow = rows.find((candidate) => candidate.pid === owner);
    if (!ownerRow) return 'owner-row-missing';
    let row: UnixProcessRow = ownerRow;
    const seen = new Set([owner]);
    for (let depth = 0; depth < 32; depth++) {
        const parentPid = row.parent;
        if (row.uid !== root.uid) return 'uid-mismatch';
        if (parentPid === 0) return 'unrelated-root';
        if (!Number.isSafeInteger(parentPid) || parentPid < 0) return 'invalid-owner';
        if (seen.has(parentPid)) return 'cycle';
        const parent = rows.find((candidate) => candidate.pid === parentPid);
        if (!parent) return 'ancestor-row-missing';
        if (row.started < parent.started) return 'child-before-parent';
        if (parent.pid === root.pid) return 'owned-descendant';
        seen.add(parent.pid);
        row = parent;
    }
    return 'depth-limit';
}

/** Optional classification of existing buffers; it never authorizes process ownership. */
function emitDarwinListenerOwnerEvidence(
    pid: number,
    rows: readonly UnixProcessRow[],
    listeners: readonly ListenerEvidence[],
    owned: ReadonlySet<number>,
) {
    // Count distinct parsed owner values, not verified identities. Map coalesces
    // malformed values parsed as NaN; record counts retain their listener-record total.
    const counts = new Map<number, number>();
    for (const listener of listeners) counts.set(listener.owningProcess, (counts.get(listener.owningProcess) ?? 0) + 1);
    const root = rows.find((row) => row.pid === pid);
    const rootFields: FixtureFields = root
        ? { rootOwnerUid: root.uid, rootOwnerStartedAtMs: new Date(root.started).getTime() }
        : {};
    const emittedCount = Math.min(counts.size, 8);
    emitFixtureEvent('listener-owner-evidence', 'decision', {
        pid,
        ...rootFields,
        listenerOwnerCount: counts.size,
        listenerRecordCount: listeners.length,
        listenerOwnerEmittedCount: emittedCount,
        listenerOwnerOmittedCount: counts.size - emittedCount,
    });
    let emitted = 0;
    for (const [owner, count] of counts) {
        if (emitted++ >= emittedCount) break;
        const row = rows.find((candidate) => candidate.pid === owner);
        emitFixtureEvent('listener-owner-evidence', 'decision', {
            pid,
            ...rootFields,
            listenerOwnerPid: owner,
            ...(row
                ? {
                      listenerOwnerParentPid: row.parent,
                      listenerOwnerUid: row.uid,
                      listenerOwnerStartedAtMs: new Date(row.started).getTime(),
                  }
                : {}),
            listenerOwnerRecordCount: count,
            listenerOwnerRelation: classifyListenerOwner(owner, root, rows),
            listenerOwnerOwned: owned.has(owner),
        });
    }
}

type UnixDependencies = {
    platform?: NodeJS.Platform;
    currentUser?: () => number;
    readlink?: (file: string) => Promise<string>;
    readText?: (file: string) => Promise<string>;
    run?: ProcessExecutor;
};

export async function unixSnapshot(
    pid: number,
    port: number,
    dependencies: UnixDependencies = {},
): Promise<ProcessEvidence> {
    return snapshotUnix(pid, port, dependencies);
}

async function snapshotUnix(
    pid: number,
    port: number,
    dependencies: UnixDependencies = {},
    source?: LinuxSource,
): Promise<ProcessEvidence> {
    const platform = dependencies.platform ?? process.platform;
    const execute = dependencies.run ?? run;
    const processes = await observeNativeCommand('ps', execute, 'ps', ['-ww', '-axo', 'pid=,ppid=,uid=,lstart=,comm=']);
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
    const frame =
        root && platform === 'linux' && fixtureCreationObservationEnabled()
            ? reserveFixtureCreationObservation(true, undefined, { pid, port })
            : undefined;
    const carrier: CreationCarrier | undefined = frame ? { frame, pid, port } : undefined;
    const sequence = source ? ++source.sequence : 0;
    const previous = source?.targets.get(pid);
    const linuxCreation =
        root && platform === 'linux'
            ? await linuxCreationTime(
                  pid,
                  execute,
                  dependencies.readText ?? ((file) => readFile(file, 'utf8')),
                  carrier,
                  previous?.port === port ? previous.time : undefined,
              )
            : undefined;
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
    const result = await observeNativeCommand('lsof', execute, 'lsof', [
        '-nP',
        `-iTCP:${port}`,
        '-sTCP:LISTEN',
        '-Fpn',
    ]);
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
    if (platform === 'darwin' && fixtureHasSubscribers()) emitDarwinListenerOwnerEvidence(pid, rows, listeners, owned);
    const evidence: ProcessEvidence = {
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
                  startedAtUtc: linuxCreation?.startedAtUtc ?? root.started,
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
    if (source && linuxCreation && evidence.root.exists)
        linuxRoots.set(evidence.root, {
            source,
            sequence,
            pid,
            port,
            ticks: linuxCreation.ticks,
            h: linuxCreation.h,
            boot: linuxCreation.boot,
            raw: evidence.root.startedAtUtc,
            executablePath: evidence.root.executablePath,
            sessionId: evidence.root.sessionId,
        });
    if (carrier && carrier.clipped !== undefined && root && evidence.root.exists) {
        try {
            creationSources.set(evidence.root, {
                ...carrier,
                raw: evidence.root.startedAtUtc,
                clipped: carrier.clipped,
                executablePath: evidence.root.executablePath,
                sessionId: evidence.root.sessionId,
            });
        } catch {
            /* Invalid diagnostic metadata cannot replace the snapshot. */
        }
    }
    return evidence;
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
        now?: () => number;
        unix?: Omit<UnixDependencies, 'platform'>;
    } = {},
): PlatformAdapter {
    const platform = dependencies.platform ?? process.platform;
    const source: LinuxSource = { sequence: 0, targets: new Map() };
    const now = dependencies.now ?? Date.now;
    const readText = dependencies.unix?.readText ?? ((file: string) => readFile(file, 'utf8'));
    const windows = createWindowsLauncher();
    const closeWindows = dependencies.closeWindows;
    const requestUnixClose = dependencies.requestUnixClose ?? ((pid) => process.kill(pid, 'SIGTERM'));
    if (!['win32', 'linux', 'darwin'].includes(platform)) throw new Error('Unsupported operating system.');
    const snapshot: PlatformAdapter['snapshot'] =
        dependencies.snapshot ??
        (platform === 'win32'
            ? async (pid, port) => parseSnapshot(await windowsHelper('Snapshot', { RootProcessId: pid, Port: port }))
            : (pid, port) => snapshotUnix(pid, port, { ...dependencies.unix, platform }, source));
    const calibrations = new WeakMap<object, { value: LinuxCalibration | undefined; target?: ManagedTarget }>();
    type LaunchProof = {
        token: object;
        calibration: LinuxCalibration | undefined;
        requestedAt: number;
        sequence: number;
        child: NonNullable<ManagedTarget['child']>;
        pid: number;
        port: number;
        path: string;
        kind: ProcessTarget['targetKind'];
        requestText: string;
        bound?: { ticks: bigint; h: bigint; sessionId: number; publicTime: string };
    };
    const launches = new WeakMap<ManagedTarget, LaunchProof>();
    const registeredChildren = new WeakSet<NonNullable<ManagedTarget['child']>>();
    async function prepareLaunch(context: LaunchContext = {}): Promise<object> {
        context.signal?.throwIfAborted();
        const value =
            platform === 'linux' ? await abortable(readLinuxCalibration(readText, now), context.signal) : undefined;
        context.signal?.throwIfAborted();
        const token = {};
        calibrations.set(token, { value });
        return token;
    }
    function registerLaunch(target: ManagedTarget, token: object, requestedAt: number) {
        if (platform !== 'linux') return;
        const prior = launches.get(target);
        if (prior) {
            if (
                prior.token === token &&
                prior.child === target.child &&
                prior.pid === target.processId &&
                prior.requestedAt === requestedAt
            )
                return;
            throw new Error('The registered Linux child identity changed.');
        }
        const calibration = calibrations.get(token);
        const child = target.child;
        const pid = child && Object.getOwnPropertyDescriptor(child, 'pid');
        if (
            !calibration?.value ||
            calibration.target ||
            !child ||
            !pid ||
            !('value' in pid) ||
            pid.value !== target.processId ||
            !Number.isSafeInteger(target.processId) ||
            target.processId <= 0 ||
            !Number.isSafeInteger(requestedAt)
        )
            throw new Error('The Linux launch identity is unverifiable.');
        observeTargetExit(target);
        if (targetExitObserved(target) || child.monitoringFailure)
            throw new Error('The Linux actual-child identity is unavailable.');
        const registeredPid = target.processId;
        if (source.targets.has(registeredPid) || registeredChildren.has(child))
            throw new Error('The Linux child identity is already registered.');
        registeredChildren.add(child);
        source.targets.set(registeredPid, { target, port: target.port });
        calibration.target = target;
        launches.set(target, {
            token,
            calibration: calibration.value,
            requestedAt,
            sequence: source.sequence,
            child,
            pid: target.processId,
            port: target.port,
            path: target.executablePath,
            kind: target.targetKind,
            requestText: target.startedAtUtc,
        });
        child.once('exit', () => {
            if (source.targets.get(registeredPid)?.target === target) source.targets.delete(registeredPid);
        });
    }
    function checkLaunch(target: ManagedTarget, proof: LaunchProof, context: LaunchContext) {
        context.signal?.throwIfAborted();
        const pid = Object.getOwnPropertyDescriptor(proof.child, 'pid');
        if (
            target.child !== proof.child ||
            target.processId !== proof.pid ||
            target.port !== proof.port ||
            !pid ||
            !('value' in pid) ||
            pid.value !== proof.pid ||
            target.executablePath !== proof.path ||
            target.targetKind !== proof.kind ||
            target.startedAtUtc !== (proof.bound?.publicTime ?? proof.requestText) ||
            targetExitObserved(target) ||
            proof.child.monitoringFailure
        )
            throw new Error('The registered Linux child identity is unavailable or changed.');
    }
    async function validateIdentity(
        evidence: ProcessEvidence,
        target: ManagedTarget,
        context: IdentityValidationContext = {},
    ) {
        if (platform !== 'linux') {
            validateProcessIdentity(evidence, target, { newlyLaunched: context.newlyLaunched ?? false });
            if (context.newlyLaunched && evidence.root.exists) target.startedAtUtc = evidence.root.startedAtUtc;
            return;
        }
        const launch = launches.get(target);
        if (!launch) throw new Error('The Linux target has no registered launch identity.');
        checkLaunch(target, launch, context);
        const raw = linuxRoots.get(evidence.root);
        if (
            !raw ||
            raw.source !== source ||
            raw.sequence <= launch.sequence ||
            raw.pid !== launch.pid ||
            raw.port !== launch.port ||
            !boundRootMatches(evidence.root, raw) ||
            normalizePath(raw.executablePath) !== normalizePath(launch.path) ||
            raw.sessionId !== evidence.currentSessionId
        )
            throw new Error('The Linux root identity proof is unverifiable.');
        if (launch.bound) {
            if (
                raw.ticks !== launch.bound.ticks ||
                raw.h !== launch.bound.h ||
                raw.sessionId !== launch.bound.sessionId
            )
                throw new Error('The Linux process creation identity changed.');
            return;
        }
        if (raw.boot === undefined) throw new Error('The Linux initial creation identity lacks boot evidence.');
        // This read occurs after the associated stat read, in this adapter's unchanged proc reader context.
        const post = await abortable(readLinuxCalibration(readText, now), context.signal);
        checkLaunch(target, launch, context);
        if (
            !launch.calibration ||
            post.uptimeUpperNs < launch.calibration.uptimeUpperNs ||
            launch.calibration.beforeUtcMs < launch.requestedAt ||
            post.beforeUtcMs < launch.calibration.afterUtcMs
        )
            throw new Error('The Linux process creation clock identity moved backwards.');
        if (
            linuxRoots.get(evidence.root) !== raw ||
            !boundRootMatches(evidence.root, raw) ||
            evidence.currentSessionId !== raw.sessionId
        )
            throw new Error('The Linux root identity proof changed.');
        const offset =
            launch.calibration &&
            intersectLinuxIntervals(launch.calibration, post, {
                lowerNs: raw.boot * 1_000_000_000n,
                upperNs: (raw.boot + 1n) * 1_000_000_000n,
            });
        const birth = linuxBirthInterval({
            rawTicks: raw.ticks,
            clkTck: raw.h,
            readerBirthUpperNs: post.uptimeUpperNs,
        });
        const decisionNow = now();
        if (decisionNow < post.afterUtcMs)
            throw new Error('The Linux process creation clock identity moved backwards.');
        const publicTime =
            offset &&
            birth &&
            linuxPublicTime(
                { lowerNs: offset.lowerNs + birth.lowerNs, upperNs: offset.upperNs + birth.upperNs },
                launch.requestedAt,
                decisionNow,
            );
        if (!publicTime) throw new Error('The Linux process creation identity interval is unverifiable.');
        context.assertReadinessActive?.();
        checkLaunch(target, launch, context);
        // A concurrent first validation may already have bound the same child.
        const concurrent = launches.get(target)?.bound;
        if (
            concurrent &&
            (concurrent.ticks !== raw.ticks || concurrent.h !== raw.h || concurrent.sessionId !== raw.sessionId)
        )
            throw new Error('The Linux process creation identity changed.');
        if (!launch.bound) launch.bound = { ticks: raw.ticks, h: raw.h, sessionId: raw.sessionId, publicTime };
        source.targets.set(launch.pid, { target, port: launch.port, time: launch.bound.publicTime });
        target.startedAtUtc = launch.bound.publicTime;
    }
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
        await validateIdentity(evidence, target, context);
        context.signal?.throwIfAborted();
        if (targetExitObserved(target)) return { closeRequested: false, processExited: true };
        if (platform === 'linux') {
            const launch = launches.get(target);
            if (!launch) throw new Error('The Linux target has no registered launch identity.');
            checkLaunch(target, launch, context);
        }
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
            emitFixtureEvent(
                'native-close',
                'decision',
                { phase: 'normal-close', outcome: 'failed', pid: target.processId, port: target.port },
                cause,
            );
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
        prepareLaunch,
        registerLaunch,
        validateIdentity,
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
                const result = await observeNativeCommand('netsh', run, 'netsh.exe', [
                    'int',
                    family,
                    'show',
                    'excludedportrange',
                    'protocol=tcp',
                ]);
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
