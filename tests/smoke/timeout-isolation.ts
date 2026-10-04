import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import { lifecycleClient, readStatus } from './lifecycle-client.ts';
import { createClient } from './mcp-client.ts';

if (process.platform !== 'win32') throw new Error('This opt-in native Chrome smoke is Windows-only.');
const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-timeout-isolation-'));
const client = createClient(
    fileURLToPath(new URL('../../plugins/codex/debugging-cdp-targets/dist/mcp-bootstrap.mjs', import.meta.url)),
);
async function tool(name: string, args: Record<string, unknown> = {}) {
    // The test client must outlive the gateway's unchanged 60-second upstream timeout.
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
    const entryId = initial.entryId;
    const targets = await Promise.all(
        [0, 1].map((index) =>
            control({
                action: 'start',
                entryId,
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
    assert.match(JSON.stringify(pages), /1:.*TIMEOUT-0/);
    const started = performance.now();
    const hung = tool('evaluate_script', { _dct: route(first), pageId: 1, function: '() => new Promise(() => {})' });
    const peerDuring = await tool('list_pages', { _dct: route(second) });
    assert.match(JSON.stringify(peerDuring), /TIMEOUT-1/);
    const result = await hung;
    const elapsedMs = performance.now() - started;
    assert.equal(result.isError, true);
    assert.ok(isRecord(result.structuredContent));
    assert.equal(result.structuredContent.code, 'CONNECTION_RECOVERY_REQUIRED');
    assert.equal(result.structuredContent.upstreamClosed, true);
    const peerAfter = await tool('list_pages', { _dct: route(second) });
    assert.match(JSON.stringify(peerAfter), /TIMEOUT-1/);
    const gated = await tool('list_pages', { _dct: route(first) });
    assert.equal(gated.isError, true);
    assert.ok(isRecord(gated.structuredContent));
    assert.equal(gated.structuredContent.status, 'lost');
    const lost = (await tool('dct_connection_status', { entryId, connectionId: first.connectionId })).structuredContent;
    assert.ok(isRecord(lost) && Array.isArray(lost.diagnostics));
    assert.ok(
        lost.diagnostics.some(
            (item: unknown) => isRecord(item) && item.phase === 'cdp-response' && item.outcome === 'interrupted',
        ),
    );
    const recovered = await control({ action: 'restart', entryId, requestId: randomUUID(), ...route(first) });
    assert.ok(!('connections' in recovered));
    assert.notEqual(recovered.sessionId, first.sessionId);
    assert.match(JSON.stringify(await tool('list_pages', { _dct: route(recovered) })), /TIMEOUT-0/);
    for (const target of [recovered, second]) {
        await control({ action: 'stop', entryId, requestId: randomUUID(), disposition: 'Close', ...route(target) });
    }
    console.log(
        JSON.stringify({
            passed: true,
            elapsedMs,
            isolatedConnections: targets.length,
            upstreamClosed: true,
            explicitRecovery: true,
            profilesRetainedAt: folder,
        }),
    );
} finally {
    await client.close();
    assert.equal(client.child.exitCode, 0);
}
