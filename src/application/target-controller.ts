import { randomUUID } from 'node:crypto';
import { type ManagedTarget, RetainedTargetError } from '../domains/cdp-target.ts';
import type { Disposition, LaunchContext, LaunchOptions, TargetStatus } from '../domains/control-contract.ts';
import { DetailedError, errorDetails, errorMessage } from '../shared/errors.ts';

export interface ControllerRouter {
    setTarget(target: ManagedTarget): void;
    clearTarget(): void;
    isBusy(): boolean;
    pause?: () => void;
    resume?: () => void;
}
export type TargetHealth = 'healthy' | 'gone' | 'unavailable' | 'identity-changed';
export interface ControllerHost {
    launch(options: LaunchOptions, context?: LaunchContext): Promise<ManagedTarget>;
    close(target: ManagedTarget, options?: { requireListener?: boolean }): Promise<boolean>;
    health?(target: ManagedTarget): Promise<TargetHealth>;
}
export type TargetEvent = { sessionId: string; reason: 'process-exited'; taskActive: boolean };
type Current = {
    target: ManagedTarget;
    options: LaunchOptions;
    sessionId: string;
    exited: boolean;
    expectedExit?: boolean;
    unsubscribe?: () => void;
    closeFailure?: Record<string, unknown>;
};

export function createTargetController({
    entryId,
    router,
    host,
    server,
    onProcessExit,
}: {
    entryId: string;
    router: ControllerRouter;
    host: ControllerHost;
    server: { ensure(options: LaunchOptions): Promise<void>; close(): Promise<void> };
    onProcessExit?: (event: TargetEvent) => void;
}) {
    let current: Current | undefined;
    let state: TargetStatus['status'] = 'idle';
    let reason: string | undefined;
    let taskActive = false;
    let gated = false;
    let serial = Promise.resolve();
    let checking: Promise<void> | undefined;
    function status(): TargetStatus {
        return {
            entryId,
            status: state,
            taskActive,
            ...(current
                ? {
                      sessionId: current.sessionId,
                      port: current.target.port,
                      processId: current.target.processId,
                      targetKind: current.target.targetKind,
                  }
                : {}),
            ...(reason ? { reason } : {}),
        };
    }
    function run<T>(operation: () => Promise<T>): Promise<T> {
        const result = serial.then(operation);
        serial = result.then(
            () => {},
            () => {},
        );
        return result;
    }
    function requireSession(sessionId: string) {
        if (!current || current.sessionId !== sessionId) throw new Error('The target session is absent or stale.');
        return current;
    }
    function gate() {
        if (!gated) router.clearTarget();
        gated = true;
    }
    function confirmExit(selected: Current) {
        if (!selected.exited) {
            selected.exited = true;
            selected.target.releaseProfile?.();
        }
        selected.target.child?.disposeMonitor?.();
    }
    function processExited(selected: Current) {
        if (current !== selected || selected.exited) return;
        confirmExit(selected);
        gate();
        // Explicit cleanup owns expected exits, including late delivery after its failure.
        if (state === 'closing' || selected.expectedExit) return;
        state = 'lost';
        reason = 'process-exited';
        onProcessExit?.({
            sessionId: selected.sessionId,
            reason: 'process-exited',
            taskActive,
        });
    }
    function subscribe(selected: Current) {
        const child = selected.target.child;
        if (!child) return;
        const exited = () => processExited(selected);
        child.once('exit', exited);
        const stopMonitor = child.onMonitorError?.(() => lose(selected, 'process-monitor-lost'));
        selected.unsubscribe = () => {
            child.off?.('exit', exited);
            stopMonitor?.();
        };
        // Node retains exitCode/signalCode even when exit preceded this subscription.
        if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') exited();
    }
    function lose(selected: Current, why: string) {
        if (current !== selected || selected.exited || state === 'closing' || state === 'close-failed') return;
        gate();
        state = 'lost';
        reason = why;
    }
    async function tryClose(selected: Current, requireListener = true) {
        delete selected.closeFailure;
        try {
            if (selected.exited) return true;
            if (!requireListener && host.health && (await host.health(selected.target)) === 'gone') {
                confirmExit(selected);
                return true;
            }
            const closed = await host.close(selected.target, { requireListener });
            if (closed) confirmExit(selected);
            if (!closed) selected.closeFailure = { phase: 'normal-close', reason: 'application-still-running' };
            return selected.exited || closed;
        } catch (error) {
            selected.closeFailure = { phase: 'normal-close', ...errorDetails(error), cause: errorMessage(error) };
            return selected.exited;
        }
    }
    function failedClose(selected: Current) {
        const error = new DetailedError(
            'The target did not close normally; its official connection and identity remain available for retry.',
        );
        error.details = {
            ...selected.closeFailure,
            entryId,
            sessionId: selected.sessionId,
            retainedTargets: [{ processId: selected.target.processId, port: selected.target.port }],
        };
        return error;
    }
    function retainFailedRollback(target: ManagedTarget, options: LaunchOptions, sessionId: string) {
        current = { target, options, sessionId, exited: false };
        taskActive = false;
        state = 'close-failed';
        reason = 'target-rollback-failed';
        gate();
        subscribe(current);
    }
    async function attach(options: LaunchOptions, sessionId: string = randomUUID(), context: LaunchContext = {}) {
        context.signal?.throwIfAborted();
        context.onPhase?.('starting-official-server');
        await server.ensure(options);
        context.signal?.throwIfAborted();
        let target: ManagedTarget;
        try {
            target = await host.launch(options, context);
        } catch (error) {
            if (error instanceof RetainedTargetError) retainFailedRollback(error.target, options, sessionId);
            throw error;
        }
        const selected: Current = { target, options, sessionId, exited: false };
        try {
            context.signal?.throwIfAborted();
            router.setTarget(target);
        } catch (error) {
            if (!(await tryClose(selected, false))) {
                retainFailedRollback(target, options, sessionId);
                throw failedClose(selected);
            }
            throw error;
        }
        current = selected;
        gated = false;
        taskActive = true;
        reason = undefined;
        state = 'active';
        subscribe(selected);
        return status();
    }
    function start(options: LaunchOptions, sessionId?: string, context: LaunchContext = {}) {
        return run(async () => {
            if (current)
                throw new Error('An existing target session must be explicitly closed before this entry is reused.');
            return attach(options, sessionId, context);
        });
    }
    async function dispose(selected: Current) {
        taskActive = false;
        state = 'closing';
        gate();
        try {
            await server.close();
        } catch (error) {
            state = 'close-failed';
            reason = 'official-close-failed';
            throw error;
        }
        selected.unsubscribe?.();
        selected.target.child?.disposeMonitor?.();
        current = undefined;
        state = 'idle';
        reason = undefined;
    }
    function retireExited({ sessionId }: { sessionId: string }) {
        return run(async () => {
            const selected = current;
            if (selected?.sessionId === sessionId && selected.exited && !taskActive) await dispose(selected);
            return status();
        });
    }
    function restart(
        { sessionId, mcpArgs }: { sessionId: string; mcpArgs?: string[] },
        context: LaunchContext & { onSession?: (sessionId: string) => void } = {},
    ) {
        return run(async () => {
            context.signal?.throwIfAborted();
            const previous = requireSession(sessionId);
            if (state !== 'lost' && state !== 'active')
                throw new Error('Only an active or lost target session can be explicitly restarted.');
            if (router.isBusy()) throw new Error('CDP is busy; retry after the current request completes.');
            if (!previous.target.launchDefinition)
                throw new Error('The exact launch definition is unavailable; cannot safely restart.');
            previous.expectedExit = true;
            router.pause?.();
            const previousState = state;
            state = 'closing';
            if (!(await tryClose(previous, false))) {
                delete previous.expectedExit;
                state = previousState;
                router.resume?.();
                throw failedClose(previous);
            }
            try {
                await server.close();
            } catch (error) {
                state = 'close-failed';
                reason = 'official-close-failed';
                taskActive = false;
                throw error;
            }
            previous.unsubscribe?.();
            previous.target.child?.disposeMonitor?.();
            previous.exited = true;
            const options: LaunchOptions = {
                ...previous.options,
                exactPort: previous.target.port,
                launchDefinition: previous.target.launchDefinition,
                ...(mcpArgs === undefined ? {} : { mcpArgs }),
            };
            try {
                const nextSession = randomUUID();
                context.onSession?.(nextSession);
                return { ...(await attach(options, nextSession, context)), pageIdsInvalidated: true };
            } catch (error) {
                if (current === previous) {
                    state = 'lost';
                    reason = 'restart-incomplete';
                    gate();
                    context.onSession?.(previous.sessionId);
                }
                throw error;
            }
        });
    }
    function stop({ sessionId, disposition }: { sessionId: string; disposition: Disposition }) {
        return run(async () => {
            const selected = requireSession(sessionId);
            if (disposition !== 'Close' && disposition !== 'Keep') throw new Error('Choose Close or Keep.');
            if (state === 'close-failed' && disposition !== 'Close')
                throw new Error('The retained target requires an explicit Close retry.');
            if (disposition === 'Keep') {
                taskActive = false;
                if (selected.exited) await dispose(selected);
                return { ...status(), disposition };
            }
            if (state === 'active' && router.isBusy())
                throw new Error('CDP is busy; retry after the current request completes.');
            const previousState = state;
            router.pause?.();
            selected.expectedExit = true;
            state = 'closing';
            if (!(await tryClose(selected, previousState === 'active'))) {
                delete selected.expectedExit;
                state = previousState;
                router.resume?.();
                throw failedClose(selected);
            }
            await dispose(selected);
            return { ...status(), disposition, pageIdsInvalidated: true };
        });
    }
    function endTask({ sessionId }: { sessionId: string }) {
        return run(async () => {
            const selected = requireSession(sessionId);
            if (state === 'close-failed') throw new Error('The retained target requires an explicit Close retry.');
            taskActive = false;
            if (selected.exited) await dispose(selected);
            return status();
        });
    }
    function beginTask({ sessionId }: { sessionId: string }) {
        const selected = requireSession(sessionId);
        if (!selected.exited && state !== 'closing' && state !== 'close-failed') taskActive = true;
    }
    async function checkHealth() {
        if (checking) return checking;
        const selected = current;
        if (!selected || selected.exited || state !== 'active') return;
        checking = (async () => {
            let health: TargetHealth;
            try {
                if (host.health) health = await host.health(selected.target);
                else {
                    await selected.target.verify?.();
                    health = 'healthy';
                }
            } catch {
                health = 'unavailable';
            }
            if (current !== selected || state !== 'active') return;
            if (health === 'gone') processExited(selected);
            else if (health !== 'healthy')
                lose(selected, health === 'identity-changed' ? health : 'target-unavailable');
        })().finally(() => {
            checking = undefined;
        });
        return checking;
    }
    function cleanupOnDisconnect() {
        return run(async () => {
            taskActive = false;
            const selected = current;
            if (selected) selected.expectedExit = true;
            state = 'closing';
            const closed = !selected || (await tryClose(selected, false));
            gate();
            try {
                await server.close();
            } finally {
                selected?.unsubscribe?.();
                selected?.target.child?.disposeMonitor?.();
            }
            current = undefined;
            state = 'idle';
            reason = undefined;
            return closed || !selected
                ? undefined
                : { processId: selected.target.processId, port: selected.target.port };
        });
    }
    return {
        status,
        start,
        restart,
        stop,
        endTask,
        beginTask,
        retireExited,
        checkHealth,
        cleanupOnDisconnect,
        officialDisconnected: () => {
            if (current) lose(current, 'official-disconnected');
        },
        quarantine: (reason: string) => {
            if (current) lose(current, reason);
        },
        canInvoke: () => state === 'active' && !gated,
    };
}
