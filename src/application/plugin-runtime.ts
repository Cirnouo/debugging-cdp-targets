import { randomUUID } from 'node:crypto';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { createCdpRouter } from '../adapters/cdp-router.ts';
import { createControlServer } from '../adapters/control-ipc.ts';
import { createOfficialConnection, type OfficialConnection } from '../adapters/mcp-bridge.ts';
import { createMcpEntryServer } from '../adapters/mcp-entry-server.ts';
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
type Prompt = { abort: AbortController; result: Promise<string>; subscribers: number; settled: boolean };
type Controller = ReturnType<typeof createTargetController>;
type ManagedConnection = {
    connectionId: string;
    controller: Controller;
    router: RuntimeRouter;
    upstream?: OfficialConnection;
    closingUpstream?: OfficialConnection;
    failedStartupSessionId?: string;
    prompts: Map<string, Prompt>;
};
type RuntimeDependencies = {
    createRouter?: () => Promise<RuntimeRouter>;
    createHost?: () => ControllerHost;
    createControl?: (options: { controller: ControlHandler; entryId: string }) => Promise<{ close(): Promise<void> }>;
    createConnection?: typeof createOfficialConnection;
    createEntry?: typeof createMcpEntryServer;
    pollIntervalMs?: number;
    watchLeaseMs?: number;
};

export async function startPluginRuntime({
    createRouter = createCdpRouter,
    createHost = createTargetHost,
    createControl = createControlServer,
    createConnection = createOfficialConnection,
    createEntry = createMcpEntryServer,
    pollIntervalMs = 1_000,
    watchLeaseMs = 25_000,
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
    let polling: ReturnType<typeof setInterval> | undefined;
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
    function abortPrompts(connection: ManagedConnection, sessionId?: string) {
        if (sessionId) {
            connection.prompts.get(sessionId)?.abort.abort();
            connection.prompts.delete(sessionId);
        } else {
            for (const prompt of connection.prompts.values()) prompt.abort.abort();
            connection.prompts.clear();
        }
    }
    async function remove(connection: ManagedConnection) {
        abortPrompts(connection);
        await connection.router.close();
        connections.delete(connection.connectionId);
    }
    async function start(options: Parameters<Controller['start']>[0]): Promise<ConnectionStatus> {
        if (shuttingDown) throw new Error('The gateway is closing.');
        const connectionId = randomUUID();
        const sessionId = randomUUID();
        const router = await createRouter();
        const connection: ManagedConnection = {
            connectionId,
            router,
            prompts: new Map(),
            controller: createTargetController({
                entryId,
                router,
                host: createHost(),
                server: { ensure: () => ensureUpstream(connection), close: () => closeUpstream(connection) },
            }),
        };
        connections.set(connectionId, connection);
        try {
            await connection.controller.start(
                { ...options, profileKey: options.profileKey ?? `${connectionId}-${sessionId}` },
                sessionId,
            );
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
            const result = await connection.controller.restart(request);
            abortPrompts(connection, request.sessionId);
            return { ...result, connectionId: connection.connectionId };
        },
        stop: async (request) => {
            const connection = routed(request);
            if (connection.failedStartupSessionId) {
                if (request.disposition !== 'Close')
                    throw new Error('The retained startup requires an explicit Close retry.');
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
            const result = await connection.controller.stop(request);
            abortPrompts(connection, request.sessionId);
            if (result.status === 'idle') {
                try {
                    await remove(connection);
                } catch (error) {
                    connection.failedStartupSessionId = request.sessionId;
                    const retained = new DetailedError(errorMessage(error));
                    retained.details = { ...statusOf(connection) };
                    throw retained;
                }
            }
            return { ...result, connectionId: connection.connectionId };
        },
        endTask: async (request) => {
            const connection = routed(request);
            const result = await connection.controller.endTask(request);
            abortPrompts(connection, request.sessionId);
            return { ...result, connectionId: connection.connectionId };
        },
    };
    async function ask(connection: ManagedConnection, event: TargetEvent, signal: AbortSignal) {
        if (signal.aborted) return 'pending';
        let prompt = connection.prompts.get(event.sessionId);
        if (prompt) return waitForChoice(prompt, signal);
        const abort = new AbortController();
        const record: Prompt = { abort, result: Promise.resolve('pending'), subscribers: 0, settled: false };
        record.result = Promise.resolve()
            .then(async () => {
                const current = statusOf(connection);
                const gateway = entry;
                if (
                    !gateway ||
                    current.sessionId !== event.sessionId ||
                    current.status !== 'lost' ||
                    abort.signal.aborted
                )
                    return 'pending';
                const choice = await gateway.askLoss(
                    `调试目标 ${current.targetKind}（PID ${current.processId}，连接 ${connection.connectionId}，会话 ${event.sessionId}）已断开（${event.reason}）。这是误关闭还是有意关闭？误关闭可用原 CDP 端口 ${current.port}、原启动参数和配置重新启动；有意关闭将终止依赖此目标的任务。`,
                    abort.signal,
                );
                return abort.signal.aborted ? 'pending' : choice;
            })
            .then((choice) => {
                if (choice === 'pending' && connection.prompts.get(event.sessionId) === record)
                    connection.prompts.delete(event.sessionId);
                return choice;
            })
            .finally(() => {
                record.settled = true;
            });
        prompt = record;
        connection.prompts.set(event.sessionId, prompt);
        return waitForChoice(prompt, signal);
    }
    function waitForChoice(prompt: Prompt, signal: AbortSignal): Promise<string> {
        prompt.subscribers += 1;
        return new Promise((resolve) => {
            let done = false;
            function finish(choice: string) {
                if (done) return;
                done = true;
                signal.removeEventListener('abort', aborted);
                prompt.subscribers -= 1;
                if (!prompt.settled && prompt.subscribers === 0) prompt.abort.abort();
                resolve(signal.aborted ? 'pending' : choice);
            }
            function aborted() {
                finish('pending');
            }
            signal.addEventListener('abort', aborted, { once: true });
            void prompt.result.then(finish, () => finish('pending'));
            if (signal.aborted) aborted();
        });
    }
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
            if (polling) clearInterval(polling);
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
                    abortPrompts(connection);
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
            status: () => ({ ...status() }),
            onRootsChanged: async () => {
                await Promise.all([...connections.values()].map((connection) => connection.upstream?.rootsChanged()));
            },
            watch: async (route, signal) => {
                const connection = routed(parseConnectionRoute(route));
                const lease = new AbortController();
                const aborted = () => lease.abort();
                signal.addEventListener('abort', aborted, { once: true });
                if (signal.aborted) lease.abort();
                let expired = false;
                const timer = setTimeout(() => {
                    expired = true;
                    lease.abort();
                }, watchLeaseMs);
                try {
                    const event = await connection.controller.watchTarget(lease.signal);
                    if (event.reason === 'task-ended')
                        return { ...statusOf(connection), reason: expired ? 'watch-renew' : 'task-ended' };
                    const choice = await ask(connection, event, signal);
                    return {
                        ...statusOf(connection),
                        event,
                        choice,
                        nextAction: choice === 'restart' ? 'restart' : choice === 'cancel' ? 'stop-Close' : 'ask-user',
                    };
                } finally {
                    clearTimeout(timer);
                    signal.removeEventListener('abort', aborted);
                }
            },
            invoke: async (name, arguments_, signal, onProgress) => {
                const route = parseConnectionRoute(arguments_._dct);
                const connection = routed(route);
                await connection.controller.checkHealth();
                routed(route);
                const current = statusOf(connection);
                if (current.status === 'lost' && current.sessionId) {
                    const event = { sessionId: current.sessionId, reason: current.reason ?? 'target-unavailable' };
                    return lifecycleResult({
                        ...current,
                        choice: await ask(connection, event, signal),
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
        polling = setInterval(() => {
            for (const connection of connections.values()) void connection.controller.checkHealth().catch(() => {});
        }, pollIntervalMs);
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
