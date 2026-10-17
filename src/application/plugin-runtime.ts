import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { CallToolResult, ListRootsResult, Tool } from '@modelcontextprotocol/client';
import { createCdpRouter } from '../adapters/cdp-router.ts';
import { profileAvailable as nativeProfileAvailable } from '../adapters/chrome-profile.ts';
import { DataDirectoryRegistry } from '../adapters/data-directory.ts';
import { beginFixtureStage, emitFixtureEvent, runFixtureCleanup } from '../adapters/fixture-diagnostics.ts';
import { createOfficialConnection, type OfficialConnection } from '../adapters/mcp-bridge.ts';
import { buildServerArguments, resolveServerBin, snapshotOfficialEnvironment } from '../adapters/official-server.ts';
import { createPortReservations } from '../adapters/port-reservation.ts';
import { createTargetHost } from '../adapters/target-host.ts';
import { loadOfficialToolCatalog, workspaceSources } from '../adapters/tool-catalog.ts';
import {
    type ConnectionRoute,
    type ConnectionStatus,
    type ControlContext,
    type ControlHandler,
    type CoreControlHandler,
    type CoreControlRequest,
    connectionSummary,
    type GatewayStatus,
    lifecycleFailureEvidence,
    parseConnectionRoute,
    validateIdentity,
} from '../domains/control-contract.ts';
import { parseDataIsolation } from '../domains/data-isolation.ts';
import {
    bindPreparedLaunch,
    prepareLaunchDefinition,
    validateDataIsolationBinding,
} from '../domains/launch-command.ts';
import type { ClientPrincipal, ClientRequestContext } from '../shared/client-context.ts';
import { DEFAULT_BASE_PORT } from '../shared/constants.ts';
import { type Diagnose, type Diagnostic, measured } from '../shared/diagnostics.ts';
import { DetailedError, errorCode, errorDetails, errorMessage, isRecord } from '../shared/errors.ts';
import { createClientContext, waitForClient } from './client-context.ts';
import { type ConnectionDirectory, createConnectionDirectory } from './connection-directory.ts';
import { type ConnectionOwner, createConnectionOwner } from './connection-owner.ts';
import { createLifecycleService } from './mcp-lifecycle.ts';
import { createRegistrationRegistry } from './registrations.ts';
import {
    type ControllerHost,
    type ControllerRouter,
    createTargetController,
    type TargetEvent,
} from './target-controller.ts';

type RuntimeRouter = ControllerRouter & { url: string; close(): Promise<void> };
type Controller = ReturnType<typeof createTargetController>;
type ManagedConnection = {
    connectionId: string;
    sessionId: string;
    owner: ConnectionOwner;
    logicalOwner: ConnectionOwner;
    officialOwner: ConnectionOwner;
    restartScope?: import('../domains/control-contract.ts').RestartScope;
    directory: ConnectionDirectory;
    controller: Controller;
    router: RuntimeRouter;
    upstream?: OfficialConnection;
    mcpArgs: string[];
    roots: ListRootsResult;
    rootsNegotiated: boolean;
    officialEnvironment: NodeJS.ProcessEnv;
    workspace: ReturnType<typeof workspaceSources>;
    establishedAt?: number;
    lastRealOperationAt?: number;
    executionContext?: ClientRequestContext;
    executionFacilityFailure?: RequestFailure;
    activeCalls: number;
    diagnostics: (Diagnostic & { sessionId: string })[];
    diagnose: Diagnose;
    quarantined: boolean;
    quarantine?: Promise<boolean>;
};
export type RuntimeDependencies = {
    onCleanupReady?: (capability: GatewayConstructionCleanup) => void;
    officialRuntime?: Readonly<{ nodeExecutable: string; bin: string }>;
    dataDirectories?: DataDirectoryRegistry;
    profileAvailable?: typeof nativeProfileAvailable;
    createRouter?: (options?: { diagnose?: Diagnose }) => Promise<RuntimeRouter>;
    createHost?: () => ControllerHost;
    createConnection?: typeof createOfficialConnection;
    loadCatalog?: typeof loadOfficialToolCatalog;
    now?: () => number;
};
export type GatewayConstructionCleanup = Readonly<{
    cleanup(): Promise<void>;
    state(): 'open' | 'closing' | 'failed' | 'closed';
}>;
export async function createGatewayCore({
    dataDirectories = new DataDirectoryRegistry(),
    profileAvailable = nativeProfileAvailable,
    createRouter = createCdpRouter,
    createHost,
    createConnection = createOfficialConnection,
    loadCatalog = loadOfficialToolCatalog,
    now,
    officialRuntime,
    onCleanupReady,
}: RuntimeDependencies = {}) {
    const runtimeLocation = officialRuntime ? Object.freeze({ ...officialRuntime }) : undefined;
    const timestamp = now ?? Date.now;
    const entryId = randomUUID();
    const registrations = createRegistrationRegistry({
        ...(now ? { now } : {}),
        onExpire: (principal) => lifecycle.forgetOwner(principal.registrationId),
    });
    const resourceRegistrations = new Map<string, { principal: ClientPrincipal; directory: ConnectionDirectory }>();
    const connections = new Map<string, ManagedConnection>();
    const owners = new Set<ConnectionOwner>();
    const directories = new Set<ConnectionDirectory>();
    const portReservations = createPortReservations();
    const makeHost = createHost ?? (() => createTargetHost({ portReservations }));
    const retirements = new Set<Promise<void>>();
    const starts = new Set<Promise<ConnectionStatus>>();
    const replacements = new Set<Promise<unknown>>();
    let fullCatalog: Awaited<ReturnType<typeof loadOfficialToolCatalog>> | undefined;
    let shuttingDown = false;
    const admissionShutdown = new AbortController();
    let cleanupPromise: Promise<void> | undefined;
    let cleanupState: 'open' | 'closing' | 'failed' | 'closed' = 'open';
    async function retryDirectory(directory: ConnectionDirectory) {
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
    function newOwner(sessionId: string, directory?: ConnectionDirectory) {
        const owner = createConnectionOwner(
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
    function statusOf(connection: ManagedConnection): ConnectionStatus {
        const state = connection.controller.status();
        const upstreamStatus = connection.quarantined
            ? 'quarantined'
            : connection.upstream
              ? 'connected'
              : 'disconnected';
        const enabledTools =
            upstreamStatus === 'connected' ? (connection.upstream?.tools.map((tool) => tool.name) ?? []) : [];
        return {
            ...state,
            connectionId: connection.connectionId,
            upstreamStatus,
            enabledToolCount: enabledTools.length,
            enabledTools,
        };
    }
    function summary(connection: ManagedConnection) {
        return connectionSummary(statusOf(connection));
    }
    function status(): GatewayStatus;
    function status(connectionId: string): ConnectionStatus;
    function status(connectionId?: string): GatewayStatus | ConnectionStatus {
        if (connectionId !== undefined) return statusOf(selected(connectionId));
        return { connections: [...connections.values()].filter((item) => !item.owner.retired).map(summary) };
    }
    async function disposeResources(owner: ConnectionOwner) {
        try {
            await owner.closeResources();
        } finally {
            if (!owner.hasPendingResources() && owner.retired) owners.delete(owner);
        }
    }
    async function closeUpstream(connection: ManagedConnection, owner = connection.officialOwner) {
        if (connection.officialOwner === owner) delete connection.upstream;
        try {
            await owner.closeResource('upstream');
        } finally {
            if (connection.officialOwner === owner) delete connection.upstream;
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
    function observeExit(connection: ManagedConnection, event: TargetEvent) {
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
    async function ensureUpstream(connection: ManagedConnection, context: ControlContext = {}) {
        if (connection.upstream) return;
        if (connection.officialOwner.retired) connection.officialOwner = newOwner(randomUUID(), connection.directory);
        const owner = connection.officialOwner;
        owner.assertOpen();
        const args = buildServerArguments(connection.router.url, connection.officialEnvironment, connection.mcpArgs);
        connection.mcpArgs = args.slice(1);
        const signal = context.signal ? AbortSignal.any([owner.signal, context.signal]) : owner.signal;
        const acquiring = createConnection(connection.router.url, {
            ...runtimeLocation,
            args,
            environment: connection.officialEnvironment,
            signal,
            onAcquired: (resource) => owner.register('upstream', resource),
            roots: async () => structuredClone(connection.roots),
            elicitation: {
                form: true,
                request: async (params, incoming) => {
                    owner.assertOpen();
                    const origin = connection.executionContext;
                    if (!origin) throw new RequestFailure('CLIENT_CONTEXT_UNAVAILABLE');
                    try {
                        return await origin.elicit(params, AbortSignal.any([incoming, owner.signal]));
                    } catch (error) {
                        // The official SDK round trip erases local error types. Retain only a
                        // closed local facility reason on this same owned execution, never raw
                        // upstream text/data or another request's context.
                        if (error instanceof RequestFailure && connection.executionContext === origin)
                            connection.executionFacilityFailure = error;
                        throw error;
                    }
                },
            },
        });
        const upstream = await owner.track(acquiring);
        if (!owner.hasResource('upstream')) owner.register('upstream', upstream);
        if (connection.officialOwner !== owner || owner.retired || signal.aborted || shuttingDown) {
            owner.retire(new Error('The official connection acquisition belongs to a retired session.'));
            await owner.closeResource('upstream');
            throw new Error('The target exited or its official connection acquisition was cancelled.');
        }
        if (!fullCatalog) throw new Error('Missing fixed tool catalog.');
        try {
            fullCatalog.validate(upstream.tools);
        } catch (error) {
            await owner.closeResource('upstream');
            throw error;
        }
        owner.assertOpen();
        connection.upstream = upstream;
        upstream.onExit(() => {
            if (connection.officialOwner !== owner || owner.retired || connection.upstream !== upstream) return;
            delete connection.upstream;
            connection.controller.officialDisconnected();
        });
    }
    async function start(
        options: Parameters<Controller['start']>[0],
        context: ControlContext = {},
    ): Promise<ConnectionStatus> {
        if (shuttingDown) throw new Error('The gateway is closing.');
        const principal = context.client?.principal;
        if (!principal) throw new Error('Start requires an authenticated originating client.');
        registrations.check(principal);
        context.signal?.throwIfAborted();
        const admissionSignal = context.signal
            ? AbortSignal.any([admissionShutdown.signal, context.signal])
            : admissionShutdown.signal;
        options = structuredClone(options);
        const ambient = { ...process.env };
        const officialEnvironment = snapshotOfficialEnvironment(ambient);
        const temporaryDirectory = os.tmpdir();
        options.preparedLaunch = prepareLaunchDefinition(
            options.launch,
            options.basePort ?? DEFAULT_BASE_PORT,
            ambient,
            process.platform === 'win32',
        );
        const roots = context.client
            ? await waitForClient(context.client.readRoots(admissionSignal), admissionSignal)
            : { roots: [] };
        admissionSignal.throwIfAborted();
        const isolation = parseDataIsolation(options.isolation);
        validateDataIsolationBinding(options.launch, isolation.mode, ambient, process.platform === 'win32');
        const host = makeHost();
        host.validateLaunch?.(options);
        if (isolation.mode === 'data-dir') {
            const prepared = options.preparedLaunch;
            const parsed = bindPreparedLaunch(
                prepared,
                prepared.portPolicy.kind === 'fixed' ? prepared.portPolicy.port : prepared.portPolicy.basePort,
                '{dataDir}',
            );
            if (!path.isAbsolute(parsed.executablePath) || (parsed.cwd !== undefined && !path.isAbsolute(parsed.cwd)))
                throw new Error('Application executable and working directory must be absolute.');
        }
        const connectionId = randomUUID();
        const sessionId = randomUUID();
        const initialArgs = buildServerArguments('http://127.0.0.1:1', ambient, options.mcpArgs).slice(1);
        const directory = createConnectionDirectory(
            dataDirectories,
            isolation,
            context.onIsolation,
            options.targetKind === 'chrome' ? profileAvailable : undefined,
        );
        directories.add(directory);
        registrations.own(connectionId, principal);
        resourceRegistrations.set(connectionId, { principal, directory });
        const owner = newOwner(randomUUID(), directory);
        const logicalOwner = newOwner(randomUUID(), directory);
        const officialOwner = newOwner(randomUUID(), directory);
        owner.expectedOperationId = context.operationId;
        let connection: ManagedConnection | undefined;
        const diagnostics: (Diagnostic & { sessionId: string })[] = [];
        function diagnoseFor(selectedOwner: ConnectionOwner): Diagnose {
            return (event) => {
                if (selectedOwner.retired || (connection && connection.owner !== selectedOwner)) return;
                diagnostics.push({ ...event, sessionId: selectedOwner.sessionId });
                if (diagnostics.length > 64) diagnostics.shift();
            };
        }
        try {
            context.onIdentity?.({ connectionId, sessionId });
            context.onPhase?.('validating-official-server');
            if (createConnection === createOfficialConnection && !runtimeLocation) await resolveServerBin();
            context.signal?.throwIfAborted();
            if (shuttingDown) throw new Error('The gateway is closing.');
            context.onPhase?.('acquiring-data-directory');
            await directory.acquire();
            context.signal?.throwIfAborted();
            if (shuttingDown) throw new Error('The gateway is closing.');
            const diagnose = diagnoseFor(owner);
            context.onPhase?.('creating-router');
            const router = await createRouter({ diagnose });
            logicalOwner.register('router', router);
            context.signal?.throwIfAborted();
            if (shuttingDown) throw new Error('The gateway is closing.');
            const managed: ManagedConnection = {
                connectionId,
                sessionId,
                owner,
                logicalOwner,
                officialOwner,
                directory,
                router,
                diagnostics,
                diagnose,
                mcpArgs: initialArgs,
                roots: structuredClone(roots),
                rootsNegotiated: context.client?.capabilities.roots ?? false,
                officialEnvironment,
                workspace: workspaceSources(
                    initialArgs,
                    context.client?.capabilities.roots ?? false,
                    temporaryDirectory,
                ),
                activeCalls: 0,
                quarantined: false,
                controller: createTargetController({
                    entryId,
                    host,
                    router: {
                        setTarget: (target) => managed.router.setTarget(target),
                        clearTarget: () => managed.router.clearTarget(),
                        isBusy: () => managed.router.isBusy(),
                        pause: () => managed.router.pause?.(),
                        resume: () => managed.router.resume?.(),
                    },
                    createOwner: async () => {
                        if (!managed.owner.target && !managed.owner.retired) return managed.owner;
                        const replacement = newOwner(randomUUID(), directory);
                        managed.owner = replacement;
                        delete managed.quarantine;
                        managed.quarantined = false;
                        managed.diagnose = diagnoseFor(replacement);
                        replacement.assertOpen();
                        return replacement;
                    },
                    onProcessExit: (event) => observeExit(managed, event),
                    onObservationFailure: (id) => {
                        if (managed.owner.sessionId !== id) return;
                        managed.quarantined = true;
                        trackRetirement(closeUpstream(managed));
                    },
                    server: {
                        ensure: (_options, context) => ensureUpstream(managed, context),
                        close: async (selectedOwner = managed.owner) => {
                            const errors: unknown[] = [];
                            async function disposeSide(owner: ConnectionOwner) {
                                try {
                                    await disposeResources(owner);
                                } catch (error) {
                                    errors.push(error);
                                }
                            }
                            if (managed.restartScope !== 'target') {
                                managed.officialOwner.retire(new Error('The official generation is closing.'));
                                delete managed.upstream;
                                await disposeSide(managed.officialOwner);
                            }
                            if (!managed.restartScope) {
                                managed.logicalOwner.retire(new Error('The connection is closing.'));
                                await disposeSide(managed.logicalOwner);
                            }
                            await disposeSide(selectedOwner);
                            if (errors.length === 1) throw errors[0];
                            if (errors.length) throw new AggregateError(errors, 'Connection resource disposal failed.');
                        },
                    },
                }),
            };
            connection = managed;
            connections.set(connectionId, managed);
            await managed.controller.start(options, sessionId, {
                ...context,
                ...(directory.path === undefined ? {} : { dataDirectory: directory.path }),
            });
            managed.owner.assertOpen();
            managed.establishedAt = timestamp();
            managed.lastRealOperationAt = managed.establishedAt;
            return summary(managed);
        } catch (error) {
            const primaryEvidence = {
                ...lifecycleFailureEvidence(errorDetails(error) ?? {}),
                ...(errorCode(error) === undefined ? {} : { code: errorCode(error) }),
            };
            directory.requestRelease();
            const managed = connection;
            const failedOwner = managed?.owner ?? owner;
            if (!failedOwner.target || failedOwner.exited) {
                failedOwner.retire(error);
                try {
                    const cleanup = await Promise.allSettled([
                        disposeResources(failedOwner),
                        disposeResources(officialOwner),
                        disposeResources(logicalOwner),
                    ]);
                    const failure = cleanup.find((result) => result.status === 'rejected');
                    if (failure?.status === 'rejected') throw failure.reason;
                } catch (cleanupError) {
                    emitFixtureEvent('resource-disposal', 'decision', { outcome: 'failed' }, cleanupError);
                    const failure = new DetailedError(errorMessage(error), { cause: error });
                    failure.details = {
                        ...primaryEvidence,
                        entryId,
                        connectionId,
                        sessionId: connection?.sessionId ?? sessionId,
                        cleanupError: errorMessage(cleanupError),
                    };
                    connections.delete(connectionId);
                    throw failure;
                }
                connections.delete(connectionId);
            }
            if (
                context.signal?.aborted &&
                error === context.signal.reason &&
                (!failedOwner.target || failedOwner.exited)
            )
                throw context.signal.reason;
            const failure = new DetailedError(errorMessage(error), { cause: error });
            failure.details = {
                ...primaryEvidence,
                entryId,
                connectionId,
                sessionId: connection?.sessionId ?? sessionId,
                ...(managed ? connectionSummary(statusOf(managed)) : {}),
                processExited: failedOwner.exited,
            };
            throw failure;
        } finally {
            await retryDirectory(directory).catch(() => {});
        }
    }
    const handler: ControlHandler = {
        status,
        start: (options, context) => {
            const job = start(options, context);
            starts.add(job);
            void job.finally(() => starts.delete(job)).catch(() => {});
            return job;
        },
        restart: (request, context = {}) => {
            const job = (async () => {
                if (shuttingDown) throw new Error('The gateway is closing.');
                const connection = routed(request);
                if (connection.activeCalls > 0) throw new RequestFailure('CONNECTION_BUSY');
                connection.lastRealOperationAt = timestamp();
                connection.owner.expectedOperationId = context.operationId;
                if (request.scope === undefined || !['target', 'official', 'both'].includes(request.scope))
                    throw new Error('An explicit target, official or both restart scope is required.');
                if (Object.hasOwn(request, 'mcpArgs'))
                    throw new Error('Restart cannot replace mcpArgs; Close and start a new connection.');
                const releaseSuccessor = connection.directory.holdSuccessor();
                connection.restartScope = request.scope;
                try {
                    if (connection.restartScope === 'official') {
                        connection.router.pause?.();
                        connection.officialOwner.retire(new Error('The official generation is restarting.'));
                        await closeUpstream(connection);
                        await ensureUpstream(connection, context);
                        const sessionId = randomUUID();
                        connection.controller.replaceOfficialSession(sessionId);
                        connection.sessionId = sessionId;
                        context.onIdentity?.({ connectionId: request.connectionId, sessionId });
                        return { ...summary(connection), pageIdsInvalidated: true };
                    }
                    const result = await connection.controller.restart(request, {
                        ...context,
                        ...(connection.directory.path === undefined
                            ? {}
                            : { dataDirectory: connection.directory.path }),
                        onSession: (sessionId) => {
                            connection.sessionId = sessionId;
                            context.onIdentity?.({ connectionId: request.connectionId, sessionId });
                        },
                    });
                    return { ...summary(connection), ...result, connectionId: request.connectionId };
                } catch (error) {
                    connection.directory.requestRelease();
                    if (request.scope === 'official') {
                        delete connection.restartScope;
                        try {
                            await connection.controller.cleanupOnDisconnect('rollback');
                        } catch {
                            /* Retained failed disposal remains owned for explicit cleanup retry. */
                        }
                    }
                    const owner = connection.owner;
                    if (!owner.target || owner.exited) {
                        connection.logicalOwner.retire(error);
                        connection.officialOwner.retire(error);
                        delete connection.upstream;
                        await Promise.allSettled([
                            disposeResources(connection.officialOwner),
                            disposeResources(connection.logicalOwner),
                        ]);
                    }
                    if (!owner.target || owner.exited) {
                        owner.retire(error);
                        try {
                            await disposeResources(owner);
                        } catch {
                            /* The original disposal error remains in the owned cleanup ledger. */
                        }
                    }
                    if (connection.owner.retired || connection.controller.status().status === 'idle')
                        connections.delete(request.connectionId);
                    throw error;
                } finally {
                    delete connection.restartScope;
                    releaseSuccessor();
                    await retryDirectory(connection.directory).catch(() => {});
                }
            })();
            replacements.add(job);
            void job.finally(() => replacements.delete(job)).catch(() => {});
            return job;
        },
        stop: async (request, context = {}) => {
            const connection = routed(request);
            connection.lastRealOperationAt = timestamp();
            delete connection.executionFacilityFailure;
            connection.owner.expectedOperationId = context.operationId;
            if (request.disposition === 'Close') connection.directory.requestRelease();
            const result = await connection.controller.stop(request, context);
            if (request.disposition === 'Close') {
                if (connections.get(request.connectionId) === connection) connections.delete(request.connectionId);
                await retryDirectory(connection.directory);
            }
            return {
                ...result,
                connectionId: connection.connectionId,
                enabledToolCount: request.disposition === 'Close' ? 0 : (summary(connection).enabledToolCount ?? 0),
                upstreamStatus:
                    request.disposition === 'Close'
                        ? 'disconnected'
                        : (summary(connection).upstreamStatus ?? 'disconnected'),
            };
        },
    };
    const lifecycle = createLifecycleService({
        entryId,
        handler,
        authorize: registrations.authorize,
        beginJob: registrations.beginJob,
    });
    function lifecycleResult(details: Record<string, unknown>): CallToolResult {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(details) }],
            structuredContent: details,
        };
    }
    const catalogOwner = newOwner(randomUUID());
    function cleanup() {
        return runFixtureCleanup({ entryId }, performCleanup);
    }
    async function performCleanup() {
        if (cleanupPromise) return cleanupPromise;
        if (cleanupState === 'closed') return;
        const finishObservation = beginFixtureStage('gateway-cleanup');
        shuttingDown = true;
        admissionShutdown.abort(new Error('The gateway is closing.'));
        cleanupState = 'closing';
        for (const directory of directories) directory.requestRelease();
        const closing: Promise<unknown>[] = [];
        const cleaning = new Map<ConnectionOwner, { version: number; joined: boolean }>();
        for (const connection of connections.values()) {
            connection.owner.abortWork(new Error('The gateway is closing.'));
            connection.router.clearTarget();
            closing.push(
                connection.controller.cleanupOnDisconnect().then((retained) => {
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
    // Trusted composition retains this capability even if construction later rejects.
    // A throwing callback runs before the first resource acquisition.
    onCleanupReady?.(Object.freeze({ cleanup, state: () => cleanupState }));
    try {
        catalogOwner.assertOpen();
        const catalogRouter = await catalogOwner.track(
            createRouter().then((router) => {
                catalogOwner.register('router', router);
                catalogOwner.assertOpen();
                return router;
            }),
        );
        const catalogConnection = await catalogOwner.track(
            createConnection(catalogRouter.url, {
                ...runtimeLocation,
                signal: catalogOwner.signal,
                onAcquired: (resource) => catalogOwner.register('upstream', resource),
            }).then((connection) => {
                if (!catalogOwner.hasResource('upstream')) catalogOwner.register('upstream', connection);
                catalogOwner.assertOpen();
                return connection;
            }),
        );
        fullCatalog = await loadCatalog(catalogConnection.tools);
        catalogOwner.assertOpen();
        fullCatalog.validate(catalogConnection.tools);
        const catalog: Tool[] = fullCatalog.tools;
        await disposeResources(catalogOwner);
        catalogOwner.retire(new Error('Catalog discovery completed.'));
        owners.delete(catalogOwner);
        async function control(
            request: import('../domains/control-contract.ts').ControlRequest,
            signal?: AbortSignal,
            client?: ClientRequestContext,
        ): Promise<Record<string, unknown>> {
            if (client) registrations.check(client.principal);
            const result = await performControl(request, signal, client);
            if (client) {
                registrations.touch(client.principal);
                if (Array.isArray(result.connections))
                    return {
                        ...result,
                        connections: result.connections.filter((item: unknown) => {
                            if (!isRecord(item) || typeof item.connectionId !== 'string') return false;
                            try {
                                registrations.authorize(item.connectionId, client.principal);
                                return true;
                            } catch {
                                return false;
                            }
                        }),
                    };
            }
            return result;
        }
        async function performControl(
            request: import('../domains/control-contract.ts').ControlRequest,
            signal?: AbortSignal,
            client?: ClientRequestContext,
        ): Promise<Record<string, unknown>> {
            if (client) registrations.check(client.principal);
            const result = await lifecycle.control(request, signal, client);
            if (request.action !== 'status' || request.operationId || !fullCatalog) return result;
            const connection = request.connectionId ? selected(request.connectionId) : undefined;
            if (!connection)
                return {
                    ...result,
                    ...(request.toolNames
                        ? {
                              toolAvailability: fullCatalog.describe(
                                  buildServerArguments('http://127.0.0.1:1').slice(1),
                                  undefined,
                                  request.toolNames,
                              ),
                          }
                        : {}),
                };
            return {
                ...connectionSummary(statusOf(connection)),
                ...(request.toolNames ? {} : { enabledTools: statusOf(connection).enabledTools ?? [] }),
                ...(request.toolNames
                    ? {
                          toolAvailability: fullCatalog.describe(
                              connection.mcpArgs,
                              !connection.quarantined ? connection.upstream?.tools : undefined,
                              request.toolNames,
                          ),
                      }
                    : {}),
                ...(request.include?.includes('configuration')
                    ? {
                          mcpArgs: [...connection.mcpArgs],
                          workspace: structuredClone(connection.workspace),
                          roots: structuredClone(connection.roots),
                          launch: connection.controller.configuration(),
                          official: {
                              generation: connection.officialOwner.sessionId,
                              processId: connection.upstream?.processId,
                          },
                          isolation: connection.directory.evidence(),
                      }
                    : {}),
                ...(request.include?.includes('diagnostics') ? { diagnostics: [...connection.diagnostics] } : {}),
            };
        }
        async function invoke(
            name: string,
            arguments_: Record<string, unknown>,
            signal: AbortSignal,
            onProgress: (progress: import('@modelcontextprotocol/client').Progress) => void,
            client?: ClientRequestContext,
        ): Promise<CallToolResult> {
            if (shuttingDown) throw new RequestFailure('APP_CLOSING');
            signal.throwIfAborted();
            const route = parseConnectionRoute(arguments_._dct);
            if (client) {
                registrations.check(client.principal);
                registrations.authorize(route.connectionId, client.principal);
            }
            const connection = routed(route);
            if (connection.activeCalls > 0 || lifecycle.isBusy(connection.connectionId))
                throw new RequestFailure('CONNECTION_BUSY');
            const owner = connection.owner;
            connection.activeCalls += 1;
            connection.lastRealOperationAt = timestamp();
            if (client) connection.executionContext = client;
            const execution = (async () => {
                if (connection.upstream && !connection.upstream.tools.some((tool) => tool.name === name))
                    return lifecycleResult({
                        code: 'TOOL_NOT_ENABLED',
                        ...route,
                        ...fullCatalog?.requirements(name, connection.mcpArgs, true),
                        nextAction: 'close-and-new-start',
                    });
                const healthTiming = measured(connection.diagnose, 'connection-health');
                await connection.controller.checkHealth();
                healthTiming();
                owner.assertOpen();
                routed(route);
                const current = summary(connection);
                const upstream = connection.upstream;
                if (!connection.controller.canInvoke() || !upstream)
                    return lifecycleResult({
                        ...current,
                        reason: current.reason ?? 'target-not-ready',
                        nextAction: 'inspect-connection-error',
                    });
                const { _dct: routing, ...upstreamArguments } = arguments_;
                void routing;
                const timing = measured(connection.diagnose, 'upstream-processing');
                try {
                    const result = await upstream.call(name, upstreamArguments, owner.signal, (progress) => {
                        if (
                            !signal.aborted &&
                            connection.owner === owner &&
                            !owner.retired &&
                            connection.upstream === upstream
                        )
                            onProgress(progress);
                    });
                    owner.assertOpen();
                    routed(route);
                    timing();
                    measured(connection.diagnose, 'result-ready')();
                    if (client) registrations.touch(client.principal);
                    return result;
                } catch (error) {
                    timing('failed');
                    throw connection.executionFacilityFailure ?? error;
                }
            })().finally(() => {
                connection.activeCalls -= 1;
                delete connection.executionContext;
                delete connection.executionFacilityFailure;
            });
            owner.track(execution);
            return waitForClient(execution, signal);
        }
        return {
            entryId,
            controller: handler as CoreControlHandler,
            tools: catalog,
            invoke: (name: string, args: Record<string, unknown>, client: ClientRequestContext) =>
                invoke(name, args, client.waitSignal, client.progress, client),
            cleanup,
            register() {
                if (shuttingDown) throw new Error('The gateway is closing.');
                return registrations.create();
            },
            control: (request: CoreControlRequest, client: ClientRequestContext) =>
                control(request, client.waitSignal, client),
            attachClient(bearer: string) {
                return createClientContext(registrations.authenticate(bearer));
            },
            admin: {
                registrations: registrations.list,
                unregister: (registrationId: string) => registrations.unregister(registrations.resolve(registrationId)),
                transfer(connectionId: string, registrationId: string) {
                    const principal = registrations.resolve(registrationId);
                    const connection = selected(connectionId);
                    registrations.transfer(
                        connectionId,
                        principal,
                        () =>
                            cleanupState !== 'open' ||
                            lifecycle.isBusy(connectionId) ||
                            connection.activeCalls > 0 ||
                            connection.owner.hasPendingWork() ||
                            [connection.owner, connection.officialOwner, connection.logicalOwner].some(
                                (owner) => owner.isCleaning() || owner.hasFailedDisposal(),
                            ),
                    );
                    const resource = resourceRegistrations.get(connectionId);
                    if (resource) resource.principal = principal;
                },
                status,
                connections: () =>
                    [...connections.values()].map((connection) => ({
                        ...summary(connection),
                        registrationId: resourceRegistrations.get(connection.connectionId)?.principal.registrationId,
                        establishedAt: connection.establishedAt,
                        lastRealOperationAt: connection.lastRealOperationAt,
                        targetGeneration: connection.owner.sessionId,
                        officialGeneration: connection.officialOwner.sessionId,
                    })),
                operations: lifecycle.list,
                control: (request: CoreControlRequest) => {
                    if (request.action === 'start')
                        return Promise.reject(new Error('Administration cannot create targets.'));
                    return performControl(request);
                },
                cleanupState: () => cleanupState,
            },
        };
    } catch (error) {
        try {
            await cleanup();
        } catch (cleanupError) {
            const failure = new DetailedError(errorMessage(error), { cause: error });
            failure.details = { cleanupError: errorMessage(cleanupError) };
            throw failure;
        }
        throw error;
    }
}

export type GatewayCore = Awaited<ReturnType<typeof createGatewayCore>>;

import { RequestFailure } from '../domains/request-failure.ts';
