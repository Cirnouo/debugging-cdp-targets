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
        const request = {
            entryId: '11111111-1111-4111-8111-111111111111',
            requestId: 'start-1',
            launch: { executable: 'C:/App/app.exe', args: ['literal & value'], env: { DEBUG_PORT: '{port}' } },
            mcpArgs: ['--workspace=C:/Output'],
        };
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
    } finally {
        await client.close();
        await gateway.close();
    }
});
