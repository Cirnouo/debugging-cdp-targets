import type { ManagedTarget } from '../domains/cdp-target.ts';

export interface OwnedResource {
    close(): Promise<void>;
}

/** One in-memory owner for a target run and its unfinished acquisitions. */
export function createConnectionOwner(sessionId: string, onSettled?: () => void) {
    const work = new AbortController();
    const resources = new Map<string, OwnedResource>();
    const closing = new Map<string, Promise<void>>();
    const unsettled = new Set<string>();
    const pending = new Set<Promise<unknown>>();
    let cleanup: Promise<void> | undefined;
    let cleanupSettled = false;
    let resourceVersion = 0;
    let resolveExit = () => {};
    const exit = new Promise<void>((resolve) => {
        resolveExit = resolve;
    });
    const owner = {
        sessionId,
        target: undefined as ManagedTarget | undefined,
        exited: false,
        retired: false,
        expectedExit: undefined as 'close' | 'restart' | 'rollback' | 'disconnect' | undefined,
        expectedOperationId: undefined as string | undefined,
        signal: work.signal,
        exit,
        get resourceVersion() {
            return resourceVersion;
        },
        isCleaning() {
            return !!cleanup && !cleanupSettled;
        },
        assertOpen() {
            if (owner.retired) throw new Error('The target session has exited or retired.');
            work.signal.throwIfAborted();
        },
        abortWork(reason: unknown) {
            if (!work.signal.aborted) work.abort(reason);
        },
        retire(reason: unknown) {
            owner.retired = true;
            owner.abortWork(reason);
        },
        confirmExit() {
            if (owner.exited) return false;
            owner.exited = true;
            owner.retire(new Error('The target process exited.'));
            resolveExit();
            onSettled?.();
            return true;
        },
        track<T>(job: Promise<T>): Promise<T> {
            pending.add(job);
            void job
                .finally(() => {
                    pending.delete(job);
                    onSettled?.();
                })
                .catch(() => {});
            return job;
        },
        register(name: string, resource: OwnedResource) {
            const previous = resources.get(name);
            if (previous && previous !== resource) throw new Error('An owned resource is already registered.');
            if (!previous) resourceVersion += 1;
            resources.set(name, resource);
            if (owner.retired) void owner.closeResource(name).catch(() => {});
        },
        hasResource(name: string) {
            return resources.has(name);
        },
        hasPendingResources() {
            return resources.size > 0 || pending.size > 0;
        },
        closeResource(name: string): Promise<void> {
            const previous = closing.get(name);
            if (previous) return previous;
            const resource = resources.get(name);
            if (!resource) return Promise.resolve();
            unsettled.add(name);
            const result = (async () => {
                try {
                    await resource.close();
                    if (resources.get(name) === resource) resources.delete(name);
                } finally {
                    unsettled.delete(name);
                    onSettled?.();
                }
            })();
            closing.set(name, result);
            return result;
        },
        closeResources(): Promise<void> {
            if (cleanup) return cleanup;
            cleanup = (async () => {
                try {
                    const failures: unknown[] = [];
                    const names = [...resources.keys()].sort((a, b) => Number(a === 'router') - Number(b === 'router'));
                    for (const name of names) {
                        try {
                            await owner.closeResource(name);
                        } catch (error) {
                            failures.push(error);
                        }
                    }
                    if (failures.length === 1) throw failures[0];
                    if (failures.length)
                        throw new AggregateError(failures, 'Owned connection resources did not close.');
                } finally {
                    cleanupSettled = true;
                }
            })();
            return cleanup;
        },
        retryResources() {
            if (cleanup && !cleanupSettled) return cleanup;
            cleanup = undefined;
            cleanupSettled = false;
            for (const name of resources.keys()) if (!unsettled.has(name)) closing.delete(name);
            return owner.closeResources();
        },
    };
    return owner;
}

export type ConnectionOwner = ReturnType<typeof createConnectionOwner>;
