import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createOfficialConnection } from '../src/adapters/mcp-bridge.ts';
import { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';

const route = {
    connectionId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
};

import { preserveZeroRequestCancellation } from '../src/adapters/mcp-transport.ts';

test('transport preserves cancellation for ID zero without changing other protocol fields', async () => {
    const [base, peer] = InMemoryTransport.createLinkedPair();
    const transport = preserveZeroRequestCancellation(base);
    const inbound: import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage[] = [];
    const outbound: import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage[] = [];
    transport.onmessage = (message) => {
        inbound.push(message);
    };
    peer.onmessage = (message) => {
        outbound.push(message);
    };
    await transport.start();
    await peer.start();
    const original = {
        jsonrpc: '2.0' as const,
        id: 0,
        method: 'tools/call',
        params: { name: 'unchanged', arguments: { value: 0 }, _meta: { progressToken: 0 } },
    };
    await transport.send(original);
    const sent = outbound.pop();
    assert.ok(sent && 'id' in sent && typeof sent.id === 'string');
    const wireId = sent.id;
    assert.deepEqual(sent, { ...original, id: wireId });
    await transport.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 0, reason: 'cancel' },
    });
    assert.deepEqual(outbound.pop(), {
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: wireId, reason: 'cancel' },
    });
    await peer.send({ jsonrpc: '2.0', id: wireId, result: { exact: true } });
    assert.deepEqual(inbound.pop(), { jsonrpc: '2.0', id: 0, result: { exact: true } });
    await peer.send({ jsonrpc: '2.0', id: wireId, result: {} });
    assert.deepEqual(inbound.pop(), { jsonrpc: '2.0', id: wireId, result: {} });
    await peer.send(original);
    const received = inbound.pop();
    assert.ok(received && 'id' in received && typeof received.id === 'string');
    const internalId = received.id;
    assert.notEqual(internalId, wireId);
    assert.deepEqual(received, { ...original, id: internalId });
    await peer.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0, reason: 'cancel' } });
    assert.deepEqual(inbound.pop(), {
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: internalId, reason: 'cancel' },
    });
    await transport.send({ jsonrpc: '2.0', id: internalId, result: { exact: true } });
    assert.deepEqual(outbound.pop(), { jsonrpc: '2.0', id: 0, result: { exact: true } });
    await transport.send({ jsonrpc: '2.0', id: internalId, result: {} });
    assert.deepEqual(outbound.pop(), { jsonrpc: '2.0', id: internalId, result: {} });
    for (const id of [42, 'original-string']) {
        const message = { ...original, id };
        await transport.send(message);
        assert.deepEqual(outbound.pop(), message);
        await peer.send(message);
        assert.deepEqual(inbound.pop(), message);
        const cancel = {
            jsonrpc: '2.0' as const,
            method: 'notifications/cancelled',
            params: { requestId: id, reason: 'unchanged' },
        };
        await transport.send(cancel);
        assert.deepEqual(outbound.pop(), cancel);
        await peer.send(cancel);
        assert.deepEqual(inbound.pop(), cancel);
    }
    await transport.send(original);
    const active = outbound.pop();
    assert.ok(active && 'id' in active && active.id !== undefined);
    await peer.send(original);
    const activeIncoming = inbound.pop();
    assert.ok(activeIncoming && 'id' in activeIncoming && activeIncoming.id !== undefined);
    await transport.close();
    base.onmessage?.({ jsonrpc: '2.0', id: active.id, result: {} });
    assert.deepEqual(inbound.pop(), { jsonrpc: '2.0', id: active.id, result: {} });
    base.send = async (message) => {
        outbound.push(message);
    };
    await transport.send({ jsonrpc: '2.0', id: activeIncoming.id, result: {} });
    assert.deepEqual(outbound.pop(), { jsonrpc: '2.0', id: activeIncoming.id, result: {} });
    await peer.close();
});

async function boundedSignal(signal: Promise<void>, description: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            signal,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(description)), 2000);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

test('entry preserves official tools and forwards calls, roots, progress and lifecycle choices', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const tool = {
        name: 'official_echo',
        inputSchema: { type: 'object' as const, properties: { value: { type: 'string' } } },
    };
    let rootsChanged = false;
    const entry = createMcpEntryServer({
        onRootsChanged: async () => {
            rootsChanged = true;
        },
        tools: [tool],
        transport: serverTransport,
        status: () => ({ state: 'idle' }),
        watch: async (_route, signal) => ({ choice: await entry.askLoss('目标已退出', signal) }),
        invoke: async (name, arguments_, signal, progress) => {
            assert.equal(name, tool.name);
            assert.equal(signal.aborted, false);
            progress({ progress: 1, total: 1 });
            return { content: [{ type: 'text', text: String(arguments_.value) }] };
        },
    });
    const client = new Client(
        { name: 'test', version: '1' },
        { capabilities: { roots: { listChanged: true }, elicitation: { form: {} } } },
    );
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: 'file:///test' }] }));
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
        assert.equal(request.params.mode, 'form');
        if (request.params.mode !== 'form') throw new Error('Expected form');
        assert.deepEqual(request.params.requestedSchema.properties.action, {
            type: 'string',
            title: '目标连接已断开，请选择下一步',
            enum: ['restart', 'cancel'],
            enumNames: ['误关闭，使用原端口重新启动', '有意关闭，终止依赖该目标的任务'],
        });
        return { action: 'accept', content: { action: 'restart' } };
    });
    await entry.connect();
    assert.equal(entry.supportsFormElicitation(), false);
    assert.equal(entry.supportsRoots(), false);
    await client.connect(clientTransport);
    assert.equal(entry.supportsFormElicitation(), true);
    assert.equal(entry.supportsRoots(), true);
    try {
        const exposed = (await client.listTools()).tools[0];
        assert.equal(exposed?.name, tool.name);
        assert.deepEqual(exposed?.inputSchema.properties?.value, tool.inputSchema.properties.value);
        assert.deepEqual(exposed?.inputSchema.required, ['_dct']);
        assert.deepEqual(tool.inputSchema.properties, { value: { type: 'string' } });
        let progressed = false;
        assert.deepEqual(
            await client.callTool({ name: tool.name, arguments: { value: 'ok', _dct: route } }, undefined, {
                onprogress: () => {
                    progressed = true;
                },
            }),
            { content: [{ type: 'text', text: 'ok' }] },
        );
        assert.equal(progressed, true);
        assert.deepEqual(await entry.roots(), { roots: [{ uri: 'file:///test' }] });
        await client.sendRootsListChanged();
        assert.equal(rootsChanged, true);
        assert.deepEqual((await client.callTool({ name: 'dct_connection_status' })).structuredContent, {
            state: 'idle',
        });
        for (const name of ['dct_connection_status', 'dct_watch_target']) {
            const lifecycleTool = (await client.listTools()).tools.find((item) => item.name === name);
            assert.equal(lifecycleTool?.inputSchema.additionalProperties, false);
            await assert.rejects(client.callTool({ name, arguments: { extra: true } }));
        }
        assert.deepEqual((await client.callTool({ name: 'dct_watch_target', arguments: route })).structuredContent, {
            choice: 'restart',
        });
        client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'cancel' }));
        assert.equal(await entry.askLoss('退出'), 'pending');
        client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'decline' }));
        assert.equal(await entry.askLoss('退出'), 'pending');
        const forwarded = {
            mode: 'form' as const,
            message: '官方请求',
            requestedSchema: { type: 'object' as const, properties: { value: { type: 'string' as const } } },
        };
        client.setRequestHandler(ElicitRequestSchema, async (request) => {
            assert.deepEqual(request.params, forwarded);
            return { action: 'accept', content: { value: '原始回答' } };
        });
        assert.deepEqual(await entry.elicit(forwarded), { action: 'accept', content: { value: '原始回答' } });
        const cancelled = new AbortController();
        cancelled.abort();
        assert.equal(await entry.askLoss('退出', cancelled.signal), 'pending');
    } finally {
        await entry.close();
        await client.close();
    }
    await entry.closed;
});

test('entry returns pending without host elicitation and forwards watch cancellation', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let cancelled = false;
    let rootsNotifications = 0;
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const entry = createMcpEntryServer({
        onRootsChanged: async () => {
            rootsNotifications += 1;
        },
        tools: [],
        transport: serverTransport,
        status: () => ({}),
        watch: async (_route, signal) => {
            entered();
            await new Promise<void>((resolve) =>
                signal.addEventListener(
                    'abort',
                    () => {
                        cancelled = true;
                        resolve();
                    },
                    { once: true },
                ),
            );
            return {};
        },
        invoke: async () => ({ content: [] }),
    });
    const client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
    await entry.connect();
    await client.connect(clientTransport);
    try {
        assert.equal(await entry.askLoss('目标已退出'), 'pending');
        assert.equal(entry.supportsFormElicitation(), false);
        assert.equal(entry.supportsRoots(), false);
        await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' });
        assert.equal(rootsNotifications, 0);
        assert.throws(() =>
            entry.elicit({ mode: 'form', message: '不应询问', requestedSchema: { type: 'object', properties: {} } }),
        );
        const signal = new AbortController();
        const pending = client.callTool({ name: 'dct_watch_target', arguments: route }, undefined, {
            signal: signal.signal,
        });
        await started;
        signal.abort();
        await assert.rejects(pending);
        assert.equal(cancelled, true);
        await assert.rejects(client.callTool({ name: 'unknown' }));
    } finally {
        await entry.close();
        await client.close();
    }
});

async function fakeOfficial() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-mcp-test-'));
    const bin = path.join(directory, 'server.mjs');
    await writeFile(
        bin,
        `import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/types.js'))};
const server = new Server({ name: 'fake-official', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.arguments?.capabilities) return { content: [], structuredContent: { capabilities: server.getClientCapabilities() } };
    if (request.params.arguments?.elicit) {
        const result = await server.elicitInput({ mode: 'form', message: request.params.arguments.elicitWait ? '等待取消' : '上游原始问题', requestedSchema: { type: 'object', properties: { value: { type: 'string', title: '原始字段' } }, required: ['value'] } }, { signal: extra.signal });
        return { content: [], structuredContent: { result } };
    }
    if (request.params.arguments?.exit) process.exit(0);
    if (request.params.arguments?.wait) {
        await new Promise((resolve) => extra.signal.addEventListener('abort', resolve, { once: true }));
        return { content: [{ type: 'text', text: 'cancelled' }] };
    }
    const token = request.params._meta?.progressToken;
    if (token !== undefined) await extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: 1 } });
    const roots = await server.listRoots();
    return { content: [{ type: 'text', text: JSON.stringify(roots) }], structuredContent: { arguments: request.params.arguments } };
});
process.stdin.once('end', () => server.close().then(() => process.exit(0)));
await server.connect(new StdioServerTransport());
`,
        'utf8',
    );
    return { bin, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('official bridge initializes, relays results/roots/progress/cancellation and exits by EOF', async () => {
    const fixture = await fakeOfficial();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', {
        bin: fixture.bin,
        args: [],
        roots: async () => ({ roots: [{ uri: 'file:///fixture' }] }),
    });
    try {
        assert.equal(connection.tools[0]?.name, 'echo');
        let progressed = false;
        const result = await connection.call('echo', { value: 'preserved' }, undefined, () => {
            progressed = true;
        });
        assert.equal(progressed, true);
        assert.deepEqual(result.structuredContent, { arguments: { value: 'preserved' } });
        assert.deepEqual(result.content, [{ type: 'text', text: '{"roots":[{"uri":"file:///fixture"}]}' }]);
        await connection.rootsChanged();
        const cancellation = new AbortController();
        const pending = connection.call('echo', { wait: true }, cancellation.signal);
        cancellation.abort();
        await assert.rejects(pending);
        let exits = 0;
        connection.onExit(() => {
            exits += 1;
        });
        await connection.close();
        assert.equal(exits, 1);
        await connection.close();
        assert.equal(exits, 1);
    } finally {
        await connection.close();
        await fixture.cleanup();
    }
});

test('official bridge rejects pending calls on unexpected subprocess exit once', async () => {
    const fixture = await fakeOfficial();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', { bin: fixture.bin, args: [] });
    try {
        let exits = 0;
        connection.onExit(() => {
            exits += 1;
        });
        await assert.rejects(connection.call('echo', { exit: true }));
        assert.equal(exits, 1);
    } finally {
        await connection.close();
        await fixture.cleanup();
    }
});

test('official bridge forwards form elicitation transparently only for supported hosts', async () => {
    const fixture = await fakeOfficial();
    let calls = 0;
    let begin: () => void = () => {};
    let end: () => void = () => {};
    const began = new Promise<void>((resolve) => {
        begin = resolve;
    });
    const ended = new Promise<void>((resolve) => {
        end = resolve;
    });
    const connection = await createOfficialConnection('http://127.0.0.1:9222', {
        bin: fixture.bin,
        args: [],
        elicitation: {
            form: true,
            request: async (params, signal) => {
                calls += 1;
                assert.equal(signal.aborted, false);
                if (params.message === '等待取消') {
                    begin();
                    await new Promise<void>((resolve) =>
                        signal.addEventListener(
                            'abort',
                            () => {
                                end();
                                resolve();
                            },
                            { once: true },
                        ),
                    );
                    return { action: 'cancel' };
                }
                assert.deepEqual(params, {
                    mode: 'form',
                    message: '上游原始问题',
                    requestedSchema: {
                        type: 'object',
                        properties: { value: { type: 'string', title: '原始字段' } },
                        required: ['value'],
                    },
                });
                return { action: 'accept', content: { value: 'host answer' } };
            },
        },
    });
    try {
        const capabilities = (await connection.call('echo', { capabilities: true })).structuredContent?.capabilities;
        assert.deepEqual(capabilities, { elicitation: { form: {} } });
        assert.deepEqual((await connection.call('echo', { elicit: true })).structuredContent, {
            result: { action: 'accept', content: { value: 'host answer' } },
        });
        assert.equal(calls, 1);
        const abort = new AbortController();
        const pending = connection.call('echo', { elicit: true, elicitWait: true }, abort.signal);
        await began;
        abort.abort();
        await assert.rejects(pending);
        await ended;
        assert.equal(calls, 2);
    } finally {
        await connection.close();
    }
    const unsupported = await createOfficialConnection('http://127.0.0.1:9222', {
        bin: fixture.bin,
        args: [],
        elicitation: {
            form: false,
            request: async () => {
                throw new Error('Host must not be asked');
            },
        },
    });
    try {
        assert.deepEqual((await unsupported.call('echo', { capabilities: true })).structuredContent?.capabilities, {});
        await assert.rejects(unsupported.rootsChanged());
        await assert.rejects(unsupported.call('echo', { elicit: true }));
    } finally {
        await unsupported.close();
        await fixture.cleanup();
    }
});

test('catalog-only upstream has no fabricated roots capability', async () => {
    const fixture = await fakeOfficial();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', { bin: fixture.bin, args: [] });
    try {
        assert.equal(connection.tools[0]?.name, 'echo');
        assert.deepEqual((await connection.call('echo', { capabilities: true })).structuredContent?.capabilities, {});
        await assert.rejects(connection.call('echo', {}));
    } finally {
        await connection.close();
        await fixture.cleanup();
    }
});

test('host cancellation crosses gateway, upstream call and nested form request without replay', async () => {
    const fixture = await fakeOfficial();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let connection: Awaited<ReturnType<typeof createOfficialConnection>> | undefined;
    let requests = 0;
    let begin: () => void = () => {};
    let end: () => void = () => {};
    const began = new Promise<void>((resolve) => {
        begin = resolve;
    });
    const ended = new Promise<void>((resolve) => {
        end = resolve;
    });
    const gateway = createMcpEntryServer({
        tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }],
        transport: serverTransport,
        status: () => ({}),
        watch: async () => ({}),
        invoke: (name, arguments_, signal, progress) => {
            assert.ok(connection);
            return connection.call(name, arguments_, signal, progress);
        },
    });
    const host = new Client({ name: 'host', version: '1' }, { capabilities: { elicitation: { form: {} } } });
    host.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
        requests += 1;
        assert.equal(request.params.message, '等待取消');
        begin();
        await new Promise<void>((resolve) =>
            extra.signal.addEventListener(
                'abort',
                () => {
                    end();
                    resolve();
                },
                { once: true },
            ),
        );
        return { action: 'cancel' };
    });
    await gateway.connect();
    await host.connect(clientTransport);
    try {
        connection = await createOfficialConnection('http://127.0.0.1:9222', {
            bin: fixture.bin,
            args: [],
            elicitation: { form: gateway.supportsFormElicitation(), request: gateway.elicit },
        });
        assert.equal(gateway.supportsRoots(), false);
        assert.deepEqual((await connection.call('echo', { capabilities: true })).structuredContent?.capabilities, {
            elicitation: { form: {} },
        });
        const abort = new AbortController();
        const pending = host.callTool(
            { name: 'echo', arguments: { elicit: true, elicitWait: true, _dct: route } },
            undefined,
            {
                signal: abort.signal,
            },
        );
        void pending.catch(() => {});
        await boundedSignal(began, 'host must receive nested elicitation');
        abort.abort();
        await assert.rejects(pending);
        await boundedSignal(ended, 'nested host request must receive cancellation');
        assert.equal(requests, 1);
    } finally {
        await connection?.close();
        await gateway.close();
        await host.close();
        await fixture.cleanup();
    }
});

test('official catalog rejects reserved routing collisions and malformed tool routes', async () => {
    assert.throws(
        () =>
            createMcpEntryServer({
                tools: [
                    { name: 'collision', inputSchema: { type: 'object', properties: { _dct: { type: 'string' } } } },
                ],
                status: () => ({}),
                watch: async () => ({}),
                invoke: async () => ({ content: [] }),
            }),
        /reserved _dct/,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let invoked = 0;
    const entry = createMcpEntryServer({
        tools: [{ name: 'official', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
        transport: serverTransport,
        status: () => ({}),
        watch: async () => ({}),
        invoke: async () => {
            invoked += 1;
            return { content: [] };
        },
    });
    const client = new Client({ name: 'routes', version: '1' }, { capabilities: {} });
    await entry.connect();
    await client.connect(clientTransport);
    try {
        for (const arguments_ of [
            {},
            { _dct: {} },
            { _dct: { ...route, extra: true } },
            { _dct: { ...route, sessionId: route.sessionId.replace('2222', 'ABCD') } },
        ])
            await assert.rejects(client.callTool({ name: 'official', arguments: arguments_ }));
        assert.equal(invoked, 0);
        const tools = (await client.listTools()).tools;
        const watch = tools.find((tool) => tool.name === 'dct_watch_target');
        assert.deepEqual(watch?.inputSchema.required, ['connectionId', 'sessionId']);
        assert.equal(watch?.inputSchema.additionalProperties, false);
        const status = tools.find((tool) => tool.name === 'dct_connection_status');
        assert.deepEqual(status?.inputSchema.properties, {});
    } finally {
        await entry.close();
        await client.close();
    }
});
