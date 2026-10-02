import { randomUUID } from 'node:crypto';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { createCdpRouter } from '../adapters/cdp-router.ts';
import { createControlServer } from '../adapters/control-ipc.ts';
import { createOfficialConnection, type OfficialConnection } from '../adapters/mcp-bridge.ts';
import { createMcpEntryServer, type HookEventName } from '../adapters/mcp-entry-server.ts';
import { createTargetHost } from '../adapters/target-host.ts';
import {
    type ConnectionRoute,
    type ConnectionStatus,
    type ControlHandler,
    type GatewayStatus,
    parseConnectionRoute,
    validateIdentity,
} from '../domains/control-contract.ts';
import { DetailedError, errorDetails, errorMessage } from '../shared/errors.ts';
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
    closingUpstream?: OfficialConnection;
    failedStartupSessionId?: string;
    removal?: Promise<void>;
    retainedStatus?: ConnectionStatus;
};
type RuntimeDependencies = {
    createRouter?: () => Promise<RuntimeRouter>;
    createHost?: () => ControllerHost;
    createControl?: (options: { controller: ControlHandler; entryId: string }) => Promise<{ close(): Promise<void> }>;
    createConnection?: typeof createOfficialConnection;
    createEntry?: typeof createMcpEntryServer;
};

export async function startPluginRuntime({
    createRouter = createCdpRouter,
    createHost = createTargetHost,
    createControl = createControlServer,
    createConnection = createOfficialConnection,
    createEntry = createMcpEntryServer,
}: RuntimeDependencies = {}) {
    const entryId = randomUUID();
    const connections = new Map<string, ManagedConnection>();
    let entry: Entry | undefined;
    let control: { close(): Promise<void> } | undefined;
    let catalog: Tool[] = [];
    let catalogConnection: OfficialConnection | undefined;
    let catalogRouterClosed = false;
    let catalogCleanupError: string | undefined;
    let cleanupPromise: Promise<void> | undefined;
    const notices = new Map<string, TargetEvent>();
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
    async function ensureUpstream(connection: ManagedConnection) {
        if (connection.upstream) return;
        const gateway = entry;
        const upstream = await createConnection(connection.router.url, {
            ...(gateway?.supportsRoots() ? { roots: () => gateway.roots() } : {}),
            ...(gateway?.supportsFormElicitation()
                ? { elicitation: { form: true, request: (params, signal) => gateway.elicit(params, signal) } }
                : {}),
        });
        connection.upstream = upstream;
        if (JSON.stringify(upstream.tools) !== JSON.stringify(catalog)) {
            await closeUpstream(connection);
            throw new Error('The official tool catalog changed. Reconnect this entry before starting a target.');
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
        if (!messages.length) return {};
        const context =
            'CDP target process exited during active work. ' +
            messages.join('\n') +
            '\nAsk the user whether to restart or end dependent work. Never restart or replay tools automatically; other connections remain independent.';
        return hookEventName === 'Stop'
            ? { decision: 'block', reason: context }
            : { hookSpecificOutput: { hookEventName, additionalContext: context } };
    }
    async function start(options: Parameters<Controller['start']>[0]): Promise<ConnectionStatus> {
        if (shuttingDown) throw new Error('The gateway is closing.');
        const connectionId = randomUUID();
        const sessionId = randomUUID();
        const router = await createRouter();
        const connection: ManagedConnection = {
            connectionId,
            router,
            controller: createTargetController({
                entryId,
                router,
                host: createHost(),
                onProcessExit: (event) => observeExit(connection, event),
                server: { ensure: () => ensureUpstream(connection), close: () => closeUpstream(connection) },
            }),
        };
        connections.set(connectionId, connection);
        try {
            await connection.controller.start(options, sessionId);
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
            const retained = new DetailedError(errorMessage(error));
            retained.details = { ...errorDetails(error), ...statusOf(connection) };
            throw retained;
        }
    }
    const handler: ControlHandler = {
        status,
        start: (options) => {
            const pending = start(options);
            starts.add(pending);
            void pending.finally(() => starts.delete(pending)).catch(() => {});
            return pending;
        },
        restart: async (request) => {
            const connection = routed(request);
            clearNotice(connection, request.sessionId);
            const result = await connection.controller.restart(request);
            return { ...result, connectionId: connection.connectionId };
        },
        stop: async (request) => {
            const connection = routed(request);
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
            const results = await Promise.allSettled(
                [...connections.values()].map(async (connection) => {
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
                }),
            );
            connections.clear();
            await control?.close();
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
        await closeCatalogConnection();
        await closeCatalogRouter();
        entry = createEntry({
            tools: catalog,
            status: (hookEventName) => (hookEventName ? hookStatus(hookEventName) : { ...status() }),
            onRootsChanged: async () => {
                await Promise.all([...connections.values()].map((connection) => connection.upstream?.rootsChanged()));
            },
            invoke: async (name, arguments_, signal, onProgress) => {
                const route = parseConnectionRoute(arguments_._dct);
                const connection = routed(route);
                connection.controller.beginTask(route);
                await connection.controller.checkHealth();
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
                return connection.upstream.call(name, upstreamArguments, signal, onProgress);
            },
        });
        control = await createControl({ entryId, controller: handler });
        await entry.connect();
        const selectedEntry = entry;
        const closed = selectedEntry.closed.then(cleanup);
        return {
            entryId,
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
