import { randomUUID } from 'node:crypto';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { createCdpRouter } from '../adapters/cdp-router.ts';
import { createControlServer } from '../adapters/control-ipc.ts';
import { createOfficialConnection, type OfficialConnection } from '../adapters/mcp-bridge.ts';
import { createMcpEntryServer } from '../adapters/mcp-entry-server.ts';
import { createTargetHost } from '../adapters/target-host.ts';
import type { ControlHandler } from '../domains/control-contract.ts';
import type { ControllerHost, ControllerRouter, TargetEvent } from './target-controller.ts';
import { createTargetController } from './target-controller.ts';

type RuntimeRouter = ControllerRouter & { url: string; close(): Promise<void> };
type Entry = ReturnType<typeof createMcpEntryServer>;
type Prompt = { abort: AbortController; result: Promise<string>; subscribers: number; settled: boolean };
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
    const router = await createRouter();
    let entry: Entry | undefined;
    let connection: OfficialConnection | undefined;
    let control: { close(): Promise<void> } | undefined;
    let catalog: Tool[] = [];
    let closingConnection: OfficialConnection | undefined;
    let cleanupPromise: Promise<void> | undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    const prompts = new Map<string, Prompt>();
    async function closeConnection() {
        const selected = connection;
        if (!selected) return;
        closingConnection = selected;
        try {
            await selected.close();
            if (connection === selected) connection = undefined;
        } finally {
            closingConnection = undefined;
        }
    }
    async function ensureConnection() {
        if (connection) return;
        const gateway = entry;
        const selected = await createConnection(router.url, {
            ...(gateway?.supportsRoots() ? { roots: () => gateway.roots() } : {}),
            ...(gateway?.supportsFormElicitation()
                ? {
                      elicitation: { form: true, request: (params, signal) => gateway.elicit(params, signal) },
                  }
                : {}),
        });
        if (JSON.stringify(selected.tools) !== JSON.stringify(catalog)) {
            await selected.close();
            throw new Error('The official tool catalog changed. Reconnect this entry before starting a target.');
        }
        connection = selected;
        selected.onExit(() => {
            if (connection !== selected || closingConnection === selected) return;
            connection = undefined;
            controller.officialDisconnected();
        });
    }
    const controller = createTargetController({
        entryId,
        router,
        host: createHost(),
        server: { ensure: ensureConnection, close: closeConnection },
    });
    function abortPrompts(sessionId: string) {
        prompts.get(sessionId)?.abort.abort();
        prompts.delete(sessionId);
    }
    const handler: ControlHandler = {
        status: controller.status,
        start: controller.start,
        restart: async (request) => {
            const result = await controller.restart(request);
            abortPrompts(request.sessionId);
            return result;
        },
        stop: async (request) => {
            const result = await controller.stop(request);
            abortPrompts(request.sessionId);
            return result;
        },
        endTask: async (request) => {
            const result = await controller.endTask(request);
            abortPrompts(request.sessionId);
            return result;
        },
    };
    async function ask(event: TargetEvent, signal: AbortSignal) {
        if (signal.aborted) return 'pending';
        let prompt = prompts.get(event.sessionId);
        if (prompt) return waitForChoice(prompt, signal);
        const abort = new AbortController();
        const record: Prompt = { abort, result: Promise.resolve('pending'), subscribers: 0, settled: false };
        record.result = Promise.resolve()
            .then(async () => {
                const status = controller.status();
                const gateway = entry;
                if (
                    !gateway ||
                    status.sessionId !== event.sessionId ||
                    status.status !== 'lost' ||
                    abort.signal.aborted
                )
                    return 'pending';
                const choice = await gateway.askLoss(
                    `调试目标已断开（${event.reason}）。这是误关闭还是有意关闭？误关闭可用原 CDP 端口 ${status.port}、原启动参数和配置重新启动；有意关闭将终止依赖此目标的任务。`,
                    abort.signal,
                );
                return abort.signal.aborted ? 'pending' : choice;
            })
            .then((choice) => {
                if (choice === 'pending' && prompts.get(event.sessionId) === record) prompts.delete(event.sessionId);
                return choice;
            })
            .finally(() => {
                record.settled = true;
            });
        prompt = record;
        prompts.set(event.sessionId, prompt);
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
        cleanupPromise = (async () => {
            if (polling) clearInterval(polling);
            for (const prompt of prompts.values()) prompt.abort.abort();
            prompts.clear();
            try {
                const retained = await controller.cleanupOnDisconnect();
                if (retained)
                    process.stderr.write(
                        `Target did not close normally; inspect PID ${retained.processId}, port ${retained.port}.\n`,
                    );
            } finally {
                try {
                    await control?.close();
                } finally {
                    await router.close();
                }
            }
        })();
        return cleanupPromise;
    }
    try {
        const initial = await createConnection(router.url);
        catalog = initial.tools;
        // Catalog acquisition has no target; close its process normally before host initialization.
        connection = initial;
        await closeConnection();
        entry = createEntry({
            tools: catalog,
            status: () => ({ ...controller.status() }),
            onRootsChanged: () => connection?.rootsChanged() ?? Promise.resolve(),
            watch: async (signal) => {
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
                    const event = await controller.watchTarget(lease.signal);
                    if (event.reason === 'task-ended')
                        return { ...controller.status(), reason: expired ? 'watch-renew' : 'task-ended' };
                    const choice = await ask(event, signal);
                    return {
                        ...controller.status(),
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
                await controller.checkHealth();
                const status = controller.status();
                if (status.status === 'lost' && status.sessionId) {
                    const event = { sessionId: status.sessionId, reason: status.reason ?? 'target-unavailable' };
                    return lifecycleResult({ ...status, choice: await ask(event, signal), pageIdsInvalidated: true });
                }
                if (!controller.canInvoke() || !connection)
                    return lifecycleResult({ ...status, reason: 'target-not-ready' });
                return connection.call(name, arguments_, signal, onProgress);
            },
        });
        control = await createControl({ entryId, controller: handler });
        await entry.connect();
        polling = setInterval(() => {
            void controller.checkHealth().catch(() => {});
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
        throw error;
    }
}
