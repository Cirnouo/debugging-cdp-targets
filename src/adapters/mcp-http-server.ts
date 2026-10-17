import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { getSupportedElicitationModes } from '@modelcontextprotocol/client';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import { type CoreControlRequest, parseControlRequest } from '../domains/control-contract.ts';
import {
    MCP_MAX_REQUEST_BODY_BYTES,
    mcpHttpRejection,
    parseRegisteredArguments,
    parseRegisteredOfficialArguments,
} from '../domains/mcp-http.ts';
import { RequestFailure, requestFailureExplanation } from '../domains/request-failure.ts';
import type { ClientRequestContext, ClientRequestFacilities } from '../shared/client-context.ts';
import { LIFECYCLE_ACTIONS, lifecycleTools } from './lifecycle-tools.ts';

type ClientHandle = { request(facilities: ClientRequestFacilities): ClientRequestContext; detach(): void };
type HttpCore = {
    tools: Tool[];
    register(): { principal: { registrationId: string }; bearer: string };
    attachClient(bearer: string): ClientHandle;
    control(request: CoreControlRequest, context: ClientRequestContext): Promise<Record<string, unknown>>;
    invoke(name: string, arguments_: Record<string, unknown>, context: ClientRequestContext): Promise<CallToolResult>;
};
const INSTRUCTIONS =
    'Connect directly to the local desktop App. Call dct_registration_register once and retain its one-time registrationBearer. Pass that bearer explicitly to every lifecycle request and inside _dct with current connectionId/sessionId for each official tool. Registrations own resources independently of chats, HTTP and MCP sessions. Never replay a start on reconnect. Follow the debugging-cdp-targets Skill before new target launches and obtain Close/Keep before ending target work.';
declare const __DCT_APP_VERSION__: string;

/** Only transports live here. Client/session close never disposes the application-owned core. */
export async function createMcpHttpServer(options: { port: number; core: HttpCore; accepting?: () => boolean }) {
    const requestLifetime = new AsyncLocalStorage<AbortSignal>();
    const sessions = new Map<string, ReturnType<typeof session>>();
    const opening = new Set<ReturnType<typeof session>>();
    const live = new Set<ReturnType<typeof session>>();
    const lifecycle = lifecycleTools();
    const reserved = new Set(lifecycle.map((tool) => tool.name));
    const routeSchema = {
        type: 'object',
        properties: {
            registrationBearer: { type: 'string', minLength: 32, maxLength: 128 },
            connectionId: { type: 'string', format: 'uuid' },
            sessionId: { type: 'string', format: 'uuid' },
        },
        required: ['registrationBearer', 'connectionId', 'sessionId'],
        additionalProperties: false,
    };
    const tools = options.core.tools.map((tool) => {
        if (reserved.has(tool.name) || Object.hasOwn(tool.inputSchema.properties ?? {}, '_dct'))
            throw new Error('Official catalog collides with reserved App routing.');
        return {
            ...tool,
            inputSchema: {
                ...tool.inputSchema,
                properties: { ...tool.inputSchema.properties, _dct: routeSchema },
                required: [...(tool.inputSchema.required ?? []), '_dct'],
            },
        };
    });
    function session() {
        let clientLifetime = new AbortController();
        const server = new Server(
            {
                name: 'debugging-cdp-targets',
                version: typeof __DCT_APP_VERSION__ === 'undefined' ? '0.1.0' : __DCT_APP_VERSION__,
            },
            { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
        );
        const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
            onsessioninitialized: (id) => {
                opening.delete(selected);
                sessions.set(id, selected);
            },
            onsessionclosed: (id) => {
                sessions.delete(id);
                clientLifetime.abort(new Error('The originating MCP session closed.'));
            },
        });
        server.onerror = () => {};
        server.onclose = () => {
            clientLifetime.abort(new Error('The originating MCP transport closed.'));
            if (transport.sessionId) sessions.delete(transport.sessionId);
            opening.delete(selected);
            live.delete(selected);
        };
        server.setRequestHandler('tools/list', async () => ({ tools: [...tools, ...lifecycle] }));
        server.setRequestHandler('tools/call', async (request, context) => {
            const name = request.params.name;
            const arguments_ = request.params.arguments ?? {};
            let authenticated = false;
            try {
                if (name === 'dct_registration_register') {
                    if (Object.keys(arguments_).length) throw new Error('Register takes no arguments.');
                    const created = options.core.register();
                    const result = {
                        registrationId: created.principal.registrationId,
                        registrationBearer: created.bearer,
                    };
                    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
                }
                const action = Object.hasOwn(LIFECYCLE_ACTIONS, name) ? LIFECYCLE_ACTIONS[name] : undefined;
                const parsed = action
                    ? parseRegisteredArguments(arguments_)
                    : parseRegisteredOfficialArguments(arguments_);
                // Authentication precedes resource/result reads. No session contains an implicit registration.
                const client = options.core.attachClient(parsed.registrationBearer);
                authenticated = true;
                const capabilities = server.getClientCapabilities();
                const token = request.params._meta?.progressToken;
                const lifetime = requestLifetime.getStore();
                const requestContext = client.request({
                    requestId: context.mcpReq.id,
                    capabilities: {
                        roots: capabilities?.roots !== undefined,
                        formElicitation: getSupportedElicitationModes(capabilities?.elicitation).supportsFormMode,
                    },
                    waitSignal: AbortSignal.any([
                        context.mcpReq.signal,
                        clientLifetime.signal,
                        ...(lifetime ? [lifetime] : []),
                    ]),
                    readRoots: (signal) => context.mcpReq.send({ method: 'roots/list' }, signal ? { signal } : {}),
                    elicit: (params, signal) =>
                        context.mcpReq.send({ method: 'elicitation/create', params }, signal ? { signal } : {}),
                    onProgress: (progress) => {
                        if (token !== undefined)
                            void context.mcpReq
                                .notify({
                                    method: 'notifications/progress',
                                    params: { ...progress, progressToken: token },
                                })
                                .catch(() => {});
                    },
                });
                // An accepted asynchronous operation still owns these original facilities. Normal response
                // completion is not client detach; dynamic request/session signals gate later use.
                if (action) {
                    if (Object.hasOwn(parsed.arguments, 'action')) throw new Error('Tool name selects its action.');
                    const result = await options.core.control(
                        parseControlRequest({ ...parsed.arguments, action }),
                        requestContext,
                    );
                    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
                }
                if (!options.core.tools.some((tool) => tool.name === name)) throw new Error('Unknown tool.');
                const official = parseRegisteredOfficialArguments(arguments_);
                return await options.core.invoke(name, { ...official.arguments, _dct: official.route }, requestContext);
            } catch (error) {
                if (authenticated && error instanceof RequestFailure)
                    throw new ProtocolError(ProtocolErrorCode.InvalidParams, requestFailureExplanation(error), {
                        code: error.code,
                    });
                throw new ProtocolError(
                    ProtocolErrorCode.InvalidParams,
                    'Request rejected. Check the registration bearer, current route and validated tool arguments.',
                );
            }
        });
        const selected = {
            server,
            transport,
            connected: server.connect(transport),
            disconnect() {
                clientLifetime.abort(new Error('The originating client stream disconnected.'));
                clientLifetime = new AbortController();
            },
        };
        opening.add(selected);
        live.add(selected);
        return selected;
    }
    let closing = false;
    let closingAttempt: Promise<void> | undefined;
    const listener = createServer((request, response) => {
        void (async () => {
            const address = listener.address();
            if (!address || typeof address === 'string') throw new Error('Unavailable endpoint.');
            const rejection = mcpHttpRejection(
                { method: request.method, url: request.url, headers: request.headers },
                address.port,
            );
            const sensitiveHeaders = new Set(['host', 'origin', 'content-length', 'content-type', 'mcp-session-id']);
            const seen = new Set<string>();
            let duplicated = false;
            for (let index = 0; index < request.rawHeaders.length; index += 2) {
                const key = request.rawHeaders[index]?.toLowerCase();
                if (key && sensitiveHeaders.has(key)) {
                    if (seen.has(key)) duplicated = true;
                    seen.add(key);
                }
            }
            const unavailable = closing || options.accepting?.() === false;
            if (rejection || duplicated || unavailable) {
                response.writeHead(unavailable ? 503 : duplicated ? 400 : (rejection?.status ?? 400), {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                });
                response.end(
                    JSON.stringify({
                        error: unavailable
                            ? 'App is unavailable.'
                            : duplicated
                              ? 'Ambiguous headers.'
                              : rejection?.message,
                    }),
                );
                request.resume();
                return;
            }
            const id = request.headers['mcp-session-id'];
            let selected = typeof id === 'string' ? sessions.get(id) : undefined;
            if (id !== undefined && !selected) {
                response.writeHead(404).end();
                request.resume();
                return;
            }
            selected ??= session();
            await selected.connected;
            const disconnected = new AbortController();
            response.once('close', () => {
                if (!response.writableFinished)
                    disconnected.abort(new Error('The originating HTTP response disconnected.'));
                if (request.method === 'GET') selected.disconnect();
            });
            try {
                await requestLifetime.run(disconnected.signal, () =>
                    selected.transport.handleRequest(request, response),
                );
            } finally {
                if (!selected.transport.sessionId) await selected.server.close();
            }
        })().catch(() => {
            if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
            response.end('{"error":"MCP request failed."}');
        });
    });
    await new Promise<void>((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(options.port, '127.0.0.1', () => {
            listener.removeListener('error', reject);
            resolve();
        });
    });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Unavailable App endpoint.');
    return {
        url: `http://127.0.0.1:${address.port}/mcp`,
        close() {
            closing = true;
            if (closingAttempt) return closingAttempt;
            const attempt = (async () => {
                const results = await Promise.allSettled([...live].map((item) => item.server.close()));
                listener.closeIdleConnections();
                if (listener.listening)
                    await new Promise<void>((resolve, reject) =>
                        listener.close((error) => (error ? reject(error) : resolve())),
                    );
                if (results.some((result) => result.status === 'rejected'))
                    throw new Error('MCP transport cleanup failed.');
            })();
            closingAttempt = attempt;
            void attempt.catch(() => {
                closingAttempt = undefined;
            });
            return attempt;
        },
    };
}
