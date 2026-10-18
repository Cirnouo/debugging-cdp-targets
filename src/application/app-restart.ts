import type { DeploymentLease } from '../adapters/app-deployment.ts';
import type { AppParentExitObserver } from '../adapters/app-parent-exit.ts';
import { type DeploymentState, parseDeploymentState } from '../domains/app-deployment.ts';
import {
    type AppRestartContext,
    encodeAppRestartContext,
    parseAppRestartContext,
    parseAppRestartLeaseReceipt,
} from '../domains/app-restart.ts';

export type AppRestartChild = Readonly<{
    processId: number;
    /** Actual owned child exit only. Helper EOF/error must reject instead. */
    exited: Promise<void>;
    releaseObservation(): Promise<void>;
    unref(): void;
}>;
export type AppRestartBridgeOptions = {
    use: DeploymentLease;
    parent: AppParentExitObserver;
    context: Omit<AppRestartContext, 'buildId'>;
    publishReady(): Promise<void>;
    readSelection(use: DeploymentLease): Promise<unknown>;
    verifySelection(selection: DeploymentState): Promise<void>;
    /** Uncertain creation returns its owned observer; rejection cannot settle coverage. */
    spawn(
        context: AppRestartContext,
        lifetime: Readonly<{ detached: true; shell: false; stdio: 'ignore' }>,
    ): Promise<
        Readonly<{ outcome: 'not-created' }> | Readonly<{ outcome: 'created' | 'unconfirmed'; child: AppRestartChild }>
    >;
    readReceipt(
        context: AppRestartContext,
        child: AppRestartChild,
    ): Readonly<{ result: Promise<unknown>; stop(): Promise<void> }>;
};
type Settlement = Readonly<{ outcome: 'acknowledged' | 'no-successor' | 'child-exited' }>;
export type AppRestartBridgeResult =
    | Settlement
    | Readonly<{
          outcome: 'retained';
          reason: 'spawn-unconfirmed' | 'handoff-unconfirmed' | 'release-failed';
          coverage: Readonly<{ use: DeploymentLease; parent: AppParentExitObserver; child?: AppRestartChild }>;
          completion: Promise<Settlement>;
          retryRelease(): Promise<AppRestartBridgeResult>;
      }>;

/** Module-only orchestration: callers supply verified native/payload/receipt producers. */
export async function runAppRestartBridge(input: AppRestartBridgeOptions): Promise<AppRestartBridgeResult> {
    const options = Object.freeze({ ...input, context: Object.freeze({ ...input.context }) });
    if (options.use.kind !== 'use') throw new Error('App restart requires an already acquired shared use lease.');
    const { promise: completion, resolve: complete } = Promise.withResolvers<Settlement>();
    let child: AppRestartChild | undefined;
    let receipt: ReturnType<AppRestartBridgeOptions['readReceipt']> | undefined;
    let safeOutcome: Settlement['outcome'] | undefined;
    let settled: Settlement | undefined;
    let releasePending: Promise<AppRestartBridgeResult> | undefined;
    let receiptStopped = false;
    let observationReleased = false;
    let unreferenced = false;
    let parentDisposed = false;
    let reason: Extract<AppRestartBridgeResult, { outcome: 'retained' }>['reason'] = 'spawn-unconfirmed';

    function retained(): AppRestartBridgeResult {
        return Object.freeze({
            outcome: 'retained',
            reason,
            coverage: Object.freeze({ use: options.use, parent: options.parent, ...(child ? { child } : {}) }),
            completion,
            retryRelease: release,
        });
    }

    function release(): Promise<AppRestartBridgeResult> {
        if (settled) return Promise.resolve(settled);
        if (!safeOutcome) return Promise.resolve(retained());
        if (releasePending) return releasePending;
        const attempt = (async (): Promise<AppRestartBridgeResult> => {
            try {
                if (receipt && !receiptStopped) {
                    await receipt.stop();
                    receiptStopped = true;
                }
                if (child && !observationReleased) {
                    await child.releaseObservation();
                    observationReleased = true;
                }
                if (child && !unreferenced) {
                    child.unref();
                    unreferenced = true;
                }
                if (!parentDisposed) {
                    await options.parent.dispose();
                    parentDisposed = true;
                }
                await options.use.release();
                settled = Object.freeze({ outcome: safeOutcome });
                complete(settled);
                return settled;
            } catch {
                reason = 'release-failed';
                return retained();
            }
        })();
        releasePending = attempt;
        void attempt.then(() => {
            releasePending = undefined;
        });
        return attempt;
    }

    let context: AppRestartContext;
    try {
        // Readiness is separate from parent exit; neither authorizes successor launch.
        await options.parent.ready;
        await options.publishReady();
        await options.parent.exited;
        const state = parseDeploymentState(
            await options.readSelection(options.use),
            options.context.installationIdentity,
        );
        if (state.phase !== 'active') {
            safeOutcome = 'no-successor';
            return release();
        }
        await options.verifySelection(state);
        context = parseAppRestartContext(
            encodeAppRestartContext({ ...options.context, buildId: state.selectedBuildId }),
        );
    } catch {
        safeOutcome = 'no-successor';
        return release();
    }

    let spawnConfirmed = false;
    try {
        const spawned = await options.spawn(context, { detached: true, shell: false, stdio: 'ignore' });
        if (spawned.outcome === 'not-created') {
            safeOutcome = 'no-successor';
            return release();
        }
        child = spawned.child;
        spawnConfirmed = spawned.outcome === 'created';
    } catch {
        // A rejected spawn is not definitive no-child evidence. Keep the owner.
        return retained();
    }
    if (spawnConfirmed) reason = 'handoff-unconfirmed';
    const actualChild = child;
    if (spawnConfirmed) {
        try {
            receipt = options.readReceipt(context, actualChild);
        } catch {
            // The actual child observer below still owns a failed receipt setup.
        }
    }
    const actualExit = actualChild.exited.then(
        () => {
            safeOutcome ??= 'child-exited';
            return release();
        },
        () => retained(),
    );
    if (!receipt) return retained();
    const acknowledgement = receipt.result.then(
        async (value): Promise<AppRestartBridgeResult> => {
            try {
                parseAppRestartLeaseReceipt(value, {
                    installationIdentity: context.installationIdentity,
                    buildId: context.buildId,
                    attemptId: context.attemptId,
                    processId: actualChild.processId,
                });
            } catch {
                return retained();
            }
            safeOutcome ??= 'acknowledged';
            return release();
        },
        () => retained(),
    );
    // Ending this bounded receipt wait never ends actual child ownership.
    return Promise.race([actualExit, acknowledgement]);
}
