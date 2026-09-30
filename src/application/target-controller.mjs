import { DISPOSITIONS } from '../shared/constants.mjs';

export function createTargetController({ router, host }) {
    let current = null;

    function status() {
        if (!current) return { status: 'none' };
        return { status: 'active', port: current.port, processId: current.processId, targetKind: current.targetKind };
    }

    function attach(target) {
        router.setTarget(target);
        current = target;
        target.child?.once('exit', () => {
            if (current !== target) return;
            router.clearTarget();
            current = null;
        });
    }

    async function tryClose(target) {
        try {
            return await host.close(target);
        } catch {
            return false;
        }
    }

    async function rollbackNew(target, message, retained = []) {
        if (!(await tryClose(target))) retained.push(target);
        const error = new Error(message);
        error.details = { retainedTargets: retained.map(({ processId, port }) => ({ processId, port })) };
        throw error;
    }

    function requireDisposition(options) {
        if (!DISPOSITIONS.includes(options?.disposition))
            throw new Error('Choose Close or Keep for the current target.');
        if (router.isBusy()) throw new Error('CDP is busy with an in-flight request; retry after it finishes.');
    }

    async function start(options) {
        if (current) throw new Error('A target is already active; use switch.');
        const target = await host.launch(options);
        try {
            attach(target);
        } catch (error) {
            await rollbackNew(target, error.message);
        }
        return status();
    }

    async function switchTarget(options) {
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
                await rollbackNew(next, error.message);
            }
            return { ...status(), previousTarget: options.disposition, pageIdsInvalidated: true };
        } finally {
            router.resume?.();
        }
    }

    async function stop(options) {
        if (!current) return { status: 'none' };
        requireDisposition(options);
        const target = current;
        router.pause?.();
        try {
            if (options.disposition === 'Close' && !(await tryClose(target))) {
                const error = new Error('The target did not close normally; it remains active.');
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
