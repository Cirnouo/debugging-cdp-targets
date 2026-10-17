import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHttpServer } from '../src/adapters/mcp-http-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createGatewayCore } from '../src/application/plugin-runtime.ts';
import { isRecord } from '../src/shared/errors.ts';

test('the real HTTP SDK transport declares registered lifecycle tools and validates before core dispatch', async () => {
    const received: unknown[] = [];
    const core = await createGatewayCore({
        loadCatalog: async () => createToolCatalog({ version: '1.11.0', tools: [] }),
        createRouter: async () => ({
            url: 'http://127.0.0.1:31000',
            isBusy: () => false,
            setTarget() {},
            clearTarget() {},
            close: async () => {},
        }),
        createHost: () => ({
            launch: async () => {
                throw new Error('No native launch in this protocol fixture.');
            },
            close: async () => true,
        }),
        createConnection: async () => ({
            tools: [],
            call: async () => ({ content: [] }),
            close: async () => {},
            onExit() {},
            rootsChanged: async () => {},
        }),
    });
    const dispatch = core.control;
    core.control = async (request, context) => {
        received.push(request);
        return dispatch(request, context);
    };
    const gateway = await createMcpHttpServer({ port: 0, core });
    const client = new Client({ name: 'protocol-test', version: '1' });
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((tool) => tool.name).sort(), [
            'dct_connection_restart',
            'dct_connection_start',
            'dct_connection_status',
            'dct_connection_stop',
            'dct_operation_cancel',
            'dct_operation_wait',
            'dct_registration_register',
        ]);
        const statusTool = tools.find((tool) => tool.name === 'dct_connection_status');
        assert.deepEqual(statusTool?.inputSchema.properties?.include, {
            type: 'array',
            items: { type: 'string', enum: ['configuration', 'diagnostics'] },
            uniqueItems: true,
        });
        const registered = await client.callTool({ name: 'dct_registration_register', arguments: {} });
        assert.ok(isRecord(registered.structuredContent));
        const registrationBearer = registered.structuredContent.registrationBearer;
        assert.equal(typeof registrationBearer, 'string');
        const request = {
            registrationBearer,
            isolation: { mode: 'none' },
            requestId: 'start-1',
            launch: { executable: '/fixture/app', args: ['literal & value'], env: { DEBUG_PORT: '{port}' } },
            mcpArgs: ['--workspace=/fixture'],
        };
        const startTool = tools.find((tool) => tool.name === 'dct_connection_start');
        assert.ok(startTool?.inputSchema.required?.includes('isolation'));
        assert.ok(startTool?.inputSchema.required?.includes('registrationBearer'));
        const restart = tools.find((tool) => tool.name === 'dct_connection_restart');
        assert.ok(restart?.inputSchema.required?.includes('scope'));
        for (const invalid of [
            { registrationBearer, requestId: 'missing-isolation', launch: request.launch },
            { ...request, sessionId: '11111111-1111-4111-8111-111111111111' },
            { ...request, action: 'stop' },
            { ...request, entryId: '11111111-1111-4111-8111-111111111111' },
        ])
            await assert.rejects(client.callTool({ name: 'dct_connection_start', arguments: invalid }));
        assert.equal(received.length, 0);
        await client.callTool({ name: 'dct_connection_start', arguments: request });
        const { registrationBearer: secret, ...arguments_ } = request;
        void secret;
        assert.deepEqual(received[0], { action: 'start', ...arguments_ });
        const status = await client.callTool({ name: 'dct_connection_status', arguments: { registrationBearer } });
        assert.ok(isRecord(status.structuredContent) && Array.isArray(status.structuredContent.connections));
        for (const arguments_ of [
            { registrationBearer, include: ['configuration'] },
            { registrationBearer, hookEventName: 'Stop' },
            { registrationBearer, entryId: '11111111-1111-4111-8111-111111111111' },
        ])
            await assert.rejects(client.callTool({ name: 'dct_connection_status', arguments: arguments_ }));
        assert.equal(received.length, 2);
    } finally {
        await client.close();
        await gateway.close();
        await core.cleanup();
    }
});
