import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatformAdapter } from '../../src/adapters/platform-process.ts';
import type { ProcessTarget } from '../../src/domains/cdp-target.ts';
import type { ConnectionStatus, ControlResult } from '../../src/domains/control-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { assertSummary, hookResultEvents } from '../fixtures/hook-gateway-events.ts';
import { createChromeSmokeLaunch, inspectChromeSmokeTarget, requireChromeSmokeExecutable } from './chrome-host.ts';
import { closeSmokeConnection, lifecycleClient, readStatus } from './lifecycle-client.ts';
import { createClient, readMcpTools } from './mcp-client.ts';

const chrome = await requireChromeSmokeExecutable();
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-entry-recovery-'));
const platform = createPlatformAdapter();
const owned: ProcessTarget[] = [];
let entryId = '';
const client = createClient(path.join(root, 'plugins/codex/debugging-cdp-targets/dist/mcp-bootstrap.mjs'));
async function tool(name: string, arguments_: Record<string, unknown> = {}) {
    const result = await client.request('tools/call', { name, arguments: arguments_ });
    assert.ok(isRecord(result));
    if (name === 'dct_connection_status' && !arguments_.hookEventName)
        assertSummary(result.structuredContent, typeof arguments_.connectionId === 'string');
    if (
        name === 'dct_operation_wait' &&
        isRecord(result.structuredContent) &&
        isRecord(result.structuredContent.operation) &&
        result.structuredContent.operation.state === 'succeeded'
    )
        assertSummary(result.structuredContent.operation.result);
    return result;
}
const control = lifecycleClient(tool);
async function status(connectionId?: string): Promise<ControlResult> {
    return control({ action: 'status', entryId, ...(connectionId ? { connectionId } : {}) });
}
async function selectedStatus(connectionId: string): Promise<ConnectionStatus> {
    const result = await status(connectionId);
    assert.ok(!('connections' in result));
    return result;
}
async function mutate(
    action: 'restart' | 'stop' | 'end-task',
    target: ConnectionStatus,
    disposition?: 'Close' | 'Keep',
) {
    const identity = { ...route(target), entryId, requestId: randomUUID() };
    const result =
        action === 'stop' && disposition !== 'Keep'
            ? await closeSmokeConnection(control, { action, ...identity, disposition: 'Close' })
            : await control(action === 'stop' ? { action, ...identity, disposition: 'Keep' } : { action, ...identity });
    assert.ok(!('connections' in result));
    return result;
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
    const fixture = await inspectChromeSmokeTarget(target, chrome, platform);
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
async function start(index: number) {
    const target = await control({
        action: 'start',
        entryId,
        requestId: randomUUID(),
        targetKind: 'chrome',
        basePort: 19422 + index * 10,
        launch: createChromeSmokeLaunch(
            chrome,
            path.join(folder, `profile-${index}`),
            `data:text/html,<title>CONNECTION-${index}</title>`,
        ),
    });
    assert.ok(!('connections' in target));
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
    const initial = readStatus(gateway.structuredContent);
    assert.ok('connections' in initial);
    assert.deepEqual(initial.connections, []);
    entryId = initial.entryId;
    const [first, second, third] = await Promise.all([0, 1, 2].map(start));
    assert.ok(first && second && third);
    assert.equal(new Set([first.connectionId, second.connectionId, third.connectionId]).size, 3);
    await Promise.all([first, second, third].map(recordOwned));
    const aggregate = await status();
    assert.ok('connections' in aggregate && aggregate.connections.length === 3);
    await Promise.all([pages(first, 0), pages(second, 1), pages(third, 2)]);
    console.log('Three independent real targets passed concurrent official page calls in one gateway.');
    await mutate('end-task', first);
    await mutate('stop', first, 'Keep');
    await Promise.all([pages(first, 0), pages(second, 1), pages(third, 2)]);
    await mutate('stop', second, 'Close');
    await rejectsRoute(second);
    await Promise.all([pages(first, 0), pages(third, 2)]);
    const fourth = await start(3);
    assert.notEqual(fourth.connectionId, second.connectionId);
    await recordOwned(fourth);
    await Promise.all([pages(first, 0), pages(third, 2), pages(fourth, 3)]);
    console.log('Keep/reuse, scoped Close and later new connection passed.');
    assert.deepEqual(
        (await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent,
        {},
        'Delivered terminal operations must not be repeated by Hooks.',
    );
    await until(async () => (await selectedStatus(first.connectionId)).taskActive === true);
    closeStarted = Date.now();
    const [normallyClosed] = await Promise.all([closeFixture(first), pages(third, 2), pages(fourth, 3)]);
    assert.equal(normallyClosed, true);
    closeCompleted = Date.now();
    await until(async () => {
        const current = await status();
        return (
            'connections' in current &&
            !current.connections.some((connection) => connection.connectionId === first.connectionId)
        );
    });
    const reminder = await tool('dct_connection_status', { hookEventName: 'PostToolUse' });
    assert.ok(isRecord(reminder.structuredContent));
    const events = hookResultEvents(reminder.structuredContent);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.exits.length, 1);
    const exited = events[0]?.exits[0];
    assert.ok(exited);
    assert.equal(exited.connectionId, first.connectionId);
    assert.equal(exited.sessionId, first.sessionId);
    assert.equal(exited.processId, first.processId);
    assert.equal(exited.port, first.port);
    assert.equal(exited.taskActive, true);
    assert.equal(exited.expected, undefined);
    assert.equal(exited.cleanupError, undefined);
    assert.deepEqual(events[0]?.operations, []);
    assert.deepEqual(events[0]?.connections, []);
    const reminderReceived = Date.now();
    assert.ok(reminderReceived - closeCompleted <= 5_000);
    assert.deepEqual((await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent, {});
    await rejectsRoute(first);
    await assert.rejects(() => mutate('restart', first), /absent|closed|session|connection/i);
    const retried = await start(0);
    assert.notEqual(retried.connectionId, first.connectionId);
    assert.notEqual(retried.sessionId, first.sessionId);
    await recordOwned(retried);
    await pages(retried, 0);
    const restarted = await mutate('restart', retried);
    assert.equal(restarted.connectionId, retried.connectionId);
    assert.equal(restarted.port, retried.port);
    assert.notEqual(restarted.processId, retried.processId);
    assert.notEqual(restarted.sessionId, retried.sessionId);
    assert.equal(restarted.pageIdsInvalidated, true);
    await recordOwned(restarted);
    await rejectsRoute(retried);
    await Promise.all([pages(restarted, 0), pages(third, 2), pages(fourth, 3)]);
    assert.deepEqual(
        (await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent,
        {},
        'Expected restart belongs to its delivered operation, with no duplicate exit notice.',
    );
    console.log(
        'Ordinary exit used a new start; explicit live restart replaced its session/resources on the exact port while peers remained usable.',
    );
    await mutate('stop', fourth, 'Keep');
    assert.equal(await closeFixture(fourth), true);
    await until(async () => {
        const current = await status();
        return (
            'connections' in current && !current.connections.some((item) => item.connectionId === fourth.connectionId)
        );
    });
    const keptExit = hookResultEvents(
        (await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent,
    );
    assert.equal(keptExit.length, 1);
    assert.equal(keptExit[0]?.exits.length, 1);
    assert.equal(keptExit[0]?.exits[0]?.connectionId, fourth.connectionId);
    assert.equal(keptExit[0]?.exits[0]?.sessionId, fourth.sessionId);
    assert.equal(keptExit[0]?.exits[0]?.taskActive, false);
    assert.equal(keptExit[0]?.exits[0]?.cleanupError, undefined);
    assert.deepEqual(keptExit[0]?.operations, []);
    assert.deepEqual(keptExit[0]?.connections, []);
    assert.deepEqual((await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent, {});
    await rejectsRoute(fourth);
    await Promise.all([pages(restarted, 0), pages(third, 2)]);
    const remaining = await status();
    assert.ok('connections' in remaining && remaining.connections.length === 2);
    console.log(
        JSON.stringify({
            passed: true,
            entryId,
            connectionIds: [
                first.connectionId,
                second.connectionId,
                third.connectionId,
                fourth.connectionId,
                retried.connectionId,
            ],
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
