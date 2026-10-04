import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createPlatformAdapter } from '../../src/adapters/platform-process.ts';
import { errorDetails, isRecord } from '../../src/shared/errors.ts';
import { lifecycleClient, readStatus } from './lifecycle-client.ts';
import { createClient } from './mcp-client.ts';

if (process.platform !== 'win32') throw new Error('Windows elevated MCP smoke requires Windows.');
const folder = path.resolve(process.argv[2] ?? '.superpowers/sdd/mcp-native-lifecycle/windows-elevated-mcp');
await mkdir(folder, { recursive: true });
const executable = path.join(folder, 'requireAdministrator.exe');
const compiled = await promisify(execFile)(
    'powershell.exe',
    [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(new URL('../fixtures/compile-native-window.ps1', import.meta.url)),
        '-Output',
        executable,
        '-Level',
        'requireAdministrator',
    ],
    { windowsHide: true, shell: false },
);
const permissions: unknown = JSON.parse(compiled.stdout.trim());
assert.ok(isRecord(permissions));
assert.equal(permissions.currentElevation, false, 'Run this smoke from an ordinary gateway process.');
assert.equal(permissions.requiresElevation, true);
const client = createClient(
    fileURLToPath(new URL('../../plugins/debugging-cdp-targets/dist/mcp-bootstrap.mjs', import.meta.url)),
);
const events: Record<string, unknown>[] = [];
const evidence: Record<string, unknown> = { gatewayElevated: false, events };
async function tool(name: string, args: Record<string, unknown> = {}) {
    const result = await client.request('tools/call', { name, arguments: args });
    assert.ok(isRecord(result));
    const value = result.structuredContent;
    if (name === 'dct_operation_wait' && isRecord(value) && Array.isArray(value.events)) {
        for (const event of value.events)
            if (isRecord(event)) {
                const diagnostic = { phase: event.phase, state: event.state, elapsedMs: event.elapsedMs };
                events.push(diagnostic);
                console.log(JSON.stringify(diagnostic));
            }
    }
    return result;
}
const control = lifecycleClient(tool);
try {
    await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'elevated-mcp-smoke', version: '0.1.0' },
    });
    client.notify('notifications/initialized');
    const entryId = readStatus((await tool('dct_connection_status')).structuredContent).entryId;
    const marker = path.join(folder, 'visible');
    const target = await control({
        action: 'start',
        entryId,
        requestId: randomUUID(),
        basePort: 21522,
        launch: {
            executable,
            args: [marker],
            cwd: folder,
            env: {
                DCT_TEST_NATIVE: 'MCP elevated Unicode 中文',
                DCT_TEST_WINDOW_LIFETIME_MS: '120000',
                DCT_TEST_CDP_PORT: '{port}',
            },
        },
    });
    assert.ok(!('connections' in target));
    assert.equal(target.status, 'active');
    assert.ok(target.processId && target.port && target.sessionId);
    evidence.entryId = entryId;
    evidence.connectionId = target.connectionId;
    evidence.sessionId = target.sessionId;
    evidence.processId = target.processId;
    evidence.port = target.port;
    assert.equal(await readFile(`${marker}.elevated`, 'utf8'), 'true');
    assert.equal(Number(await readFile(`${marker}.pid`, 'utf8')), target.processId);
    assert.equal(Buffer.from(await readFile(marker, 'utf8'), 'base64').toString('utf8'), 'MCP elevated Unicode 中文');
    const permissionIndex = events.findIndex((event) => event.phase === 'awaiting-permission');
    const readinessIndex = events.findIndex((event) => event.phase === 'waiting-cdp');
    assert.ok(permissionIndex >= 0 && readinessIndex > permissionIndex);
    evidence.permissionThenReadiness = true;
    const status = (await tool('dct_connection_status', { entryId, connectionId: target.connectionId }))
        .structuredContent;
    assert.ok(isRecord(status));
    assert.equal(status.status, 'active');
    assert.ok(Array.isArray(status.enabledTools) && status.enabledTools.includes('take_screenshot'));
    evidence.actualOfficialCatalogReturned = true;
    evidence.environmentPreserved = true;
    const closed = await control({
        action: 'stop',
        entryId,
        requestId: randomUUID(),
        connectionId: target.connectionId,
        sessionId: target.sessionId,
        disposition: 'Close',
    });
    assert.ok(!('connections' in closed));
    assert.equal(closed.status, 'idle');
    assert.equal(await readFile(`${marker}.closed`, 'utf8'), 'normal-close');
    const final = await createPlatformAdapter().snapshot(target.processId, target.port);
    assert.equal(final.root.exists, false);
    assert.deepEqual(final.listeners, []);
    const gateway = readStatus((await tool('dct_connection_status', { entryId })).structuredContent);
    assert.ok('connections' in gateway);
    assert.deepEqual(gateway.connections, []);
    evidence.normalCloseConfirmed = true;
    evidence.passed = true;
} catch (error) {
    evidence.failure = errorDetails(error) ?? { category: 'integration-assertion-failed' };
    throw error;
} finally {
    try {
        await client.close();
        evidence.gatewayExitCode = client.child.exitCode;
    } finally {
        await writeFile(path.join(folder, 'evidence.json'), `${JSON.stringify(evidence, null, 4)}\n`);
        console.log(JSON.stringify(evidence));
    }
    assert.equal(client.child.exitCode, 0);
}
