import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, ProtocolError, ProtocolErrorCode, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { DataDirectoryRegistry } from '../src/adapters/data-directory.ts';
import { createMcpHttpServer } from '../src/adapters/mcp-http-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createGatewayCore } from '../src/gateway/core.ts';
import { isRecord } from '../src/shared/errors.ts';

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

test('HTTP socket enforces endpoint headers, bounded streamed bodies and explicit port conflict', async () => {
    const selected = await fixture();
    const status = (headers: Record<string, string>, chunks: string[]) =>
        new Promise<number>((resolve, reject) => {
            const request = httpRequest(selected.http.url, { method: 'POST', headers }, (response) => {
                response.resume();
                response.once('end', () => resolve(response.statusCode ?? 0));
            });
            request.once('error', reject);
            for (const chunk of chunks) request.write(chunk);
            request.end();
        });
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
        assert.equal(
            await status({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, [
                ' '.repeat(2 * 1024 * 1024),
                ' '.repeat(2 * 1024 * 1024),
                ' ',
            ]),
            413,
        );
        const port = Number(new URL(selected.http.url).port);
        await assert.rejects(createMcpHttpServer({ port, core: selected.core }), { code: 'EADDRINUSE' });
    } finally {
        await selected.close();
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
