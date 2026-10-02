import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { controlEndpoint, sendControlRequest } from '../../src/adapters/control-ipc.ts';
import { createPlatformAdapter } from '../../src/adapters/platform-process.ts';
import type { ProcessTarget } from '../../src/domains/cdp-target.ts';
import { type ConnectionStatus, type ControlResult, parseControlResponse } from '../../src/domains/control-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { createClient, readMcpTools } from './mcp-client.ts';

if (process.platform !== 'win32') throw new Error('The real connection recovery smoke is Windows-only.');
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-entry-recovery-'));
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const execute = promisify(execFile);
const platform = createPlatformAdapter();
const owned: ProcessTarget[] = [];
let entryId = '';
const client = createClient(path.join(root, 'plugins/debugging-cdp-targets/dist/mcp-bootstrap.mjs'));
async function tool(name: string, arguments_: Record<string, unknown> = {}) {
    const result = await client.request('tools/call', { name, arguments: arguments_ });
    assert.ok(isRecord(result));
    return result;
}
async function status(connectionId?: string): Promise<ControlResult> {
    const response = await sendControlRequest(controlEndpoint(entryId), {
        action: 'status',
        entryId,
        ...(connectionId ? { connectionId } : {}),
    });
    assert.ok(response.ok, JSON.stringify(response));
    return response.result;
}
async function selectedStatus(connectionId: string): Promise<ConnectionStatus> {
    const result = await status(connectionId);
    assert.ok(!('connections' in result));
    return result;
}
async function cli(action: string, options: string[] = []): Promise<ConnectionStatus> {
    for (let attempt = 0; ; attempt += 1) {
        try {
            const { stdout } = await execute(
                process.execPath,
                [path.join(root, 'src/interface/control.ts'), action, '--entry-id', entryId, ...options],
                { windowsHide: true, shell: false, timeout: 60_000 },
            );
            const response = parseControlResponse(JSON.parse(stdout));
            assert.ok(response.ok, JSON.stringify(response));
            assert.ok(!('connections' in response.result));
            return response.result;
        } catch (error) {
            if (
                action !== 'stop' ||
                !options.includes('Close') ||
                attempt >= 2 ||
                !isRecord(error) ||
                typeof error.stdout !== 'string'
            )
                throw error;
            const response = parseControlResponse(JSON.parse(error.stdout));
            if (response.ok || !/did not close normally/.test(response.error)) throw error;
            console.log(JSON.stringify({ normalCloseRetry: attempt + 1, at: Date.now(), retained: response.details }));
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
}
function identities(target: ConnectionStatus) {
    assert.ok(target.sessionId);
    return ['--connection-id', target.connectionId, '--session-id', target.sessionId];
}
function route(target: ConnectionStatus) {
    assert.ok(target.sessionId);
    return { connectionId: target.connectionId, sessionId: target.sessionId };
}
async function until(predicate: () => Promise<boolean>, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (!(await predicate())) {
        if (Date.now() >= deadline) throw new Error('Expected connection state was not reached.');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}
async function recordOwned(target: ConnectionStatus): Promise<ProcessTarget> {
    assert.ok(target.processId && target.port && target.targetKind);
    const evidence = await platform.snapshot(target.processId, target.port);
    assert.ok(evidence.root.exists);
    assert.equal(path.resolve(evidence.root.executablePath).toLowerCase(), path.resolve(chrome).toLowerCase());
    const fixture = {
        processId: target.processId,
        port: target.port,
        targetKind: target.targetKind,
        executablePath: evidence.root.executablePath,
        startedAtUtc: evidence.root.startedAtUtc,
    };
    owned.push(fixture);
    return fixture;
}
async function closeFixture(target: ConnectionStatus) {
    assert.ok(target.processId && target.port);
    const fixture = owned.find((item) => item.processId === target.processId && item.port === target.port);
    assert.ok(fixture);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await platform.close(fixture, { requireListener: attempt === 0 })) return true;
        console.log(
            JSON.stringify({ fixtureNormalCloseRetry: attempt + 1, at: Date.now(), processId: target.processId }),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
}
function launch(index: number) {
    return `"${chrome}" --no-first-run --disable-background-networking --disable-background-mode --disable-updater-scheduler --user-data-dir="${path.join(folder, `profile-${index}`)}" --remote-debugging-port={port} "data:text/html,<title>CONNECTION-${index}</title>"`;
}
async function start(index: number) {
    const target = await cli('start', [
        '--target-kind',
        'chrome',
        '--base-port',
        String(19422 + index * 10),
        '--launch-command',
        launch(index),
    ]);
    assert.equal(target.status, 'active');
    return target;
}
async function pages(target: ConnectionStatus, index: number) {
    const result = await tool('list_pages', { _dct: route(target) });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result), new RegExp(`CONNECTION-${index}`));
}
async function rejectsRoute(target: ConnectionStatus) {
    await assert.rejects(() => tool('list_pages', { _dct: route(target) }), /unknown|stale|closed|session|connection/i);
}
let closeStarted = 0;
let closeCompleted = 0;
try {
    await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: { elicitation: { form: {} } },
        clientInfo: { name: 'parallel-connection-recovery', version: '0.1.0' },
    });
    client.notify('notifications/initialized');
    const catalog = readMcpTools(await client.request('tools/list'));
    assert.ok(catalog.some((item) => item.name === 'list_pages'));
    const gateway = await tool('dct_connection_status');
    const initial = parseControlResponse({ ok: true, result: gateway.structuredContent });
    assert.ok(initial.ok && 'connections' in initial.result);
    assert.deepEqual(initial.result.connections, []);
    entryId = initial.result.entryId;
    const [first, second, third] = await Promise.all([0, 1, 2].map(start));
    assert.ok(first && second && third);
    assert.equal(new Set([first.connectionId, second.connectionId, third.connectionId]).size, 3);
    await Promise.all([first, second, third].map(recordOwned));
    const aggregate = await status();
    assert.ok('connections' in aggregate && aggregate.connections.length === 3);
    await Promise.all([pages(first, 0), pages(second, 1), pages(third, 2)]);
    console.log('Three independent real targets passed concurrent official page calls in one gateway.');
    await cli('end-task', identities(first));
    await cli('stop', [...identities(first), '--disposition', 'Keep']);
    await Promise.all([pages(first, 0), pages(second, 1), pages(third, 2)]);
    await cli('stop', [...identities(second), '--disposition', 'Close']);
    await rejectsRoute(second);
    await Promise.all([pages(first, 0), pages(third, 2)]);
    const fourth = await start(3);
    assert.notEqual(fourth.connectionId, second.connectionId);
    await recordOwned(fourth);
    await Promise.all([pages(first, 0), pages(third, 2), pages(fourth, 3)]);
    console.log('Keep/reuse, scoped Close and later new connection passed.');
    await until(async () => (await selectedStatus(first.connectionId)).taskActive === true);
    closeStarted = Date.now();
    const [normallyClosed] = await Promise.all([closeFixture(first), pages(third, 2), pages(fourth, 3)]);
    assert.equal(normallyClosed, true);
    closeCompleted = Date.now();
    await until(async () => (await selectedStatus(first.connectionId)).status === 'lost');
    const reminder = await tool('dct_connection_status', { hookEventName: 'PostToolUse' });
    assert.ok(isRecord(reminder.structuredContent));
    const context = JSON.stringify(reminder.structuredContent);
    assert.ok(context.includes(first.connectionId));
    assert.ok(context.includes('process-exited'));
    const reminderReceived = Date.now();
    assert.ok(reminderReceived - closeCompleted <= 5_000);
    assert.deepEqual((await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent, {});
    const restarted = await cli('restart', identities(first));
    assert.equal(restarted.connectionId, first.connectionId);
    assert.equal(restarted.port, first.port);
    assert.notEqual(restarted.processId, first.processId);
    assert.notEqual(restarted.sessionId, first.sessionId);
    assert.equal(restarted.pageIdsInvalidated, true);
    await recordOwned(restarted);
    await rejectsRoute(first);
    await Promise.all([pages(restarted, 0), pages(third, 2), pages(fourth, 3)]);
    console.log('Explicit same-port recovery replaced session and rejected old route while peers remained usable.');
    await cli('stop', [...identities(fourth), '--disposition', 'Keep']);
    assert.equal(await closeFixture(fourth), true);
    await until(async () => {
        const current = await status();
        return (
            'connections' in current && !current.connections.some((item) => item.connectionId === fourth.connectionId)
        );
    });
    assert.deepEqual((await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent, {});
    await rejectsRoute(fourth);
    await Promise.all([pages(restarted, 0), pages(third, 2)]);
    const remaining = await status();
    assert.ok('connections' in remaining && remaining.connections.length === 2);
    console.log(
        JSON.stringify({
            passed: true,
            entryId,
            connectionIds: [first.connectionId, second.connectionId, third.connectionId, fourth.connectionId],
            recordedExitTiming: {
                closeStarted,
                closeCompleted,
                reminderReceived,
                millisecondsFromCloseStart: reminderReceived - closeStarted,
                millisecondsFromCloseCompletion: reminderReceived - closeCompleted,
                measuresUiRendering: false,
            },
            profilesRetainedAt: folder,
        }),
    );
} catch (error) {
    console.error('Connection smoke primary failure:', error);
    throw error;
} finally {
    const closed = await Promise.allSettled([client.close()]);
    for (const fixture of owned) {
        const evidence = await platform.snapshot(fixture.processId, fixture.port);
        if (evidence.root.exists) {
            const normallyClosed = await platform.close(fixture, { requireListener: false });
            if (!normallyClosed) console.error('Fixture retained after normal Close:', fixture.processId, fixture.port);
            assert.equal(normallyClosed, true);
        }
    }
    assert.ok(
        closed.every((result) => result.status === 'fulfilled'),
        'Gateway EOF cleanup failed.',
    );
    assert.equal(client.child.exitCode, 0, 'Gateway did not exit normally.');
    console.log(JSON.stringify({ gatewayExitCode: client.child.exitCode, profilesRetainedAt: folder }));
}
