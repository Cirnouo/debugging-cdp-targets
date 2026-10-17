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
import { createGatewayCore } from '../src/application/plugin-runtime.ts';
import type { CoreControlRequest } from '../src/domains/control-contract.ts';
import { isRecord } from '../src/shared/errors.ts';

const BEARER = 'a'.repeat(48);
const PEER = 'b'.repeat(48);
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
