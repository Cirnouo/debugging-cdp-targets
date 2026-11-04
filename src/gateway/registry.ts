import { beginFixtureStage, runFixtureCleanup } from '../adapters/fixture-diagnostics.ts';
import type { createLifecycleService } from '../application/mcp-lifecycle.ts';
import type { createRegistrationRegistry } from '../application/registrations.ts';
import { type ConnectionRoute, type ConnectionStatus, validateIdentity } from '../domains/control-contract.ts';
import type { ClientPrincipal } from '../shared/client-context.ts';
import { errorMessage } from '../shared/errors.ts';
import type { ConnectionDirectoryLease } from './connections/directory-lease.ts';
import { createResourceOwner, type ResourceOwner } from './connections/resource-owner.ts';
import type { ManagedConnection } from './core.ts';
import type { TargetExitEvent } from './targets/target-lifecycle.ts';

export function createGatewayRegistry({
    entryId,
    registrations,
}: {
    entryId: string;
    registrations: Pick<ReturnType<typeof createRegistrationRegistry>, 'own' | 'release'>;
}) {
    const resourceRegistrations = new Map<
        string,
        { principal: ClientPrincipal; directory: ConnectionDirectoryLease }
    >();
    const connections = new Map<string, ManagedConnection>();
    const owners = new Set<ResourceOwner>();
    const directories = new Set<ConnectionDirectoryLease>();
    const retirements = new Set<Promise<void>>();
    const starts = new Set<Promise<ConnectionStatus>>();
    const replacements = new Set<Promise<unknown>>();
    let shuttingDown = false;
    const admissionShutdown = new AbortController();
    let cleanupPromise: Promise<void> | undefined;
    let cleanupState: 'open' | 'closing' | 'failed' | 'closed' = 'open';
    async function retryDirectory(directory: ConnectionDirectoryLease) {
        try {
            await directory.retry();
        } finally {
            if (directory.released) {
                directories.delete(directory);
                for (const [id, resource] of resourceRegistrations)
                    if (resource.directory === directory) {
                        registrations.release(id);
                        resourceRegistrations.delete(id);
                    }
            }
        }
    }
    function newOwner(sessionId: string, directory?: ConnectionDirectoryLease) {
        const owner = createResourceOwner(
            sessionId,
            directory
                ? () => {
                      void retryDirectory(directory).catch(() => {});
                  }
                : undefined,
        );
        owners.add(owner);
        directory?.addOwner(owner);
        return owner;
    }
    function selected(connectionId: string) {
        validateIdentity(connectionId, 'connection ID');
        const connection = connections.get(connectionId);
        if (!connection || connection.owner.retired) throw new Error('The target connection is absent or closed.');
        return connection;
    }
    function routed(route: ConnectionRoute) {
        const connection = selected(route.connectionId);
        if (connection.sessionId !== route.sessionId) throw new Error('The target session is absent or stale.');
        return connection;
    }
    async function disposeResources(owner: ResourceOwner) {
        try {
            await owner.closeResources();
        } finally {
            if (!owner.hasPendingResources() && owner.retired) owners.delete(owner);
        }
    }
    function trackRetirement(job: Promise<void>) {
        retirements.add(job);
        void job
            .catch((error: unknown) => {
                process.stderr.write(`Connection cleanup failed: ${errorMessage(error)}\n`);
            })
            .finally(() => retirements.delete(job));
    }
    function observeExit(
        connection: ManagedConnection,
        event: TargetExitEvent,
        lifecycle: Pick<ReturnType<typeof createLifecycleService>, 'cancelRoute'>,
    ) {
        const owner = connection.owner;
        if ((event.generation ?? event.sessionId) !== owner.sessionId) return;
        if (event.expected !== 'restart') connection.directory.requestRelease();
        // Target controller already revoked routing and the owner's dependent work.
        lifecycle.cancelRoute({ connectionId: connection.connectionId, sessionId: event.sessionId });
        const pending = (async () => {
            try {
                await connection.controller.retireExited({ sessionId: event.sessionId });
            } finally {
                if (
                    event.expected !== 'restart' &&
                    connections.get(connection.connectionId) === connection &&
                    connection.owner === owner
                )
                    connections.delete(connection.connectionId);
                if (!owner.hasPendingResources()) owners.delete(owner);
                await retryDirectory(connection.directory).catch(() => {});
            }
        })();
        trackRetirement(pending);
    }
    function cleanup(lifecycle: Pick<ReturnType<typeof createLifecycleService>, 'close'>) {
        return runFixtureCleanup({ entryId }, () => performCleanup(lifecycle));
    }
    async function performCleanup(lifecycle: Pick<ReturnType<typeof createLifecycleService>, 'close'>) {
        if (cleanupPromise) return cleanupPromise;
        if (cleanupState === 'closed') return;
        const finishObservation = beginFixtureStage('gateway-cleanup');
        shuttingDown = true;
        admissionShutdown.abort(new Error('The gateway is closing.'));
        cleanupState = 'closing';
        for (const directory of directories) directory.requestRelease();
        const closing: Promise<unknown>[] = [];
        const cleaning = new Map<ResourceOwner, { version: number; joined: boolean }>();
        for (const connection of connections.values()) {
            connection.owner.abortWork(new Error('The gateway is closing.'));
            connection.router.clearTarget();
            closing.push(
                connection.controller.cleanup().then((retained) => {
                    if (retained)
                        throw new Error(
                            'Gateway cleanup failed: the application did not close normally; live ownership is retained.',
                        );
                }),
            );
        }
        // Start every independent peer before awaiting native application shutdown.
        for (const owner of [...owners].sort((a, b) => Number(!!a.target) - Number(!!b.target))) {
            if (owner.target && !owner.exited) owner.abortWork(new Error('The gateway is closing.'));
            else owner.retire(new Error('The gateway is closing.'));
            cleaning.set(owner, { version: owner.resourceVersion, joined: owner.isCleaning() });
            if (!owner.target) closing.push(owner.retryResources());
        }
        closing.push(lifecycle.close());
        const attempt = (async () => {
            const results = await Promise.allSettled(closing);
            await Promise.allSettled([...starts, ...replacements, ...retirements]);
            results.push(
                ...(await Promise.allSettled(
                    [...owners]
                        .filter((owner) => {
                            const initial = cleaning.get(owner);
                            return (
                                (!owner.target || owner.exited) &&
                                (!initial || initial.joined || initial.version !== owner.resourceVersion)
                            );
                        })
                        .map((owner) => owner.retryResources()),
                )),
            );
            results.push(...(await Promise.allSettled([...directories].map(retryDirectory))));
            for (const [id, connection] of connections) {
                if ((!connection.owner.target || connection.owner.exited) && !connection.owner.hasPendingResources())
                    connections.delete(id);
            }
            const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
            if ([...owners].some((owner) => (owner.target && !owner.exited) || owner.hasPendingResources()))
                errors.push(new Error('Gateway cleanup failed: live or pending resource ownership remains.'));
            if ([...directories].some((directory) => !directory.released))
                errors.push(new Error('Gateway cleanup failed: a directory lease remains owned.'));
            if (errors.length) {
                cleanupState = 'failed';
                finishObservation('failed');
                throw new AggregateError(errors, 'Gateway cleanup failed; ownership is retained for retry.');
            }
            cleanupState = 'closed';
            finishObservation('succeeded');
        })();
        cleanupPromise = attempt.finally(() => {
            cleanupPromise = undefined;
        });
        return cleanupPromise;
    }

    return {
        retryDirectory,
        newOwner,
        selected,
        routed,
        disposeResources,
        trackRetirement,
        observeExit,
        cleanup,
        enrollDirectory(connectionId: string, principal: ClientPrincipal, directory: ConnectionDirectoryLease) {
            directories.add(directory);
            registrations.own(connectionId, principal);
            resourceRegistrations.set(connectionId, { principal, directory });
        },
        publishConnection(connectionId: string, connection: ManagedConnection) {
            connections.set(connectionId, connection);
        },
        removeConnection(connectionId: string, expected?: ManagedConnection) {
            if (expected === undefined || connections.get(connectionId) === expected) connections.delete(connectionId);
        },
        connectionReferences: () => connections.values(),
        registrationPrincipal: (connectionId: string) => resourceRegistrations.get(connectionId)?.principal,
        adoptTransferredPrincipal(connectionId: string, principal: ClientPrincipal) {
            const resource = resourceRegistrations.get(connectionId);
            if (resource) resource.principal = principal;
        },
        trackStart(job: Promise<ConnectionStatus>) {
            starts.add(job);
            void job.finally(() => starts.delete(job)).catch(() => {});
            return job;
        },
        trackReplacement<T>(job: Promise<T>) {
            replacements.add(job);
            void job.finally(() => replacements.delete(job)).catch(() => {});
            return job;
        },
        forgetCatalogOwner(owner: ResourceOwner) {
            owners.delete(owner);
        },
        get closing() {
            return shuttingDown;
        },
        get admissionSignal() {
            return admissionShutdown.signal;
        },
        get cleanupState() {
            return cleanupState;
        },
    };
}
