import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import {
    Client,
    type ClientCapabilities,
    isInputRequiredResult,
    StreamableHTTPClientTransport,
    withInputRequired,
} from '@modelcontextprotocol/client';
import { CallToolResultSchema } from '@modelcontextprotocol/core';
import { createMcpHttpServer } from '../src/adapters/mcp-http-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createClientContext } from '../src/application/client-context.ts';
import type { CoreControlRequest } from '../src/domains/control-contract.ts';
import { createGatewayCore } from '../src/gateway/core.ts';
import { isRecord } from '../src/shared/errors.ts';

const BEARER = 'a'.repeat(48);
const PEER = 'b'.repeat(48);
const ROUTE = {
    registrationBearer: BEARER,
    connectionId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
};
const ROOTS = { roots: [{ uri: 'file:///fixture/workspace', name: 'fixture' }] };

async function fixture() {
    const calls: { request: CoreControlRequest; roots: unknown }[] = [];
    let effects = 0;
    let invokes = 0;
    const http = await createMcpHttpServer({
        port: 0,
        core: {
            tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }],
            register: () => ({ principal: { registrationId: 'fixture-owner' }, bearer: BEARER }),
            attachClient(bearer) {
                assert.ok(bearer === BEARER || bearer === PEER);
                return createClientContext({ registrationId: bearer === BEARER ? 'fixture-owner' : 'peer-owner' });
            },
            async control(request, context) {
                calls.push({ request, roots: await context.readRoots() });
                return { operationId: 'fixture-operation', accepted: true };
            },
            async invoke(_name, arguments_, context) {
                invokes++;
                effects++;
                context.progress({ progress: 1, message: 'before input' });
                const answers = [];
                const rounds = typeof arguments_.rounds === 'number' ? arguments_.rounds : 1;
                for (let index = 0; index < rounds; index++) {
                    answers.push(
                        await context.elicit({
                            message: `Form ${index + 1}`,
                            requestedSchema: {
                                type: 'object',
                                properties: { answer: { type: 'string' } },
                                required: ['answer'],
                            },
                        }),
                    );
                    context.progress({ progress: index + 2, message: 'after input' });
                }
                return { content: [], structuredContent: { answers } };
            },
        },
    });
    const clients: Client[] = [];
    const responses: { session: string | null; body: string }[] = [];
    const wire: { client: number; message: unknown }[] = [];
    const reads: Promise<void>[] = [];
    async function client(modern = true, capabilities: ClientCapabilities = {}) {
        const clientIndex = clients.length;
        const selected = new Client(
            { name: 'modern-http-fixture', version: '1' },
            { capabilities, ...(modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}) },
        );
        clients.push(selected);
        await selected.connect(
            new StreamableHTTPClientTransport(new URL(http.url), {
                fetch: async (input, init) => {
                    const response = await fetch(input, init);
                    if (
                        modern &&
                        init?.method === 'POST' &&
                        response.headers.get('content-type')?.startsWith('text/event-stream')
                    ) {
                        reads.push(
                            response
                                .clone()
                                .text()
                                .then((body) => {
                                    for (const line of body.split('\n')) {
                                        if (!line.startsWith('data:')) continue;
                                        const message: unknown = JSON.parse(line.slice(5));
                                        wire.push({ client: clientIndex, message });
                                    }
                                }),
                        );
                    }
                    responses.push({
                        session: response.headers.get('mcp-session-id'),
                        body: response.headers.get('content-type')?.startsWith('text/event-stream')
                            ? ''
                            : await response.clone().text(),
                    });
                    return response;
                },
            }),
        );
        return selected;
    }
    return {
        client,
        calls,
        responses,
        wire,
        drain: () => Promise.all(reads),
        http,
        effects: () => effects,
        invokes: () => invokes,
        async close() {
            await Promise.all(clients.map((item) => item.close()));
            await http.close();
            await Promise.allSettled(reads);
        },
    };
}

function manual(client: Client, name: string, arguments_: Record<string, unknown>, continuation = {}, options = {}) {
    return client.request(
        { method: 'tools/call', params: { name, arguments: arguments_, ...continuation } },
        withInputRequired(CallToolResultSchema),
        { allowInputRequired: true, ...options },
    );
}

function gate() {
    let open = () => {};
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

async function ownedFixture(mode: 'before' | 'after' | 'input') {
    const entered = gate();
    const release = gate();
    const formRejected = gate();
    const settled = gate();
    let actualCalls = 0;
    let closedTargets = 0;
    let closedUpstreams = 0;
    const tool = { name: 'echo', inputSchema: { type: 'object' as const, properties: {} } };
    const catalog = createToolCatalog({ version: '1.11.0', tools: [{ name: 'echo', requires: {}, variants: [tool] }] });
    const core = await createGatewayCore({
        loadCatalog: async () => catalog,
        createRouter: async () => ({
            url: 'http://127.0.0.1:30000',
            isBusy: () => false,
            setTarget() {},
            clearTarget() {},
            close: async () => {},
        }),
        createHost: () => {
            const child = new EventEmitter();
            return {
                launch: async () => ({
                    processId: 42,
                    port: 9222,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-17T00:00:00Z',
                    targetKind: 'generic-cdp' as const,
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: [] },
                }),
                close: async () => {
                    closedTargets++;
                    child.emit('exit');
                    return true;
                },
            };
        },
        createConnection: async (_url, options) => ({
            tools: [tool],
            async call(_name, args, signal, onProgress) {
                actualCalls++;
                if (!args.hold) return { content: [] };
                onProgress?.({ progress: 1 });
                if (mode !== 'before') {
                    try {
                        await options?.elicitation?.request(
                            {
                                message: 'Owned form',
                                requestedSchema: {
                                    type: 'object',
                                    properties: { answer: { type: 'string' } },
                                    required: ['answer'],
                                },
                            },
                            signal ?? new AbortController().signal,
                        );
                    } catch {
                        formRejected.open();
                    }
                }
                onProgress?.({ progress: 2 });
                entered.open();
                await release.promise;
                onProgress?.({ progress: 3 });
                settled.open();
                return { content: [] };
            },
            close: async () => {
                closedUpstreams++;
            },
            onExit() {},
            rootsChanged: async () => {},
        }),
    });
    // Discard bootstrap-discovery disposal counts; the selected live pair begins below.
    closedUpstreams = 0;
    const http = await createMcpHttpServer({ port: 0, core });
    const client = new Client(
        { name: 'owned-modern-fixture', version: '1' },
        {
            capabilities: { elicitation: { form: {} } },
            versionNegotiation: { mode: { pin: '2026-07-28' } },
        },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
    const registered = await client.callTool({ name: 'dct_registration_register', arguments: {} });
    assert.ok(isRecord(registered.structuredContent));
    const registrationBearer = registered.structuredContent.registrationBearer;
    const accepted = await client.callTool({
        name: 'dct_connection_start',
        arguments: {
            registrationBearer,
            requestId: 'owned-start',
            isolation: { mode: 'none' },
            launch: { executable: process.execPath },
        },
    });
    assert.ok(isRecord(accepted.structuredContent));
    let route: Record<string, unknown> = {};
    for (let index = 0; index < 20; index++) {
        const value = await client.callTool({
            name: 'dct_operation_wait',
            arguments: {
                registrationBearer,
                operationId: accepted.structuredContent.operationId,
            },
        });
        if (isRecord(value.structuredContent) && value.structuredContent.complete) {
            const operation = value.structuredContent.operation;
            assert.ok(isRecord(operation) && isRecord(operation.result));
            route = {
                registrationBearer,
                connectionId: operation.result.connectionId,
                sessionId: operation.result.sessionId,
            };
            break;
        }
    }
    assert.ok(route.connectionId);
    return {
        client,
        http,
        core,
        route,
        entered,
        release,
        formRejected,
        settled,
        calls: () => actualCalls,
        closed: () => [closedTargets, closedUpstreams],
        async close() {
            release.open();
            await core.cleanup();
            await client.close();
            await http.close();
        },
    };
}

test('strict modern and sessionful legacy discover the same fixed tools through one Core', async () => {
    const f = await fixture();
    try {
        const modern = await f.client();
        const legacy = await f.client(false);
        const modernTools = await modern.listTools();
        assert.deepEqual(modernTools.tools, (await legacy.listTools()).tools);
        assert.equal(modernTools.tools.length, 8);
        for (const client of [modern, legacy]) {
            const result = await client.callTool({ name: 'dct_registration_register', arguments: {} });
            assert.ok(isRecord(result.structuredContent));
            assert.equal(result.structuredContent.registrationBearer, BEARER);
        }
        assert.ok(f.responses.some((response) => response.session));
        assert.ok(f.responses.some((response) => !response.session && response.body.includes('resultType')));
    } finally {
        await f.close();
    }
});

test('modern roots are required before accepting a start and bind continuation to owner and arguments', async () => {
    const f = await fixture();
    try {
        const client = await f.client(true, { roots: {} });
        const arguments_ = {
            registrationBearer: BEARER,
            requestId: 'modern-start',
            isolation: { mode: 'none' },
            launch: { executable: process.execPath },
        };
        const first = await manual(client, 'dct_connection_start', arguments_);
        assert.ok(isInputRequiredResult(first));
        assert.equal(f.calls.length, 0);
        assert.ok(first.inputRequests?.roots);
        assert.equal(typeof first.requestState, 'string');
        for (const changed of [
            { ...arguments_, registrationBearer: PEER },
            { ...arguments_, requestId: 'changed' },
        ]) {
            await assert.rejects(
                manual(client, 'dct_connection_start', changed, {
                    requestState: first.requestState,
                    inputResponses: { roots: ROOTS },
                }),
            );
            assert.equal(f.calls.length, 0);
        }
        const result = await manual(client, 'dct_connection_start', arguments_, {
            requestState: first.requestState,
            inputResponses: { roots: ROOTS },
        });
        assert.ok(!isInputRequiredResult(result));
        assert.deepEqual(f.calls[0]?.roots, ROOTS);
        assert.equal(f.calls.length, 1);
    } finally {
        await f.close();
    }
});

test('modern form continuation resumes two forms on one actual invocation after intermediate server close', async () => {
    const f = await fixture();
    try {
        const client = await f.client(true, { elicitation: { form: {} } });
        const args = { _dct: ROUTE, rounds: 2 };
        let result = await manual(client, 'echo', args);
        for (const answer of ['one', 'two']) {
            assert.ok(isInputRequiredResult(result));
            assert.ok(result.inputRequests);
            const [key] = Object.keys(result.inputRequests);
            assert.ok(key);
            await new Promise<void>((resolve) => setImmediate(resolve));
            result = await manual(client, 'echo', args, {
                requestState: result.requestState,
                inputResponses: { [key]: { action: 'accept', content: { answer } } },
            });
        }
        assert.ok(!isInputRequiredResult(result));
        assert.deepEqual(result.structuredContent, {
            answers: [
                { action: 'accept', content: { answer: 'one' } },
                { action: 'accept', content: { answer: 'two' } },
            ],
        });
        assert.equal(f.invokes(), 1);
        assert.equal(f.effects(), 1);
    } finally {
        await f.close();
    }
});

test('modern roots reject malformed, wrapped, tampered, expired and downgraded continuations before Core effects', async (t) => {
    const f = await fixture();
    try {
        const client = await f.client(true, { roots: {} });
        const args = {
            registrationBearer: BEARER,
            requestId: 'roots-adversarial',
            isolation: { mode: 'none' },
            launch: { executable: process.execPath },
        };
        const first = await manual(client, 'dct_connection_start', args);
        assert.ok(isInputRequiredResult(first));
        const base = { requestState: first.requestState };
        await assert.rejects(
            manual(client, 'dct_connection_start', args, {
                requestState: `${first.requestState}tampered`,
                inputResponses: { roots: ROOTS },
            }),
        );
        await assert.rejects(
            manual(client, 'dct_connection_start', args, {
                ...base,
                inputResponses: { roots: { roots: [{ uri: 42 }] } },
            }),
        );
        const wrapped = await manual(client, 'dct_connection_start', args, {
            ...base,
            inputResponses: { roots: { method: 'roots/list', result: ROOTS } },
        });
        assert.ok(isInputRequiredResult(wrapped));
        const missing = await manual(client, 'dct_connection_start', args, base);
        assert.ok(isInputRequiredResult(missing));
        const peer = await f.client();
        await assert.rejects(manual(peer, 'dct_connection_start', args, { ...base, inputResponses: { roots: ROOTS } }));
        assert.equal(f.calls.length, 0);
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        t.mock.timers.tick(600_001);
        await assert.rejects(
            manual(client, 'dct_connection_start', args, { ...base, inputResponses: { roots: ROOTS } }),
        );
        assert.equal(f.calls.length, 0);
    } finally {
        t.mock.timers.reset();
        await f.close();
    }
});

test('modern form replies require the original principal, route, arguments, capability and unconsumed validated round', async () => {
    const f = await fixture();
    try {
        const client = await f.client(true, { elicitation: { form: {} } });
        const args = { _dct: ROUTE, rounds: 2 };
        const first = await manual(client, 'echo', args);
        assert.ok(isInputRequiredResult(first));
        const continuation = {
            requestState: first.requestState,
            inputResponses: { form1: { action: 'accept', content: { answer: 'first' } } },
        };
        for (const changed of [
            { ...args, rounds: 1 },
            { ...args, _dct: { ...ROUTE, registrationBearer: PEER } },
            { ...args, _dct: { ...ROUTE, sessionId: '00000000-0000-4000-8000-000000000003' } },
        ])
            await assert.rejects(manual(client, 'echo', changed, continuation));
        const incapable = await f.client();
        await assert.rejects(manual(incapable, 'echo', args, continuation));
        for (const value of [{ action: 'accept', content: { answer: 7 } }, { action: 'unknown' }, { action: 'accept' }])
            await assert.rejects(
                manual(client, 'echo', args, { requestState: first.requestState, inputResponses: { form1: value } }),
            );
        const missing = await manual(client, 'echo', args, { requestState: first.requestState });
        assert.ok(isInputRequiredResult(missing));
        const wrapped = await manual(client, 'echo', args, {
            requestState: first.requestState,
            inputResponses: { form1: { method: 'elicitation/create', result: { action: 'decline' } } },
        });
        assert.ok(isInputRequiredResult(wrapped));
        const second = await manual(client, 'echo', args, continuation);
        assert.ok(isInputRequiredResult(second));
        await assert.rejects(manual(client, 'echo', args, continuation));
        const result = await manual(client, 'echo', args, {
            requestState: second.requestState,
            inputResponses: { form2: { action: 'cancel' } },
        });
        assert.ok(!isInputRequiredResult(result));
        await assert.rejects(
            manual(client, 'echo', args, {
                requestState: second.requestState,
                inputResponses: { form2: { action: 'accept', content: { answer: 'late' } } },
            }),
            /input.*unavailable|expired/i,
        );
        assert.equal(f.invokes(), 1);
        assert.equal(f.effects(), 1);
    } finally {
        await f.close();
    }
});

test('form decline and cancellation are forwarded as outcomes and a ninth round cannot replay the invocation', async () => {
    const f = await fixture();
    try {
        const client = await f.client(true, { elicitation: { form: {} } });
        for (const action of ['decline', 'cancel']) {
            const first = await manual(client, 'echo', { _dct: ROUTE });
            assert.ok(isInputRequiredResult(first));
            const result = await manual(
                client,
                'echo',
                { _dct: ROUTE },
                { requestState: first.requestState, inputResponses: { form1: { action } } },
            );
            assert.ok(!isInputRequiredResult(result));
            assert.deepEqual(result.structuredContent, { answers: [{ action }] });
        }
        const args = { _dct: ROUTE, rounds: 9 };
        let result = await manual(client, 'echo', args);
        for (let round = 1; round <= 8; round++) {
            assert.ok(isInputRequiredResult(result));
            const request = manual(client, 'echo', args, {
                requestState: result.requestState,
                inputResponses: { [`form${round}`]: { action: 'decline' } },
            });
            if (round === 8) await assert.rejects(request, /eight.*form|form.*eight/i);
            else result = await request;
        }
        assert.equal(f.invokes(), 3);
        assert.equal(f.effects(), 3);
    } finally {
        await f.close();
    }
});

test('modern progress uses zero and continuation tokens only on the current originating exchange', async () => {
    const f = await fixture();
    try {
        const client = await f.client(true, { elicitation: { form: {} } });
        await f.client(true, { elicitation: { form: {} } });
        const args = { _dct: ROUTE };
        const first = await manual(client, 'echo', args, { _meta: { progressToken: 0 } });
        assert.ok(isInputRequiredResult(first));
        const result = await manual(client, 'echo', args, {
            requestState: first.requestState,
            inputResponses: { form1: { action: 'decline' } },
            _meta: { progressToken: 'continuation-token' },
        });
        assert.ok(!isInputRequiredResult(result));
        const noToken = await manual(client, 'echo', args);
        assert.ok(isInputRequiredResult(noToken));
        await manual(client, 'echo', args, {
            requestState: noToken.requestState,
            inputResponses: { form1: { action: 'decline' } },
        });
        await f.drain();
        const progress = f.wire.filter(
            (entry) => isRecord(entry.message) && entry.message.method === 'notifications/progress',
        );
        assert.deepEqual(
            progress.map((entry) => {
                assert.ok(isRecord(entry.message));
                return { client: entry.client, params: entry.message.params };
            }),
            [
                { client: 0, params: { progress: 1, message: 'before input', progressToken: 0 } },
                { client: 0, params: { progress: 2, message: 'after input', progressToken: 'continuation-token' } },
            ],
        );
        assert.equal(f.effects(), 2);
    } finally {
        await f.close();
    }
});

test('real Core modern start retains captured roots after acceptance and domain retries acquire one target', async () => {
    let launched = 0;
    let routers = 0;
    let upstreams = 0;
    const tool = { name: 'echo', inputSchema: { type: 'object' as const, properties: {} } };
    const catalog = createToolCatalog({ version: '1.11.0', tools: [{ name: 'echo', requires: {}, variants: [tool] }] });
    const core = await createGatewayCore({
        loadCatalog: async () => catalog,
        createRouter: async () => {
            routers++;
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
        createConnection: async () => {
            upstreams++;
            return {
                tools: [tool],
                call: async () => ({ content: [] }),
                close: async () => {},
                onExit() {},
                rootsChanged: async () => {},
            };
        },
    });
    // Core bootstrap owns a disposable catalog-discovery router/upstream before HTTP is callable.
    assert.deepEqual([routers, launched, upstreams], [1, 0, 1]);
    routers = 0;
    upstreams = 0;
    const http = await createMcpHttpServer({ port: 0, core });
    const client = new Client(
        { name: 'real-core-modern', version: '1' },
        {
            capabilities: { roots: {} },
            versionNegotiation: { mode: { pin: '2026-07-28' } },
        },
    );
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
        const registered = await client.callTool({ name: 'dct_registration_register', arguments: {} });
        assert.ok(isRecord(registered.structuredContent));
        const args = {
            registrationBearer: registered.structuredContent.registrationBearer,
            requestId: 'one-modern-start',
            isolation: { mode: 'none' },
            launch: { executable: process.execPath },
        };
        const first = await manual(client, 'dct_connection_start', args);
        assert.ok(isInputRequiredResult(first));
        assert.deepEqual([routers, launched, upstreams], [0, 0, 0]);
        const continuation = { requestState: first.requestState, inputResponses: { roots: ROOTS } };
        const accepted = await manual(client, 'dct_connection_start', args, continuation);
        assert.ok(!isInputRequiredResult(accepted) && isRecord(accepted.structuredContent));
        for (let index = 0; index < 20; index++) {
            const value = await client.callTool({
                name: 'dct_operation_wait',
                arguments: {
                    registrationBearer: args.registrationBearer,
                    operationId: accepted.structuredContent.operationId,
                },
            });
            if (isRecord(value.structuredContent) && value.structuredContent.complete) break;
        }
        const repeated = await manual(client, 'dct_connection_start', args, continuation);
        assert.ok(!isInputRequiredResult(repeated));
        assert.ok(isRecord(repeated.structuredContent));
        assert.equal(repeated.structuredContent.operationId, accepted.structuredContent.operationId);
        assert.deepEqual([routers, launched, upstreams], [1, 1, 1]);
        await assert.rejects(
            manual(
                client,
                'dct_connection_start',
                { ...args, launch: { executable: process.execPath, args: ['changed'] } },
                continuation,
            ),
        );
    } finally {
        await core.cleanup();
        await client.close();
        await http.close();
    }
});

for (const mode of ['before', 'after'] as const) {
    test(`modern cancellation ${mode} input detaches facilities while real Core execution remains busy`, async () => {
        const f = await ownedFixture(mode);
        let held: Promise<unknown> | undefined;
        try {
            const args = { _dct: f.route, hold: true };
            const abort = new AbortController();
            const seen: number[] = [];
            if (mode === 'after') {
                const first = await manual(f.client, 'echo', args);
                assert.ok(isInputRequiredResult(first));
                held = manual(
                    f.client,
                    'echo',
                    args,
                    {
                        requestState: first.requestState,
                        inputResponses: { form1: { action: 'accept', content: { answer: 'owned' } } },
                    },
                    { signal: abort.signal, onprogress: (value: { progress: number }) => seen.push(value.progress) },
                );
            } else {
                held = manual(
                    f.client,
                    'echo',
                    args,
                    {},
                    { signal: abort.signal, onprogress: (value: { progress: number }) => seen.push(value.progress) },
                );
            }
            const rejected = assert.rejects(held);
            await f.entered.promise;
            abort.abort(new Error('Fixture client cancelled.'));
            await rejected;
            await assert.rejects(manual(f.client, 'echo', { _dct: f.route }), /busy/i);
            assert.deepEqual(f.closed(), [0, 0]);
            assert.equal(f.calls(), 1);
            const progressAtDetach = [...seen];
            f.release.open();
            await f.settled.promise;
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.deepEqual(seen, progressAtDetach);
            await manual(f.client, 'echo', { _dct: f.route });
            assert.equal(f.calls(), 2);
        } finally {
            f.release.open();
            await held?.catch(() => {});
            await f.close();
        }
    });
}

test('abandoned form holder expires without releasing owned resources or busy actual execution', async (t) => {
    const f = await ownedFixture('input');
    try {
        const args = { _dct: f.route, hold: true };
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
        const first = await manual(f.client, 'echo', args);
        assert.ok(isInputRequiredResult(first));
        t.mock.timers.tick(600_001);
        await f.formRejected.promise;
        await f.entered.promise;
        assert.equal(f.calls(), 1);
        assert.deepEqual(f.closed(), [0, 0]);
        t.mock.timers.reset();
        await assert.rejects(
            manual(f.client, 'echo', args, {
                requestState: first.requestState,
                inputResponses: { form1: { action: 'decline' } },
            }),
        );
        await assert.rejects(manual(f.client, 'echo', { _dct: f.route }), /busy/i);
    } finally {
        t.mock.timers.reset();
        f.release.open();
        await f.close();
    }
});

test('raw modern SSE socket abort detaches the original context while the owned execution stays busy', {
    timeout: 10_000,
}, async () => {
    const f = await ownedFixture('before');
    try {
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 77,
            method: 'tools/call',
            params: {
                name: 'echo',
                arguments: { hold: true, _dct: f.route },
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                    'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
                    'io.modelcontextprotocol/clientInfo': { name: 'raw-socket', version: '1' },
                    progressToken: 0,
                },
            },
        });
        const socket = httpRequest(f.http.url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                'mcp-protocol-version': '2026-07-28',
                'mcp-method': 'tools/call',
                'mcp-name': 'echo',
                'content-length': Buffer.byteLength(body),
            },
        });
        socket.on('error', () => {});
        const received = new Promise<void>((resolve, reject) => {
            socket.on('response', (response) => {
                response.once('data', (data) => {
                    if (response.statusCode !== 200)
                        reject(new Error(`Fixture HTTP ${response.statusCode}: ${String(data)}`));
                    else resolve();
                    response.destroy();
                });
                response.on('error', () => {});
            });
            socket.on('error', reject);
        });
        socket.end(body);
        await received;
        await f.entered.promise;
        await assert.rejects(manual(f.client, 'echo', { _dct: f.route }), /busy/i);
        assert.equal(f.calls(), 1);
        assert.deepEqual(f.closed(), [0, 0]);
    } finally {
        f.release.open();
        await f.close();
    }
});

test('malformed modern traffic never falls back to a legacy session or reaches Core effects', async () => {
    const f = await fixture();
    try {
        const base = {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'policy-fixture', version: '1' },
        };
        for (const [version, method, meta] of [
            ['2026-12-15', 'tools/call', { ...base, 'io.modelcontextprotocol/protocolVersion': '2026-12-15' }],
            ['2026-07-28', 'tools/call', {}],
            ['2026-07-28', 'tools/list', base],
            ['2026-07-28', 'tools/call', { ...base, 'io.modelcontextprotocol/clientCapabilities': 'invalid' }],
            ['2026-07-28', 'tools/call', { ...base, 'io.modelcontextprotocol/protocolVersion': '2025-06-18' }],
        ] as const) {
            const response = await fetch(f.http.url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json, text/event-stream',
                    'mcp-protocol-version': version,
                    'mcp-method': method,
                    'mcp-name': 'dct_registration_register',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: {
                        name: 'dct_registration_register',
                        arguments: {},
                        _meta: meta,
                    },
                }),
            });
            const text = await response.text();
            assert.ok(response.status >= 400, text);
            assert.equal(response.headers.get('mcp-session-id'), null);
        }
        const huge = await fetch(f.http.url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'mcp-protocol-version': '2026-07-28',
            },
            body: ' '.repeat(4 * 1024 * 1024 + 1),
        });
        assert.equal(huge.status, 413);
        await huge.text();
        const url = new URL(f.http.url);
        const duplicate = await new Promise<number | undefined>((resolve, reject) => {
            const request = httpRequest(
                url,
                {
                    method: 'POST',
                    headers: [
                        'Host',
                        url.host,
                        'Content-Type',
                        'application/json',
                        'Content-Length',
                        '2',
                        'MCP-Protocol-Version',
                        '2026-07-28',
                        'MCP-Protocol-Version',
                        '2026-07-28',
                    ],
                },
                (response) => {
                    response.resume();
                    response.on('end', () => resolve(response.statusCode));
                },
            );
            request.on('error', reject);
            request.end('{}');
        });
        assert.equal(duplicate, 400);
        assert.equal(f.calls.length, 0);
        assert.equal(f.effects(), 0);
    } finally {
        await f.close();
    }
});

test('concurrent continuation duplicates resolve only one input round without another invocation', async () => {
    const f = await fixture();
    try {
        const client = await f.client(true, { elicitation: { form: {} } });
        const args = { _dct: ROUTE, rounds: 2 };
        const first = await manual(client, 'echo', args);
        assert.ok(isInputRequiredResult(first));
        const next = { requestState: first.requestState, inputResponses: { form1: { action: 'decline' } } };
        const replies = await Promise.allSettled([
            manual(client, 'echo', args, next),
            manual(client, 'echo', args, next),
        ]);
        assert.equal(replies.filter((reply) => reply.status === 'fulfilled').length, 1);
        assert.equal(replies.filter((reply) => reply.status === 'rejected').length, 1);
        const allowed = replies.find((reply) => reply.status === 'fulfilled');
        assert.ok(allowed?.status === 'fulfilled' && isInputRequiredResult(allowed.value));
        await manual(client, 'echo', args, {
            requestState: allowed.value.requestState,
            inputResponses: { form2: { action: 'decline' } },
        });
        assert.equal(f.invokes(), 1);
        assert.equal(f.effects(), 1);
    } finally {
        await f.close();
    }
});

test('real Core modern form continuation finishes the same upstream execution after the first exchange ends', async () => {
    const f = await ownedFixture('after');
    try {
        const args = { _dct: f.route, hold: true };
        const first = await manual(f.client, 'echo', args);
        assert.ok(isInputRequiredResult(first));
        const result = manual(f.client, 'echo', args, {
            requestState: first.requestState,
            inputResponses: { form1: { action: 'accept', content: { answer: 'continued' } } },
        });
        await f.entered.promise;
        assert.equal(f.calls(), 1);
        assert.deepEqual(f.closed(), [0, 0]);
        f.release.open();
        assert.ok(!isInputRequiredResult(await result));
        assert.equal(f.calls(), 1);
    } finally {
        f.release.open();
        await f.close();
    }
});
