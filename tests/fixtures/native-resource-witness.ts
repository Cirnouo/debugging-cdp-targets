import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import {
    NativeFixtureFailure,
    type NativeResourceLog,
    type PidState,
    safeExitCode,
    safeSignal,
    safeWitnessPid,
    type WitnessContext,
    type WitnessDiagnostic,
    type WitnessPhase,
    type WitnessRole,
} from './native-resource-log.ts';

export interface WitnessChild {
    readonly pid?: number | undefined;
    readonly stdout: Readable | null;
    readonly stderr: Readable | null;
    once(event: 'error', listener: (error: Error) => void): this;
    once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}
export type WitnessSpawn = (
    executable: string,
    args: string[],
    options: { windowsHide: true; shell: false; stdio: ['ignore', 'pipe', 'pipe'] },
) => WitnessChild;

function diagnostic(
    role: WitnessRole,
    context: WitnessContext,
    pidState: PidState,
    ownedPid: number | null,
): WitnessDiagnostic {
    return {
        role,
        context,
        phase: 'inspect',
        phaseKnown: false,
        spawned: false,
        pidState,
        ownedPid,
        witnessPid: null,
        armed: false,
        errorKind: 'invalid-pid',
        win32Code: null,
        hresult: null,
        closeCode: null,
        applicationExitCode: null,
        signal: null,
        stdout: { bytes: 0, retainedBytes: 0, truncated: false, parsing: 'pending' },
        stderr: { bytes: 0, retainedBytes: 0, truncated: false, parsing: 'not-parsed' },
        armedReceipt: 'absent',
        exitReceipt: 'absent',
        failedReceipt: 'absent',
    };
}

export function pidInputFailure(role: WitnessRole, context: WitnessContext, state: PidState, log: NativeResourceLog) {
    const error = new NativeFixtureFailure(diagnostic(role, context, state, null));
    log.event('FAILURE', context, role, { diagnostic: error.diagnostic });
    return error;
}

export async function retainWitnessFromPidText(
    text: string | undefined,
    role: WitnessRole,
    context: WitnessContext,
    log: NativeResourceLog,
    create?: WitnessSpawn,
) {
    const token = text?.trim();
    const state: PidState =
        token === undefined
            ? 'missing'
            : token === ''
              ? 'empty'
              : !/^\d+$/.test(token)
                ? 'malformed'
                : !Number.isSafeInteger(Number(token)) || Number(token) < 1 || Number(token) > 2147483647
                  ? 'out-of-range'
                  : 'valid';
    if (state !== 'valid') throw pidInputFailure(role, context, state, log);
    return retainExitWitness(Number(token), role, context, log, create);
}

const phases: WitnessPhase[] = ['compile', 'inspect', 'armed', 'wait', 'exit'];
function int32(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}

export function retainExitWitness(
    pid: number,
    role: WitnessRole,
    context: WitnessContext,
    log: NativeResourceLog,
    create: WitnessSpawn = spawn,
) {
    if (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647)
        throw pidInputFailure(role, context, 'out-of-range', log);
    const state = diagnostic(role, context, 'valid', pid);
    state.phase = 'compile';
    state.errorKind = 'unexpected';
    let resolveArmed = () => {};
    let rejectArmed: (error: unknown) => void = () => {};
    let resolveExited = () => {};
    let rejectExited: (error: unknown) => void = () => {};
    const armed = new Promise<void>((resolve, reject) => {
        resolveArmed = resolve;
        rejectArmed = reject;
    });
    const exited = new Promise<void>((resolve, reject) => {
        resolveExited = resolve;
        rejectExited = reject;
    });
    void armed.catch(() => {});
    void exited.catch(() => {});
    log.trackWitnessExit(exited);
    let bad = false;
    let failed = false;
    let spawnFailed = false;
    let receipts = 0;
    let buffer = Buffer.alloc(0);
    let lastPhase = -1;
    function invalid() {
        bad = true;
        state.errorKind = 'protocol';
        state.stdout.parsing = 'invalid';
    }
    function failure() {
        const error = new NativeFixtureFailure(state);
        rejectArmed(error);
        rejectExited(error);
        return error;
    }
    function parse(line: Buffer) {
        if (++receipts > 64) {
            invalid();
            return;
        }
        let value: unknown;
        try {
            value = JSON.parse(line.toString('utf8'));
        } catch {
            invalid();
            return;
        }
        if (
            !isRecord(value) ||
            value.role !== role ||
            value.pid !== pid ||
            failed ||
            (state.exitReceipt === 'accepted' && (bad || value.event !== 'failed' || value.phase !== 'exit'))
        ) {
            invalid();
            return;
        }
        if (value.event === 'phase') {
            const phase = phases.find((candidate) => candidate === value.phase);
            const index = phase ? phases.indexOf(phase) : -1;
            if (index < 0 || index < lastPhase) {
                invalid();
                return;
            }
            lastPhase = index;
            state.phase = phases[index] ?? 'compile';
            state.phaseKnown = true;
            log.event('PHASE', context, role, { phase: state.phase, phaseKnown: true, ownedPid: pid });
            if (state.phase === 'wait') log.event('BEGIN', role === 'root' ? 'root-exit' : 'exit-join', role);
        } else if (value.event === 'armed') {
            state.armedReceipt = 'rejected';
            if (
                bad ||
                state.armed ||
                lastPhase > 2 ||
                typeof value.executablePath !== 'string' ||
                value.executablePath.length > 32768 ||
                path.win32.resolve(value.executablePath).toLowerCase() !==
                    path.win32.resolve(process.execPath).toLowerCase() ||
                typeof value.startedAtUtc !== 'string' ||
                value.startedAtUtc.length > 64 ||
                !Number.isFinite(Date.parse(value.startedAtUtc))
            ) {
                invalid();
                return;
            }
            state.armed = true;
            state.armedReceipt = 'accepted';
            resolveArmed();
            log.event('IDENTITY', context, role, {
                ownedPid: pid,
                startedAtUtc: value.startedAtUtc,
                executableVerified: true,
            });
        } else if (value.event === 'exited') {
            state.exitReceipt = 'rejected';
            if (!bad && state.armed) state.applicationExitCode = safeExitCode(value.exitCode);
            if (bad || !state.armed || state.applicationExitCode !== 0) {
                invalid();
                return;
            }
            state.exitReceipt = 'accepted';
            log.event('END', role === 'root' ? 'root-exit' : 'exit-join', role, {
                applicationExitCode: 0,
                ...(role === 'root' ? { rootExitSource: 'retained-witness' as const } : {}),
            });
        } else if (value.event === 'failed') {
            state.failedReceipt = 'rejected';
            if (
                !phases.some((phase) => phase === value.phase) ||
                typeof value.errorKind !== 'string' ||
                !['compile', 'native', 'unexpected'].includes(value.errorKind) ||
                (value.win32Code !== null && !int32(value.win32Code)) ||
                (value.hresult !== null && !int32(value.hresult))
            ) {
                invalid();
                return;
            }
            failed = true;
            state.phase = value.phase as WitnessPhase;
            state.phaseKnown = true;
            state.errorKind = value.errorKind as 'compile' | 'native' | 'unexpected';
            state.win32Code = value.win32Code;
            state.hresult = value.hresult;
            state.failedReceipt = 'accepted';
            log.event('FAILURE', context, role, { diagnostic: new NativeFixtureFailure(state).diagnostic });
        } else {
            invalid();
        }
    }
    function data(chunk: Buffer | string) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        state.stdout.bytes = Math.min(Number.MAX_SAFE_INTEGER, state.stdout.bytes + bytes.length);
        const available = Math.max(0, 262144 - state.stdout.retainedBytes);
        const retained = bytes.subarray(0, available);
        state.stdout.retainedBytes += retained.length;
        if (retained.length !== bytes.length) {
            state.stdout.truncated = true;
            invalid();
        }
        buffer = Buffer.concat([buffer, retained]);
        let newline = buffer.indexOf(10);
        while (newline !== -1) {
            const line = buffer.subarray(0, newline);
            buffer = buffer.subarray(newline + 1);
            parse(line);
            newline = buffer.indexOf(10);
        }
    }
    let child: WitnessChild;
    try {
        child = create(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./native-resource-witness.ps1', import.meta.url)),
                '-OwnedPid',
                String(pid),
                '-Role',
                role,
            ],
            { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        state.witnessPid = safeWitnessPid(child.pid);
        state.spawned = state.witnessPid !== null;
        log.event('SPAWN', context, role, { ownedPid: pid, witnessPid: state.witnessPid, spawned: state.spawned });
    } catch {
        state.errorKind = 'spawn';
        const error = failure();
        log.event('FAILURE', context, role, { diagnostic: error.diagnostic });
        return { armed, exited };
    }
    child.stdout?.on('data', data);
    const pipeError = () => {
        invalid();
        const error = failure();
        log.event('FAILURE', context, role, { diagnostic: error.diagnostic });
    };
    child.stdout?.once('error', pipeError);
    child.stderr?.once('error', pipeError);
    child.stderr?.on('data', (chunk: Buffer | string) => {
        const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        state.stderr.bytes = Math.min(Number.MAX_SAFE_INTEGER, state.stderr.bytes + bytes);
        state.stderr.truncated = state.stderr.bytes > 16384;
    });
    child.once('error', () => {
        spawnFailed = true;
        state.errorKind = 'spawn';
        const error = failure();
        log.event('FAILURE', context, role, { diagnostic: error.diagnostic });
    });
    child.once('close', (code, signal) => {
        state.closeCode = safeExitCode(code);
        state.signal = safeSignal(signal);
        if (buffer.length > 0) parse(buffer);
        buffer = Buffer.alloc(0);
        if (!bad && receipts > 0) state.stdout.parsing = 'valid';
        if (
            !bad &&
            !failed &&
            !spawnFailed &&
            code === 0 &&
            signal === null &&
            state.armed &&
            state.exitReceipt === 'accepted'
        ) {
            state.stdout.parsing = 'valid';
            resolveExited();
        } else {
            if (!failed && !spawnFailed) invalid();
            const error = failure();
            log.event('FAILURE', context, role, { diagnostic: error.diagnostic });
        }
        log.event('CLOSE', 'exit-join', role, {
            diagnostic: new NativeFixtureFailure(state).diagnostic,
            closeCode: state.closeCode,
            signal: state.signal,
        });
    });
    return { armed, exited };
}
