import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';

test('the real MCP transport declares structured lifecycle tools and validates before dispatch', async () => {
    const [peer, transport] = InMemoryTransport.createLinkedPair();
    const received: unknown[] = [];
    const gateway = createMcpEntryServer({
        tools: [],
        transport,
        status: () => ({}),
        invoke: async () => ({ content: [] }),
        control: async (request) => {
            received.push(request);
            return { accepted: true };
        },
    });
    const client = new Client({ name: 'test', version: '0.1.0' });
    await gateway.connect();
    await client.connect(peer);
    try {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((tool) => tool.name).sort(), [
            'dct_connection_end_task',
            'dct_connection_restart',
            'dct_connection_start',
            'dct_connection_status',
            'dct_connection_stop',
            'dct_operation_cancel',
            'dct_operation_wait',
        ]);
        const statusTool = tools.find((tool) => tool.name === 'dct_connection_status');
        assert.deepEqual(statusTool?.inputSchema.properties?.include, {
            type: 'array',
            items: { type: 'string', enum: ['configuration', 'diagnostics'] },
            uniqueItems: true,
        });
        const request = {
            isolation: { mode: 'none' },
            entryId: '11111111-1111-4111-8111-111111111111',
            requestId: 'start-1',
            launch: { executable: 'C:/App/app.exe', args: ['literal & value'], env: { DEBUG_PORT: '{port}' } },
            mcpArgs: ['--workspace=C:/Output'],
        };
        const startTool = tools.find((tool) => tool.name === 'dct_connection_start');
        assert.ok(startTool?.inputSchema.required?.includes('isolation'));
        await assert.rejects(
            client.callTool({
                name: 'dct_connection_start',
                arguments: { entryId: request.entryId, requestId: 'missing-isolation', launch: request.launch },
            }),
        );
        await client.callTool({ name: 'dct_connection_start', arguments: request });
        assert.deepEqual(received, [{ action: 'start', ...request }]);
        await assert.rejects(
            client.callTool({ name: 'dct_connection_start', arguments: { ...request, sessionId: request.entryId } }),
        );
        await assert.rejects(
            client.callTool({ name: 'dct_connection_start', arguments: { ...request, action: 'stop' } }),
        );
        assert.equal(received.length, 1);
        const hook = await client.callTool({ name: 'dct_connection_status', arguments: { hookEventName: 'Stop' } });
        assert.deepEqual(hook.structuredContent, {});
        const statusArguments = {
            entryId: request.entryId,
            connectionId: '22222222-2222-4222-8222-222222222222',
            include: ['diagnostics'],
        };
        const statusResult = await client.callTool({ name: 'dct_connection_status', arguments: statusArguments });
        assert.deepEqual(statusResult.structuredContent, { accepted: true });
        assert.deepEqual(statusResult.content, [{ type: 'text', text: '{"accepted":true}' }]);
        assert.deepEqual(received[1], { action: 'status', ...statusArguments });
        for (const arguments_ of [
            { entryId: request.entryId, include: ['configuration'] },
            { ...statusArguments, operationId: '33333333-3333-4333-8333-333333333333' },
            { hookEventName: 'Stop', entryId: request.entryId },
            { hookEventName: 'Stop', include: ['diagnostics'] },
        ])
            await assert.rejects(client.callTool({ name: 'dct_connection_status', arguments: arguments_ }));
        assert.equal(received.length, 2);
    } finally {
        await client.close();
        await gateway.close();
    }
});
