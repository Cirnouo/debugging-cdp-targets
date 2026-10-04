import { randomUUID } from 'node:crypto';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { createCdpRouter } from '../adapters/cdp-router.ts';
import { createOfficialConnection, interruptedOfficialCall, type OfficialConnection } from '../adapters/mcp-bridge.ts';
import { createMcpEntryServer, type HookEventName } from '../adapters/mcp-entry-server.ts';
import { buildServerArguments } from '../adapters/official-server.ts';
import { createTargetHost } from '../adapters/target-host.ts';
import { loadOfficialToolCatalog, workspaceSources } from '../adapters/tool-catalog.ts';
import {
    type ConnectionRoute,
    type ConnectionStatus,
    type ControlContext,
    type ControlHandler,
    type GatewayStatus,
    parseConnectionRoute,
    validateIdentity,
} from '../domains/control-contract.ts';
import { type Diagnose, type Diagnostic, measured } from '../shared/diagnostics.ts';
import { DetailedError, errorDetails, errorMessage } from '../shared/errors.ts';
import { createLifecycleService } from './mcp-lifecycle.ts';
import type { ControllerHost, ControllerRouter, TargetEvent } from './target-controller.ts';
import { createTargetController } from './target-controller.ts';

type RuntimeRouter = ControllerRouter & { url: string; close(): Promise<void> };
type Entry = ReturnType<typeof createMcpEntryServer>;
type Controller = ReturnType<typeof createTargetController>;
type ManagedConnection = {
    connectionId: string;
    controller: Controller;
    router: RuntimeRouter;
    upstream?: OfficialConnection;
    mcpArgs?: string[];
    closingUpstream?: OfficialConnection;
    failedStartupSessionId?: string;
    removal?: Promise<void>;
    retainedStatus?: ConnectionStatus;
    activeCalls: number;
    diagnostics: (Diagnostic & { sessionId: string })[];
    diagnose: Diagnose;
    quarantine?: Promise<boolean>;
};
type RuntimeDependencies = {
    createRouter?: (options?: { diagnose?: Diagnose }) => Promise<RuntimeRouter>;
    createHost?: () => ControllerHost;
    createConnection?: typeof createOfficialConnection;
    createEntry?: typeof createMcpEntryServer;
    loadCatalog?: typeof loadOfficialToolCatalog;
};

export async function startPluginRuntime({
    createRouter = createCdpRouter,
    createHost = createTargetHost,
    createConnection = createOfficialConnection,
    createEntry = createMcpEntryServer,
    loadCatalog = loadOfficialToolCatalog,
}: RuntimeDependencies = {}) {
    const entryId = randomUUID();
    const connections = new Map<string, ManagedConnection>();
    let entry: Entry | undefined;
    let catalog: Tool[] = [];
    let fullCatalog: Awaited<ReturnType<typeof loadOfficialToolCatalog>> | undefined;
    let catalogConnection: OfficialConnection | undefined;
    let catalogRouterClosed = false;
    let catalogCleanupError: string | undefined;
    let cleanupPromise: Promise<void> | undefined;
    const notices = new Map<string, TargetEvent>();
    const connectionNotices = new Map<string, Record<string, unknown>>();
    const retirements = new Set<Promise<void>>();
    let shuttingDown = false;
    const starts = new Set<Promise<ConnectionStatus>>();
    function selected(connectionId: string) {
        validateIdentity(connectionId, 'connection ID');
        const connection = connections.get(connectionId);
        if (!connection) throw new Error('The target connection is absent or closed.');
        return connection;
    }
    function routed(route: ConnectionRoute) {
        const connection = selected(route.connectionId);
        if (statusOf(connection).sessionId !== route.sessionId)
            throw new Error('The target session is absent or stale.');
        return connection;
    }
    function statusOf(connection: ManagedConnection): ConnectionStatus {
        return {
            ...connection.controller.status(),
            connectionId: connection.connectionId,
            mcpArgs: connection.mcpArgs ?? [],
            enabledTools: connection.upstream?.tools.map((tool) => tool.name) ?? [],
            workspace: workspaceSources(connection.mcpArgs ?? [], entry?.supportsRoots() ?? false),
            diagnostics: [...connection.diagnostics],
            ...(connection.failedStartupSessionId
                ? { sessionId: connection.failedStartupSessionId, reason: 'startup-cleanup-failed' }
                : {}),
            ...connection.retainedStatus,
        };
    }
    function status(): GatewayStatus;
    function status(connectionId: string): ConnectionStatus;
    function status(connectionId?: string): GatewayStatus | ConnectionStatus {
        if (connectionId !== undefined) return statusOf(selected(connectionId));
        return { entryId, connections: [...connections.values()].map(statusOf) };
    }
    async function closeUpstream(connection: ManagedConnection) {
        const upstream = connection.upstream;
        if (!upstream) return;
        connection.closingUpstream = upstream;
        try {
            await upstream.close();
            if (connection.upstream === upstream) delete connection.upstream;
        } finally {
            delete connection.closingUpstream;
        }
    }
    async function ensureUpstream(connection: ManagedConnection, options: Parameters<Controller['start']>[0]) {
        if (connection.upstream) return;
        const gateway = entry;
        const args = buildServerArguments(connection.router.url, process.env, options.mcpArgs);
        const upstream = await createConnection(connection.router.url, {
            args,
            ...(gateway?.supportsRoots() ? { roots: () => gateway.roots() } : {}),
            ...(gateway?.supportsFormElicitation()
                ? { elicitation: { form: true, request: (params, signal) => gateway.elicit(params, signal) } }
                : {}),
        });
        connection.upstream = upstream;
        connection.mcpArgs = args.slice(1);
        try {
            if (!fullCatalog) throw new Error('Missing fixed tool catalog.');
            fullCatalog.validate(upstream.tools);
        } catch (error) {
            await closeUpstream(connection);
            throw error;
        }
        upstream.onExit(() => {
            if (connection.upstream !== upstream || connection.closingUpstream === upstream) return;
            delete connection.upstream;
            connection.controller.officialDisconnected();
        });
    }
    function clearNotice(connection: ManagedConnection, sessionId?: string) {
        if (!sessionId || notices.get(connection.connectionId)?.sessionId === sessionId)
            notices.delete(connection.connectionId);
        if (!sessionId || connectionNotices.get(connection.connectionId)?.sessionId === sessionId)
            connectionNotices.delete(connection.connectionId);
    }
    async function remove(connection: ManagedConnection) {
        if (connections.get(connection.connectionId) !== connection) return;
        clearNotice(connection);
        if (!connection.removal) {
            connection.removal = connection.router.close().then(() => {
                if (connections.get(connection.connectionId) === connection)
                    connections.delete(connection.connectionId);
            });
        }
        try {
            await connection.removal;
        } catch (error) {
            delete connection.removal;
            throw error;
        }
    }
    async function removeRetired(connection: ManagedConnection, previous: ConnectionStatus) {
        try {
            await remove(connection);
        } catch (error) {
            if (previous.sessionId) connection.failedStartupSessionId = previous.sessionId;
            connection.retainedStatus = {
                ...previous,
                status: 'close-failed',
                taskActive: false,
                reason: 'router-close-failed',
            };
            const retained = new DetailedError(errorMessage(error));
            retained.details = { ...statusOf(connection) };
            throw retained;
        }
    }
    function observeExit(connection: ManagedConnection, event: TargetEvent) {
        if (shuttingDown || connections.get(connection.connectionId) !== connection) return;
        if (event.taskActive) {
            notices.set(connection.connectionId, event);
            return;
        }
        clearNotice(connection, event.sessionId);
        const previous = statusOf(connection);
        const pending = (async () => {
            const result = await connection.controller.retireExited({ sessionId: event.sessionId });
            if (result.status === 'idle') await removeRetired(connection, previous);
        })();
        retirements.add(pending);
        void pending
            .catch((error: unknown) => {
                process.stderr.write(
                    'Retired target connection cleanup failed: ' +
                        connection.connectionId +
                        ': ' +
                        errorMessage(error) +
                        '\n',
                );
            })
            .finally(() => retirements.delete(pending));
    }
    function hookStatus(hookEventName: HookEventName): Record<string, unknown> {
        const messages: string[] = [];
        const completed = lifecycle.takeNotices().filter((operation) => {
            if (!operation.connectionId || !operation.sessionId) return true;
            const current = connections.get(operation.connectionId);
            return !current || statusOf(current).sessionId === operation.sessionId;
        });
        const failures = [...connectionNotices.values()];
        connectionNotices.clear();
        for (const [connectionId, event] of notices) {
            notices.delete(connectionId);
            const connection = connections.get(connectionId);
            if (!connection) continue;
            const current = statusOf(connection);
            if (current.sessionId !== event.sessionId || !current.taskActive || current.reason !== 'process-exited')
                continue;
            messages.push(
                JSON.stringify({
                    entryId,
                    connectionId,
                    sessionId: event.sessionId,
                    targetKind: current.targetKind,
                    processId: current.processId,
                    port: current.port,
                    reason: event.reason,
                }),
            );
        }
        if (!messages.length && !completed.length && !failures.length) return {};
        const context =
            (messages.length ? 'CDP target process exited during active work. ' : '') +
            messages.join('\n') +
            (messages.length
                ? '\nAsk the user whether to restart or end dependent work. Never restart or replay tools automatically; other connections remain independent.'
                : '') +
            (completed.length ? `\nCDP lifecycle operation results: ${JSON.stringify(completed)}` : '') +
            (failures.length
                ? '\nCDP connection requires explicit recovery; never restart or replay tools automatically. ' +
                  JSON.stringify(failures)
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
        buildServerArguments('http://127.0.0.1:1', process.env, options.mcpArgs);
        const connectionId = randomUUID();
        const sessionId = randomUUID();
        context.onIdentity?.({ connectionId, sessionId });
        const diagnostics: (Diagnostic & { sessionId: string })[] = [];
        const diagnose: Diagnose = (event) => {
            diagnostics.push({ ...event, sessionId: connection.controller.status().sessionId ?? sessionId });
            if (diagnostics.length > 64) diagnostics.shift();
        };
        const router = await createRouter({ diagnose });
        const connection: ManagedConnection = {
            connectionId,
            activeCalls: 0,
            diagnostics,
            diagnose,
            router,
            controller: createTargetController({
                entryId,
                router,
                host: createHost(),
                onProcessExit: (event) => observeExit(connection, event),
                server: {
                    ensure: (options) => ensureUpstream(connection, options),
                    close: () => closeUpstream(connection),
                },
            }),
        };
        connections.set(connectionId, connection);
        try {
            await connection.controller.start(options, sessionId, context);
            return statusOf(connection);
        } catch (error) {
            if (connection.controller.status().status === 'idle') {
                try {
                    await closeUpstream(connection);
                    await remove(connection);
                } catch (cleanupError) {
                    connection.failedStartupSessionId = sessionId;
                    const retained = new DetailedError(errorMessage(error));
                    retained.details = {
                        ...errorDetails(error),
                        ...statusOf(connection),
                        cleanupError: errorMessage(cleanupError),
                    };
                    throw retained;
                }
            }
            if (context.signal?.aborted && error === context.signal.reason && !connections.has(connectionId))
                throw error;
            const retained = new DetailedError(errorMessage(error));
            retained.details = { ...errorDetails(error), ...statusOf(connection) };
            throw retained;
        }
    }
    const handler: ControlHandler = {
        status,
        start: (options, context) => {
            const pending = start(options, context);
            starts.add(pending);
            void pending.finally(() => starts.delete(pending)).catch(() => {});
            return pending;
        },
        restart: async (request, context = {}) => {
            const connection = routed(request);
            if (connection.quarantine) await connection.quarantine;
            if (connection.activeCalls) throw new Error('An official request is still running for this connection.');
            buildServerArguments(connection.router.url, process.env, request.mcpArgs ?? connection.mcpArgs);
            clearNotice(connection, request.sessionId);
            const result = await connection.controller.restart(request, {
                ...context,
                onSession: (sessionId) => context.onIdentity?.({ connectionId: request.connectionId, sessionId }),
            });
            return { ...statusOf(connection), ...result, connectionId: connection.connectionId };
        },
        stop: async (request) => {
            const connection = routed(request);
            if (connection.quarantine) await connection.quarantine;
            if (request.disposition === 'Close' && connection.activeCalls)
                throw new Error('An official request is still running for this connection.');
            if (connection.failedStartupSessionId) {
                if (request.disposition !== 'Close')
                    throw new Error('The retained connection requires an explicit Close retry.');
                await closeUpstream(connection);
                await remove(connection);
                return {
                    entryId,
                    connectionId: connection.connectionId,
                    status: 'idle',
                    disposition: 'Close',
                    pageIdsInvalidated: true,
                };
            }
            const previous = statusOf(connection);
            const result = await connection.controller.stop(request);
            clearNotice(connection, request.sessionId);
            if (result.status === 'idle') await removeRetired(connection, previous);
            return { ...result, connectionId: connection.connectionId };
        },
        endTask: async (request) => {
            const connection = routed(request);
            clearNotice(connection, request.sessionId);
            const previous = statusOf(connection);
            const result = await connection.controller.endTask(request);
            if (result.status === 'idle') await removeRetired(connection, previous);
            return { ...result, connectionId: connection.connectionId };
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
    async function cleanup() {
        if (cleanupPromise) return cleanupPromise;
        shuttingDown = true;
        cleanupPromise = (async () => {
            notices.clear();
            const operationsClosed = lifecycle.close();
            const closingTargets = new Map<string, Promise<PromiseSettledResult<void>>>();
            function closeTarget(connection: ManagedConnection) {
                const previous = closingTargets.get(connection.connectionId);
                if (previous) return previous;
                const closing = (async () => {
                    clearNotice(connection);
                    try {
                        const retained = await connection.controller.cleanupOnDisconnect();
                        if (retained)
                            process.stderr.write(
                                `Target connection ${connection.connectionId} did not close normally; inspect PID ${retained.processId}, port ${retained.port}.\n`,
                            );
                    } finally {
                        await connection.router.close();
                    }
                })().then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
                    () => ({ status: 'fulfilled', value: undefined }),
                    (reason) => ({ status: 'rejected', reason }),
                );
                closingTargets.set(connection.connectionId, closing);
                return closing;
            }
            // Authorization may still require a user's OS response. Unrelated live
            // connections begin normal cleanup immediately, without waiting for it.
            for (const connection of connections.values())
                if (connection.controller.status().processId) void closeTarget(connection);
            await operationsClosed;
            await Promise.allSettled([...retirements]);
            try {
                await closeCatalogConnection();
            } catch (error) {
                catalogCleanupError = errorMessage(error);
                process.stderr.write(`Catalog upstream cleanup failed for entry ${entryId}: ${catalogCleanupError}\n`);
            } finally {
                await closeCatalogRouter();
            }
            await Promise.allSettled([...starts]);
            for (const connection of connections.values()) void closeTarget(connection);
            const results = await Promise.all(closingTargets.values());
            connections.clear();
            for (const result of results)
                if (result.status === 'rejected')
                    process.stderr.write(`Target cleanup failed: ${errorMessage(result.reason)}\n`);
        })();
        return cleanupPromise;
    }
    const catalogRouter = await createRouter();
    async function closeCatalogConnection() {
        const selected = catalogConnection;
        if (!selected) return;
        await selected.close();
        if (catalogConnection === selected) catalogConnection = undefined;
    }
    async function closeCatalogRouter() {
        if (catalogRouterClosed) return;
        await catalogRouter.close();
        catalogRouterClosed = true;
    }
    try {
        catalogConnection = await createConnection(catalogRouter.url);
        catalog = catalogConnection.tools;
        fullCatalog = await loadCatalog(catalog);
        fullCatalog.validate(catalog);
        catalog = fullCatalog.tools;
        await closeCatalogConnection();
        await closeCatalogRouter();
        entry = createEntry({
            tools: catalog,
            status: (hookEventName) => (hookEventName ? hookStatus(hookEventName) : { ...status() }),
            control: async (request, signal) => {
                const result = await lifecycle.control(request, signal);
                if (request.action !== 'status' || !fullCatalog) return result;
                const connection = request.connectionId ? selected(request.connectionId) : undefined;
                return {
                    ...result,
                    ...(request.operationId
                        ? {}
                        : {
                              toolAvailability: fullCatalog.describe(
                                  connection?.mcpArgs ?? buildServerArguments('http://127.0.0.1:1').slice(1),
                                  connection?.upstream?.tools,
                                  request.toolNames,
                              ),
                          }),
                };
            },
            onRootsChanged: async () => {
                await Promise.all([...connections.values()].map((connection) => connection.upstream?.rootsChanged()));
            },
            invoke: async (name, arguments_, signal, onProgress) => {
                const route = parseConnectionRoute(arguments_._dct);
                signal.throwIfAborted();
                const connection = routed(route);
                if (connection.upstream && !connection.upstream.tools.some((tool) => tool.name === name))
                    return lifecycleResult({
                        code: 'TOOL_NOT_ENABLED',
                        entryId,
                        ...route,
                        ...fullCatalog?.requirements(name, connection.mcpArgs ?? []),
                        nextAction: 'explicit-start-or-restart',
                    });
                connection.controller.beginTask(route);
                const healthTiming = measured(connection.diagnose, 'connection-health');
                await connection.controller.checkHealth();
                healthTiming();
                routed(route);
                const current = statusOf(connection);
                if (current.status === 'lost' && current.sessionId) {
                    return lifecycleResult({
                        ...current,
                        nextAction: current.reason === 'process-exited' ? 'ask-user' : 'inspect-connection-error',
                        pageIdsInvalidated: true,
                    });
                }
                if (!connection.controller.canInvoke() || !connection.upstream)
                    return lifecycleResult({ ...current, reason: 'target-not-ready' });
                const { _dct: routing, ...upstreamArguments } = arguments_;
                void routing;
                signal.throwIfAborted();
                connection.activeCalls += 1;
                const upstreamTiming = measured(connection.diagnose, 'upstream-processing');
                try {
                    const result = await connection.upstream.call(name, upstreamArguments, signal, onProgress);
                    upstreamTiming();
                    measured(connection.diagnose, 'result-ready')();
                    return result;
                } catch (error) {
                    const reason = interruptedOfficialCall(error, signal);
                    upstreamTiming(reason ? 'interrupted' : 'failed');
                    if (!reason || statusOf(connection).sessionId !== route.sessionId) throw error;
                    connection.controller.quarantine(reason);
                    if (!connection.quarantine) {
                        connection.quarantine = closeUpstream(connection).then(
                            () => true,
                            () => false,
                        );
                    }
                    const quarantine = connection.quarantine;
                    const upstreamClosed = await quarantine;
                    if (connection.quarantine === quarantine) delete connection.quarantine;
                    const details = {
                        code: 'CONNECTION_RECOVERY_REQUIRED',
                        ...statusOf(connection),
                        reason,
                        upstreamClosed,
                        nextAction: 'explicit-restart-or-close',
                    };
                    connectionNotices.set(connection.connectionId, details);
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
        if (catalogConnection) {
            const retained = new DetailedError(errorMessage(error));
            retained.details = {
                ...errorDetails(error),
                entryId,
                catalogUpstreamRetained: true,
                cleanupError: catalogCleanupError,
            };
            throw retained;
        }
        throw error;
    }
}
