import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatformAdapter } from '../../src/adapters/platform-process.ts';
import type { ProcessTarget } from '../../src/domains/cdp-target.ts';
import type { ConnectionStatus, ControlResult } from '../../src/domains/control-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { assertSummary, waitForSmokeHookEvents } from '../fixtures/hook-gateway-events.ts';
import {
    createChromeSmokeLaunch,
    inspectChromeSmokeDirectory,
    inspectChromeSmokeTarget,
    requestChromeSmokeClose,
    requireChromeSmokeExecutable,
} from './chrome-host.ts';
import { closeSmokeConnection, lifecycleClient, readStatus } from './lifecycle-client.ts';
import { createClient, readMcpTools } from './mcp-client.ts';

const chrome = await requireChromeSmokeExecutable();
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-entry-recovery-')));
const managedDirectories = new Map<string, string>();
const platform = createPlatformAdapter();
const owned: ProcessTarget[] = [];
let entryId = '';
const client = createClient(path.join(root, 'plugins/codex/debugging-cdp-targets/dist/mcp-bootstrap.mjs'));
async function tool(name: string, arguments_: Record<string, unknown> = {}) {
    const result = await client.request('tools/call', { name, arguments: arguments_ });
    assert.ok(isRecord(result));
    if (name === 'dct_connection_status' && !arguments_.hookEventName && !arguments_.include)
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
    return requestChromeSmokeClose(fixture, platform);
}
async function start(index: number) {
    const target = await control({
        action: 'start',
        entryId,
        requestId: randomUUID(),
        basePort: 19422 + index * 10,
        ...createChromeSmokeLaunch(
            chrome,
            path.join(folder, `profile-${index}`),
            `data:text/html,<title>CONNECTION-${index}</title>`,
        ),
    });
    assert.ok(!('connections' in target));
    assert.equal(target.status, 'active');
    const fixture = await recordOwned(target);
    const directory = await inspectChromeSmokeDirectory(tool, target, fixture);
    managedDirectories.set(target.connectionId, directory);
    await writeFile(path.join(directory, 'restart-evidence'), target.connectionId);
    return target;
}
async function directoryDeleted(target: ConnectionStatus) {
    const directory = managedDirectories.get(target.connectionId);
    assert.ok(directory);
    await until(async () => {
        try {
            await lstat(directory);
            return false;
        } catch (error) {
            if (isRecord(error) && error.code === 'ENOENT') return true;
            throw error;
        }
    });
}
async function pages(target: ConnectionStatus, index: number) {
    const result = await tool('list_pages', { _dct: route(target) });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result), new RegExp(`CONNECTION-${index}`));
}
async function rejectsRoute(target: ConnectionStatus) {
    await assert.rejects(() => tool('list_pages', { _dct: route(target) }), /unknown|stale|closed|session|connection/i);
}
let normalCloseRequestStartedAt = 0;
let normalCloseRequestedAt = 0;
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
    const aggregate = await status();
    assert.ok('connections' in aggregate && aggregate.connections.length === 3);
    await Promise.all([pages(first, 0), pages(second, 1), pages(third, 2)]);
    console.log('Three independent real targets passed concurrent official page calls in one gateway.');
    await mutate('end-task', first);
    await mutate('stop', first, 'Keep');
    await Promise.all([pages(first, 0), pages(second, 1), pages(third, 2)]);
    await mutate('stop', second, 'Close');
    await directoryDeleted(second);
    await rejectsRoute(second);
    await Promise.all([pages(first, 0), pages(third, 2)]);
    const fourth = await start(3);
    assert.notEqual(fourth.connectionId, second.connectionId);
    await Promise.all([pages(first, 0), pages(third, 2), pages(fourth, 3)]);
    console.log('Keep/reuse, scoped Close and later new connection passed.');
    assert.deepEqual(
        (await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent,
        {},
        'Delivered terminal operations must not be repeated by Hooks.',
    );
    await until(async () => (await selectedStatus(first.connectionId)).taskActive === true);
    normalCloseRequestStartedAt = Date.now();
    const [normalCloseRequested] = await Promise.all([
        closeFixture(first).then((accepted) => {
            normalCloseRequestedAt = Date.now();
            return accepted;
        }),
        pages(third, 2),
        pages(fourth, 3),
    ]);
    assert.equal(normalCloseRequested, true);
    await until(async () => {
        const current = await status();
        return (
            'connections' in current &&
            !current.connections.some((connection) => connection.connectionId === first.connectionId)
        );
    });
    const connectionRetirementObservedAt = Date.now();
    const events = await waitForSmokeHookEvents(
        async () => (await tool('dct_connection_status', { hookEventName: 'PostToolUse' })).structuredContent,
    );
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
    assert.equal(exited.cleanupCode, undefined);
    assert.deepEqual(events[0]?.operations, []);
    assert.deepEqual(events[0]?.connections, []);
    const reminderReceived = Date.now();
    assert.ok(reminderReceived - connectionRetirementObservedAt <= 5_000);
    assert.deepEqual((await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent, {});
    await rejectsRoute(first);
    await directoryDeleted(first);
    await assert.rejects(() => mutate('restart', first), /absent|closed|session|connection/i);
    const retried = await start(0);
    assert.notEqual(retried.connectionId, first.connectionId);
    assert.notEqual(retried.sessionId, first.sessionId);
    await pages(retried, 0);
    const restarted = await mutate('restart', retried);
    assert.equal(restarted.connectionId, retried.connectionId);
    assert.equal(restarted.port, retried.port);
    assert.notEqual(restarted.processId, retried.processId);
    assert.notEqual(restarted.sessionId, retried.sessionId);
    assert.equal(restarted.pageIdsInvalidated, true);
    const restartedFixture = await recordOwned(restarted);
    const restartedDirectory = await inspectChromeSmokeDirectory(tool, restarted, restartedFixture);
    assert.equal(restartedDirectory, managedDirectories.get(retried.connectionId));
    assert.equal(await readFile(path.join(restartedDirectory, 'restart-evidence'), 'utf8'), retried.connectionId);
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
    const keptExit = await waitForSmokeHookEvents(
        async () => (await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent,
    );
    assert.equal(keptExit.length, 1);
    assert.equal(keptExit[0]?.exits.length, 1);
    assert.equal(keptExit[0]?.exits[0]?.connectionId, fourth.connectionId);
    assert.equal(keptExit[0]?.exits[0]?.sessionId, fourth.sessionId);
    assert.equal(keptExit[0]?.exits[0]?.taskActive, false);
    assert.equal(keptExit[0]?.exits[0]?.cleanupError, undefined);
    assert.equal(keptExit[0]?.exits[0]?.cleanupCode, undefined);
    assert.deepEqual(keptExit[0]?.operations, []);
    assert.deepEqual(keptExit[0]?.connections, []);
    assert.deepEqual((await tool('dct_connection_status', { hookEventName: 'Stop' })).structuredContent, {});
    await rejectsRoute(fourth);
    await directoryDeleted(fourth);
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
                normalCloseRequestStartedAt,
                normalCloseRequestedAt,
                connectionRetirementObservedAt,
                reminderReceived,
                millisecondsFromNormalCloseRequestStart: reminderReceived - normalCloseRequestStartedAt,
                millisecondsFromNormalCloseRequestCompletion: reminderReceived - normalCloseRequestedAt,
                millisecondsFromConnectionRetirementObservation: reminderReceived - connectionRetirementObservedAt,
                measuresUiRendering: false,
            },
            managedProfileParent: folder,
        }),
    );
} catch (error) {
    console.error('Connection smoke primary failure:', error);
    throw error;
} finally {
    const closed = await Promise.allSettled([client.close()]);
    let retainedAfterGatewayCleanup = false;
    for (const fixture of owned) {
        const evidence = await platform.snapshot(fixture.processId, fixture.port);
        if (evidence.root.exists) {
            retainedAfterGatewayCleanup = true;
            try {
                const normalCloseRequested = await requestChromeSmokeClose(fixture, platform);
                console.error(
                    'Fixture retained after gateway EOF cleanup:',
                    JSON.stringify({ processId: fixture.processId, port: fixture.port, normalCloseRequested }),
                );
            } catch (error) {
                console.error('Retained fixture normal Close request failed:', fixture.processId, fixture.port, error);
            }
        }
    }
    assert.ok(
        closed.every((result) => result.status === 'fulfilled'),
        'Gateway EOF cleanup failed.',
    );
    assert.equal(client.child.exitCode, 0, 'Gateway did not exit normally.');
    assert.equal(retainedAfterGatewayCleanup, false, 'Gateway EOF cleanup retained an application.');
    for (const directory of new Set(managedDirectories.values()))
        await assert.rejects(lstat(directory), { code: 'ENOENT' });
    console.log(JSON.stringify({ gatewayExitCode: client.child.exitCode, deletedManagedProfilesUnder: folder }));
}
