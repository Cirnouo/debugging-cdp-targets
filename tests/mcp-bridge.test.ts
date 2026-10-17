import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ClientCapabilities } from '@modelcontextprotocol/client';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createOfficialConnection, interruptedOfficialCall } from '../src/adapters/mcp-bridge.ts';
import { createMcpHttpServer } from '../src/adapters/mcp-http-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createGatewayCore } from '../src/application/plugin-runtime.ts';
import type { ClientRequestContext } from '../src/shared/client-context.ts';
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

async function fakeOfficial(options: { pages?: number; repeatedCursor?: boolean; reservedRouting?: boolean } = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-mcp-test-'));
    const bin = path.join(directory, 'server.mjs');
    await writeFile(
        bin,
        `import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/server'))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/server/stdio'))};
import { access } from 'node:fs/promises';
const server = new Server({ name: 'fake-official', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler('tools/list', async (request) => {
    const page = Number(request.params?.cursor === 'repeat' ? 1 : request.params?.cursor ?? 0);
    return {
        tools: [{ name: ${options.pages ? "'echo_' + page" : "'echo'"}, inputSchema: { type: 'object', properties: ${options.reservedRouting ? "{ _dct: { type: 'string' } }" : '{}'} }, outputSchema: { type: 'object', properties: { arguments: { type: 'object' }, value: { type: 'number' } } }, annotations: { title: 'Original title', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { original: 'tool metadata' } }],
        ...(page + 1 < ${options.pages ?? 1} ? { nextCursor: ${options.repeatedCursor ? "'repeat'" : 'String(page + 1)'} } : {}),
    };
});
server.setRequestHandler('tools/call', async (request, ctx) => {
    if (request.params.arguments?.environment) return { content: [], structuredContent: { updateChecks: process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS, configDiscovery: process.env.CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY } };
    if (request.params.arguments?.invalidOutput) return { content: [], structuredContent: { value: 'invalid' } };
    if (request.params.arguments?.capabilities) return { content: [], structuredContent: { capabilities: server.getClientCapabilities() } };
    if (request.params.arguments?.elicit) {
        const result = await server.elicitInput({ mode: 'form', message: request.params.arguments.elicitWait ? '等待取消' : '上游原始问题', requestedSchema: { type: 'object', properties: { value: { type: 'string', title: '原始字段' } }, required: ['value'] } }, { signal: ctx.mcpReq.signal });
        return { content: [], structuredContent: { result } };
    }
    if (request.params.arguments?.exit) process.exit(0);
    if (request.params.arguments?.lateWire) {
        await new Promise((resolve) => setTimeout(resolve, request.params.arguments.lateWire));
        const response = request.params.arguments.protocolError
            ? { error: { code: -32603, message: 'synthetic protocol failure' } }
            : { result: { content: [], structuredContent: { arguments: {} } } };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: ctx.mcpReq.id, ...response }) + '\\n');
        await new Promise(() => {});
    }
    if (request.params.arguments?.ignoreCancel) await new Promise(() => {});
    if (request.params.arguments?.untilFile) {
        while (!await access(request.params.arguments.untilFile).then(() => true, () => false))
            await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (request.params.arguments?.delay) await new Promise((resolve) => setTimeout(resolve, request.params.arguments.delay));
    if (request.params.arguments?.wait) {
        await new Promise((resolve) => ctx.mcpReq.signal.addEventListener('abort', resolve, { once: true }));
        return { content: [{ type: 'text', text: 'cancelled' }] };
    }
    const token = request.params._meta?.progressToken;
    if (token !== undefined) await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress: request.params.arguments?.zeroProgress ? 0 : 1 } });
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

test('update checks and config discovery are suppressed only in the independent official child environment', async () => {
    const fixture = await fakeOfficial();
    const previous = process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS;
    const previousDiscovery = process.env.CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY;
    process.env.CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY = 'parent-setting';
    process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = 'parent-setting';
    const connection = await createOfficialConnection('http://127.0.0.1:9222', { bin: fixture.bin, args: [] });
    try {
        const content = (await connection.call('echo', { environment: true })).structuredContent;
        assert.ok(isRecord(content));
        assert.equal(content.updateChecks, '1');
        assert.equal(content.configDiscovery, '1');
        assert.equal(process.env.CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY, 'parent-setting');
        assert.equal(process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS, 'parent-setting');
    } finally {
        await connection.close();
        await fixture.cleanup();
        if (previous === undefined) delete process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS;
        else process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = previous;
        if (previousDiscovery === undefined) delete process.env.CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY;
        else process.env.CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY = previousDiscovery;
    }
});

test('SDK execution timeout retains accounting until a cancellation-ignoring upstream definitively closes', async () => {
    const fixture = await fakeOfficial();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', {
        bin: fixture.bin,
        args: [],
        requestTimeoutMs: 40,
    });
    try {
        let settled = false;
        const actual = connection.call('echo', { ignoreCancel: true }).finally(() => {
            settled = true;
        });
        void actual.catch(() => {});
        await new Promise<void>((resolve) => setTimeout(resolve, 75));
        assert.equal(settled, false);
        await assert.rejects(connection.call('echo', {}), /busy/);
        await connection.close();
        await assert.rejects(actual, (error) => {
            assert.equal(interruptedOfficialCall(error), 'upstream-timeout');
            return true;
        });
        assert.equal(interruptedOfficialCall(new Error('Request timed out')), undefined);
    } finally {
        await connection.close();
        await fixture.cleanup();
    }
});

test('completed official acquisition is independent of the old target acquisition signal', async () => {
    const fixture = await fakeOfficial();
    const acquisition = new AbortController();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', {
        bin: fixture.bin,
        args: [],
        signal: acquisition.signal,
    });
    try {
        acquisition.abort(new Error('Old target generation retired.'));
        const result = await connection.call('echo', { capabilities: true });
        assert.ok(result.structuredContent);
    } finally {
        await connection.close();
        await fixture.cleanup();
    }
});

for (const protocolError of [false, true]) {
    test(`late ${protocolError ? 'protocol error' : 'result'} after SDK timeout releases only its matching wire execution`, async () => {
        const fixture = await fakeOfficial();
        const connection = await createOfficialConnection('http://127.0.0.1:9222', {
            bin: fixture.bin,
            args: [],
            requestTimeoutMs: 20,
        });
        try {
            await assert.rejects(
                connection.call('echo', { lateWire: 60, protocolError }),
                (error) => interruptedOfficialCall(error) === 'upstream-timeout',
            );
            const next = await connection.call('echo', { capabilities: true });
            assert.ok(next.structuredContent);
        } finally {
            await connection.close();
            await fixture.cleanup();
        }
    });
}

test('response racing its SDK deadline and explicit close never leaves a permanent execution slot', async () => {
    const fixture = await fakeOfficial();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', {
        bin: fixture.bin,
        args: [],
        requestTimeoutMs: 25,
    });
    try {
        await connection.call('echo', { lateWire: 25 }).catch((error: unknown) => {
            assert.equal(interruptedOfficialCall(error), 'upstream-timeout');
        });
        await connection.call('echo', { capabilities: true });
        await connection.close();
        await assert.rejects(connection.call('echo', { capabilities: true }), /connected|closed/i);
        await assert.rejects(connection.call('echo', { capabilities: true }), /connected|closed/i);
    } finally {
        await connection.close();
        await fixture.cleanup();
    }
});

test('public transport serialization failure closes pending SDK state and cannot leave a false busy slot', async () => {
    const fixture = await fakeOfficial();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', { bin: fixture.bin, args: [] });
    try {
        const arguments_: Record<string, unknown> = {};
        arguments_.cycle = arguments_;
        await assert.rejects(connection.call('echo', arguments_), /circular|closed|connected/i);
        await assert.rejects(connection.call('echo', {}), /connected|closed/i);
        await assert.rejects(connection.call('echo', {}), /connected|closed/i);
    } finally {
        await connection.close();
        await fixture.cleanup();
    }
});

async function httpBridge(fixture: Awaited<ReturnType<typeof fakeOfficial>>, capabilities: ClientCapabilities = {}) {
    const children = new Map<number, EventEmitter>();
    const calls: { args: Record<string, unknown>; signal?: AbortSignal; finished: Promise<void> }[] = [];
    const upstreams: Awaited<ReturnType<typeof createOfficialConnection>>[] = [];
    const contexts: ClientRequestContext[] = [];
    const core = await createGatewayCore({
        createConnection: async (url, options) => {
            const connection = await createOfficialConnection(url, { ...options, bin: fixture.bin, args: [] });
            upstreams.push(connection);
            return {
                ...connection,
                call: async (name, args, signal, progress) => {
                    let finish = () => {};
                    const finished = new Promise<void>((resolve) => {
                        finish = resolve;
                    });
                    calls.push({ args, ...(signal ? { signal } : {}), finished });
                    try {
                        return await connection.call(name, args, signal, progress);
                    } finally {
                        finish();
                    }
                },
            };
        },
        loadCatalog: async (tools) =>
            createToolCatalog({
                version: '1.11.0',
                tools: (tools ?? []).map((tool) => ({ name: tool.name, requires: {}, variants: [tool] })),
            }),
        createRouter: async () => ({
            url: 'http://127.0.0.1:31000',
            isBusy: () => false,
            setTarget() {},
            clearTarget() {},
            close: async () => {},
        }),
        createHost: () => ({
            launch: async () => {
                const processId = children.size + 42;
                const child = new EventEmitter();
                children.set(processId, child);
                return {
                    processId,
                    port: 9222 + processId,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-17T00:00:00Z',
                    targetKind: 'generic-cdp' as const,
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: [] },
                };
            },
            close: async (target) => {
                children.get(target.processId)?.emit('exit');
                return true;
            },
        }),
    });
    const invoke = core.invoke;
    core.invoke = (name, args, context) => {
        contexts.push(context);
        return invoke(name, args, context);
    };
    let gateway: Awaited<ReturnType<typeof createMcpHttpServer>>;
    try {
        gateway = await createMcpHttpServer({ port: 0, core });
    } catch (error) {
        await core.cleanup();
        throw error;
    }
    const client = new Client({ name: 'http-bridge-host', version: '1' }, { capabilities });
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
    } catch (error) {
        await core.cleanup();
        await gateway.close();
        throw error;
    }
    const structured = (result: { structuredContent?: unknown }) => {
        assert.ok(isRecord(result.structuredContent));
        return result.structuredContent;
    };
    return {
        core,
        gateway,
        client,
        calls,
        upstreams,
        contexts,
        async start() {
            const registered = structured(await client.callTool({ name: 'dct_registration_register', arguments: {} }));
            assert.equal(typeof registered.registrationBearer, 'string');
            const registrationBearer = String(registered.registrationBearer);
            const accepted = structured(
                await client.callTool({
                    name: 'dct_connection_start',
                    arguments: {
                        registrationBearer,
                        requestId: 'fixture-start',
                        isolation: { mode: 'none' },
                        launch: { executable: process.execPath },
                    },
                }),
            );
            let cursor = 0;
            for (let attempt = 0; attempt < 30; attempt++) {
                const result = structured(
                    await client.callTool({
                        name: 'dct_operation_wait',
                        arguments: {
                            registrationBearer,
                            operationId: accepted.operationId,
                            cursor,
                        },
                    }),
                );
                assert.equal(typeof result.cursor, 'number');
                cursor = Number(result.cursor);
                if (!result.complete) continue;
                assert.ok(isRecord(result.operation));
                assert.equal(result.operation.state, 'succeeded');
                assert.ok(isRecord(result.operation.result));
                const { connectionId, sessionId } = result.operation.result;
                assert.equal(typeof connectionId, 'string');
                assert.equal(typeof sessionId, 'string');
                return { registrationBearer, connectionId: String(connectionId), sessionId: String(sessionId) };
            }
            throw new Error('HTTP bridge fixture start never completed.');
        },
        async close() {
            await core.cleanup();
            await client.close();
            await gateway.close();
        },
    };
}

test('HTTP real core preserves official tools, cached originating roots, progress, metadata and form results', async () => {
    const fixture = await fakeOfficial();
    const f = await httpBridge(fixture, { roots: { listChanged: true }, elicitation: { form: {} } });
    let rootsReads = 0;
    f.client.setRequestHandler('roots/list', async () => {
        rootsReads++;
        return { roots: [{ uri: 'file:///http-origin' }] };
    });
    f.client.setRequestHandler('elicitation/create', async (request) => {
        assert.deepEqual(request.params, {
            mode: 'form',
            message: '上游原始问题',
            requestedSchema: {
                type: 'object',
                properties: { value: { type: 'string', title: '原始字段' } },
                required: ['value'],
            },
        });
        return { action: 'accept', content: { value: '原始回答' } };
    });
    try {
        const route = await f.start();
        const tool = (await f.client.listTools()).tools.find((tool) => tool.name === 'echo');
        assert.ok(tool);
        assert.deepEqual(tool.inputSchema.required, ['_dct']);
        assert.deepEqual(tool.outputSchema, f.upstreams[1]?.tools[0]?.outputSchema);
        assert.deepEqual(tool.annotations, f.upstreams[1]?.tools[0]?.annotations);
        assert.deepEqual(tool._meta, { original: 'tool metadata' });
        const progress: unknown[] = [];
        const result = await f.client.callTool(
            { name: 'echo', arguments: { value: 'ok', _dct: route } },
            {
                onprogress: (value) => progress.push(value),
            },
        );
        assert.deepEqual(result, {
            content: [{ type: 'text', text: '{"roots":[{"uri":"file:///http-origin"}]}' }],
            structuredContent: { arguments: { value: 'ok' } },
            _meta: { original: 'result metadata' },
            isError: false,
        });
        assert.equal(rootsReads, 1);
        assert.equal(progress.length, 1);
        assert.ok(isRecord(progress[0]) && progress[0].progress === 1);
        const form = await f.client.callTool({ name: 'echo', arguments: { elicit: true, _dct: route } });
        assert.deepEqual(form.structuredContent, { result: { action: 'accept', content: { value: '原始回答' } } });
        const selected = await f.client.callTool({
            name: 'dct_connection_status',
            arguments: {
                registrationBearer: route.registrationBearer,
                connectionId: route.connectionId,
            },
        });
        assert.ok(isRecord(selected.structuredContent));
        assert.equal(selected.structuredContent.upstreamStatus, 'connected');
        const keep = await f.client.callTool({
            name: 'dct_connection_stop',
            arguments: {
                ...route,
                requestId: 'fixture-keep',
                disposition: 'Keep',
            },
        });
        assert.ok(isRecord(keep.structuredContent) && typeof keep.structuredContent.operationId === 'string');
    } finally {
        await f.close();
        await fixture.cleanup();
    }
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
        let markExit: () => void = () => {};
        const actualExit = new Promise<void>((resolve) => {
            markExit = resolve;
        });
        connection.onExit(() => {
            exits += 1;
            markExit();
        });
        await assert.rejects(connection.call('echo', { exit: true }));
        await boundedSignal(actualExit, 'official child exit must be independently observed');
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

test('HTTP host cancellation detaches its wait and retains the original owned execution until real terminal', async () => {
    const fixture = await fakeOfficial();
    const f = await httpBridge(fixture, { elicitation: { form: {} } });
    let requests = 0;
    let begin = () => {};
    const began = new Promise<void>((resolve) => {
        begin = resolve;
    });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.client.setRequestHandler('elicitation/create', async (request) => {
        requests++;
        assert.equal(request.params.message, '等待取消');
        begin();
        await released;
        return { action: 'cancel' };
    });
    try {
        const route = await f.start();
        const pid = f.upstreams[1]?.processId;
        assert.equal(typeof pid, 'number');
        const abort = new AbortController();
        const pending = f.client.callTool(
            { name: 'echo', arguments: { elicit: true, elicitWait: true, _dct: route } },
            { signal: abort.signal },
        );
        void pending.catch(() => {});
        await boundedSignal(began, 'host must receive the original nested elicitation');
        abort.abort(new Error('Host no longer waits.'));
        await assert.rejects(pending);
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0]?.signal?.aborted, false, 'Host cancellation cannot retire the owned execution.');
        assert.equal(f.upstreams.length, 2, 'No replacement or replay is permitted.');
        assert.equal(f.upstreams[1]?.processId, pid);
        release();
        assert.ok(f.calls[0]);
        await boundedSignal(f.calls[0].finished, 'original upstream must reach a real terminal result');
        await new Promise<void>((resolve) => setImmediate(resolve));
        const result = await f.client.callTool({ name: 'echo', arguments: { capabilities: true, _dct: route } });
        assert.ok(result.structuredContent);
        assert.equal(requests, 1);
        assert.equal(f.upstreams.length, 2);
    } finally {
        release();
        await f.close();
        await fixture.cleanup();
    }
});

test('HTTP catalog rejects reserved routing collisions and invalid registered routes before official dispatch', async () => {
    const collision = await fakeOfficial({ reservedRouting: true });
    try {
        await assert.rejects(httpBridge(collision), /reserved.*routing/i);
    } finally {
        await collision.cleanup();
    }
    const fixture = await fakeOfficial();
    const f = await httpBridge(fixture);
    try {
        const registered = await f.client.callTool({ name: 'dct_registration_register', arguments: {} });
        assert.ok(isRecord(registered.structuredContent));
        const registrationBearer = registered.structuredContent.registrationBearer;
        for (const arguments_ of [
            {},
            { _dct: {} },
            { _dct: { ...route, registrationBearer, extra: true } },
            { _dct: { ...route, registrationBearer, sessionId: route.sessionId.replace('2222', 'ABCD') } },
        ])
            await assert.rejects(f.client.callTool({ name: 'echo', arguments: arguments_ }));
        assert.equal(f.calls.length, 0);
        const tools = (await f.client.listTools()).tools;
        assert.equal(
            tools.some((tool) => tool.name === 'dct_watch_target'),
            false,
        );
        const status = tools.find((tool) => tool.name === 'dct_connection_status');
        assert.ok(status?.inputSchema.required?.includes('registrationBearer'));
        for (const arguments_ of [
            { registrationBearer, hookEventName: 'Stop' },
            { registrationBearer, entryId: route.connectionId },
            { registrationBearer, sessionId: route.sessionId },
        ])
            await assert.rejects(f.client.callTool({ name: 'dct_connection_status', arguments: arguments_ }));
        const discovery = await f.client.callTool({ name: 'dct_connection_status', arguments: { registrationBearer } });
        assert.ok(isRecord(discovery.structuredContent));
        assert.deepEqual(discovery.structuredContent.connections, []);
        assert.equal(f.calls.length, 0);
    } finally {
        await f.close();
        await fixture.cleanup();
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

test('raw HTTP preserves request and progress ID zero while cancellation detaches only the original wait', async () => {
    const fixture = await fakeOfficial();
    const f = await httpBridge(fixture);
    let session: string | undefined;
    const rawLifetime = new AbortController();
    const releaseFile = path.join(path.dirname(fixture.bin), 'release-original');
    const raw = (message: unknown) =>
        fetch(f.gateway.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' } : {}),
            },
            body: JSON.stringify(message),
            signal: AbortSignal.any([rawLifetime.signal, AbortSignal.timeout(5000)]),
        });
    const messages = async (response: Response): Promise<unknown[]> => {
        assert.equal(response.status, 200);
        const text = await response.text();
        return response.headers.get('content-type')?.includes('text/event-stream')
            ? text
                  .split(/\r?\n/)
                  .filter((line) => line.startsWith('data: '))
                  .map((line): unknown => JSON.parse(line.slice(6)))
            : [JSON.parse(text)];
    };
    try {
        const route = await f.start();
        const initialized = await raw({
            jsonrpc: '2.0',
            id: 100,
            method: 'initialize',
            params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'raw-http-host', version: '1' },
            },
        });
        session = initialized.headers.get('mcp-session-id') ?? undefined;
        assert.ok(session);
        const ready = (await messages(initialized))[0];
        assert.ok(isRecord(ready) && isRecord(ready.result));
        assert.equal(ready.result.protocolVersion, '2025-11-25');
        assert.deepEqual(ready.result.serverInfo, { name: 'debugging-cdp-targets', version: '0.1.0' });
        assert.ok(
            typeof ready.result.instructions === 'string' && ready.result.instructions.includes('registrationBearer'),
        );
        assert.equal((await raw({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
        const result = await messages(
            await raw({
                jsonrpc: '2.0',
                id: 0,
                method: 'tools/call',
                params: {
                    name: 'echo',
                    arguments: { zeroProgress: true, _dct: route },
                    _meta: { progressToken: 0 },
                },
            }),
        );
        assert.deepEqual(result, [
            { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 0, progressToken: 0 } },
            {
                jsonrpc: '2.0',
                id: 0,
                result: {
                    content: [{ type: 'text', text: '{"roots":[]}' }],
                    structuredContent: { arguments: { zeroProgress: true } },
                    _meta: { original: 'result metadata' },
                    isError: false,
                },
            },
        ]);
        const pending = raw({
            jsonrpc: '2.0',
            id: 0,
            method: 'tools/call',
            params: {
                name: 'echo',
                arguments: { untilFile: releaseFile, _dct: route },
            },
        }).then(messages);
        for (let attempt = 0; f.calls.length < 2 && attempt < 100; attempt++)
            await new Promise<void>((resolve) => setTimeout(resolve, 5));
        assert.equal(f.calls.length, 2);
        assert.equal(
            (await raw({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0 } })).status,
            202,
        );
        void pending.catch(() => {});
        for (let attempt = 0; !f.contexts[1]?.waitSignal.aborted && attempt < 100; attempt++)
            await new Promise<void>((resolve) => setTimeout(resolve, 5));
        assert.equal(f.contexts[1]?.requestId, 0);
        assert.equal(
            f.contexts[1]?.waitSignal.aborted,
            true,
            'Wire cancellation for ID zero must detach that exact Core wait.',
        );
        rawLifetime.abort(new Error('Raw host stops waiting after explicit cancellation.'));
        await assert.rejects(pending);
        assert.equal(f.calls[1]?.signal?.aborted, false);
        await assert.rejects(f.client.callTool({ name: 'echo', arguments: { capabilities: true, _dct: route } }));
        assert.equal(f.calls.length, 2, 'A detached wait does not admit another owned execution.');
        assert.ok(f.calls[1]);
        await writeFile(releaseFile, 'release', 'utf8');
        await boundedSignal(f.calls[1].finished, 'late result must settle the original execution');
        await new Promise<void>((resolve) => setImmediate(resolve));
        await f.client.callTool({ name: 'echo', arguments: { capabilities: true, _dct: route } });
        assert.equal(f.upstreams.length, 2, 'The healthy upstream is retained without replacement.');
    } finally {
        rawLifetime.abort();
        await writeFile(releaseFile, 'release', 'utf8');
        await f.close();
        await fixture.cleanup();
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
