import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createOfficialConnection } from '../src/adapters/mcp-bridge.ts';
import { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';
import { isRecord } from '../src/shared/errors.ts';

const route = {
    connectionId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
};

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

async function fakeOfficial(options: { pages?: number; repeatedCursor?: boolean } = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-mcp-test-'));
    const bin = path.join(directory, 'server.mjs');
    await writeFile(
        bin,
        `import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/server'))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/server/stdio'))};
const server = new Server({ name: 'fake-official', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler('tools/list', async (request) => {
    const page = Number(request.params?.cursor === 'repeat' ? 1 : request.params?.cursor ?? 0);
    return {
        tools: [{ name: ${options.pages ? "'echo_' + page" : "'echo'"}, inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { arguments: { type: 'object' }, value: { type: 'number' } } }, annotations: { title: 'Original title', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { original: 'tool metadata' } }],
        ...(page + 1 < ${options.pages ?? 1} ? { nextCursor: ${options.repeatedCursor ? "'repeat'" : 'String(page + 1)'} } : {}),
    };
});
server.setRequestHandler('tools/call', async (request, ctx) => {
    if (request.params.arguments?.invalidOutput) return { content: [], structuredContent: { value: 'invalid' } };
    if (request.params.arguments?.capabilities) return { content: [], structuredContent: { capabilities: server.getClientCapabilities() } };
    if (request.params.arguments?.elicit) {
        const result = await server.elicitInput({ mode: 'form', message: request.params.arguments.elicitWait ? '等待取消' : '上游原始问题', requestedSchema: { type: 'object', properties: { value: { type: 'string', title: '原始字段' } }, required: ['value'] } }, { signal: ctx.mcpReq.signal });
        return { content: [], structuredContent: { result } };
    }
    if (request.params.arguments?.exit) process.exit(0);
    if (request.params.arguments?.wait) {
        await new Promise((resolve) => ctx.mcpReq.signal.addEventListener('abort', resolve, { once: true }));
        return { content: [{ type: 'text', text: 'cancelled' }] };
    }
    const token = request.params._meta?.progressToken;
    if (token !== undefined) await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress: 1 } });
    const roots = await server.listRoots();
    return { content: [{ type: 'text', text: JSON.stringify(roots) }], structuredContent: { arguments: request.params.arguments }, _meta: { original: 'result metadata' }, isError: false };
});
process.stdin.once('end', () => server.close().then(() => process.exit(0)));
await server.connect(new StdioServerTransport());
`,
        'utf8',
    );
    return { bin, cleanup: () => rm(directory, { recursive: true, force: true }) };
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
    client.setRequestHandler('roots/list', async () => ({ roots: [{ uri: 'file:///test' }] }));
    client.setRequestHandler('elicitation/create', async (request) => {
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
            await client.callTool(
                { name: tool.name, arguments: { value: 'ok', _dct: route } },
                {
                    onprogress: () => {
                        progressed = true;
                    },
                },
            ),
            { content: [{ type: 'text', text: 'ok' }] },
        );
        assert.equal(progressed, true);
        assert.deepEqual(await entry.roots(), { roots: [{ uri: 'file:///test' }] });
        await client.sendRootsListChanged();
        assert.equal(rootsChanged, true);
        assert.deepEqual((await client.callTool({ name: 'dct_connection_status' })).structuredContent, {
            state: 'idle',
        });
        for (const name of ['dct_connection_status']) {
            const lifecycleTool = (await client.listTools()).tools.find((item) => item.name === name);
            assert.equal(lifecycleTool?.inputSchema.additionalProperties, false);
            await assert.rejects(client.callTool({ name, arguments: { extra: true } }));
        }
        assert.ok(!(await client.listTools()).tools.some((tool) => tool.name === 'dct_watch_target'));
        await assert.rejects(client.callTool({ name: 'dct_watch_target', arguments: route }));
        const forwarded = {
            mode: 'form' as const,
            message: '官方请求',
            requestedSchema: { type: 'object' as const, properties: { value: { type: 'string' as const } } },
        };
        client.setRequestHandler('elicitation/create', async (request) => {
            assert.deepEqual(request.params, forwarded);
            return { action: 'accept', content: { value: '原始回答' } };
        });
        assert.deepEqual(await entry.elicit(forwarded), { action: 'accept', content: { value: '原始回答' } });
    } finally {
        await entry.close();
        await client.close();
    }
    await entry.closed;
});

test('official bridge initializes, relays results/roots/progress/cancellation and exits by EOF', async () => {
    const fixture = await fakeOfficial();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', {
        bin: fixture.bin,
        args: [],
        roots: async () => ({ roots: [{ uri: 'file:///fixture' }] }),
    });
    try {
        assert.deepEqual(connection.tools[0], {
            name: 'echo',
            inputSchema: { type: 'object', properties: {} },
            outputSchema: { type: 'object', properties: { arguments: { type: 'object' }, value: { type: 'number' } } },
            annotations: {
                title: 'Original title',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            _meta: { original: 'tool metadata' },
        });
        let progressed = false;
        const result = await connection.call('echo', { value: 'preserved' }, undefined, () => {
            progressed = true;
        });
        assert.equal(progressed, true);
        assert.deepEqual(result._meta, { original: 'result metadata' });
        assert.equal(result.isError, false);
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
        const capabilities = capabilitiesOf(await connection.call('echo', { capabilities: true }));
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
        assert.deepEqual(capabilitiesOf(await unsupported.call('echo', { capabilities: true })), {});
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
        assert.deepEqual(capabilitiesOf(await connection.call('echo', { capabilities: true })), {});
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
        invoke: (name, arguments_, signal, progress) => {
            assert.ok(connection);
            return connection.call(name, arguments_, signal, progress);
        },
    });
    const host = new Client({ name: 'host', version: '1' }, { capabilities: { elicitation: { form: {} } } });
    host.setRequestHandler('elicitation/create', async (request, ctx) => {
        requests += 1;
        assert.equal(request.params.message, '等待取消');
        begin();
        await new Promise<void>((resolve) =>
            ctx.mcpReq.signal.addEventListener(
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
        assert.deepEqual(capabilitiesOf(await connection.call('echo', { capabilities: true })), {
            elicitation: { form: {} },
        });
        const abort = new AbortController();
        const pending = host.callTool(
            { name: 'echo', arguments: { elicit: true, elicitWait: true, _dct: route } },
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
        assert.equal(
            tools.some((tool) => tool.name === 'dct_watch_target'),
            false,
        );
        const status = tools.find((tool) => tool.name === 'dct_connection_status');
        assert.deepEqual(Object.keys(status?.inputSchema.properties ?? {}), ['hookEventName']);
        for (const hookEventName of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'])
            assert.deepEqual(
                (await client.callTool({ name: 'dct_connection_status', arguments: { hookEventName } }))
                    .structuredContent,
                {},
            );
        for (const arguments_ of [
            { hookEventName: 'SessionEnd' },
            { hookEventName: null },
            { hookEventName: 'Stop', sessionId: route.sessionId },
        ])
            await assert.rejects(client.callTool({ name: 'dct_connection_status', arguments: arguments_ }));
    } finally {
        await entry.close();
        await client.close();
    }
});

function capabilitiesOf(result: { structuredContent?: unknown }) {
    assert.ok(isRecord(result.structuredContent));
    return result.structuredContent.capabilities;
}

test('official catalog walks more than the SDK aggregate page cap without changing names', async () => {
    const fixture = await fakeOfficial({ pages: 65 });
    try {
        const connection = await createOfficialConnection('http://127.0.0.1:9222', { bin: fixture.bin, args: [] });
        try {
            assert.deepEqual(
                connection.tools.map((tool) => tool.name),
                Array.from({ length: 65 }, (_, i) => `echo_${i}`),
            );
        } finally {
            await connection.close();
        }
    } finally {
        await fixture.cleanup();
    }
});

test('official catalog rejects repeated pagination cursors', async () => {
    const fixture = await fakeOfficial({ pages: 65, repeatedCursor: true });
    try {
        await assert.rejects(
            createOfficialConnection('http://127.0.0.1:9222', { bin: fixture.bin, args: [] }),
            /repeated tool catalog cursor/,
        );
    } finally {
        await fixture.cleanup();
    }
});

test('legacy raw host preserves request and progress ID zero and cancels the active call', async () => {
    const [peer, transport] = InMemoryTransport.createLinkedPair();
    const messages: import('@modelcontextprotocol/client').JSONRPCMessage[] = [];
    peer.onmessage = (message) => {
        messages.push(message);
    };
    let entered: () => void = () => {};
    let cancelled: () => void = () => {};
    const began = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const ended = new Promise<void>((resolve) => {
        cancelled = resolve;
    });
    const expected = {
        content: [{ type: 'text' as const, text: 'original' }],
        structuredContent: { exact: [1, false] },
        _meta: { custom: 'preserved' },
    };
    const entry = createMcpEntryServer({
        transport,
        tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }],
        status: () => ({}),
        invoke: async (_name, args, signal, progress) => {
            progress({ progress: 0, total: 1, message: 'original progress' });
            if (args.wait) {
                entered();
                await new Promise<void>((resolve) =>
                    signal.addEventListener(
                        'abort',
                        () => {
                            cancelled();
                            resolve();
                        },
                        { once: true },
                    ),
                );
            }
            return expected;
        },
    });
    await peer.start();
    await entry.connect();
    try {
        await peer.send({
            jsonrpc: '2.0',
            id: 100,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'legacy-host', version: '1' },
            },
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const initialized = messages.shift();
        assert.ok(initialized && 'result' in initialized && isRecord(initialized.result));
        assert.equal(initialized.result.protocolVersion, '2024-11-05');
        await peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        await peer.send({
            jsonrpc: '2.0',
            id: 0,
            method: 'tools/call',
            params: { name: 'echo', arguments: { _dct: route }, _meta: { progressToken: 0 } },
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(messages.splice(0), [
            {
                jsonrpc: '2.0',
                method: 'notifications/progress',
                params: { progress: 0, total: 1, message: 'original progress', progressToken: 0 },
            },
            { jsonrpc: '2.0', id: 0, result: expected },
        ]);
        await peer.send({
            jsonrpc: '2.0',
            id: 0,
            method: 'tools/call',
            params: { name: 'echo', arguments: { wait: true, _dct: route } },
        });
        await boundedSignal(began, 'legacy call must enter');
        await peer.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0 } });
        await boundedSignal(ended, 'ID zero must receive cancellation');
    } finally {
        await entry.close();
        await peer.close();
    }
});

test('official call enforces the catalog output schema while preserving valid result metadata', async () => {
    const fixture = await fakeOfficial();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', { bin: fixture.bin, args: [] });
    try {
        await assert.rejects(connection.call('echo', { invalidOutput: true }), /output schema/);
    } finally {
        await connection.close();
        await fixture.cleanup();
    }
});
