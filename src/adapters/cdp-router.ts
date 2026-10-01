import type { IncomingHttpHeaders } from 'node:http';
import http from 'node:http';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import type { ManagedTarget } from '../domains/cdp-target.ts';
import { LOOPBACK, MAX_HTTP_BYTES, REQUEST_TIMEOUT_MS } from '../shared/constants.ts';
import { isRecord } from '../shared/errors.ts';

function rewriteDiscovery(value: unknown, routerPort: number): unknown {
    if (Array.isArray(value)) return value.map((item) => rewriteDiscovery(item, routerPort));
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, rewriteDiscovery(item, routerPort)]),
        );
    }
    if (typeof value === 'string' && value.startsWith('ws://')) {
        const url = new URL(value);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return value;
        url.hostname = LOOPBACK;
        url.port = String(routerPort);
        return url.toString();
    }
    return value;
}

function messageId(data: RawData, isBinary: boolean): number | null {
    if (isBinary) return null;
    try {
        const parsed: unknown = JSON.parse(data.toString());
        return isRecord(parsed) && typeof parsed.id === 'number' && Number.isInteger(parsed.id) ? parsed.id : null;
    } catch {
        return null;
    }
}

export async function createCdpRouter() {
    let target: Pick<ManagedTarget, 'port' | 'verify'> | null = null;
    let paused = false;
    let inFlightHttp = 0;
    type Connection = { upstream: WebSocket; downstream: WebSocket | null };
    const sockets = new Set<Connection>();
    const pending = new Map<Connection, Set<number>>();
    function routerPort() {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Router is not listening on TCP.');
        return address.port;
    }
    const websocketServer = new WebSocketServer({ noServer: true });

    const server = http.createServer(async (request, response) => {
        if (request.headers.origin) {
            response.writeHead(403);
            response.end('Cross-origin CDP access is prohibited.');
            return;
        }
        if (paused) {
            response.writeHead(409, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'TARGET_SWITCHING' }));
            return;
        }
        if (!target) {
            response.writeHead(503, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'NO_TARGET', message: 'No CDP target has been started.' }));
            return;
        }
        inFlightHttp += 1;
        let completed = false;
        const complete = () => {
            if (!completed) inFlightHttp -= 1;
            completed = true;
        };
        response.once('close', complete);
        const selected = target;
        try {
            await selected.verify?.();
            if (target !== selected) throw new Error('Target disappeared during verification.');
        } catch {
            response.writeHead(503, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'TARGET_IDENTITY_UNVERIFIABLE' }));
            return;
        }
        const upstream = http.request(
            {
                hostname: LOOPBACK,
                port: target.port,
                path: request.url ?? '/',
                method: request.method ?? 'GET',
                headers: { ...request.headers, host: `${LOOPBACK}:${target.port}` },
                timeout: REQUEST_TIMEOUT_MS,
            },
            (upstreamResponse) => {
                const chunks: Buffer[] = [];
                let bytes = 0;
                upstreamResponse.on('data', (chunk) => {
                    bytes += chunk.length;
                    if (bytes > MAX_HTTP_BYTES) upstream.destroy(new Error('CDP discovery response is too large.'));
                    else chunks.push(chunk);
                });
                upstreamResponse.on('end', () => {
                    const body = Buffer.concat(chunks);
                    let output = body;
                    if (request.url?.startsWith('/json')) {
                        try {
                            output = Buffer.from(
                                JSON.stringify(rewriteDiscovery(JSON.parse(body.toString()) as unknown, routerPort())),
                            );
                        } catch {
                            // Non-JSON error bodies pass through unchanged.
                        }
                    }
                    const headers: IncomingHttpHeaders = {
                        ...upstreamResponse.headers,
                        'content-length': String(output.length),
                    };
                    delete headers['transfer-encoding'];
                    response.writeHead(upstreamResponse.statusCode ?? 502, headers);
                    response.end(output);
                });
            },
        );
        response.once('close', () => upstream.destroy());
        upstream.once('timeout', () => upstream.destroy(new Error('CDP target request timed out.')));
        upstream.once('error', (error) => {
            if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'TARGET_UNAVAILABLE', message: error.message }));
        });
        request.pipe(upstream);
    });

    server.on('upgrade', async (request, socket, head) => {
        socket.on('error', () => {});
        if (request.headers.origin) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        if (!target || paused || !/^\/devtools\/(?:browser|page)\/[^/?#]+$/.test(request.url ?? '')) {
            socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
            return;
        }
        const selected = target;
        inFlightHttp += 1;
        try {
            await selected.verify?.();
            if (target !== selected || paused) throw new Error('Target changed during verification.');
        } catch {
            socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
            return;
        } finally {
            inFlightHttp -= 1;
        }
        const upstream = new WebSocket(`ws://${LOOPBACK}:${selected.port}${request.url}`);
        socket.once('error', () => upstream.terminate());
        const tracked: Connection = { upstream, downstream: null };
        sockets.add(tracked);
        pending.set(tracked, new Set());
        upstream.once('open', () => {
            websocketServer.handleUpgrade(request, socket, head, (downstream) => {
                tracked.downstream = downstream;
                downstream.on('message', (data, isBinary) => {
                    const id = messageId(data, isBinary);
                    if (id !== null) pending.get(tracked)?.add(id);
                    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
                });
                upstream.on('message', (data, isBinary) => {
                    const id = messageId(data, isBinary);
                    if (id !== null) pending.get(tracked)?.delete(id);
                    if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary: isBinary });
                });
                downstream.once('close', () => upstream.close());
            });
        });
        upstream.once('error', () => {
            if (!tracked.downstream) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
            else tracked.downstream.terminate();
        });
        upstream.once('close', () => {
            tracked.downstream?.terminate();
            sockets.delete(tracked);
            pending.delete(tracked);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, LOOPBACK, resolve);
    });

    function disconnect() {
        for (const connection of sockets) {
            connection.downstream?.terminate();
            connection.upstream.terminate();
        }
        sockets.clear();
        pending.clear();
    }

    return {
        port: routerPort(),
        url: `http://${LOOPBACK}:${routerPort()}`,
        isBusy: () =>
            inFlightHttp > 0 ||
            [...sockets].some(({ upstream }) => upstream.readyState === WebSocket.CONNECTING) ||
            [...pending.values()].some((requests) => requests.size > 0),
        pause() {
            if (this.isBusy()) throw new Error('CDP router is busy with in-flight requests.');
            paused = true;
            disconnect();
        },
        resume() {
            paused = false;
        },
        setTarget(nextTarget: Pick<ManagedTarget, 'port' | 'verify'>) {
            if (this.isBusy()) throw new Error('CDP router is busy with in-flight requests.');
            if (!Number.isInteger(nextTarget?.port)) throw new Error('A verified target port is required.');
            disconnect();
            target = { port: nextTarget.port, ...(nextTarget.verify ? { verify: nextTarget.verify } : {}) };
            paused = false;
        },
        clearTarget() {
            disconnect();
            target = null;
            paused = false;
        },
        async close() {
            disconnect();
            await new Promise<void>((resolve) => server.close(() => resolve()));
            websocketServer.close();
        },
    };
}
