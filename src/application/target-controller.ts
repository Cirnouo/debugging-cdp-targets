import { randomUUID } from 'node:crypto';
import { type ManagedTarget, RetainedTargetError } from '../domains/cdp-target.ts';
import type {
    ControlContext,
    Disposition,
    LaunchContext,
    LaunchOptions,
    TargetStatus,
} from '../domains/control-contract.ts';
import { DetailedError, errorDetails, errorMessage } from '../shared/errors.ts';
import { type ConnectionOwner, createConnectionOwner } from './connection-owner.ts';

export interface ControllerRouter {
    setTarget(target: ManagedTarget): void;
    clearTarget(): void;
    isBusy(): boolean;
    pause?: () => void;
    resume?: () => void;
}
export type TargetHealth = 'healthy' | 'gone' | 'unavailable' | 'identity-changed';
export interface TargetLaunchContext extends LaunchContext {
    onCreated?: (target: ManagedTarget) => void;
}
export interface ControllerHost {
    launch(options: LaunchOptions, context?: TargetLaunchContext): Promise<ManagedTarget>;
    close(target: ManagedTarget, options?: { requireListener?: boolean }): Promise<boolean>;
    requestNormalClose?(target: ManagedTarget, context?: LaunchContext): Promise<Record<string, unknown>>;
    waitForExit?(target: ManagedTarget, signal?: AbortSignal): Promise<void>;
    health?(target: ManagedTarget): Promise<TargetHealth>;
}
export type TargetEvent = {
    sessionId: string;
    reason: 'process-exited';
    taskActive: boolean;
    expected?: ConnectionOwner['expectedExit'];
    operationId?: string;
    processId: number;
    port: number;
    targetKind: ManagedTarget['targetKind'];
    exitedAt: string;
    exitCode?: number;
    signalCode?: string;
};
type Current = {
    owner: ConnectionOwner;
    options: LaunchOptions;
    unsubscribe?: () => void;
    closeFailure?: Record<string, unknown>;
    closeRequest?: Promise<void>;
};

function waitWithSignal<T>(wait: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return wait;
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        const aborted = () => {
            signal.removeEventListener('abort', aborted);
            reject(signal.reason);
        };
        signal.addEventListener('abort', aborted, { once: true });
        void wait.then(
            (value) => {
                signal.removeEventListener('abort', aborted);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', aborted);
                reject(error);
            },
        );
        if (signal.aborted) aborted();
    });
}

export function createTargetController({
    entryId,
    router,
    host,
    server,
    onProcessExit,
    onObservationFailure,
    createOwner,
}: {
    entryId: string;
    router: ControllerRouter;
    host: ControllerHost;
    server: {
        ensure(options: LaunchOptions, context?: LaunchContext): Promise<void>;
        close(owner?: ConnectionOwner): Promise<void>;
    };
    onProcessExit?: (event: TargetEvent) => void;
    onObservationFailure?: (sessionId: string) => void;
    createOwner?: (sessionId: string) => Promise<ConnectionOwner>;
}) {
    let current: Current | undefined;
    let state: TargetStatus['status'] = 'idle';
    let reason: string | undefined;
    let taskActive = false;
    let gated = true;
    let changing = false;
    let checking: { owner: ConnectionOwner; job: Promise<void> } | undefined;
    function status(): TargetStatus {
        const target = current?.owner.target;
        return {
            entryId,
            status: state,
            taskActive,
            ...(current ? { sessionId: current.owner.sessionId } : {}),
            ...(target ? { port: target.port, processId: target.processId, targetKind: target.targetKind } : {}),
            ...(reason ? { reason } : {}),
        };
    }
    async function run<T>(job: () => Promise<T>): Promise<T> {
        if (changing) throw new Error('The target connection is busy with a lifecycle change.');
        changing = true;
        try {
            return await job();
        } finally {
            changing = false;
        }
    }
    function requireSession(sessionId: string) {
        if (!current || current.owner.sessionId !== sessionId || current.owner.retired)
            throw new Error('The target session is absent, closed or stale.');
        return current;
    }
    function gate() {
        if (!gated) router.clearTarget();
        gated = true;
    }
    function processExited(selected: Current) {
        if (!selected.owner.confirmExit()) return;
        const target = selected.owner.target;
        target?.releaseProfile?.();
        if (current === selected) {
            gate();
            state = 'lost';
            reason = 'process-exited';
        }
        if (!target) return;
        onProcessExit?.({
            sessionId: selected.owner.sessionId,
            reason: 'process-exited',
            taskActive,
            ...(selected.owner.expectedExit ? { expected: selected.owner.expectedExit } : {}),
            ...(selected.owner.expectedExit && selected.owner.expectedOperationId
                ? { operationId: selected.owner.expectedOperationId }
                : {}),
            processId: target.processId,
            port: target.port,
            targetKind: target.targetKind,
            exitedAt: new Date().toISOString(),
            ...(typeof target.child?.exitCode === 'number' ? { exitCode: target.child.exitCode } : {}),
            ...(typeof target.child?.signalCode === 'string' ? { signalCode: target.child.signalCode } : {}),
        });
    }
    function lose(selected: Current, why: string) {
        if (current !== selected || selected.owner.exited) return;
        gate();
        state = 'lost';
        reason = why;
        if (why === 'process-monitor-lost') {
            selected.owner.abortWork(new Error('Target process observation is unavailable.'));
            onObservationFailure?.(selected.owner.sessionId);
        }
    }
    function acquire(selected: Current, target: ManagedTarget) {
        if (selected.owner.target) {
            if (selected.owner.target !== target) throw new Error('A target run cannot acquire a second application.');
            return;
        }
        selected.owner.target = target;
        const child = target.child;
        if (child) {
            const exited = () => processExited(selected);
            child.once('exit', exited);
            const stopMonitor = child.onMonitorError?.(() => lose(selected, 'process-monitor-lost'));
            selected.unsubscribe = () => {
                child.off?.('exit', exited);
                stopMonitor?.();
            };
            if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') exited();
            else if (child.monitoringFailure) lose(selected, 'process-monitor-lost');
        } else if (target.waitForExit) {
            void target.waitForExit().then(
                () => processExited(selected),
                () => lose(selected, 'process-monitor-lost'),
            );
        }
    }
    async function normalClose(selected: Current, signal?: AbortSignal, onPhase?: LaunchContext['onPhase']) {
        const target = selected.owner.target;
        if (!target || selected.owner.exited) return;
        signal?.throwIfAborted();
        if (!selected.closeRequest) {
            onPhase?.('requesting-normal-close');
            const requestAbort = new AbortController();
            void selected.owner.exit.then(() => requestAbort.abort(new Error('The target process exited.')));
            const requestSignal = signal ? AbortSignal.any([signal, requestAbort.signal]) : requestAbort.signal;
            selected.closeRequest = (async () => {
                if (host.requestNormalClose) {
                    const result = await host.requestNormalClose(target, {
                        signal: requestSignal,
                        ...(onPhase ? { onPhase } : {}),
                    });
                    if (result.closeRequested !== true && result.closed !== true && !selected.owner.exited)
                        throw new Error('The application rejected its normal close request.');
                } else if (!(await host.close(target, { requireListener: false })) && !selected.owner.exited) {
                    throw new Error('The application rejected its normal close request.');
                }
            })();
            void selected.closeRequest.catch(() => {
                delete selected.closeRequest;
            });
        }
        try {
            await waitWithSignal(Promise.race([selected.closeRequest, selected.owner.exit]), signal);
            if (!selected.owner.exited) {
                onPhase?.('awaiting-target-exit');
                const observed = host.waitForExit ? host.waitForExit(target, signal) : target.waitForExit?.(signal);
                if (observed) {
                    await observed;
                    processExited(selected);
                } else if (target.child) await waitWithSignal(selected.owner.exit, signal);
                else throw new Error('No actual application exit observation is available.');
            }
        } catch (error) {
            if (selected.owner.exited) return;
            selected.closeFailure = { phase: 'normal-close', ...errorDetails(error), cause: errorMessage(error) };
            throw error;
        }
    }
    function failedClose(selected: Current, cause: unknown) {
        const error = new DetailedError(
            'The application did not close normally; its live identity remains available for Close retry.',
        );
        error.details = {
            ...selected.closeFailure,
            ...errorDetails(cause),
            entryId,
            sessionId: selected.owner.sessionId,
            ...(selected.owner.target
                ? {
                      processId: selected.owner.target.processId,
                      port: selected.owner.target.port,
                      retainedTargets: [
                          { processId: selected.owner.target.processId, port: selected.owner.target.port },
                      ],
                  }
                : {}),
        };
        return error;
    }
    async function dispose(selected: Current) {
        selected.owner.retire(new Error('The target session is retired.'));
        if (current === selected) gate();
        try {
            await server.close(selected.owner);
        } finally {
            if (selected.owner.exited) {
                selected.unsubscribe?.();
                selected.owner.target?.child?.disposeMonitor?.();
            }
            if (current === selected) {
                current = undefined;
                taskActive = false;
                state = 'idle';
                reason = undefined;
            }
        }
    }
    async function attach(options: LaunchOptions, sessionId: string, context: ControlContext) {
        context.signal?.throwIfAborted();
        const owner = createOwner ? await createOwner(sessionId) : createConnectionOwner(sessionId);
        owner.expectedOperationId = context.operationId;
        const selected: Current = { owner, options };
        current = selected;
        state = 'starting';
        reason = undefined;
        taskActive = true;
        const signal = context.signal ? AbortSignal.any([owner.signal, context.signal]) : owner.signal;
        try {
            const target = await host.launch(options, {
                ...context,
                signal,
                onCreated: (target) => acquire(selected, target),
            });
            acquire(selected, target);
            signal.throwIfAborted();
            owner.assertOpen();
            router.setTarget(target);
            gated = false;
            context.onPhase?.('starting-official-server');
            await server.ensure(options, { ...context, signal });
            signal.throwIfAborted();
            owner.assertOpen();
            state = 'active';
            return status();
        } catch (error) {
            if (error instanceof RetainedTargetError) {
                acquire(selected, error.target);
                if (!owner.exited) {
                    state = 'close-failed';
                    taskActive = false;
                    reason = 'target-rollback-failed';
                    gate();
                    throw error;
                }
            }
            if (owner.target && !owner.exited) {
                owner.expectedExit = 'rollback';
                try {
                    await normalClose(selected);
                } catch (closeError) {
                    state = 'close-failed';
                    taskActive = false;
                    reason = 'target-rollback-failed';
                    gate();
                    throw failedClose(selected, closeError);
                }
            }
            await dispose(selected);
            throw error;
        }
    }
    function start(options: LaunchOptions, sessionId: string = randomUUID(), context: ControlContext = {}) {
        return run(async () => {
            if (current) throw new Error('An existing target session must be closed before starting another.');
            return attach(options, sessionId, context);
        });
    }
    async function retireExited({ sessionId }: { sessionId: string }) {
        const selected = current;
        if (selected?.owner.sessionId === sessionId && selected.owner.exited) await dispose(selected);
        return status();
    }
    function restart(
        { sessionId, mcpArgs }: { sessionId: string; mcpArgs?: string[] },
        context: ControlContext & { onSession?: (sessionId: string) => void } = {},
    ) {
        return run(async () => {
            const previous = requireSession(sessionId);
            if (state !== 'active' && state !== 'lost')
                throw new Error('Only active or lost live targets can restart.');
            const target = previous.owner.target;
            if (!target?.launchDefinition)
                throw new Error('The exact launch definition is unavailable; cannot restart.');
            const previousState = state;
            previous.owner.expectedExit = 'restart';
            router.pause?.();
            state = 'closing';
            try {
                await normalClose(previous, context.signal, context.onPhase);
            } catch (error) {
                previous.owner.expectedExit = undefined;
                state = previousState;
                router.resume?.();
                if (context.signal?.aborted) throw context.signal.reason;
                throw failedClose(previous, error);
            }
            context.onPhase?.('closing-resources');
            await dispose(previous);
            context.signal?.throwIfAborted();
            const nextSession = randomUUID();
            context.onSession?.(nextSession);
            return {
                ...(await attach(
                    {
                        ...previous.options,
                        exactPort: target.port,
                        launchDefinition: target.launchDefinition,
                        ...(mcpArgs === undefined ? {} : { mcpArgs }),
                    },
                    nextSession,
                    context,
                )),
                pageIdsInvalidated: true,
            };
        });
    }
    function stop(
        { sessionId, disposition }: { sessionId: string; disposition: Disposition },
        context: ControlContext = {},
    ) {
        return run(async () => {
            const selected = requireSession(sessionId);
            if (state === 'close-failed' && disposition !== 'Close')
                throw new Error('The retained target requires Close retry.');
            if (disposition === 'Keep') {
                taskActive = false;
                return { ...status(), disposition };
            }
            if (disposition !== 'Close') throw new Error('Choose Close or Keep.');
            const previous = status();
            const previousState = state;
            selected.owner.expectedExit = 'close';
            router.pause?.();
            state = 'closing';
            try {
                await normalClose(selected, context.signal, context.onPhase);
            } catch (error) {
                selected.owner.expectedExit = undefined;
                if (!selected.owner.exited) {
                    state = previousState;
                    router.resume?.();
                }
                if (context.signal?.aborted) throw context.signal.reason;
                throw failedClose(selected, error);
            }
            context.onPhase?.('closing-resources');
            await dispose(selected);
            return { ...previous, status: 'idle' as const, taskActive: false, disposition, pageIdsInvalidated: true };
        });
    }
    function endTask({ sessionId }: { sessionId: string }) {
        return run(async () => {
            requireSession(sessionId);
            if (state === 'close-failed') throw new Error('The retained target requires Close retry.');
            taskActive = false;
            return status();
        });
    }
    function beginTask({ sessionId }: { sessionId: string }) {
        requireSession(sessionId);
        if (state === 'active' || state === 'lost') taskActive = true;
    }
    async function checkHealth() {
        const selected = current;
        const target = selected?.owner.target;
        if (!selected || !target || selected.owner.retired || state !== 'active') return;
        if (checking?.owner === selected.owner) return checking.job;
        const job = (async () => {
            let health: TargetHealth;
            try {
                if (host.health) health = await waitWithSignal(host.health(target), selected.owner.signal);
                else {
                    await waitWithSignal(Promise.resolve(target.verify?.()), selected.owner.signal);
                    health = 'healthy';
                }
            } catch (error) {
                if (selected.owner.signal.aborted) throw error;
                health = 'unavailable';
            }
            if (current === selected && state === 'active' && health !== 'healthy')
                lose(selected, health === 'identity-changed' ? health : 'target-unavailable');
        })().finally(() => {
            if (checking?.job === job) checking = undefined;
        });
        checking = { owner: selected.owner, job };
        return job;
    }
    async function cleanupOnDisconnect() {
        const selected = current;
        gate();
        taskActive = false;
        if (!selected) return;
        selected.owner.expectedExit = 'disconnect';
        selected.owner.abortWork(new Error('The gateway is closing.'));
        const resources = server.close(selected.owner);
        const results = await Promise.allSettled([normalClose(selected), resources]);
        if (selected.owner.exited) await dispose(selected);
        if (results.some((result) => result.status === 'rejected') && !selected.owner.exited) {
            const target = selected.owner.target;
            return target ? { processId: target.processId, port: target.port } : undefined;
        }
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
        quarantine: (why: string) => {
            if (current) lose(current, why);
        },
        canInvoke: () => state === 'active' && !gated && !!current && !current.owner.retired,
    };
}
