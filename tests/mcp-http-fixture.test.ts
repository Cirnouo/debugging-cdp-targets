import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../src/shared/errors.ts';
import { createClient, readMcpTools } from './smoke/mcp-client.ts';

test('native regression fixture uses real SDK HTTP and explicit bearer calls and exits only on owned teardown', {
    timeout: 30_000,
}, async () => {
    const client = createClient(fileURLToPath(new URL('./fixtures/http-gateway.ts', import.meta.url)));
    try {
        const initialized = await client.request('initialize');
        assert.ok(isRecord(initialized));
        assert.deepEqual(initialized.serverInfo, { name: 'debugging-cdp-targets', version: '0.1.0' });
        const tools = readMcpTools(await client.request('tools/list'));
        assert.ok(tools.some((tool) => tool.name === 'list_pages'));
        assert.ok(tools.some((tool) => tool.name === 'dct_registration_register'));
        const status = await client.request('tools/call', { name: 'dct_connection_status', arguments: {} });
        assert.ok(isRecord(status) && isRecord(status.structuredContent));
        assert.deepEqual(status.structuredContent, { connections: [] });
        await assert.rejects(
            client.request('tools/call', {
                name: 'dct_connection_start',
                arguments: {
                    requestId: 'no-gui-opt-in',
                    isolation: { mode: 'none' },
                    launch: { executable: path.join(os.tmpdir(), 'dct-deliberately-absent-no-gui-opt-in.exe') },
                },
            }),
        );
        assert.equal(client.child.exitCode, null);
    } finally {
        await client.close();
        assert.equal(client.child.exitCode, 0);
        assert.equal(client.child.signalCode, null);
    }
});
