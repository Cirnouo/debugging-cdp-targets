import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/client';
import { createPlatformAdapter } from '../../src/adapters/platform-process.ts';
import type { ConnectionStatus, ControlResult } from '../../src/domains/control-contract.ts';
import type { ProcessTarget } from '../../src/gateway/targets/model/target-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { requireGuiAuthorization } from '../gui-authorization.ts';
import {
    createChromeSmokeLaunch,
    inspectChromeSmokeDirectory,
    inspectChromeSmokeTarget,
    requestChromeSmokeClose,
    requireChromeSmokeExecutable,
} from './chrome-host.ts';
import {
    type BrowserStartupRecord,
    checkChromeSmokeDisplay,
    createChromeStartupCapture,
    validateBrowserStartupRecord,
} from './chrome-startup.ts';
import {
    createFixtureArtifacts,
    createFixtureGatewayClient,
    createSmokeFailures,
    fixtureOutputCollectionId,
    fixtureOutputDirectory,
} from './fixture-artifacts.ts';
import { closeSmokeConnection, lifecycleClient, readStatus } from './lifecycle-client.ts';
import { readMcpTools } from './mcp-client.ts';

const args = requireGuiAuthorization();
const outputDirectory = fixtureOutputDirectory(args);
const artifacts = createFixtureArtifacts(outputDirectory, 'entry-recovery', {
    collectionId: fixtureOutputCollectionId(args),
});
const failures = createSmokeFailures(artifacts);
const currentCollection = artifacts.snapshot();
const controlledDiagnostics =
    !!outputDirectory && currentCollection.collectionId !== null && !currentCollection.collectionRejected;
function startupEvidence(record: Readonly<BrowserStartupRecord>, firstSample = true) {
    const safe = validateBrowserStartupRecord(record);
    if (!safe) return;
    try {
        artifacts.startup(safe);
        if (firstSample) console.log(JSON.stringify(safe));
    } catch {}
}
artifacts.begin('prerequisites');
const chrome = await requireChromeSmokeExecutable().catch((error: unknown) => {
    failures.primary(error, 'prerequisites');
    failures.finish();
    throw error;
});
const display = await checkChromeSmokeDisplay(controlledDiagnostics);
if (display) {
    startupEvidence(display);
    try {
        assert.ok(!display.available || display.responsive, 'Controlled Chrome X display is not responsive.');
    } catch (error) {
        failures.primary(error, 'prerequisites');
        failures.finish();
        throw error;
    }
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-entry-recovery-')));
const startup = await createChromeStartupCapture(controlledDiagnostics, folder, startupEvidence);
const managedDirectories = new Map<string, string>();
const platform = createPlatformAdapter();
const owned: ProcessTarget[] = [];
const client = createFixtureGatewayClient(
    path.join(root, 'tests/fixtures/http-gateway.ts'),
    outputDirectory,
    'entry-recovery',
    artifacts,
);
async function tool(name: string, arguments_: Record<string, unknown> = {}) {
    const result = await client.request('tools/call', { name, arguments: arguments_ });
    assert.ok(isRecord(result));
    if (name === 'dct_connection_status' && !arguments_.include) readStatus(result.structuredContent);
    if (
        name === 'dct_operation_wait' &&
        isRecord(result.structuredContent) &&
        isRecord(result.structuredContent.operation) &&
        result.structuredContent.operation.state === 'succeeded'
    )
        readStatus(result.structuredContent.operation.result);
    return result;
}
const executeControl = lifecycleClient(tool);
const control: typeof executeControl = (request) =>
    startup && (request.action === 'start' || request.action === 'restart')
        ? startup.settled(
              () => executeControl(request),
              request.action === 'restart',
              request.action === 'start'
                  ? request.launch.args?.find((arg) => arg.startsWith('--log-file='))?.slice('--log-file='.length)
                  : undefined,
          )
        : executeControl(request);
async function status(connectionId?: string): Promise<ControlResult> {
    return control({ action: 'status', ...(connectionId ? { connectionId } : {}) });
}
async function mutate(action: 'restart' | 'stop', target: ConnectionStatus, disposition?: 'Close' | 'Keep') {
    const identity = { ...route(target), requestId: randomUUID() };
    const result =
        action === 'stop' && disposition !== 'Keep'
            ? await closeSmokeConnection(control, { action, ...identity, disposition: 'Close' })
            : await control(
                  action === 'stop'
                      ? { action, ...identity, disposition: 'Keep' }
                      : { action, ...identity, scope: 'both' },
              );
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
        requestId: randomUUID(),
        basePort: 19422 + index * 10,
        ...createChromeSmokeLaunch(
            chrome,
            path.join(folder, `profile-${index}`),
            `data:text/html,<title>CONNECTION-${index}</title>`,
            process.platform,
            startup?.newLog(),
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
    await assert.rejects(
        () => tool('list_pages', { _dct: route(target) }),
        (error: unknown) => error instanceof ProtocolError && error.code === ProtocolErrorCode.InvalidParams,
    );
}
let normalCloseRequestStartedAt = 0;
let normalCloseRequestedAt = 0;
try {
    artifacts.begin('acceptance');
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
    const [first, second, third] = await Promise.all([0, 1, 2].map(start));
    assert.ok(first && second && third);
    assert.equal(new Set([first.connectionId, second.connectionId, third.connectionId]).size, 3);
    const aggregate = await status();
    assert.ok('connections' in aggregate && aggregate.connections.length === 3);
    await Promise.all([pages(first, 0), pages(second, 1), pages(third, 2)]);
    console.log('Three independent real targets passed concurrent official page calls in one gateway.');
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
    assert.ok(first.processId && first.port);
    const exited = await platform.snapshot(first.processId, first.port);
    assert.equal(exited.root.exists, false);
    await rejectsRoute(first);
    await directoryDeleted(first);
    const cleanupObservedAt = Date.now();
    await assert.rejects(
        () => mutate('restart', first),
        (error: unknown) => error instanceof ProtocolError && error.code === ProtocolErrorCode.InvalidParams,
    );
    const retried = await start(0);
    assert.notEqual(retried.connectionId, first.connectionId);
    assert.notEqual(retried.sessionId, first.sessionId);
    await pages(retried, 0);
    const restarted = await mutate('restart', retried);
    assert.equal(restarted.connectionId, retried.connectionId);
    assert.notEqual(restarted.processId, retried.processId);
    assert.notEqual(restarted.sessionId, retried.sessionId);
    assert.equal(restarted.pageIdsInvalidated, true);
    const restartedFixture = await recordOwned(restarted);
    const restartedDirectory = await inspectChromeSmokeDirectory(tool, restarted, restartedFixture);
    assert.equal(restartedDirectory, managedDirectories.get(retried.connectionId));
    assert.equal(await readFile(path.join(restartedDirectory, 'restart-evidence'), 'utf8'), retried.connectionId);
    await rejectsRoute(retried);
    await Promise.all([pages(restarted, 0), pages(third, 2), pages(fourth, 3)]);

    console.log(
        'Ordinary exit used a new start; explicit live restart replaced its session/resources with its recorded launch policy while peers remained usable.',
    );
    await mutate('stop', fourth, 'Keep');
    assert.equal(await closeFixture(fourth), true);
    await until(async () => {
        const current = await status();
        return (
            'connections' in current && !current.connections.some((item) => item.connectionId === fourth.connectionId)
        );
    });
    assert.ok(fourth.processId && fourth.port);
    const keptExit = await platform.snapshot(fourth.processId, fourth.port);
    assert.equal(keptExit.root.exists, false);
    await rejectsRoute(fourth);
    await directoryDeleted(fourth);
    await Promise.all([pages(restarted, 0), pages(third, 2)]);
    const remaining = await status();
    assert.ok('connections' in remaining && remaining.connections.length === 2);
    console.log(
        JSON.stringify({
            passed: true,
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
                cleanupObservedAt,
                millisecondsFromNormalCloseRequestStart: cleanupObservedAt - normalCloseRequestStartedAt,
                millisecondsFromNormalCloseRequestCompletion: cleanupObservedAt - normalCloseRequestedAt,
                millisecondsFromConnectionRetirementObservation: cleanupObservedAt - connectionRetirementObservedAt,
                measuresUiRendering: false,
            },
            managedProfileParent: folder,
        }),
    );
} catch (error) {
    console.error('Connection smoke primary failure:', error);
    failures.primary(error);
} finally {
    artifacts.begin('gateway-close');
    const closed = await Promise.allSettled([client.close()]);
    for (const result of closed) if (result.status === 'rejected') failures.primary(result.reason, 'gateway-close');
    let retainedAfterGatewayCleanup = false;
    for (const fixture of owned) {
        await failures.cleanup('target-cleanup', async () => {
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
                    console.error(
                        'Retained fixture normal Close request failed:',
                        fixture.processId,
                        fixture.port,
                        error,
                    );
                    failures.primary(error, 'target-cleanup');
                }
            }
        });
    }
    await failures.cleanup('gateway-close', async () => {
        assert.ok(
            closed.every((result) => result.status === 'fulfilled'),
            'Gateway EOF cleanup failed.',
        );
    });
    await failures.cleanup('gateway-close', async () => {
        assert.equal(client.child.exitCode, 0, 'Gateway did not exit normally.');
    });
    await failures.cleanup('target-cleanup', async () => {
        assert.equal(retainedAfterGatewayCleanup, false, 'Gateway EOF cleanup retained an application.');
    });
    for (const directory of new Set(managedDirectories.values()))
        await failures.cleanup('profile-cleanup', () => assert.rejects(lstat(directory), { code: 'ENOENT' }));
    console.log(JSON.stringify({ gatewayExitCode: client.child.exitCode, deletedManagedProfilesUnder: folder }));
    await startup?.close(!failures.hasFailure() && client.child.exitCode === 0);
    failures.finish();
}
