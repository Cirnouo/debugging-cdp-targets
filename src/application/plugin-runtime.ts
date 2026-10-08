import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { createCdpRouter } from '../adapters/cdp-router.ts';
import { profileAvailable as nativeProfileAvailable } from '../adapters/chrome-profile.ts';
import { DataDirectoryRegistry } from '../adapters/data-directory.ts';
import { beginFixtureStage, emitFixtureEvent, runFixtureCleanup } from '../adapters/fixture-diagnostics.ts';
import { createOfficialConnection, interruptedOfficialCall, type OfficialConnection } from '../adapters/mcp-bridge.ts';
import { createMcpEntryServer, type HookEventName } from '../adapters/mcp-entry-server.ts';
import { buildServerArguments, resolveServerBin } from '../adapters/official-server.ts';
import { createPortReservations } from '../adapters/port-reservation.ts';
import { createTargetHost } from '../adapters/target-host.ts';
import { loadOfficialToolCatalog, workspaceSources } from '../adapters/tool-catalog.ts';
import {
    type ConnectionRoute,
    type ConnectionStatus,
    type ControlContext,
    type ControlHandler,
    connectionSummary,
    type GatewayStatus,
    lifecycleFailureEvidence,
    parseConnectionRoute,
    validateIdentity,
} from '../domains/control-contract.ts';
import { parseDataIsolation } from '../domains/data-isolation.ts';
import { resolveLaunchDefinition, validateDataIsolationBinding } from '../domains/launch-command.ts';
import { DEFAULT_BASE_PORT } from '../shared/constants.ts';
import { type Diagnose, type Diagnostic, measured } from '../shared/diagnostics.ts';
import { DetailedError, errorCode, errorDetails, errorMessage, isRecord } from '../shared/errors.ts';
import { type ConnectionDirectory, createConnectionDirectory } from './connection-directory.ts';
import { type ConnectionOwner, createConnectionOwner } from './connection-owner.ts';
import { createLifecycleService } from './mcp-lifecycle.ts';
import {
    type ControllerHost,
    type ControllerRouter,
    createTargetController,
    type TargetEvent,
} from './target-controller.ts';

type RuntimeRouter = ControllerRouter & { url: string; close(): Promise<void> };
type Entry = ReturnType<typeof createMcpEntryServer>;
type Controller = ReturnType<typeof createTargetController>;
type ManagedConnection = {
    connectionId: string;
    owner: ConnectionOwner;
    directory: ConnectionDirectory;
    controller: Controller;
    router: RuntimeRouter;
    upstream?: OfficialConnection;
    mcpArgs: string[];
    activeCalls: number;
    diagnostics: (Diagnostic & { sessionId: string })[];
    diagnose: Diagnose;
    quarantined: boolean;
    quarantine?: Promise<boolean>;
};
type RuntimeDependencies = {
    dataDirectories?: DataDirectoryRegistry;
    profileAvailable?: typeof nativeProfileAvailable;
    createRouter?: (options?: { diagnose?: Diagnose }) => Promise<RuntimeRouter>;
    createHost?: () => ControllerHost;
    createConnection?: typeof createOfficialConnection;
    createEntry?: typeof createMcpEntryServer;
    loadCatalog?: typeof loadOfficialToolCatalog;
};
type ExitNotice = TargetEvent & {
    kind: 'target-exit';
    entryId: string;
    connectionId: string;
    cleanupStatus: 'pending' | 'succeeded' | 'failed';
    cleanupCode?: string;
};
type FailureNotice = {
    kind: 'connection-failure';
    entryId: string;
    connectionId: string;
    sessionId: string;
    code: string;
    reason: string;
    upstreamClosed?: boolean;
};

export async function startPluginRuntime({
    dataDirectories = new DataDirectoryRegistry(),
    profileAvailable = nativeProfileAvailable,
    createRouter = createCdpRouter,
    createHost,
    createConnection = createOfficialConnection,
    createEntry = createMcpEntryServer,
    loadCatalog = loadOfficialToolCatalog,
}: RuntimeDependencies = {}) {
    const entryId = randomUUID();
    const connections = new Map<string, ManagedConnection>();
    const owners = new Set<ConnectionOwner>();
    const directories = new Set<ConnectionDirectory>();
    const portReservations = createPortReservations();
    const makeHost = createHost ?? (() => createTargetHost({ portReservations }));
    const notices = new Map<string, ExitNotice>();
    const failures = new Map<string, FailureNotice>();
    const retirements = new Set<Promise<void>>();
    const starts = new Set<Promise<ConnectionStatus>>();
    const replacements = new Set<Promise<unknown>>();
    let entry: Entry | undefined;
    let fullCatalog: Awaited<ReturnType<typeof loadOfficialToolCatalog>> | undefined;
    let shuttingDown = false;
    let cleanupPromise: Promise<void> | undefined;
    async function retryDirectory(directory: ConnectionDirectory) {
        try {
            await directory.retry();
        } finally {
            if (directory.released) directories.delete(directory);
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
    function noticeKey(connectionId: string, sessionId: string) {
        return `${connectionId}/${sessionId}`;
    }
    function selected(connectionId: string) {
        validateIdentity(connectionId, 'connection ID');
        const connection = connections.get(connectionId);
        if (!connection || connection.owner.retired) throw new Error('The target connection is absent or closed.');
        return connection;
    }
    function routed(route: ConnectionRoute) {
        const connection = selected(route.connectionId);
        if (connection.owner.sessionId !== route.sessionId) throw new Error('The target session is absent or stale.');
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
        return { entryId, connections: [...connections.values()].filter((item) => !item.owner.retired).map(summary) };
    }
    async function disposeResources(owner: ConnectionOwner) {
        try {
            await owner.closeResources();
        } finally {
            if (!owner.hasPendingResources() && owner.retired) owners.delete(owner);
        }
    }
    async function closeUpstream(connection: ManagedConnection, owner = connection.owner) {
        if (connection.owner === owner) delete connection.upstream;
        try {
            await owner.closeResource('upstream');
        } finally {
            if (connection.owner === owner) delete connection.upstream;
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
        if (owner.sessionId !== event.sessionId) return;
        if (event.expected !== 'restart') connection.directory.requestRelease();
        // Target controller already revoked routing and the owner's dependent work.
        lifecycle.cancelRoute({ connectionId: connection.connectionId, sessionId: event.sessionId });
        const key = noticeKey(connection.connectionId, event.sessionId);
        failures.delete(key);
        const notice: ExitNotice = {
            kind: 'target-exit',
            entryId,
            connectionId: connection.connectionId,
            sessionId: event.sessionId,
            reason: event.reason,
            taskActive: event.taskActive,
            processId: event.processId,
            port: event.port,
            targetKind: event.targetKind,
            exitedAt: event.exitedAt,
            ...(event.expected ? { expected: event.expected } : {}),
            ...(event.operationId ? { operationId: event.operationId } : {}),
            ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
            ...(event.signalCode === undefined ? {} : { signalCode: event.signalCode }),
            cleanupStatus: 'pending',
        };
        if (!shuttingDown) notices.set(key, notice);
        const pending = (async () => {
            try {
                await connection.controller.retireExited({ sessionId: event.sessionId });
                notice.cleanupStatus = 'succeeded';
            } catch (error) {
                notice.cleanupStatus = 'failed';
                notice.cleanupCode = 'RESOURCE_CLEANUP_FAILED';
                throw error;
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
    async function ensureUpstream(
        connection: ManagedConnection,
        options: Parameters<Controller['start']>[0],
        context: ControlContext = {},
    ) {
        const owner = connection.owner;
        owner.assertOpen();
        if (connection.upstream) return;
        const gateway = entry;
        const args = buildServerArguments(connection.router.url, process.env, options.mcpArgs);
        connection.mcpArgs = args.slice(1);
        const signal = context.signal ? AbortSignal.any([owner.signal, context.signal]) : owner.signal;
        const acquiring = createConnection(connection.router.url, {
            args,
            signal,
            onAcquired: (resource) => owner.register('upstream', resource),
            ...(gateway?.supportsRoots()
                ? {
                      roots: async () => {
                          owner.assertOpen();
                          const roots = await gateway.roots();
                          owner.assertOpen();
                          return roots;
                      },
                  }
                : {}),
            ...(gateway?.supportsFormElicitation()
                ? {
                      elicitation: {
                          form: true,
                          request: async (params, incoming) => {
                              owner.assertOpen();
                              const result = await gateway.elicit(params, AbortSignal.any([incoming, owner.signal]));
                              owner.assertOpen();
                              return result;
                          },
                      },
                  }
                : {}),
        });
        const upstream = await owner.track(acquiring);
        if (!owner.hasResource('upstream')) owner.register('upstream', upstream);
        if (connection.owner !== owner || owner.retired || signal.aborted || shuttingDown) {
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
            if (connection.owner !== owner || owner.retired || connection.upstream !== upstream) return;
            delete connection.upstream;
            connection.controller.officialDisconnected();
            failures.set(noticeKey(connection.connectionId, owner.sessionId), {
                kind: 'connection-failure',
                entryId,
                connectionId: connection.connectionId,
                sessionId: owner.sessionId,
                code: 'CONNECTION_RECOVERY_REQUIRED',
                reason: 'official-disconnected',
            });
        });
    }
    function hookStatus(hookEventName: HookEventName): Record<string, unknown> {
        const completed = lifecycle.takeNotices(
            (operation) =>
                ![...notices.values()].some(
                    (event) => event.operationId === operation.operationId && event.cleanupStatus === 'pending',
                ),
        );
        const observedExits = [...notices.values()]
            .filter((event) => event.cleanupStatus !== 'pending')
            .map((event) => ({
                kind: event.kind,
                entryId: event.entryId,
                connectionId: event.connectionId,
                sessionId: event.sessionId,
                reason: event.reason,
                taskActive: event.taskActive,
                processId: event.processId,
                port: event.port,
                targetKind: event.targetKind,
                exitedAt: event.exitedAt,
                cleanupStatus: event.cleanupStatus,
                ...(event.expected === undefined ? {} : { expected: event.expected }),
                ...(event.operationId === undefined ? {} : { operationId: event.operationId }),
                ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
                ...(event.signalCode === undefined ? {} : { signalCode: event.signalCode }),
                ...(event.cleanupCode === undefined ? {} : { cleanupCode: event.cleanupCode }),
            }));
        const operations = completed.map((operation) => {
            const exits = observedExits.filter(
                (event) => event.expected && event.operationId === operation.operationId,
            );
            return { ...operation, ...(exits.length ? { exits } : {}) };
        });
        const exits = observedExits.filter((event) => !event.expected || !event.operationId);
        const connectionFailures = [...failures.values()];
        for (const event of [...exits, ...operations.flatMap((operation) => operation.exits ?? [])])
            notices.delete(noticeKey(event.connectionId, event.sessionId));
        failures.clear();
        if (!completed.length && !exits.length && !connectionFailures.length) return {};
        const context =
            'CDP lifecycle events: ' +
            JSON.stringify({ exits, operations, connections: connectionFailures }) +
            (exits.some((event) => event.taskActive && !event.expected)
                ? '\nThe target exited and its old connection/session is closed. Ask the user whether to start a new task with a new start. Never restart or replay automatically.'
                : '') +
            (connectionFailures.length
                ? '\nInspect the connection error and ask before explicit restart or Close; never replay automatically.'
                : '');
        return hookEventName === 'Stop'
            ? { decision: 'block', reason: context }
            : { hookSpecificOutput: { hookEventName, additionalContext: context } };
    }
    async function start(
        options: Parameters<Controller['start']>[0],
        context: ControlContext = {},
    ): Promise<ConnectionStatus> {
        if (shuttingDown) throw new Error('The gateway is closing.');
        context.signal?.throwIfAborted();
        const isolation = parseDataIsolation(options.isolation);
        validateDataIsolationBinding(options.launch, isolation.mode, process.env);
        const host = makeHost();
        host.validateLaunch?.(options);
        if (isolation.mode === 'data-dir') {
            const parsed = resolveLaunchDefinition(
                options.launch,
                options.basePort ?? DEFAULT_BASE_PORT,
                process.env,
                '{dataDir}',
            );
            if (!path.isAbsolute(parsed.executablePath) || (parsed.cwd !== undefined && !path.isAbsolute(parsed.cwd)))
                throw new Error('Application executable and working directory must be absolute.');
        }
        const connectionId = randomUUID();
        const sessionId = randomUUID();
        const initialArgs = buildServerArguments('http://127.0.0.1:1', process.env, options.mcpArgs).slice(1);
        const directory = createConnectionDirectory(
            dataDirectories,
            isolation,
            context.onIsolation,
            options.targetKind === 'chrome' ? profileAvailable : undefined,
        );
        directories.add(directory);
        const owner = newOwner(sessionId, directory);
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
            if (createConnection === createOfficialConnection) await resolveServerBin();
            context.signal?.throwIfAborted();
            if (shuttingDown) throw new Error('The gateway is closing.');
            context.onPhase?.('acquiring-data-directory');
            await directory.acquire();
            context.signal?.throwIfAborted();
            if (shuttingDown) throw new Error('The gateway is closing.');
            const diagnose = diagnoseFor(owner);
            context.onPhase?.('creating-router');
            const router = await createRouter({ diagnose });
            owner.register('router', router);
            context.signal?.throwIfAborted();
            if (shuttingDown) throw new Error('The gateway is closing.');
            const managed: ManagedConnection = {
                connectionId,
                owner,
                directory,
                router,
                diagnostics,
                diagnose,
                mcpArgs: initialArgs,
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
                    createOwner: async (id) => {
                        if (managed.owner.sessionId === id) return managed.owner;
                        const replacement = newOwner(id, directory);
                        managed.owner = replacement;
                        delete managed.upstream;
                        delete managed.quarantine;
                        managed.quarantined = false;
                        const diagnose = diagnoseFor(replacement);
                        const router = await createRouter({ diagnose });
                        replacement.register('router', router);
                        managed.router = router;
                        managed.diagnose = diagnose;
                        replacement.assertOpen();
                        return replacement;
                    },
                    onProcessExit: (event) => observeExit(managed, event),
                    onObservationFailure: (id) => {
                        if (managed.owner.sessionId !== id) return;
                        managed.quarantined = true;
                        failures.set(noticeKey(connectionId, id), {
                            kind: 'connection-failure',
                            entryId,
                            connectionId,
                            sessionId: id,
                            code: 'PROCESS_OBSERVATION_UNAVAILABLE',
                            reason: 'process-monitor-lost',
                        });
                        trackRetirement(closeUpstream(managed));
                    },
                    server: {
                        ensure: (options, context) => ensureUpstream(managed, options, context),
                        close: (selectedOwner = managed.owner) => disposeResources(selectedOwner),
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
                    await disposeResources(failedOwner);
                } catch (cleanupError) {
                    emitFixtureEvent('resource-disposal', 'decision', { outcome: 'failed' }, cleanupError);
                    const failure = new DetailedError(errorMessage(error), { cause: error });
                    failure.details = {
                        ...primaryEvidence,
                        entryId,
                        connectionId,
                        sessionId: failedOwner.sessionId,
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
                sessionId: failedOwner.sessionId,
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
                const connection = routed(request);
                connection.owner.expectedOperationId = context.operationId;
                buildServerArguments(connection.router.url, process.env, request.mcpArgs ?? connection.mcpArgs);
                const releaseSuccessor = connection.directory.holdSuccessor();
                try {
                    const result = await connection.controller.restart(request, {
                        ...context,
                        ...(connection.directory.path === undefined
                            ? {}
                            : { dataDirectory: connection.directory.path }),
                        onSession: (sessionId) =>
                            context.onIdentity?.({ connectionId: request.connectionId, sessionId }),
                    });
                    if (!context.operationId) notices.delete(noticeKey(request.connectionId, request.sessionId));
                    return { ...summary(connection), ...result, connectionId: request.connectionId };
                } catch (error) {
                    connection.directory.requestRelease();
                    const owner = connection.owner;
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
            connection.owner.expectedOperationId = context.operationId;
            if (request.disposition === 'Close') connection.directory.requestRelease();
            const result = await connection.controller.stop(request, context);
            if (request.disposition === 'Close') {
                if (connections.get(request.connectionId) === connection) connections.delete(request.connectionId);
                if (!context.operationId) notices.delete(noticeKey(request.connectionId, request.sessionId));
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
        endTask: async (request) => {
            const connection = routed(request);
            return {
                ...(await connection.controller.endTask(request)),
                connectionId: connection.connectionId,
                upstreamStatus: summary(connection).upstreamStatus ?? 'disconnected',
                enabledToolCount: summary(connection).enabledToolCount ?? 0,
            };
        },
    };
    const lifecycle = createLifecycleService({ entryId, handler });
    function lifecycleResult(details: Record<string, unknown>): CallToolResult {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(details) }],
            structuredContent: details,
        };
    }
    const catalogOwner = newOwner(randomUUID());
    const catalogRouter = await createRouter();
    catalogOwner.register('router', catalogRouter);
    function cleanup() {
        return runFixtureCleanup({ entryId }, performCleanup);
    }
    async function performCleanup() {
        if (cleanupPromise) return cleanupPromise;
        const finishObservation = beginFixtureStage('gateway-cleanup');
        shuttingDown = true;
        for (const directory of directories) directory.requestRelease();
        const closing: Promise<unknown>[] = [];
        const cleaning = new Map<ConnectionOwner, { version: number; joined: boolean }>();
        for (const connection of connections.values()) {
            connection.owner.retire(new Error('The gateway is closing.'));
            connection.router.clearTarget();
            closing.push(
                connection.controller.cleanupOnDisconnect().then((retained) => {
                    if (retained)
                        process.stderr.write(
                            'Target did not close normally; inspect PID ' +
                                retained.processId +
                                ', port ' +
                                retained.port +
                                '.\n',
                        );
                }),
            );
        }
        // Begin all dependent cleanup before waiting on any target or authorization.
        for (const owner of owners) {
            owner.retire(new Error('The gateway is closing.'));
            cleaning.set(owner, { version: owner.resourceVersion, joined: owner.isCleaning() });
            closing.push(owner.retryResources());
        }
        closing.push(lifecycle.close());
        cleanupPromise = (async () => {
            const results = await Promise.allSettled(closing);
            await Promise.allSettled([...starts, ...replacements, ...retirements]);
            // Include resources that arrived while their acquisition was being cancelled.
            await Promise.allSettled(
                [...owners]
                    .filter((owner) => {
                        const initial = cleaning.get(owner);
                        return !initial || initial.joined || initial.version !== owner.resourceVersion;
                    })
                    .map((owner) => owner.retryResources()),
            );
            connections.clear();
            await Promise.allSettled([...directories].map(retryDirectory));
            for (const result of results)
                if (result.status === 'rejected')
                    process.stderr.write(`Gateway cleanup failed: ${errorMessage(result.reason)}\n`);
            finishObservation(results.some((result) => result.status === 'rejected') ? 'failed' : 'succeeded');
        })();
        return cleanupPromise;
    }
    try {
        const catalogConnection = await createConnection(catalogRouter.url, {
            signal: catalogOwner.signal,
            onAcquired: (resource) => catalogOwner.register('upstream', resource),
        });
        if (!catalogOwner.hasResource('upstream')) catalogOwner.register('upstream', catalogConnection);
        fullCatalog = await loadCatalog(catalogConnection.tools);
        fullCatalog.validate(catalogConnection.tools);
        const catalog: Tool[] = fullCatalog.tools;
        await disposeResources(catalogOwner);
        catalogOwner.retire(new Error('Catalog discovery completed.'));
        owners.delete(catalogOwner);
        entry = createEntry({
            tools: catalog,
            status: (hookEventName) => (hookEventName ? hookStatus(hookEventName) : { ...status() }),
            control: async (request, signal) => {
                const result = await lifecycle.control(request, signal);
                const snapshot = isRecord(result.operation) ? result.operation : result;
                if (snapshot.state === 'succeeded' || snapshot.state === 'failed' || snapshot.state === 'cancelled') {
                    for (const [key, event] of notices) {
                        if (event.expected && event.operationId === snapshot.operationId) notices.delete(key);
                    }
                    if (typeof snapshot.connectionId === 'string' && typeof snapshot.sessionId === 'string') {
                        const key = noticeKey(snapshot.connectionId, snapshot.sessionId);
                        const exit = notices.get(key);
                        const error = isRecord(snapshot.error) ? snapshot.error : undefined;
                        if (exit?.expected || error?.processExited === true) notices.delete(key);
                    }
                }
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
                              workspace: workspaceSources(connection.mcpArgs, entry?.supportsRoots() ?? false),
                              isolation: connection.directory.evidence(),
                          }
                        : {}),
                    ...(request.include?.includes('diagnostics') ? { diagnostics: [...connection.diagnostics] } : {}),
                };
            },
            onRootsChanged: async () => {
                await Promise.allSettled(
                    [...connections.values()]
                        .filter((item) => !item.owner.retired)
                        .map(async (item) => {
                            const owner = item.owner;
                            owner.assertOpen();
                            await item.upstream?.rootsChanged();
                            owner.assertOpen();
                        }),
                );
            },
            invoke: async (name, arguments_, signal, onProgress) => {
                const route = parseConnectionRoute(arguments_._dct);
                signal.throwIfAborted();
                const connection = routed(route);
                const owner = connection.owner;
                if (connection.upstream && !connection.upstream.tools.some((tool) => tool.name === name))
                    return lifecycleResult({
                        code: 'TOOL_NOT_ENABLED',
                        entryId,
                        ...route,
                        ...fullCatalog?.requirements(name, connection.mcpArgs, true),
                        nextAction: 'explicit-start-or-restart',
                    });
                connection.controller.beginTask(route);
                const healthTiming = measured(connection.diagnose, 'connection-health');
                await connection.controller.checkHealth();
                healthTiming();
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
                const callSignal = AbortSignal.any([signal, owner.signal]);
                callSignal.throwIfAborted();
                connection.activeCalls += 1;
                const upstreamTiming = measured(connection.diagnose, 'upstream-processing');
                try {
                    const result = await upstream.call(name, upstreamArguments, callSignal, (progress) => {
                        if (
                            connection.owner === owner &&
                            !owner.retired &&
                            !callSignal.aborted &&
                            connection.upstream === upstream
                        )
                            onProgress(progress);
                    });
                    owner.assertOpen();
                    routed(route);
                    callSignal.throwIfAborted();
                    upstreamTiming();
                    measured(connection.diagnose, 'result-ready')();
                    return result;
                } catch (error) {
                    const reason = interruptedOfficialCall(error, callSignal);
                    upstreamTiming(reason ? 'interrupted' : 'failed');
                    if (owner.retired || connection.owner !== owner)
                        throw new Error('The target session exited or closed during the official call.');
                    if (!reason) throw error;
                    connection.quarantined = true;
                    connection.controller.quarantine(reason);
                    if (!connection.quarantine)
                        connection.quarantine = closeUpstream(connection, owner).then(
                            () => true,
                            () => false,
                        );
                    const quarantine = connection.quarantine;
                    const upstreamClosed = await quarantine;
                    if (connection.quarantine === quarantine) delete connection.quarantine;
                    if (owner.retired || connection.owner !== owner)
                        throw new Error('The target session exited during upstream cleanup.');
                    const details = {
                        code: 'CONNECTION_RECOVERY_REQUIRED',
                        ...summary(connection),
                        reason,
                        upstreamClosed,
                        nextAction: 'explicit-restart-or-close',
                    };
                    failures.set(noticeKey(connection.connectionId, owner.sessionId), {
                        kind: 'connection-failure',
                        entryId,
                        connectionId: connection.connectionId,
                        sessionId: owner.sessionId,
                        code: details.code,
                        reason,
                        upstreamClosed,
                    });
                    return lifecycleResult(details);
                } finally {
                    connection.activeCalls -= 1;
                }
            },
        });
        await entry.connect();
        const selectedEntry = entry;
        const closed = selectedEntry.closed.then(cleanup);
        return {
            entryId,
            controller: handler,
            closed,
            async close() {
                await selectedEntry.close();
                await cleanup();
            },
        };
    } catch (error) {
        try {
            await entry?.close();
        } finally {
            await cleanup();
        }
        throw error;
    }
}
