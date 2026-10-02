import { randomUUID } from 'node:crypto';
import { type ManagedTarget, RetainedTargetError } from '../domains/cdp-target.ts';
import type { Disposition, LaunchOptions, TargetStatus } from '../domains/control-contract.ts';
import { DetailedError } from '../shared/errors.ts';

export interface ControllerRouter {
    setTarget(target: ManagedTarget): void;
    clearTarget(): void;
    isBusy(): boolean;
    pause?: () => void;
    resume?: () => void;
}
export type TargetHealth = 'healthy' | 'gone' | 'unavailable' | 'identity-changed';
export interface ControllerHost {
    launch(options: LaunchOptions): Promise<ManagedTarget>;
    close(target: ManagedTarget, options?: { requireListener?: boolean }): Promise<boolean>;
    health?(target: ManagedTarget): Promise<TargetHealth>;
}
export type TargetEvent = { sessionId: string; reason: string };
type Current = { target: ManagedTarget; options: LaunchOptions; sessionId: string };

export function createTargetController({
    entryId,
    router,
    host,
    server,
}: {
    entryId: string;
    router: ControllerRouter;
    host: ControllerHost;
    server: { ensure(): Promise<void>; close(): Promise<void> };
}) {
    let current: Current | undefined;
    let state: TargetStatus['status'] = 'idle';
    let reason: string | undefined;
    let misses = 0;
    let gated = false;
    let serial = Promise.resolve();
    let checking: Promise<void> | undefined;
    let watcher: { sessionId: string; finish(event: TargetEvent): void } | undefined;
    function status(): TargetStatus {
        return {
            entryId,
            status: state,
            taskActive: watcher !== undefined,
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
    function endWatcher() {
        watcher?.finish({ sessionId: watcher.sessionId, reason: 'task-ended' });
    }
    function gate() {
        if (!gated) router.clearTarget();
        gated = true;
    }
    function lose(selected: Current, why: string) {
        if (current !== selected || state !== 'active') return;
        gate();
        state = 'lost';
        reason = why;
        watcher?.finish({ sessionId: selected.sessionId, reason: why });
    }
    async function tryClose(selected: Current, requireListener = true) {
        try {
            if (!requireListener && host.health && (await host.health(selected.target)) === 'gone') return true;
            return await host.close(selected.target, { requireListener });
        } catch {
            return false;
        }
    }
    function officialDisconnected() {
        if (current) lose(current, 'official-disconnected');
    }
    function failedClose(selected: Current) {
        const error = new DetailedError(
            'The target did not close normally; its official connection and identity remain available for retry.',
        );
        error.details = { retainedTargets: [{ processId: selected.target.processId, port: selected.target.port }] };
        return error;
    }
    function retainFailedRollback(selected: Current) {
        current = selected;
        state = 'close-failed';
        reason = 'target-rollback-failed';
        gate();
    }
    async function attach(options: LaunchOptions, sessionId: string = randomUUID()) {
        options = { ...options, profileKey: options.profileKey ?? `${entryId}-${sessionId}` };
        await server.ensure();
        let target: ManagedTarget;
        try {
            target = await host.launch(options);
        } catch (error) {
            if (error instanceof RetainedTargetError)
                retainFailedRollback({ target: error.target, options, sessionId });
            throw error;
        }
        const selected = { target, options, sessionId };
        try {
            router.setTarget(target);
        } catch (error) {
            if (!(await tryClose(selected, false))) {
                retainFailedRollback(selected);
                throw failedClose(selected);
            }
            throw error;
        }
        current = selected;
        gated = false;
        misses = 0;
        reason = undefined;
        state = 'active';
        target.child?.once('exit', () => lose(selected, 'process-exited'));
        return status();
    }
    function start(options: LaunchOptions, sessionId?: string) {
        return run(async () => {
            if (current)
                throw new Error('An existing target session must be explicitly closed before this entry is reused.');
            return attach(options, sessionId);
        });
    }
    function restart({ sessionId }: { sessionId: string }) {
        return run(async () => {
            const previous = requireSession(sessionId);
            if (state !== 'lost')
                throw new Error('Only a lost target session can be restarted after an explicit user choice.');
            if (!previous.target.launchDefinition)
                throw new Error('The exact launch definition is unavailable; cannot safely restart.');
            const gone = host.health ? (await host.health(previous.target)) === 'gone' : false;
            if (!gone && !(await tryClose(previous, false))) throw failedClose(previous);
            await server.close();
            const options: LaunchOptions = {
                ...previous.options,
                exactPort: previous.target.port,
                launchDefinition: previous.target.launchDefinition,
                profileKey: previous.options.profileKey ?? `${entryId}-${sessionId}`,
            };
            try {
                const result = await attach(options);
                return { ...result, pageIdsInvalidated: true };
            } catch (error) {
                if (current === previous) {
                    state = 'lost';
                    gate();
                }
                throw error;
            }
        });
    }
    function stop({ sessionId, disposition }: { sessionId: string; disposition: Disposition }): Promise<TargetStatus> {
        return run(async () => {
            const selected = requireSession(sessionId);
            if (disposition !== 'Close' && disposition !== 'Keep') throw new Error('Choose Close or Keep.');
            if (state === 'close-failed' && disposition !== 'Close')
                throw new Error('The retained target requires an explicit Close retry.');
            if (disposition === 'Keep') {
                endWatcher();
                return { ...status(), disposition };
            }
            if (state === 'active' && router.isBusy())
                throw new Error('CDP is busy; retry after the current request completes.');
            const previousState = state;
            state = 'closing';
            router.pause?.();
            try {
                if (!(await tryClose(selected, previousState === 'active'))) {
                    state = previousState;
                    router.resume?.();
                    throw failedClose(selected);
                }
                gate();
                endWatcher();
                try {
                    await server.close();
                } catch (error) {
                    state = 'close-failed';
                    reason = 'official-close-failed';
                    throw error;
                }
                current = undefined;
                state = 'idle';
                reason = undefined;
                return { ...status(), disposition, pageIdsInvalidated: true };
            } catch (error) {
                if (state === 'closing') state = previousState;
                throw error;
            }
        });
    }
    async function endTask({ sessionId }: { sessionId: string }) {
        requireSession(sessionId);
        if (state === 'close-failed') throw new Error('The retained target requires an explicit Close retry.');
        endWatcher();
        return status();
    }
    function watchTarget(signal: AbortSignal): Promise<TargetEvent> {
        if (!current) return Promise.reject(new Error('No current target session to watch.'));
        if (watcher) return Promise.reject(new Error('This target session already has a task watcher.'));
        const sessionId = current.sessionId;
        if (state === 'close-failed')
            return Promise.reject(new Error('The retained target requires an explicit Close retry.'));
        if (state === 'lost') return Promise.resolve({ sessionId, reason: reason ?? 'target-unavailable' });
        return new Promise((resolve) => {
            function finish(event: TargetEvent) {
                signal.removeEventListener('abort', aborted);
                watcher = undefined;
                resolve(event);
            }
            function aborted() {
                finish({ sessionId, reason: 'task-ended' });
            }
            watcher = { sessionId, finish };
            signal.addEventListener('abort', aborted, { once: true });
            if (signal.aborted) aborted();
        });
    }
    async function checkHealth() {
        if (checking) return checking;
        const selected = current;
        if (!selected || state !== 'active') return;
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
            if (health === 'healthy') {
                misses = 0;
                if (gated) {
                    router.setTarget(selected.target);
                    gated = false;
                }
                return;
            }
            gate();
            if (health === 'gone') lose(selected, 'process-exited');
            else if (health === 'identity-changed') lose(selected, 'identity-changed');
            else if (++misses >= 2) lose(selected, 'target-unavailable');
        })().finally(() => {
            checking = undefined;
        });
        return checking;
    }
    async function cleanupOnDisconnect() {
        return run(async () => {
            endWatcher();
            const selected = current;
            state = 'closing';
            const closed = !selected || (await tryClose(selected, false));
            gate();
            await server.close();
            current = undefined;
            state = 'idle';
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
        watchTarget,
        checkHealth,
        cleanupOnDisconnect,
        officialDisconnected,
        canInvoke: () => state === 'active' && !gated,
    };
}
