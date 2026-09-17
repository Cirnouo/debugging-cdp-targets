import { SessionError, fail } from '../shared/errors.mjs';
import { createSessionRecord } from '../domains/managed-session/record.mjs';
import { validateDaemonStatus, resolveStopDaemonAction } from '../domains/devtools-bridge/contracts.mjs';
import { readSessionRecord, writeSessionRecord, removeSessionRecord } from '../adapters/local-data.mjs';
import { processExists } from '../adapters/windows-target.mjs';

export async function reconcileMissingTarget({
    state, statePath, targetInspection, getDaemonStatus, stopDaemon,
    removeState = removeSessionRecord, processExists: processIsPresent = processExists,
}) {
    if (targetInspection?.status !== 'absent' || targetInspection.reason !== 'root-and-listener-absent') return false;
    let status;
    try { status = await getDaemonStatus(state); } catch (error) {
        fail('DAEMON_IDENTITY_UNVERIFIABLE', 'The missing target cannot be reconciled because its daemon is unverifiable. State was retained.', { cause: error.message });
    }
    if (typeof status?.running !== 'boolean') fail('DAEMON_IDENTITY_UNVERIFIABLE', 'The daemon returned no reliable running status. State was retained.');
    const action = resolveStopDaemonAction({ state, status, processExists: processIsPresent });
    if (action.action === 'reject') fail('DAEMON_IDENTITY_MISMATCH', 'The daemon identity does not match. State was retained.', { reason: action.reason });
    if (action.action === 'stop') {
        try {
            await stopDaemon(action.state);
            const after = await getDaemonStatus(state);
            if (after?.running !== false) fail('DAEMON_STOP_FAILED', 'Daemon absence could not be confirmed. State was retained.');
        } catch (error) {
            fail('DAEMON_STOP_FAILED', 'The daemon cleanup could not be confirmed. State was retained.', { cause: error.message });
        }
    }
    try { await removeState(statePath); } catch (error) {
        fail('STATE_REMOVE_FAILED_RECOVERABLE', 'The target and daemon are absent, but state removal failed.', { cause: error.message });
    }
    return true;
}

export async function requireManagedTarget({ state, validateTarget, inspectTarget, duringInvoke = false, invocation = false, ...cleanup }) {
    const inspection = inspectTarget
        ? await inspectTarget(state)
        : { status: await validateTarget(state) ? 'valid' : 'mismatch' };
    if (inspection?.status === 'valid') return;
    if (await reconcileMissingTarget({ state, targetInspection: inspection, ...cleanup })) {
        fail(duringInvoke ? 'TARGET_EXITED_DURING_INVOKE' : 'TARGET_EXITED', 'The managed target exited and its session was cleared. No replacement target was started.', {
            sessionCleared: true,
            ...(invocation ? { toolMayHaveExecuted: duringInvoke } : {}),
        });
    }
    fail('TARGET_IDENTITY_MISMATCH', 'The managed target identity could not be confirmed. State was retained.', invocation ? { toolMayHaveExecuted: duringInvoke } : undefined);
}

export async function invokeGuardedTool({ state, toolArguments, validateTarget, validateDaemon, runNpx, ...cleanup }) {
    if (!Array.isArray(toolArguments) || toolArguments.length === 0) fail('TOOL_ARGUMENT_REQUIRED', 'Invoke requires at least one official CLI tool argument.');
    await requireManagedTarget({ state, validateTarget, ...cleanup, invocation: true });
    if (state.status !== 'active') fail('SESSION_NOT_ACTIVE', 'The managed session is not active.');
    if (!await validateDaemon(state)) fail('DAEMON_IDENTITY_MISMATCH', 'The daemon is absent or does not match the managed session. The tool was not invoked.');
    let result;
    let invocationError;
    try { result = await runNpx(toolArguments, state); } catch (error) { invocationError = error; }
    await requireManagedTarget({ state, validateTarget, ...cleanup, duringInvoke: true, invocation: true });
    if (!await validateDaemon(state)) fail('DAEMON_IDENTITY_MISMATCH', 'The daemon identity changed during the tool invocation; the call may already have executed. No mismatched process was stopped.');
    if (invocationError) throw invocationError;
    return result;
}

export async function stopManagedSession({
    statePath,
    disposition,
    stopDaemon,
    closeTarget,
    writeState = writeSessionRecord,
    removeState = removeSessionRecord,
}) {
    if (!['Close', 'Keep'].includes(disposition)) fail('DISPOSITION_INVALID', 'Disposition must be Close or Keep.');
    const state = await readSessionRecord(statePath);
    if (!state) return { status: 'none', disposition };
    if (state.status === 'active') await stopDaemon(state);
    const detached = createSessionRecord({ ...state, status: 'detached', daemonProcessId: 0 });

    if (disposition === 'Keep') {
        try { await writeState(statePath, detached); } catch (error) {
            fail('STATE_WRITE_FAILED_RECOVERABLE', 'The daemon stopped, but detached state could not be persisted. Retry Stop; the recorded active session remains recoverable.', { cause: error.message });
        }
        return {
            status: 'detached',
            disposition,
            rootProcessId: state.rootProcessId,
            port: state.port,
            warning: 'The target remains controllable by local processes through its loopback CDP port.',
        };
    }

    const closed = await closeTarget(state);
    if (closed) {
        try { await removeState(statePath); } catch (error) {
            fail('STATE_REMOVE_FAILED_RECOVERABLE', 'The target closed, but its stale state file could not be removed. A later Start can discard it after confirming target and daemon absence.', { cause: error.message });
        }
        return { status: 'closed', disposition, rootProcessId: state.rootProcessId };
    }
    try { await writeState(statePath, detached); } catch (error) {
        fail('STATE_WRITE_FAILED_RECOVERABLE', 'The daemon stopped and the close request was sent, but detached state could not be persisted. Retry Stop; the recorded active session remains recoverable.', { cause: error.message });
    }
    return {
        status: 'close-pending',
        disposition,
        rootProcessId: state.rootProcessId,
        port: state.port,
        warning: 'The application did not exit after a normal window-close request. Close it manually; no forced termination was attempted.',
    };
}

export async function resumeManagedSession({
    statePath,
    validateTarget,
    startDaemon,
    validateDaemon,
    stopDaemon = async () => {},
    writeState = writeSessionRecord,
    ...cleanup
}) {
    const state = await readSessionRecord(statePath);
    if (!state) fail('DETACHED_SESSION_REQUIRED', 'Resume requires a detached session written by this Skill.');
    await requireManagedTarget({ state, statePath, validateTarget, stopDaemon, ...cleanup });
    if (state.status !== 'detached') fail('DETACHED_SESSION_REQUIRED', 'Resume requires a detached session written by this Skill.');
    const started = await startDaemon(state);
    const daemonProcessId = Number(started?.processId ?? started?.ProcessId ?? started);
    const active = createSessionRecord({ ...state, status: 'active', daemonProcessId });
    if (!await validateDaemon(active)) {
        try { await stopDaemon(active); } catch { /* Preserve the validation failure. */ }
        await writeState(statePath, createSessionRecord({ ...state, status: 'detached', daemonProcessId: 0 }));
        fail('DAEMON_IDENTITY_MISMATCH', 'The restarted daemon failed identity validation.');
    }
    try {
        await writeState(statePath, active);
    } catch (error) {
        let recovered = false;
        try {
            await stopDaemon(active);
            recovered = !await validateDaemon(active);
        } catch { /* Report whether compensation could be confirmed. */ }
        if (recovered) {
            fail('STATE_WRITE_FAILED_RECOVERED', 'The active state could not be persisted, so the newly started daemon was stopped and the detached session was preserved.', { cause: error.message });
        }
        fail('STATE_WRITE_FAILED_DAEMON_ACTIVE', 'The active state could not be persisted and daemon rollback could not be confirmed. Run Stop to recover the recorded detached session.', {
            cause: error.message,
            daemonProcessId,
        });
    }
    return active;
}

export async function rollbackManagedStart({
    statePath,
    detached,
    getDaemonStatus,
    stopDaemon,
    closeTarget,
    writeState = writeSessionRecord,
    removeState = removeSessionRecord,
    processExists: processIsPresent = processExists,
}) {
    let daemonCleanupConfirmed = false;
    let daemonError;
    let recoveryState = detached;
    try {
        const status = await getDaemonStatus(detached);
        if (!status.running) {
            daemonCleanupConfirmed = true;
        } else {
            const candidate = createSessionRecord({ ...detached, status: 'active', daemonProcessId: status.processId });
            const identity = validateDaemonStatus({ state: candidate, status, processExists: processIsPresent });
            if (!identity.valid) {
                throw new SessionError('DAEMON_IDENTITY_MISMATCH', `The startup daemon cannot be rolled back safely (${identity.reason}).`);
            }
            recoveryState = candidate;
            await stopDaemon(candidate);
            const after = await getDaemonStatus(detached);
            daemonCleanupConfirmed = !after.running;
            if (!daemonCleanupConfirmed) daemonError = new Error('The daemon remained active after its stop request.');
        }
    } catch (error) {
        daemonError = error;
    }

    if (!daemonCleanupConfirmed) {
        let stateWriteError;
        try { await writeState(statePath, recoveryState); } catch (error) { stateWriteError = error; }
        return {
            daemonCleanupConfirmed: false,
            targetClosed: false,
            recoveryState,
            daemonError,
            stateWriteError,
        };
    }

    let targetClosed = false;
    let closeError;
    let stateWriteError;
    let stateRemoveError;
    try { targetClosed = await closeTarget(detached); } catch (error) { closeError = error; }
    if (targetClosed) {
        try { await removeState(statePath); } catch (error) { stateRemoveError = error; }
    } else {
        try { await writeState(statePath, detached); } catch (error) { stateWriteError = error; }
    }
    return {
        daemonCleanupConfirmed: true,
        targetClosed,
        recoveryState: targetClosed ? null : detached,
        closeError,
        stateWriteError,
        stateRemoveError,
    };
}
