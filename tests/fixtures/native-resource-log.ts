import { randomUUID } from 'node:crypto';

export type NativeResourceVariant =
    | 'group-normal'
    | 'group-abandoned'
    | 'group-body-failure'
    | 'group-abandoned-body-failure'
    | 'creator-handoff'
    | 'receiver-none'
    | 'receiver-before-late'
    | 'receiver-before-witness'
    | 'lost-packet';
export type WitnessRole = 'root' | 'middle' | 'late';
export type WitnessPhase = 'compile' | 'inspect' | 'armed' | 'wait' | 'exit';
export type WitnessContext = 'initial-arming' | 'late-arming' | 'exit-join';
export type NativeResourceStage =
    | 'fixture'
    | 'launch'
    | 'initial-arming'
    | 'root-release'
    | 'root-exit'
    | 'resource-wait'
    | 'late-release'
    | 'late-ready-wait'
    | 'late-arming'
    | 'finish-release'
    | 'exit-join'
    | 'additional-exit'
    | 'body'
    | 'cleanup'
    | 'directory-remove';
type NativeResourceEvent =
    | 'BEGIN'
    | 'END'
    | 'FAILURE'
    | 'SPAWN'
    | 'PHASE'
    | 'IDENTITY'
    | 'CLOSE'
    | 'LIMITATION'
    | 'SUMMARY';
export type PidState = 'valid' | 'missing' | 'empty' | 'malformed' | 'out-of-range' | 'read-failed';
type ReceiptState = 'absent' | 'accepted' | 'rejected';
export interface WitnessDiagnostic {
    role: WitnessRole;
    context: WitnessContext;
    phase: WitnessPhase;
    phaseKnown: boolean;
    spawned: boolean;
    pidState: PidState;
    ownedPid: number | null;
    witnessPid: number | null;
    armed: boolean;
    errorKind: 'invalid-pid' | 'spawn' | 'compile' | 'native' | 'protocol' | 'unexpected';
    win32Code: number | null;
    hresult: number | null;
    closeCode: number | null;
    applicationExitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: { bytes: number; retainedBytes: number; truncated: boolean; parsing: 'pending' | 'valid' | 'invalid' };
    stderr: { bytes: number; retainedBytes: number; truncated: boolean; parsing: 'not-parsed' };
    armedReceipt: ReceiptState;
    exitReceipt: ReceiptState;
    failedReceipt: ReceiptState;
}

export class NativeFixtureFailure extends Error {
    readonly diagnostic: Readonly<WitnessDiagnostic>;
    constructor(diagnostic: WitnessDiagnostic) {
        super('Owned native fixture witness failed.');
        this.name = 'NativeFixtureFailure';
        const safe = projectDiagnostic(diagnostic);
        this.diagnostic = Object.freeze({
            ...safe,
            stdout: Object.freeze(safe.stdout),
            stderr: Object.freeze(safe.stderr),
        });
    }
}

export interface NativeResourceEvidence {
    phase?: WitnessPhase;
    phaseKnown?: boolean;
    ownedPid?: number;
    witnessPid?: number | null;
    spawned?: boolean;
    startedAtUtc?: string;
    executableVerified?: boolean;
    applicationExitCode?: number;
    closeCode?: number | null;
    signal?: NodeJS.Signals | null;
    rootExitSource?: 'native-handle' | 'handoff-receipt' | 'retained-witness' | 'not-observed';
    diagnostic?: Readonly<WitnessDiagnostic>;
}
export type NativeResourceSink = (line: string, failed: (error?: Error | null) => void) => unknown;

const stdoutFailures = new Set<(error?: Error | null) => void>();
let stdoutObserved = false;
function consoleSink(line: string, failed: (error?: Error | null) => void) {
    if (!stdoutObserved) {
        stdoutObserved = true;
        // Write callbacks do not consume the stream's error event (including EPIPE).
        process.stdout.on('error', () => {
            for (const notify of stdoutFailures) notify(new Error('Diagnostic output unavailable.'));
        });
    }
    stdoutFailures.add(failed);
    process.stdout.write(line, (error) => {
        if (error) failed(error);
        stdoutFailures.delete(failed);
    });
}

const signals = new Set([
    'SIGABRT',
    'SIGALRM',
    'SIGBREAK',
    'SIGBUS',
    'SIGCHLD',
    'SIGCONT',
    'SIGFPE',
    'SIGHUP',
    'SIGILL',
    'SIGINT',
    'SIGIO',
    'SIGIOT',
    'SIGKILL',
    'SIGPIPE',
    'SIGPOLL',
    'SIGPROF',
    'SIGPWR',
    'SIGQUIT',
    'SIGSEGV',
    'SIGSTKFLT',
    'SIGSTOP',
    'SIGSYS',
    'SIGTERM',
    'SIGTRAP',
    'SIGTSTP',
    'SIGTTIN',
    'SIGTTOU',
    'SIGUNUSED',
    'SIGURG',
    'SIGUSR1',
    'SIGUSR2',
    'SIGVTALRM',
    'SIGWINCH',
    'SIGXCPU',
    'SIGXFSZ',
]);
export function safeSignal(value: unknown): NodeJS.Signals | null {
    return typeof value === 'string' && signals.has(value) ? (value as NodeJS.Signals) : null;
}
export function safeExitCode(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 4294967295
        ? value
        : null;
}

export function safeWitnessPid(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : null;
}

function member<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
    return values.find((candidate) => candidate === value) ?? fallback;
}
function count(value: number) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function nativeCode(value: number | null) {
    return value !== null && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : null;
}
function projectDiagnostic(value: Readonly<WitnessDiagnostic>): WitnessDiagnostic {
    return {
        role: member(value.role, ['root', 'middle', 'late'], 'root'),
        context: member(value.context, ['initial-arming', 'late-arming', 'exit-join'], 'initial-arming'),
        phase: member(value.phase, ['compile', 'inspect', 'armed', 'wait', 'exit'], 'compile'),
        phaseKnown: value.phaseKnown === true,
        spawned: value.spawned === true,
        pidState: member(
            value.pidState,
            ['valid', 'missing', 'empty', 'malformed', 'out-of-range', 'read-failed'],
            'malformed',
        ),
        ownedPid:
            value.pidState === 'valid' &&
            value.ownedPid !== null &&
            Number.isInteger(value.ownedPid) &&
            value.ownedPid > 0 &&
            value.ownedPid <= 2147483647
                ? value.ownedPid
                : null,
        witnessPid: value.spawned === true ? safeWitnessPid(value.witnessPid) : null,
        armed: value.armed === true,
        errorKind: member(
            value.errorKind,
            ['invalid-pid', 'spawn', 'compile', 'native', 'protocol', 'unexpected'],
            'unexpected',
        ),
        win32Code: nativeCode(value.win32Code),
        hresult: nativeCode(value.hresult),
        closeCode: safeExitCode(value.closeCode),
        applicationExitCode: safeExitCode(value.applicationExitCode),
        signal: safeSignal(value.signal),
        stdout: {
            bytes: count(value.stdout.bytes),
            retainedBytes: Math.min(262144, count(value.stdout.retainedBytes)),
            truncated: value.stdout.truncated === true,
            parsing: member(value.stdout.parsing, ['pending', 'valid', 'invalid'], 'invalid'),
        },
        stderr: {
            bytes: count(value.stderr.bytes),
            retainedBytes: 0,
            truncated: value.stderr.truncated === true,
            parsing: 'not-parsed',
        },
        armedReceipt: member(value.armedReceipt, ['absent', 'accepted', 'rejected'], 'rejected'),
        exitReceipt: member(value.exitReceipt, ['absent', 'accepted', 'rejected'], 'rejected'),
        failedReceipt: member(value.failedReceipt, ['absent', 'accepted', 'rejected'], 'rejected'),
    };
}

function project(evidence: NativeResourceEvidence) {
    // Deliberately enumerate fields: callers cannot add arbitrary console content.
    return {
        ...(evidence.phase && ['compile', 'inspect', 'armed', 'wait', 'exit'].includes(evidence.phase)
            ? { phase: evidence.phase }
            : {}),
        ...(typeof evidence.phaseKnown === 'boolean' ? { phaseKnown: evidence.phaseKnown } : {}),
        ...(Number.isInteger(evidence.ownedPid) &&
        (evidence.ownedPid ?? 0) > 0 &&
        (evidence.ownedPid ?? Infinity) <= 2147483647
            ? { ownedPid: evidence.ownedPid }
            : {}),
        ...(typeof evidence.startedAtUtc === 'string' &&
        evidence.startedAtUtc.length <= 64 &&
        Number.isFinite(Date.parse(evidence.startedAtUtc))
            ? { startedAtUtc: new Date(Date.parse(evidence.startedAtUtc)).toISOString() }
            : {}),
        ...(evidence.witnessPid !== undefined ? { witnessPid: safeWitnessPid(evidence.witnessPid) } : {}),
        ...(typeof evidence.spawned === 'boolean' ? { spawned: evidence.spawned } : {}),
        ...(evidence.executableVerified === true ? { executableVerified: true } : {}),
        ...(evidence.applicationExitCode !== undefined
            ? { applicationExitCode: safeExitCode(evidence.applicationExitCode) }
            : {}),
        ...(evidence.closeCode !== undefined ? { closeCode: safeExitCode(evidence.closeCode) } : {}),
        ...(evidence.signal !== undefined ? { signal: safeSignal(evidence.signal) } : {}),
        ...(evidence.rootExitSource &&
        ['native-handle', 'handoff-receipt', 'retained-witness', 'not-observed'].includes(evidence.rootExitSource)
            ? { rootExitSource: evidence.rootExitSource }
            : {}),
        ...(evidence.diagnostic ? { diagnostic: projectDiagnostic(evidence.diagnostic) } : {}),
    };
}

export function createNativeResourceLog(
    variant: NativeResourceVariant,
    options: { sink?: NativeResourceSink; clock?: () => number } = {},
) {
    const fixtureId = randomUUID();
    const clock = options.clock ?? (() => performance.now());
    const origin = clock();
    const sink = options.sink ?? consoleSink;
    let sequence = 0;
    let emittedEvents = 0;
    let emittedBytes = 0;
    let droppedEvents = 0;
    let droppedBytes = 0;
    let truncated = false;
    let writeFailed = false;
    let finished = false;
    let pending = 0;
    let pendingWitnesses = 0;
    let incomplete = false;
    let limited = false;
    const snapshot = () => ({
        emittedEvents,
        emittedBytes,
        droppedEvents,
        droppedBytes,
        truncated,
        writeFailed,
        incomplete: incomplete || !finished || pending > 0 || pendingWitnesses > 0 || truncated || writeFailed,
    });
    const failed = (error?: Error | null) => {
        if (!error) return;
        writeFailed = true;
        if (finished && !limited) {
            limited = true;
            emit('LIMITATION', 'fixture', undefined, {}, true);
        }
    };
    function emit(
        event: NativeResourceEvent,
        stage: NativeResourceStage,
        role?: WitnessRole,
        evidence: NativeResourceEvidence = {},
        reserved = false,
    ) {
        if (finished && event !== 'SUMMARY' && !incomplete) {
            incomplete = true;
            if (!limited && event !== 'LIMITATION') {
                limited = true;
                emit('LIMITATION', 'fixture', undefined, {}, true);
            }
        }
        const safe = project(evidence);
        const relativeMs = Math.max(0, Math.round((clock() - origin) * 1000) / 1000);
        const record = {
            fixtureId,
            variant,
            sequence: sequence + 1,
            relativeMs,
            event,
            stage,
            ...(role ? { role } : {}),
            ...safe,
            limits: snapshot(),
        };
        let line = `${JSON.stringify(record)}\n`;
        for (let attempt = 0; attempt < 4; attempt++) {
            record.limits = {
                ...snapshot(),
                emittedEvents: emittedEvents + 1,
                emittedBytes: emittedBytes + Buffer.byteLength(line),
            };
            line = `${JSON.stringify(record)}\n`;
        }
        const bytes = Buffer.byteLength(line);
        if (bytes > 4096 || (!reserved && (writeFailed || emittedEvents >= 126 || emittedBytes + bytes > 122880))) {
            droppedEvents = Math.min(Number.MAX_SAFE_INTEGER, droppedEvents + 1);
            droppedBytes = Math.min(Number.MAX_SAFE_INTEGER, droppedBytes + bytes);
            truncated = true;
            if (!limited && !writeFailed) {
                limited = true;
                emit('LIMITATION', 'fixture', undefined, {}, true);
            }
            return;
        }
        if (emittedEvents >= 128 || emittedBytes + bytes > 131072) return;
        sequence++;
        emittedEvents++;
        emittedBytes += bytes;
        try {
            const result = sink(line, failed);
            if (result instanceof Promise) void result.catch(() => failed(new Error('Diagnostic output unavailable.')));
        } catch {
            failed(new Error('Diagnostic output unavailable.'));
        }
    }
    const event = (
        kind: NativeResourceEvent,
        stage: NativeResourceStage,
        role?: WitnessRole,
        evidence?: NativeResourceEvidence,
    ) => emit(kind, stage, role, evidence);
    function begin(stage: NativeResourceStage, role?: WitnessRole) {
        pending++;
        event('BEGIN', stage, role);
    }
    function settled(stage: NativeResourceStage, role: WitnessRole | undefined, rejected = false, error?: unknown) {
        pending--;
        if (rejected && (stage === 'fixture' || stage === 'cleanup')) incomplete = true;
        event(
            rejected ? 'FAILURE' : 'END',
            stage,
            role,
            error instanceof NativeFixtureFailure ? { diagnostic: error.diagnostic } : {},
        );
    }
    return {
        fixtureId,
        event,
        snapshot,
        trackWitnessExit(exited: Promise<void>): void {
            // Observe the original waiter; rejection does not prove the helper exited.
            pendingWitnesses++;
            void exited.then(
                () => {
                    pendingWitnesses--;
                },
                () => {
                    pendingWitnesses--;
                    incomplete = true;
                },
            );
        },
        async step<T>(
            stage: NativeResourceStage,
            role: WitnessRole | undefined,
            action: () => T | Promise<T>,
        ): Promise<T> {
            begin(stage, role);
            try {
                const result = await action();
                settled(stage, role);
                return result;
            } catch (error) {
                settled(stage, role, true, error);
                throw error;
            }
        },
        observe<T>(
            stage: NativeResourceStage,
            role: WitnessRole | undefined,
            source: Promise<T> | (() => Promise<T>),
        ): Promise<T> {
            begin(stage, role);
            let promise: Promise<T>;
            try {
                promise = typeof source === 'function' ? source() : source;
            } catch (error) {
                settled(stage, role, true, error);
                throw error;
            }
            void promise.then(
                () => settled(stage, role),
                (error: unknown) => settled(stage, role, true, error),
            );
            return promise;
        },
        finish() {
            if (!finished) {
                incomplete ||= pending > 0 || pendingWitnesses > 0;
                finished = true;
                emit('SUMMARY', 'fixture', undefined, {}, true);
            }
        },
    };
}
export type NativeResourceLog = ReturnType<typeof createNativeResourceLog>;
