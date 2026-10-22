import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
    createMcpHandler,
    isLegacyRequest,
    WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';
import { MCP_MAX_REQUEST_BODY_BYTES, mcpHttpRejection, mcpJsonRejection } from '../domains/mcp-http.ts';
import { createMcpRequestHandler, type McpHttpCore } from './mcp-request-handler.ts';

/** Only transports live here. Client/session close never disposes the application-owned core. */
export async function createMcpHttpServer(options: { port: number; core: McpHttpCore; accepting?: () => boolean }) {
    const requestLifetime = new AsyncLocalStorage<AbortSignal>();
    const handler = createMcpRequestHandler(options.core);
    const sessions = new Map<string, ReturnType<typeof session>>();
    const live = new Set<ReturnType<typeof session>>();
    function session() {
        let clientLifetime = new AbortController();
        const server = handler.createServer({
            era: 'legacy',
            legacyLifetime: () => {
                const request = requestLifetime.getStore();
                return AbortSignal.any([clientLifetime.signal, ...(request ? [request] : [])]);
            },
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
            onsessioninitialized: (id) => {
                sessions.set(id, selected);
            },
            onsessionclosed: (id) => {
                sessions.delete(id);
                clientLifetime.abort(new Error('The originating MCP session closed.'));
            },
        });
        server.onclose = () => {
            clientLifetime.abort(new Error('The originating MCP transport closed.'));
            if (transport.sessionId) sessions.delete(transport.sessionId);
            live.delete(selected);
        };
        const selected = {
            server,
            transport,
            connected: server.connect(transport),
            disconnect() {
                clientLifetime.abort(new Error('The originating client stream disconnected.'));
                clientLifetime = new AbortController();
            },
        };
        live.add(selected);
        return selected;
    }
    const modern = createMcpHandler(() => handler.createServer({ era: 'modern' }), {
        legacy: 'reject',
        responseMode: 'auto',
        maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
        onerror: () => {},
    });
    const nodeHandler = toNodeHandler(
        {
            async fetch(request, fetchOptions) {
                let checkedOptions = fetchOptions;
                if (request.method === 'POST') {
                    let parsedBody: unknown;
                    try {
                        parsedBody =
                            fetchOptions?.parsedBody !== undefined ? fetchOptions.parsedBody : await request.json();
                    } catch {
                        return Response.json(
                            { error: 'Invalid JSON request.' },
                            { status: 400, headers: { 'Cache-Control': 'no-store' } },
                        );
                    }
                    const rejection = mcpJsonRejection(parsedBody);
                    if (rejection)
                        return Response.json(
                            { error: rejection.message },
                            { status: rejection.status, headers: { 'Cache-Control': 'no-store' } },
                        );
                    checkedOptions = { ...fetchOptions, parsedBody };
                }
                if (
                    !(await isLegacyRequest(request, checkedOptions?.parsedBody, {
                        maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
                    }))
                )
                    return modern.fetch(request, checkedOptions);
                const id = request.headers.get('mcp-session-id');
                let selected = id ? sessions.get(id) : undefined;
                if (id && !selected) return new Response(null, { status: 404 });
                selected ??= session();
                await selected.connected;
                try {
                    return await requestLifetime.run(request.signal, () =>
                        selected.transport.handleRequest(request, checkedOptions),
                    );
                } finally {
                    if (!selected.transport.sessionId) await selected.server.close();
                }
            },
        },
        { maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES, onerror: () => {} },
    );
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
            const sensitiveHeaders = new Set([
                'host',
                'origin',
                'content-length',
                'content-type',
                'mcp-session-id',
                'mcp-protocol-version',
            ]);
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
            const selected = sessions.get(String(request.headers['mcp-session-id']));
            if (request.method === 'GET') response.once('close', () => selected?.disconnect());
            if (!request.method || !request.url) throw new Error('Invalid HTTP request.');
            await nodeHandler(Object.assign(request, { method: request.method, url: request.url }), response);
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
                handler.close();
                const results = await Promise.allSettled([
                    modern.close(),
                    ...[...live].map((item) => item.server.close()),
                ]);
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
