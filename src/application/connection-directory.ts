import { DataDirectoryError, type DataDirectoryLease, type DataDirectoryRegistry } from '../adapters/data-directory.ts';
import type { DataIsolation, DataIsolationEvidence } from '../domains/data-isolation.ts';
import type { ConnectionOwner } from './connection-owner.ts';

/** A connection lease outlives every session owner and every removed route. */
export function createConnectionDirectory(
    registry: DataDirectoryRegistry,
    isolation: DataIsolation,
    publish?: (evidence: DataIsolationEvidence) => void,
    canDelete?: (directory: string) => Promise<boolean>,
) {
    const owners = new Set<ConnectionOwner>();
    let lease: DataDirectoryLease | undefined;
    let acquisitionPending = false;
    let successors = 0;
    let finalRelease = false;
    let releasing: Promise<void> | undefined;
    let released = false;
    let releaseFailed = false;
    function evidence(): DataIsolationEvidence | undefined {
        return isolation.mode === 'none'
            ? { mode: 'none' }
            : lease
              ? { mode: 'data-dir', ...lease.evidence, ...(releaseFailed ? { state: 'cleanup-failed' } : {}) }
              : undefined;
    }
    function update() {
        const current = evidence();
        if (current) publish?.(current);
    }
    return {
        evidence,
        get path() {
            return lease?.evidence.path;
        },
        get released() {
            return released;
        },
        addOwner(owner: ConnectionOwner) {
            owners.add(owner);
        },
        holdSuccessor() {
            successors++;
            let holding = true;
            return () => {
                if (!holding) return;
                holding = false;
                successors--;
            };
        },
        requestRelease() {
            finalRelease = true;
        },
        async acquire() {
            if (isolation.mode === 'none') {
                update();
                return;
            }
            acquisitionPending = true;
            const acquired = (value: DataDirectoryLease) => {
                lease = value;
                update();
            };
            try {
                acquired(await registry.acquire(isolation.directory, isolation.cleanup, acquired));
            } catch (error) {
                if (error instanceof DataDirectoryError && error.lease) acquired(error.lease);
                throw error;
            } finally {
                acquisitionPending = false;
                update();
            }
        },
        retry(): Promise<void> {
            if (releasing) return releasing;
            if (released || !finalRelease || acquisitionPending || successors > 0) return Promise.resolve();
            for (const owner of owners)
                if ((owner.target && !owner.exited) || owner.hasPendingResources()) return Promise.resolve();
            const attempt = (async () => {
                try {
                    if (
                        lease?.evidence.cleanup === 'delete-on-release' &&
                        canDelete &&
                        !(await canDelete(lease.evidence.path))
                    )
                        throw new DataDirectoryError('directory-cleanup-failed', lease);
                    await lease?.release();
                    releaseFailed = false;
                    released = true;
                } catch (error) {
                    releaseFailed = true;
                    throw error instanceof DataDirectoryError
                        ? error
                        : new DataDirectoryError('directory-cleanup-failed', lease);
                } finally {
                    update();
                }
            })();
            releasing = attempt;
            void attempt
                .finally(() => {
                    releasing = undefined;
                })
                .catch(() => {});
            return attempt;
        },
    };
}

export type ConnectionDirectory = ReturnType<typeof createConnectionDirectory>;
