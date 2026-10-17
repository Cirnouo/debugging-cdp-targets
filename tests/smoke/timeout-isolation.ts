import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProtocolError, ProtocolErrorCode, SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import { isRecord } from '../../src/shared/errors.ts';
import { requireGuiAuthorization } from '../gui-authorization.ts';
import { lifecycleClient, readStatus } from './lifecycle-client.ts';
import { createClient } from './mcp-client.ts';

requireGuiAuthorization();
if (process.platform !== 'win32') throw new Error('This opt-in native Chrome smoke is Windows-only.');
const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-timeout-isolation-'));
const client = createClient(fileURLToPath(new URL('../fixtures/http-gateway.ts', import.meta.url)));
async function tool(name: string, args: Record<string, unknown> = {}) {
    // Ordinary calls have a response wait; the owned execution has its separate lifetime.
    const result = await client.request('tools/call', { name, arguments: args }, 90_000);
    assert.ok(isRecord(result));
    return result;
}
const control = lifecycleClient(tool);
try {
    await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'timeout-isolation-smoke', version: '0.1.0' },
    });
    client.notify('notifications/initialized');
    const initial = readStatus((await tool('dct_connection_status')).structuredContent);
    assert.ok('connections' in initial && initial.connections.length === 0);
    const targets = await Promise.all(
        [0, 1].map((index) =>
            control({
                isolation: { mode: 'none' },
                action: 'start',
                requestId: randomUUID(),
                targetKind: 'chrome',
                basePort: 19722 + index * 10,
                mcpArgs: index === 1 ? ['--categoryNetwork=false'] : [],
                launch: {
                    executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
                    args: [
                        '--no-first-run',
                        '--disable-background-networking',
                        '--disable-background-mode',
                        `--user-data-dir=${path.join(folder, `profile-${index}`)}`,
                        '--remote-debugging-port={port}',
                        `data:text/html,<title>TIMEOUT-${index}</title>`,
                    ],
                },
            }),
        ),
    );
    const [first, second] = targets;
    assert.ok(first && second && !('connections' in first) && !('connections' in second));
    const route = (target: typeof first) => {
        assert.ok(target.sessionId);
        return { connectionId: target.connectionId, sessionId: target.sessionId };
    };
    const pages = await tool('list_pages', { _dct: route(first) });
    assert.match(JSON.stringify(pages), /TIMEOUT-0/);
    const started = performance.now();
    const pageId = Number(JSON.stringify(pages).match(/(?:^|\\n)(\d+):[^\n]*TIMEOUT-0/)?.[1]);
    assert.ok(Number.isInteger(pageId) && pageId > 0);
    const hung = client.request(
        'tools/call',
        { name: 'evaluate_script', arguments: { _dct: route(first), pageId, function: '() => new Promise(() => {})' } },
        5_000,
    );
    const detached = assert.rejects(
        hung,
        (error: unknown) => error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout,
    );
    const peerDuring = await tool('list_pages', { _dct: route(second) });
    assert.match(JSON.stringify(peerDuring), /TIMEOUT-1/);
    await detached;
    const elapsedMs = performance.now() - started;
    const peerAfter = await tool('list_pages', { _dct: route(second) });
    assert.match(JSON.stringify(peerAfter), /TIMEOUT-1/);
    await assert.rejects(
        tool('list_pages', { _dct: route(first) }),
        (error: unknown) => error instanceof ProtocolError && error.code === ProtocolErrorCode.InvalidParams,
    );
    const active = (await tool('dct_connection_status', { connectionId: first.connectionId })).structuredContent;
    assert.ok(isRecord(active));
    assert.equal(active.status, 'active');
    assert.equal(active.upstreamStatus, 'connected');
    for (const field of ['connectionId', 'sessionId', 'processId', 'port'] as const)
        assert.equal(active[field], first[field]);
    for (const target of [first, second]) {
        await control({ action: 'stop', requestId: randomUUID(), disposition: 'Close', ...route(target) });
    }
    console.log(
        JSON.stringify({
            passed: true,
            elapsedMs,
            isolatedConnections: targets.length,
            healthyUpstreamRetainedAfterClientTimeout: true,
            explicitNormalClose: true,
            profilesRetainedAt: folder,
        }),
    );
} finally {
    await client.close();
    assert.equal(client.child.exitCode, 0);
}
