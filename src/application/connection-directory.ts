import { DataDirectoryError, type DataDirectoryLease, type DataDirectoryRegistry } from '../adapters/data-directory.ts';
import {
    beginFixtureStage,
    captureFixtureOrigin,
    emitFixtureEvent,
    type FixtureFields,
    type FixtureOrigin,
    runFixtureResource,
} from '../adapters/fixture-diagnostics.ts';
import type { DataIsolation, DataIsolationEvidence } from '../domains/data-isolation.ts';
import type { ConnectionOwner } from './connection-owner.ts';

/** A connection lease outlives every session owner and every removed route. */
export function createConnectionDirectory(
    registry: DataDirectoryRegistry,
    isolation: DataIsolation,
    publish?: (evidence: DataIsolationEvidence) => void,
    canDelete?: (directory: string) => Promise<boolean>,
) {
    let origin: FixtureOrigin | undefined;
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
            origin ??= captureFixtureOrigin({ sessionId: undefined });
            return runFixtureResource(origin, async () => {
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
            });
        },
        retry(): Promise<void> {
            return runFixtureResource(origin, () => {
                const blocked = (reason: NonNullable<FixtureFields['reason']>) => {
                    emitFixtureEvent('directory-lease', 'decision', {
                        phase: 'release-barrier',
                        outcome: 'skipped',
                        reason,
                    });
                    return Promise.resolve();
                };
                if (releasing) {
                    emitFixtureEvent('directory-lease', 'decision', {
                        phase: 'release-barrier',
                        outcome: 'skipped',
                        reason: 'release-pending',
                    });
                    return releasing;
                }
                if (released) return blocked('already-released');
                if (!finalRelease) return blocked('release-not-requested');
                if (acquisitionPending) return blocked('acquisition-pending');
                if (successors > 0) return blocked('successor-pending');
                for (const owner of owners) {
                    if (owner.target && !owner.exited) return blocked('target-live');
                    if (owner.hasPendingResources()) return blocked('resources-pending');
                }
                const attempt = (async () => {
                    const finish = beginFixtureStage('directory-lease', { phase: 'resource-cleanup' });
                    try {
                        if (lease?.evidence.cleanup === 'delete-on-release' && canDelete) {
                            const finishAvailability = beginFixtureStage('directory-lease', { phase: 'availability' });
                            let available: boolean;
                            try {
                                available = await canDelete(lease.evidence.path);
                            } catch (error) {
                                finishAvailability('failed', {}, error);
                                throw error;
                            }
                            finishAvailability(available ? 'succeeded' : 'rejected', { available });
                            if (!available) throw new DataDirectoryError('directory-cleanup-failed', lease);
                        }
                        await lease?.release();
                        releaseFailed = false;
                        released = true;
                        finish('released');
                    } catch (error) {
                        releaseFailed = true;
                        finish('failed', {}, error);
                        throw error instanceof DataDirectoryError
                            ? error
                            : new DataDirectoryError('directory-cleanup-failed', lease, error);
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
            });
        },
    };
}

export type ConnectionDirectory = ReturnType<typeof createConnectionDirectory>;
