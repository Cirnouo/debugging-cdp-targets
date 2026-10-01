import type { ManagedTarget } from '../domains/cdp-target.ts';
import type { ControlResult, Disposition, LaunchOptions, TargetStatus } from '../domains/control-contract.ts';
import { DISPOSITIONS } from '../shared/constants.ts';
import { DetailedError, errorMessage } from '../shared/errors.ts';

export interface ControllerRouter {
    setTarget(target: ManagedTarget): void;
    clearTarget(): void;
    isBusy(): boolean;
    pause?: () => void;
    resume?: () => void;
}
export interface ControllerHost {
    launch(options: LaunchOptions): Promise<ManagedTarget>;
    close(target: ManagedTarget): Promise<boolean>;
}

export function createTargetController({ router, host }: { router: ControllerRouter; host: ControllerHost }) {
    let current: ManagedTarget | null = null;

    function status(): TargetStatus {
        if (!current) return { status: 'none' };
        return { status: 'active', port: current.port, processId: current.processId, targetKind: current.targetKind };
    }

    function attach(target: ManagedTarget) {
        router.setTarget(target);
        current = target;
        target.child?.once('exit', () => {
            if (current !== target) return;
            router.clearTarget();
            current = null;
        });
    }

    async function tryClose(target: ManagedTarget) {
        try {
            return await host.close(target);
        } catch {
            return false;
        }
    }

    async function rollbackNew(target: ManagedTarget, message: string, retained: ManagedTarget[] = []): Promise<never> {
        if (!(await tryClose(target))) retained.push(target);
        const error = new DetailedError(message);
        error.details = { retainedTargets: retained.map(({ processId, port }) => ({ processId, port })) };
        throw error;
    }

    function requireDisposition(options: { disposition: Disposition }) {
        if (!DISPOSITIONS.includes(options?.disposition))
            throw new Error('Choose Close or Keep for the current target.');
        if (router.isBusy()) throw new Error('CDP is busy with an in-flight request; retry after it finishes.');
    }

    async function start(options: LaunchOptions) {
        if (current) throw new Error('A target is already active; use switch.');
        const target = await host.launch(options);
        try {
            attach(target);
        } catch (error) {
            await rollbackNew(target, errorMessage(error));
        }
        return status();
    }

    async function switchTarget(options: LaunchOptions & { disposition: Disposition }): Promise<ControlResult> {
        if (!current) throw new Error('There is no active target; use start.');
        requireDisposition(options);
        const previous = current;
        const next = await host.launch(options);
        if (router.isBusy() || current !== previous) {
            await rollbackNew(
                next,
                'CDP became busy or the target exited during verification; the new target was not attached.',
            );
        }
        router.pause?.();
        try {
            if (options.disposition === 'Close' && !(await tryClose(previous))) {
                await rollbackNew(next, 'The current target did not close normally; it remains active.', [previous]);
            }
            try {
                attach(next);
            } catch (error) {
                await rollbackNew(next, errorMessage(error));
            }
            return { ...status(), previousTarget: options.disposition, pageIdsInvalidated: true };
        } finally {
            router.resume?.();
        }
    }

    async function stop(options: { disposition: Disposition }): Promise<ControlResult> {
        if (!current) return { status: 'none' };
        requireDisposition(options);
        const target = current;
        router.pause?.();
        try {
            if (options.disposition === 'Close' && !(await tryClose(target))) {
                const error = new DetailedError('The target did not close normally; it remains active.');
                error.details = { retainedTargets: [{ processId: target.processId, port: target.port }] };
                throw error;
            }
            router.clearTarget();
            current = null;
            return { status: 'none', disposition: options.disposition };
        } finally {
            router.resume?.();
        }
    }

    async function cleanupOnDisconnect() {
        if (!current) return;
        const target = current;
        const closed = await tryClose(target);
        router.clearTarget();
        current = null;
        return closed ? undefined : { processId: target.processId, port: target.port };
    }

    return { status, start, switch: switchTarget, stop, cleanupOnDisconnect };
}
