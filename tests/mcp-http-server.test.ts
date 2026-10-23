import assert from 'node:assert/strict';
import { EventEmitter, errorMonitor } from 'node:events';
import {
    type ClientRequest,
    createServer,
    request as httpRequest,
    type IncomingMessage,
    ServerResponse,
} from 'node:http';
import { type TestContext, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, ProtocolError, ProtocolErrorCode, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { DataDirectoryRegistry } from '../src/adapters/data-directory.ts';
import { createMcpHttpServer } from '../src/adapters/mcp-http-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createGatewayCore } from '../src/gateway/core.ts';
import { isRecord } from '../src/shared/errors.ts';

type HttpOptions = {
    expectRefusal?: boolean;
    timeoutMs?: number;
    observeRequest?: (request: ClientRequest) => void;
    holdEnd?: boolean;
};
type HttpOutcome = { kind: 'response'; status: number } | { kind: 'upload-terminated' };

function httpExchange(
    url: string,
    headers: Record<string, string>,
    chunks: string[],
    options: HttpOptions & { allowUploadTermination?: boolean } = {},
) {
    return new Promise<HttpOutcome>((resolve, reject) => {
        const started = performance.now();
        const events: { ms: number; event: string; value?: number | string }[] = [];
        const body: Buffer[] = [];
        let request: ClientRequest;
        let response: IncomingMessage | undefined;
        let bytes = 0;
        let requestClosed = false;
        let responseEnded = false;
        let responseClosed = false;
        let responseAborted = false;
        let settled = false;
        let failure: string | undefined;
        let knownUploadError = false;
        let timer: ReturnType<typeof setTimeout>;
        function record(event: string, value?: number | string) {
            if (events.length < 48)
                events.push({
                    ms: Math.round((performance.now() - started) * 1000) / 1000,
                    event,
                    ...(value === undefined ? {} : { value }),
                });
            else fail('event-limit');
        }
        function settle(force = false) {
            if (
                !settled &&
                !failure &&
                options.allowUploadTermination &&
                requestClosed &&
                !response &&
                knownUploadError
            ) {
                settled = true;
                clearTimeout(timer);
                resolve({ kind: 'upload-terminated' });
                return;
            }
            if (settled || (!force && (!requestClosed || (!failure && !responseClosed)))) return;
            if (!failure && (!responseEnded || !response?.complete || responseAborted)) failure = 'incomplete-response';
            if (!failure && options.expectRefusal) {
                if (response?.statusCode !== 413) failure = 'wrong-status';
                else if (response.headers.connection !== 'close') failure = 'missing-connection-close';
                else if (response.headers['content-type']?.split(';')[0] !== 'application/json')
                    failure = 'wrong-content-type';
                else {
                    try {
                        const parsed: unknown = JSON.parse(Buffer.concat(body).toString('utf8'));
                        assert.deepEqual(parsed, {
                            jsonrpc: '2.0',
                            error: {
                                code: -32000,
                                message: 'Payload Too Large: Request body must not exceed 1048576 bytes',
                            },
                            id: null,
                        });
                    } catch {
                        failure = 'invalid-refusal-body';
                    }
                }
            }
            settled = true;
            clearTimeout(timer);
            if (failure) {
                reject(
                    new Error(
                        `HTTP exchange failed: ${failure}; ${JSON.stringify({ requestClosed, responseEnded, responseClosed, responseAborted, complete: response?.complete ?? false, status: response?.statusCode ?? null, bytes, events })}`,
                    ),
                );
            } else resolve({ kind: 'response', status: response?.statusCode ?? 0 });
        }
        function fail(reason: string) {
            failure ??= reason;
            request.destroy();
            settle();
        }
        function requestError(error: unknown) {
            const code =
                isRecord(error) && (error.code === 'EPIPE' || error.code === 'ECONNRESET') ? error.code : 'OTHER';
            record('request.error', code);
            if (code !== 'OTHER') knownUploadError = true;
            if (!options.expectRefusal || code === 'OTHER') fail('request-error');
        }
        request = httpRequest(url, { method: 'POST', headers }, (incoming) => {
            response = incoming;
            record('response.headers', incoming.statusCode);
            incoming.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                record('response.data', chunk.length);
                if (bytes > 16384) fail('body-limit');
                else body.push(chunk);
            });
            incoming.once('end', () => {
                responseEnded = true;
                record('response.end');
                settle();
            });
            incoming.once('aborted', () => {
                responseAborted = true;
                record('response.aborted');
                fail('response-aborted');
            });
            incoming.on('error', () => {
                record('response.error');
                fail('response-error');
            });
            incoming.once('close', () => {
                responseClosed = true;
                record('response.close');
                if (!responseEnded || !incoming.complete) fail('incomplete-response');
                settle();
            });
        });
        request.on('error', requestError);
        request.once('finish', () => record('request.finish'));
        request.once('close', () => {
            requestClosed = true;
            record('request.close');
            settle();
        });
        timer = setTimeout(() => {
            record('timeout');
            fail('timeout');
            settle(true);
        }, options.timeoutMs ?? 2000);
        try {
            options.observeRequest?.(request);
            for (const chunk of chunks) {
                record('request.write', Buffer.byteLength(chunk));
                request.write(chunk, (error) => {
                    record('request.write-callback');
                    if (error) requestError(error);
                });
            }
            if (!options.holdEnd) {
                record('request.end');
                request.end();
            }
        } catch {
            fail('write-threw');
        }
    });
}

async function httpStatus(url: string, headers: Record<string, string>, chunks: string[], options: HttpOptions = {}) {
    const outcome = await httpExchange(url, headers, chunks, options);
    assert.equal(outcome.kind, 'response');
    if (outcome.kind !== 'response') throw new Error('Missing client HTTP response.');
    return outcome.status;
}

async function boundedFloodRefusal(
    t: TestContext,
    url: string,
    chunks: string[],
    options: Pick<HttpOptions, 'holdEnd' | 'timeoutMs' | 'observeRequest'> = {},
) {
    const authority = new URL(url).host;
    const events: string[] = [];
    const body: Buffer[] = [];
    let response: ServerResponse | undefined;
    let socket: IncomingMessage['socket'] | undefined;
    let client: ClientRequest | undefined;
    let bytes = 0;
    let headReturned = false;
    let endReturned = false;
    let finished = false;
    let socketClosed = false;
    let finishBeforeSocketClose = false;
    let cleanup = false;
    let failure: string | undefined;
    let status: number | undefined;
    let contentType: unknown;
    let connection: unknown;
    let before: { complete: boolean; destroyed: boolean; aborted: boolean } | undefined;
    let signalClosed: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
        signalClosed = resolve;
    });
    const record = (event: string) => {
        if (events.length < 48) events.push(event);
        else failure ??= 'event-limit';
    };
    const finish = () => {
        finished = true;
        record('response.finish');
    };
    const responseError = () => {
        failure ??= 'response-error';
        record('response.error');
    };
    const socketError = (error: unknown) => {
        if (!isRecord(error) || (error.code !== 'EPIPE' && error.code !== 'ECONNRESET')) failure ??= 'socket-error';
        record('socket.error');
    };
    const socketClose = () => {
        socketClosed = !cleanup;
        finishBeforeSocketClose = finished;
        record('socket.close');
        signalClosed();
    };
    function append(chunk: unknown, encoding: unknown) {
        if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
        let value: Buffer;
        if (typeof chunk === 'string')
            value = Buffer.from(chunk, typeof encoding === 'string' && Buffer.isEncoding(encoding) ? encoding : 'utf8');
        else if (chunk instanceof Uint8Array) value = Buffer.from(chunk);
        else {
            failure ??= 'invalid-server-chunk';
            return;
        }
        bytes += value.length;
        if (bytes > 16384) failure ??= 'body-limit';
        else body.push(value);
    }
    const originalHead = ServerResponse.prototype.writeHead;
    const originalWrite = ServerResponse.prototype.write;
    const originalEnd = ServerResponse.prototype.end;
    const headSpy = t.mock.method(
        ServerResponse.prototype,
        'writeHead',
        function (this: ServerResponse, ...args: Parameters<ServerResponse['writeHead']>) {
            const matches =
                this.req.method === 'POST' &&
                this.req.url === '/mcp' &&
                this.req.headers.host === authority &&
                this.req.headers['transfer-encoding'] === 'chunked';
            if (matches) {
                if (response) failure ??= 'duplicate-response';
                response = this;
                socket = this.req.socket;
                before = { complete: this.req.complete, destroyed: this.req.destroyed, aborted: this.req.aborted };
                this.once('finish', finish);
                this.once(errorMonitor, responseError);
                socket.once('close', socketClose);
                (socket as EventEmitter).once(errorMonitor, socketError);
                record('response.head-entry');
            }
            try {
                const result = originalHead.apply(this, args);
                if (this === response) {
                    headReturned = true;
                    status = args[0];
                    const headers: unknown = typeof args[1] === 'string' ? (args as readonly unknown[])[2] : args[1];
                    if (isRecord(headers)) {
                        for (const [key, value] of Object.entries(headers)) {
                            if (key.toLowerCase() === 'content-type') contentType = value;
                            if (key.toLowerCase() === 'connection') connection = value;
                        }
                    }
                    record('response.head-return');
                }
                return result;
            } catch (error) {
                if (this === response) failure ??= 'head-threw';
                throw error;
            }
        },
    );
    const writeSpy = t.mock.method(
        ServerResponse.prototype,
        'write',
        function (this: ServerResponse, ...args: Parameters<ServerResponse['write']>) {
            try {
                const result = originalWrite.apply(this, args);
                if (this === response) {
                    append(args[0], args[1]);
                    record('response.write-return');
                }
                return result;
            } catch (error) {
                if (this === response) failure ??= 'write-threw';
                throw error;
            }
        },
    );
    const endSpy = t.mock.method(
        ServerResponse.prototype,
        'end',
        function (this: ServerResponse, ...args: Parameters<ServerResponse['end']>) {
            try {
                const result = originalEnd.apply(this, args);
                if (this === response) {
                    append(args[0], args[1]);
                    endReturned = true;
                    record('response.end-return');
                }
                return result;
            } catch (error) {
                if (this === response) failure ??= 'end-threw';
                throw error;
            }
        },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () =>
                reject(
                    new Error(
                        `Bounded flooding refusal failed: timeout; ${JSON.stringify({ headReturned, endReturned, finished, socketClosed, bytes, events })}`,
                    ),
                ),
            options.timeoutMs ?? 2000,
        );
    });
    try {
        const [outcome] = await Promise.race([
            Promise.all([
                httpExchange(
                    url,
                    { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
                    chunks,
                    {
                        ...options,
                        expectRefusal: true,
                        allowUploadTermination: true,
                        observeRequest(request) {
                            client = request;
                            options.observeRequest?.(request);
                        },
                    },
                ),
                closed,
            ]),
            deadline,
        ]);
        if (!(headReturned && endReturned && finished && socketClosed && finishBeforeSocketClose))
            failure ??= 'incomplete-server';
        if (status !== 413) failure ??= 'wrong-server-status';
        if (connection !== 'close') failure ??= 'wrong-server-connection';
        if (!(typeof contentType === 'string' && contentType.split(';')[0] === 'application/json'))
            failure ??= 'wrong-server-content-type';
        if (
            !Buffer.concat(body).equals(
                Buffer.from(
                    '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too Large: Request body must not exceed 1048576 bytes"},"id":null}',
                ),
            )
        )
            failure ??= 'invalid-server-body';
        const evidence = JSON.stringify({
            headReturned,
            endReturned,
            finished,
            socketClosed,
            finishBeforeSocketClose,
            status,
            bytes,
            before,
            events,
        });
        assert.equal(failure, undefined, `Bounded flooding refusal failed: ${failure}; ${evidence}`);
        if (options.holdEnd) assert.deepEqual(before, { complete: false, destroyed: false, aborted: false });
        if (outcome.kind === 'response') assert.equal(outcome.status, 413);
        return outcome;
    } finally {
        cleanup = true;
        clearTimeout(timer);
        headSpy.mock.restore();
        writeSpy.mock.restore();
        endSpy.mock.restore();
        response?.off('finish', finish);
        response?.off(errorMonitor, responseError);
        socket?.off('close', socketClose);
        socket?.off(errorMonitor, socketError);
        client?.destroy();
    }
}

async function refusalResponse(
    respond: (request: IncomingMessage, response: ServerResponse) => void,
    options: Parameters<typeof httpStatus>[3] = {},
) {
    const server = createServer(respond);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        return await httpStatus(`http://127.0.0.1:${address.port}/mcp`, { 'Content-Type': 'application/json' }, [' '], {
            expectRefusal: true,
            ...options,
        });
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
}

test('HTTP bounded flooding refusal distinguishes a physically closed upload from client JSON', async (t) => {
    let client: ClientRequest | undefined;
    let serverResponse: ServerResponse | undefined;
    let writeCompleted = false;
    let responseStarted = false;
    let responseFinished = false;
    let injected = false;
    let restoreWrite = () => {};
    function respond() {
        if (!serverResponse || !writeCompleted || responseStarted) return;
        responseStarted = true;
        serverResponse.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
        serverResponse.end(
            '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too Large: Request body must not exceed 1048576 bytes"},"id":null}',
        );
    }
    const server = createServer((_request, response) => {
        serverResponse = response;
        response.once('finish', () => {
            responseFinished = true;
            if (client) {
                client.destroy(Object.assign(new Error('peer upload failed'), { code: 'EPIPE' }));
                injected = true;
            }
        });
        respond();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const outcome = await boundedFloodRefusal(t, `http://127.0.0.1:${address.port}/mcp`, [' '], {
            holdEnd: true,
            observeRequest: (request) => {
                client = request;
                const originalWrite = request.write;
                const spy = t.mock.method(
                    request,
                    'write',
                    function (this: ClientRequest, ...args: Parameters<ClientRequest['write']>) {
                        const forwarded: unknown[] = [...args];
                        const callbackIndex = forwarded.length - 1;
                        const callback = forwarded[callbackIndex];
                        if (typeof callback === 'function') {
                            forwarded[callbackIndex] = function (this: unknown, ...callbackArgs: unknown[]) {
                                const result = Reflect.apply(callback, this, callbackArgs);
                                if (callbackArgs[0] === undefined || callbackArgs[0] === null) {
                                    writeCompleted = true;
                                    respond();
                                }
                                return result;
                            };
                        }
                        return Reflect.apply(originalWrite, this, forwarded);
                    },
                );
                restoreWrite = () => spy.mock.restore();
            },
        });
        assert.deepEqual(outcome, { kind: 'upload-terminated' });
        assert.equal(writeCompleted, true);
        assert.equal(responseFinished, true);
        assert.equal(injected, true);
    } finally {
        restoreWrite();
        serverResponse = undefined;
        client?.destroy();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
});

async function floodFixture(
    t: TestContext,
    respond: (request: IncomingMessage, response: ServerResponse) => void,
    code: 'EPIPE' | 'ECONNRESET' | 'OTHER' | null = 'ECONNRESET',
) {
    let client: ClientRequest | undefined;
    const server = createServer((request, response) => {
        if (code)
            response.once('finish', () =>
                client?.destroy(Object.assign(new Error('controlled peer failure'), { code })),
            );
        respond(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        return await boundedFloodRefusal(t, `http://127.0.0.1:${address.port}/mcp`, [' '], {
            timeoutMs: 50,
            observeRequest: (request) => {
                client = request;
            },
        });
    } finally {
        client?.destroy();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
}

test('HTTP bounded flooding refusal retains complete client JSON as a distinct outcome', async (t) => {
    assert.deepEqual(
        await floodFixture(
            t,
            (_request, response) => {
                response.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
                response.end(
                    '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too Large: Request body must not exceed 1048576 bytes"},"id":null}',
                );
            },
            null,
        ),
        { kind: 'response', status: 413 },
    );
});

for (const [name, status, body, contentType, connection, reason] of [
    ['wrong status', 400, '{}', 'application/json', 'close', 'wrong-server-status'],
    ['wrong body', 413, '{"private":"do-not-echo"}', 'application/json', 'close', 'invalid-server-body'],
    ['invalid JSON', 413, '{', 'application/json', 'close', 'invalid-server-body'],
    ['body limit', 413, 'x'.repeat(16385), 'application/json', 'close', 'body-limit'],
    ['content type', 413, '{}', 'text/plain', 'close', 'wrong-server-content-type'],
    ['connection', 413, '{}', 'application/json', 'keep-alive', 'wrong-server-connection'],
] as const) {
    test(`HTTP bounded flooding refusal rejects actual server ${name} despite known upload closure`, async (t) => {
        await assert.rejects(
            floodFixture(t, (_request, response) => {
                response.writeHead(status, { 'Content-Type': contentType, Connection: connection });
                response.end(body);
            }),
            new RegExp(`Bounded flooding refusal failed: ${reason};`),
        );
    });
}

test('HTTP bounded flooding refusal rejects native closure without server end and finish', async (t) => {
    await assert.rejects(
        floodFixture(t, (request, response) => {
            response.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
            response.write('{');
            request.socket.destroy();
        }),
        /Bounded flooding refusal failed: incomplete-server;|HTTP exchange failed: (response-aborted|response-error|incomplete-response);/,
    );
});

test('HTTP bounded flooding refusal rejects absent headers and cleanup-induced socket closure', async (t) => {
    await assert.rejects(
        floodFixture(t, () => {}),
        /Bounded flooding refusal failed: timeout;/,
    );
});

test('HTTP bounded flooding refusal requires native socket close beyond complete response close', async (t) => {
    await assert.rejects(
        floodFixture(
            t,
            (_request, response) => {
                response.writeHead(413, { 'Content-Type': 'application/json', Connection: 'keep-alive' });
                response.end(
                    '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too Large: Request body must not exceed 1048576 bytes"},"id":null}',
                );
            },
            null,
        ),
        /Bounded flooding refusal failed: timeout;|HTTP exchange failed: missing-connection-close;/,
    );
});

test('HTTP bounded flooding refusal rejects unknown client error after actual server finish', async (t) => {
    await assert.rejects(
        floodFixture(
            t,
            (_request, response) => {
                response.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
                response.end(
                    '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too Large: Request body must not exceed 1048576 bytes"},"id":null}',
                );
            },
            'OTHER',
        ),
        /HTTP exchange failed: request-error;/,
    );
});

test('HTTP refusal observation retains upload error before complete response', async () => {
    const result = await refusalResponse(
        (_request, response) => {
            response.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
            response.end(
                '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too Large: Request body must not exceed 1048576 bytes"},"id":null}',
            );
        },
        {
            observeRequest(request) {
                request.once('socket', () =>
                    request.emit('error', Object.assign(new Error('upload refused'), { code: 'EPIPE' })),
                );
            },
        },
    );
    assert.equal(result, 413);
});

test('HTTP refusal observation retains request reset before complete response', async () => {
    assert.equal(
        await refusalResponse(
            (_request, response) => {
                response.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
                response.end(
                    '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too Large: Request body must not exceed 1048576 bytes"},"id":null}',
                );
            },
            {
                observeRequest(request) {
                    request.once('socket', () =>
                        request.emit('error', Object.assign(new Error('upload refused'), { code: 'ECONNRESET' })),
                    );
                },
            },
        ),
        413,
    );
});

for (const [name, status, body, connection, contentType, reason] of [
    ['wrong status', 400, '{}', 'close', 'application/json', 'wrong-status'],
    ['echoed body', 413, '{"private":"do-not-echo"}', 'close', 'application/json', 'invalid-refusal-body'],
    ['invalid JSON', 413, '{', 'close', 'application/json', 'invalid-refusal-body'],
    ['unbounded body', 413, 'x'.repeat(16385), 'close', 'application/json', 'body-limit'],
    ['open connection', 413, '{}', 'keep-alive', 'application/json', 'missing-connection-close'],
    ['wrong content type', 413, '{}', 'close', 'text/plain', 'wrong-content-type'],
] as const) {
    test(`HTTP refusal observation rejects ${name}`, async () => {
        await assert.rejects(
            refusalResponse((_request, response) => {
                response.writeHead(status, { 'Content-Type': contentType, Connection: connection });
                response.end(body);
            }),
            new RegExp(`HTTP exchange failed: ${reason};`),
        );
    });
}

test('HTTP refusal observation rejects truncated 413 and response abort', async () => {
    await assert.rejects(
        refusalResponse((_request, response) => {
            response.writeHead(413, {
                'Content-Type': 'application/json',
                Connection: 'close',
                'Content-Length': '125',
            });
            response.end('{');
        }),
        /HTTP exchange failed: (response-aborted|response-error|incomplete-response);/,
    );
});

for (const code of ['EPIPE', 'ECONNRESET']) {
    test(`HTTP refusal observation rejects ${code} without a response at its deadline`, async () => {
        await assert.rejects(
            refusalResponse(() => {}, {
                timeoutMs: 30,
                observeRequest(request) {
                    request.once('socket', () =>
                        request.emit('error', Object.assign(new Error('upload refused'), { code })),
                    );
                },
            }),
            /HTTP exchange failed: timeout;/,
        );
    });
}

test('HTTP refusal observation rejects a reset socket without inferred 413', async () => {
    await assert.rejects(
        refusalResponse((request) => request.socket.destroy(), { timeoutMs: 30 }),
        /HTTP exchange failed: timeout;/,
    );
});

test('HTTP refusal observation rejects an exchange that never responds', async () => {
    await assert.rejects(
        refusalResponse(() => {}, { timeoutMs: 30 }),
        /HTTP exchange failed: timeout;/,
    );
});

for (const side of ['request', 'response'] as const) {
    test(`HTTP refusal observation rejects ${side} error after complete response before request close`, async () => {
        await assert.rejects(
            refusalResponse(
                (_request, response) => {
                    response.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
                    response.end(
                        '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Payload Too Large: Request body must not exceed 1048576 bytes"},"id":null}',
                    );
                },
                {
                    observeRequest(request) {
                        request.once('response', (response) => {
                            response.once('end', () => {
                                (side === 'request' ? request : response).emit('error', new Error('unrelated failure'));
                            });
                        });
                    },
                },
            ),
            new RegExp(`HTTP exchange failed: ${side}-error;`),
        );
    });
}

async function fixture() {
    const tool = { name: 'echo', inputSchema: { type: 'object' as const, properties: {} } };
    const catalog = createToolCatalog({ version: '1.11.0', tools: [{ name: 'echo', requires: {}, variants: [tool] }] });
    let launched = 0;
    let officialCalls = 0;
    let now = 0;
    const acquired = { directory: 0, router: 0, target: 0, official: 0 };
    let releaseCall: () => void = () => {};
    let enterCall: () => void = () => {};
    const heldCall = new Promise<void>((resolve) => {
        releaseCall = resolve;
    });
    const callEntered = new Promise<void>((resolve) => {
        enterCall = resolve;
    });
    const dataDirectories = new DataDirectoryRegistry();
    dataDirectories.acquire = async () => {
        acquired.directory++;
        throw new Error('Unexpected fixture directory acquisition.');
    };
    const core = await createGatewayCore({
        now: () => now,
        dataDirectories,
        loadCatalog: async () => catalog,
        createRouter: async () => {
            acquired.router++;
            return {
                url: 'http://127.0.0.1:30000',
                isBusy: () => false,
                setTarget() {},
                clearTarget() {},
                close: async () => {},
            };
        },
        createHost: () => {
            const child = new EventEmitter();
            return {
                launch: async () => {
                    launched++;
                    acquired.target++;
                    return {
                        processId: 42,
                        port: 9222,
                        executablePath: process.execPath,
                        startedAtUtc: '2026-10-17T00:00:00Z',
                        targetKind: 'generic-cdp' as const,
                        child,
                        launchDefinition: { executablePath: process.execPath, arguments: [] },
                    };
                },
                close: async () => {
                    child.emit('exit');
                    return true;
                },
            };
        },
        createConnection: async (_url, options) => {
            acquired.official++;
            return {
                tools: [tool],
                call: async (_name, arguments_, signal, onProgress) => {
                    officialCalls++;
                    if (arguments_.hold === true) {
                        enterCall();
                        await heldCall;
                    }
                    if (arguments_.privateFailure === true) throw new Error('private-path-and-token-fixture');
                    if (arguments_.holdFormFailure === true) {
                        try {
                            await options?.elicitation?.request(
                                { message: 'Original held form', requestedSchema: { type: 'object', properties: {} } },
                                signal ?? new AbortController().signal,
                            );
                        } catch {
                            enterCall();
                            await heldCall;
                            throw new Error('Translated upstream SDK rejection');
                        }
                        throw new Error('Expected originating form facility refusal.');
                    }
                    const roots = await options?.roots?.();
                    if (arguments_.challenge === true) {
                        onProgress?.({ progress: 1, total: 2, message: 'Fixture progress' });
                        const answer = await options?.elicitation?.request(
                            {
                                message: 'Origin challenge',
                                requestedSchema: {
                                    type: 'object',
                                    properties: { answer: { type: 'string' } },
                                    required: ['answer'],
                                },
                            },
                            signal ?? new AbortController().signal,
                        );
                        return { content: [], structuredContent: { arguments_, roots, answer } };
                    }
                    return { content: [], structuredContent: { arguments_, roots } };
                },
                close: async () => {},
                onExit() {},
                rootsChanged: async () => {},
            };
        },
    });
    const http = await createMcpHttpServer({ port: 0, core });
    const clients: Client[] = [];
    const transports: StreamableHTTPClientTransport[] = [];
    const inboundMethods: string[] = [];
    let rootsReplySent: () => void = () => {};
    const rootsReplied = new Promise<void>((resolve) => {
        rootsReplySent = resolve;
    });
    async function client(withRoots = false) {
        const selected = new Client(
            { name: 'http-fixture', version: '1' },
            { capabilities: withRoots ? { roots: {}, elicitation: { form: {} } } : {} },
        );
        clients.push(selected);
        const transport = new StreamableHTTPClientTransport(new URL(http.url));
        transports.push(transport);
        await selected.connect(transport);
        const send = transport.send.bind(transport);
        transport.send = async (message, options) => {
            await send(message, options);
            if ('result' in message && isRecord(message.result) && Array.isArray(message.result.roots))
                rootsReplySent();
        };
        const receive = transport.onmessage;
        transport.onmessage = (message) => {
            if ('method' in message) inboundMethods.push(message.method);
            receive?.(message);
        };
        return selected;
    }
    return {
        core,
        http,
        client,
        transports,
        inboundMethods,
        acquired,
        rootsReplied,
        releaseCall,
        callEntered,
        launched: () => launched,
        officialCalls: () => officialCalls,
        advance: (milliseconds: number) => {
            now += milliseconds;
        },
        async close() {
            await core.cleanup();
            await Promise.all(clients.map((item) => item.close()));
            await http.close();
        },
    };
}
function structured(value: unknown) {
    assert.ok(isRecord(value) && isRecord(value.structuredContent));
    return value.structuredContent;
}
async function register(client: Client) {
    const value = structured(await client.callTool({ name: 'dct_registration_register', arguments: {} }));
    assert.equal(typeof value.registrationBearer, 'string');
    return String(value.registrationBearer);
}

test('HTTP transport close is joinable and retrying App shutdown after it closes is harmless', async () => {
    const f = await fixture();
    const client = await f.client();
    await register(client);
    try {
        await Promise.all([f.http.close(), f.http.close()]);
        await f.http.close();
    } finally {
        await f.close();
    }
});
async function terminal(client: Client, registrationBearer: string, operationId: unknown) {
    for (let index = 0; index < 30; index++) {
        const result = structured(
            await client.callTool({ name: 'dct_operation_wait', arguments: { registrationBearer, operationId } }),
        );
        if (result.complete) {
            assert.ok(isRecord(result.operation));
            return result.operation;
        }
    }
    throw new Error('Fixture operation did not finish.');
}

test('authenticated HTTP errors preserve bounded busy and originating form-context guidance without raw upstream details', async () => {
    const f = await fixture();
    let pending: Promise<unknown> | undefined;
    try {
        const client = await f.client();
        const registrationBearer = await register(client);
        const accepted = structured(
            await client.callTool({
                name: 'dct_connection_start',
                arguments: {
                    registrationBearer,
                    requestId: 'bounded-errors',
                    isolation: { mode: 'none' },
                    launch: { executable: process.execPath },
                },
            }),
        );
        const completed = await terminal(client, registrationBearer, accepted.operationId);
        assert.ok(isRecord(completed.result));
        const route = {
            registrationBearer,
            connectionId: completed.result.connectionId,
            sessionId: completed.result.sessionId,
        };
        const call = (args: Record<string, unknown>) =>
            client.callTool({ name: 'echo', arguments: { ...args, _dct: route } });
        pending = call({ hold: true });
        await f.callEntered;
        await assert.rejects(call({}), (error: unknown) => {
            assert.ok(error instanceof ProtocolError);
            assert.equal(error.code, ProtocolErrorCode.InvalidParams);
            assert.match(error.message, /busy.*owned.*execution/i);
            assert.deepEqual(error.data, { code: 'CONNECTION_BUSY' });
            return true;
        });
        f.releaseCall();
        await pending;
        await assert.rejects(call({ challenge: true }), (error: unknown) => {
            assert.ok(error instanceof ProtocolError);
            assert.match(error.message, /originating client.*form-mode elicitation/i);
            assert.deepEqual(error.data, { code: 'FORM_ELICITATION_UNAVAILABLE' });
            return true;
        });
        await assert.rejects(call({ privateFailure: true }), (error: unknown) => {
            assert.ok(error instanceof ProtocolError);
            assert.equal(error.data, undefined);
            assert.doesNotMatch(error.message, /private-path-and-token-fixture/);
            return true;
        });
        await f.core.cleanup();
        await assert.rejects(
            client.callTool({
                name: 'dct_connection_start',
                arguments: {
                    registrationBearer,
                    requestId: 'after-cleanup',
                    isolation: { mode: 'none' },
                    launch: { executable: process.execPath },
                },
            }),
            (error: unknown) => {
                assert.ok(error instanceof ProtocolError);
                assert.match(error.message, /App is closing/);
                assert.deepEqual(error.data, { code: 'APP_CLOSING' });
                return true;
            },
        );
    } finally {
        f.releaseCall();
        await pending?.catch(() => {});
        await f.close();
    }
});

test('public HTTP Keep preserves the original held facility failure until execution settles without stale reasons or replay', async () => {
    const f = await fixture();
    let pending: Promise<unknown> | undefined;
    try {
        const client = await f.client();
        const registrationBearer = await register(client);
        const start = structured(
            await client.callTool({
                name: 'dct_connection_start',
                arguments: {
                    registrationBearer,
                    requestId: 'keep-race-start',
                    isolation: { mode: 'none' },
                    launch: { executable: process.execPath },
                },
            }),
        );
        const completed = await terminal(client, registrationBearer, start.operationId);
        assert.ok(isRecord(completed.result));
        const route = {
            registrationBearer,
            connectionId: completed.result.connectionId,
            sessionId: completed.result.sessionId,
        };
        const call = (arguments_: Record<string, unknown>) =>
            client.callTool({ name: 'echo', arguments: { ...arguments_, _dct: route } });
        const acquired = { ...f.acquired };
        pending = call({ holdFormFailure: true }).then(
            (result) => ({ result }),
            (error: unknown) => ({ error }),
        );
        await Promise.race([
            f.callEntered,
            delay(2000, undefined, { ref: false }).then(() => {
                throw new Error('Original local form refusal did not reach the explicit barrier.');
            }),
        ]);
        const assertBusy = (error: unknown) => {
            assert.ok(error instanceof ProtocolError);
            assert.deepEqual(error.data, { code: 'CONNECTION_BUSY' });
            return true;
        };
        await assert.rejects(call({}), assertBusy);
        const accepted = structured(
            await client.callTool({
                name: 'dct_connection_stop',
                arguments: {
                    ...route,
                    requestId: 'keep-held-execution',
                    disposition: 'Keep',
                },
            }),
        );
        const kept = await terminal(client, registrationBearer, accepted.operationId);
        assert.equal(kept.state, 'succeeded');
        await assert.rejects(call({}), assertBusy);
        assert.deepEqual(f.acquired, acquired);
        assert.equal(f.officialCalls(), 1);
        const selected = structured(
            await client.callTool({
                name: 'dct_connection_status',
                arguments: {
                    registrationBearer,
                    connectionId: route.connectionId,
                },
            }),
        );
        assert.equal(selected.sessionId, route.sessionId);
        assert.equal(selected.upstreamStatus, 'connected');
        f.releaseCall();
        const original = await pending;
        assert.ok(isRecord(original) && original.error instanceof ProtocolError);
        assert.deepEqual(original.error.data, { code: 'FORM_ELICITATION_UNAVAILABLE' });
        assert.match(original.error.message, /originating client.*form-mode elicitation/i);
        await assert.rejects(call({ privateFailure: true }), (error: unknown) => {
            assert.ok(error instanceof ProtocolError);
            assert.equal(error.data, undefined);
            assert.doesNotMatch(
                error.message,
                /form-mode elicitation|private-path-and-token-fixture|Translated upstream/,
            );
            return true;
        });
        assert.deepEqual(structured(await call({ value: 'unchanged-success' })), {
            arguments_: { value: 'unchanged-success' },
            roots: { roots: [] },
        });
        assert.equal(f.officialCalls(), 3);
        assert.deepEqual(f.acquired, acquired);
    } finally {
        f.releaseCall();
        await pending;
        await f.close();
        assert.equal(f.core.admin.cleanupState(), 'closed');
    }
});

test('actual SDK HTTP keeps delayed originating roots after an accepted start and survives client close', async () => {
    const selected = await fixture();
    try {
        const first = await selected.client(true);
        let release: () => void = () => {};
        let entered: () => void = () => {};
        const rootsEntered = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const rootsReleased = new Promise<void>((resolve) => {
            release = resolve;
        });
        first.setRequestHandler('roots/list', async () => {
            entered();
            await rootsReleased;
            return { roots: [{ uri: 'file:///original', name: 'original' }] };
        });
        const bearer = await register(first);
        const start = structured(
            await first.callTool({
                name: 'dct_connection_start',
                arguments: {
                    registrationBearer: bearer,
                    requestId: 'once',
                    launch: { executable: process.execPath },
                    isolation: { mode: 'none' },
                },
            }),
        );
        await Promise.race([
            rootsEntered,
            delay(2000).then(() => {
                throw new Error('No originating roots request.');
            }),
        ]);
        assert.equal(selected.launched(), 0);
        release();
        const done = await terminal(first, bearer, start.operationId);
        assert.equal(done.state, 'succeeded');
        assert.ok(isRecord(done.result));
        const route = {
            registrationBearer: bearer,
            connectionId: done.result.connectionId,
            sessionId: done.result.sessionId,
        };
        const echo = structured(await first.callTool({ name: 'echo', arguments: { value: 7, _dct: route } }));
        assert.deepEqual(echo.arguments_, { value: 7 });
        assert.deepEqual(echo.roots, { roots: [{ uri: 'file:///original', name: 'original' }] });
        assert.equal(JSON.stringify(done).includes('entryId'), false);
        assert.equal(JSON.stringify(done).includes('taskActive'), false);
        await first.close();
        const second = await selected.client();
        const resumed = structured(
            await second.callTool({ name: 'dct_connection_status', arguments: { registrationBearer: bearer } }),
        );
        assert.ok(Array.isArray(resumed.connections));
        assert.equal(resumed.connections.length, 1);
        const other = await register(second);
        const empty = structured(
            await second.callTool({ name: 'dct_connection_status', arguments: { registrationBearer: other } }),
        );
        assert.deepEqual(empty.connections, []);
        await assert.rejects(
            second.callTool({ name: 'echo', arguments: { _dct: { ...route, registrationBearer: other } } }),
        );
        await assert.rejects(second.callTool({ name: 'dct_connection_status', arguments: {} }));
    } finally {
        await selected.close();
    }
});

test('HTTP oversized refusal preserves the incomplete request until response handoff', async (t) => {
    const selected = await fixture();
    try {
        const own = await selected.client();
        const peer = await selected.client();
        const sessions = selected.transports.map((transport) => transport.sessionId);
        const acquired = { ...selected.acquired };
        await boundedFloodRefusal(t, selected.http.url, [' '.repeat(2 * 1024 * 1024)], { holdEnd: true });
        assert.deepEqual(selected.acquired, acquired);
        assert.equal(selected.launched(), 0);
        assert.equal(selected.officialCalls(), 0);
        assert.ok((await own.listTools()).tools.length > 0);
        assert.ok((await peer.listTools()).tools.length > 0);
        assert.deepEqual(
            selected.transports.map((transport) => transport.sessionId),
            sessions,
        );
    } finally {
        await selected.close();
    }
});

test('HTTP socket enforces endpoint headers, bounded streamed bodies and explicit port conflict', async (t) => {
    const selected = await fixture();
    const status = (headers: Record<string, string>, chunks: string[], expectRefusal = false) =>
        httpStatus(selected.http.url, headers, chunks, { expectRefusal });
    try {
        for (const [headers, expected] of [
            [{ Host: 'attacker.invalid' }, 403],
            [{ Origin: 'http://attacker.invalid' }, 403],
            [{ 'Content-Type': 'text/plain' }, 415],
        ] as const) {
            assert.equal(await status({ 'Content-Type': 'application/json', ...headers }, ['{}']), expected);
        }
        const tooLarge = await fetch(selected.http.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: ' '.repeat(4 * 1024 * 1024 + 1),
        });
        assert.equal(tooLarge.status, 413);
        assert.deepEqual(await tooLarge.json(), { error: 'Request body exceeds the limit.' });
        const own = await selected.client();
        const peer = await selected.client();
        const sessions = selected.transports.map((transport) => transport.sessionId);
        const acquired = { ...selected.acquired };
        await boundedFloodRefusal(t, selected.http.url, [
            ' '.repeat(2 * 1024 * 1024),
            ' '.repeat(2 * 1024 * 1024),
            ' ',
        ]);
        assert.deepEqual(selected.acquired, acquired);
        assert.equal(selected.launched(), 0);
        assert.equal(selected.officialCalls(), 0);
        assert.ok((await own.listTools()).tools.length > 0);
        assert.ok((await peer.listTools()).tools.length > 0);
        assert.deepEqual(
            selected.transports.map((transport) => transport.sessionId),
            sessions,
        );
        const port = Number(new URL(selected.http.url).port);
        await assert.rejects(createMcpHttpServer({ port, core: selected.core }), { code: 'EADDRINUSE' });
    } finally {
        await selected.close();
    }
});

test('HTTP raw UTF-8 boundaries cover content lengths and chunked bytes without closing healthy legacy sessions', async () => {
    const f = await fixture();
    const acquiredBefore = { ...f.acquired };
    try {
        assert.deepEqual(acquiredBefore, { directory: 0, router: 1, target: 0, official: 1 });
        const own = await f.client();
        const peer = await f.client();
        const session = f.transports[0]?.sessionId;
        assert.ok(session);
        const post = (body: Buffer, chunked: boolean) =>
            new Promise<{ status: number; body: string }>((resolve, reject) => {
                const request = httpRequest(
                    f.http.url,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json, text/event-stream',
                            'MCP-Protocol-Version': '2025-06-18',
                            'MCP-Session-Id': session,
                            ...(!chunked ? { 'Content-Length': String(body.length) } : {}),
                        },
                    },
                    (response) => {
                        let text = '';
                        response.on('data', (chunk: Buffer) => {
                            text += chunk.toString();
                        });
                        response.once('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
                    },
                );
                request.once('error', reject);
                if (chunked) {
                    request.write(body.subarray(0, 71));
                    request.write(body.subarray(71, 700001));
                    request.end(body.subarray(700001));
                } else request.end(body);
            });
        const empty = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping', params: { _meta: { padding: '' } } });
        for (const chunked of [false, true]) {
            for (const [bytes, status] of [
                [1048575, 200],
                [1048576, 200],
                [1048577, 413],
            ] as const) {
                const paddingBytes = bytes - Buffer.byteLength(empty);
                const padding = `${'é'.repeat(Math.floor(paddingBytes / 2))}${paddingBytes % 2 ? 'x' : ''}`;
                const body = Buffer.from(
                    JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping', params: { _meta: { padding } } }),
                );
                assert.equal(body.length, bytes);
                const result = await post(body, chunked);
                assert.equal(result.status, status, result.body);
                if (status === 413) assert.doesNotMatch(result.body, /padding|é/);
            }
        }
        const malformed = await post(Buffer.from('{"private":"do-not-echo"'), true);
        assert.equal(malformed.status, 400);
        assert.doesNotMatch(malformed.body, /private|do-not-echo/);
        const overflow = await post(
            Buffer.from(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: 7,
                    method: 'ping',
                    params: { _meta: { values: Array(10001).fill(null) } },
                }),
            ),
            false,
        );
        assert.equal(overflow.status, 413);
        // Four envelope members, params._meta and _meta.values use six members before the array.
        for (const [elements, status] of [
            [9993, 200],
            [9994, 200],
            [9995, 413],
        ] as const) {
            const result = await post(
                Buffer.from(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: 7,
                        method: 'ping',
                        params: { _meta: { values: Array(elements).fill(null) } },
                    }),
                ),
                false,
            );
            assert.equal(result.status, status, result.body);
        }
        // Envelope, params and _meta precede the first array container.
        for (const [arrays, status] of [
            [60, 200],
            [61, 200],
            [62, 413],
        ] as const) {
            const body = `{"jsonrpc":"2.0","id":7,"method":"ping","params":{"_meta":{"values":${'['.repeat(arrays)}${']'.repeat(arrays)}}}}`;
            const result = await post(Buffer.from(body), true);
            assert.equal(result.status, status, result.body);
        }
        assert.deepEqual((await own.listTools()).tools, (await peer.listTools()).tools);
        assert.equal(f.launched(), 0);
        assert.equal(f.officialCalls(), 0);
        assert.deepEqual(f.acquired, acquiredBefore);
    } finally {
        await f.close();
    }
});

test('parallel SDK HTTP callers keep roots, elicitation and progress on their originating request with no bearer readback', async () => {
    const f = await fixture();
    try {
        const clients = await Promise.all([f.client(true), f.client(true)]);
        const progress: number[][] = [[], []];
        const operationIds: unknown[] = [];
        const owners = await Promise.all(
            clients.map(async (client, index) => {
                client.setRequestHandler('roots/list', async () => ({ roots: [{ uri: `file:///owner-${index}` }] }));
                client.setRequestHandler('elicitation/create', async () => ({
                    action: 'accept',
                    content: { answer: `owner-${index}` },
                }));
                const registrationBearer = await register(client);
                const accepted = structured(
                    await client.callTool({
                        name: 'dct_connection_start',
                        arguments: {
                            registrationBearer,
                            requestId: 'same-per-registration',
                            isolation: { mode: 'none' },
                            launch: { executable: process.execPath },
                        },
                    }),
                );
                operationIds[index] = accepted.operationId;
                const operation = await terminal(client, registrationBearer, accepted.operationId);
                assert.equal(operation.state, 'succeeded');
                assert.ok(isRecord(operation.result));
                return {
                    registrationBearer,
                    connectionId: operation.result.connectionId,
                    sessionId: operation.result.sessionId,
                };
            }),
        );
        const results = await Promise.all(
            clients.map((client, index) =>
                client.callTool(
                    {
                        name: 'echo',
                        arguments: { challenge: true, _dct: owners[index] },
                    },
                    { onprogress: (value) => progress[index]?.push(value.progress) },
                ),
            ),
        );
        results.forEach((result, index) => {
            const value = structured(result);
            assert.deepEqual(value.arguments_, { challenge: true });
            assert.deepEqual(value.roots, { roots: [{ uri: `file:///owner-${index}` }] });
            assert.deepEqual(value.answer, { action: 'accept', content: { answer: `owner-${index}` } });
            assert.deepEqual(progress[index], [1]);
        });
        const owner = owners[0];
        assert.ok(owner);
        const first = clients[0];
        assert.ok(first);
        const projections = [
            results,
            f.core.admin.registrations(),
            f.core.admin.connections(),
            f.core.admin.operations(),
            await clients[0]?.callTool({
                name: 'dct_connection_status',
                arguments: { registrationBearer: owner.registrationBearer },
            }),
            await terminal(first, owner.registrationBearer, operationIds[0]),
        ];
        for (const registered of owners)
            assert.equal(JSON.stringify(projections).includes(registered.registrationBearer), false);
        await assert.rejects(
            clients[1]?.callTool({
                name: 'dct_operation_wait',
                arguments: { registrationBearer: owners[1]?.registrationBearer, operationId: operationIds[0] },
            }),
        );
        await assert.rejects(
            first.callTool({
                name: 'echo',
                arguments: { _dct: { ...owner, sessionId: '11111111-1111-4111-8111-111111111111' } },
            }),
        );
    } finally {
        await f.close();
    }
});

test('expired and unknown SDK HTTP bearers fail before resource reads or acquisition and never appear in errors', async () => {
    const f = await fixture();
    try {
        const client = await f.client();
        const registrationBearer = await register(client);
        f.advance(30 * 60 * 1000);
        const baseline = { ...f.acquired };
        for (const bearer of [registrationBearer, 'x'.repeat(43)]) {
            await assert.rejects(
                client.callTool({
                    name: 'dct_connection_start',
                    arguments: {
                        registrationBearer: bearer,
                        requestId: 'expired',
                        isolation: { mode: 'none' },
                        launch: { executable: process.execPath },
                    },
                }),
                (error: unknown) => error instanceof Error && !error.message.includes(bearer),
            );
            await assert.rejects(
                client.callTool({ name: 'dct_connection_status', arguments: { registrationBearer: bearer } }),
            );
        }
        assert.deepEqual(f.acquired, baseline);
    } finally {
        await f.close();
    }
});

for (const disposition of ['cancel', 'cleanup']) {
    test(`actual SDK HTTP ${disposition} ends local admission; ended-origin wire cancel is best effort`, async (context) => {
        const selected = await fixture();
        let release: () => void = () => {};
        try {
            const client = await selected.client(true);
            let entered: () => void = () => {};
            let remoteAborted = false;
            const rootsEntered = new Promise<void>((resolve) => {
                entered = resolve;
            });
            const rootsReleased = new Promise<void>((resolve) => {
                release = resolve;
            });
            client.setRequestHandler('roots/list', async (_request, context) => {
                context.mcpReq.signal.addEventListener(
                    'abort',
                    () => {
                        remoteAborted = true;
                    },
                    { once: true },
                );
                entered();
                await rootsReleased;
                return { roots: [{ uri: 'file:///too-late' }] };
            });
            const registrationBearer = await register(client);
            const baseline = { ...selected.acquired };
            const unhandled: unknown[] = [];
            const observeUnhandled = (error: unknown) => {
                unhandled.push(error);
            };
            process.on('unhandledRejection', observeUnhandled);
            try {
                const start = structured(
                    await client.callTool({
                        name: 'dct_connection_start',
                        arguments: {
                            registrationBearer,
                            requestId: disposition,
                            launch: { executable: process.execPath },
                            isolation: { mode: 'none' },
                        },
                    }),
                );
                await rootsEntered;
                if (disposition === 'cancel')
                    await client.callTool({
                        name: 'dct_operation_cancel',
                        arguments: { registrationBearer, operationId: start.operationId },
                    });
                else await selected.core.cleanup();
                const cancelled = await terminal(client, registrationBearer, start.operationId);
                assert.equal(cancelled.state, disposition === 'cancel' ? 'cancelled' : 'failed');
                assert.deepEqual(selected.acquired, baseline);
                context.diagnostic(
                    JSON.stringify({
                        disposition,
                        localAdmission: cancelled.state,
                        acquiredTargets: selected.launched(),
                        inboundMethods: selected.inboundMethods,
                    }),
                );
                release();
                await selected.rootsReplied;
                const result = await terminal(client, registrationBearer, start.operationId);
                assert.equal(result.state, cancelled.state);
                await delay(10);
                assert.deepEqual(selected.acquired, baseline);
                assert.equal(remoteAborted, false);
                assert.deepEqual(selected.inboundMethods, ['roots/list']);
                assert.deepEqual(unhandled, []);
            } finally {
                process.off('unhandledRejection', observeUnhandled);
            }
        } finally {
            release();
            await selected.close();
        }
    });
}
