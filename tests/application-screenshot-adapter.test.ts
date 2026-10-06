import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    type ApplicationAdapterIO,
    createApplicationScreenshotAdapter,
} from './smoke/application-screenshot-adapter.ts';
import type { ApplicationProbeConfig } from './smoke/application-screenshot-core.ts';
import type { PreparedApplicationScreenshotFixture } from './smoke/application-screenshot-fixture.ts';

const entryId = '00000000-0000-4000-8000-000000000001';
const connectionId = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const operationId = '00000000-0000-4000-8000-000000000004';
const identity = {
    processId: 4400,
    executablePath: 'C:/Fixture/obsidian.exe',
    startedAtUtc: '2026-10-07T00:00:00.0000001Z',
};
const connection = {
    entryId,
    connectionId,
    sessionId,
    processId: 4400,
    port: 20222,
    status: 'active',
    targetKind: 'generic-cdp',
};
const config: ApplicationProbeConfig = {
    fixture: {
        application: 'obsidian',
        source: { executable: identity.executablePath, sha256: 'a'.repeat(64) },
        baseline: {
            executable: identity.executablePath,
            args: ['--user-data-dir={fixture}/profile', '--remote-debugging-port={port}'],
        },
        candidate: {
            executable: identity.executablePath,
            args: [
                '--user-data-dir={fixture}/profile',
                '--remote-debugging-port={port}',
                '--enable-features=CDPScreenshotNewSurface',
            ],
        },
        fixtureFiles: {},
        page: { url: 'app://obsidian.md/index.html', title: 'synthetic' },
    },
    payload: { root: 'C:/Evidence/sealed', receipt: {} },
    mainWindow: { className: 'Chrome_WidgetWin_1', titleIncludes: 'synthetic' },
    identityFunction: '() => ({})',
    preflight: { status: 'approved', reason: 'Guarded' },
};
const prepared: PreparedApplicationScreenshotFixture = {
    fixture: config.fixture,
    directory: 'C:/Evidence/cell',
    sourceSha256: 'a'.repeat(64),
    launch: {
        executable: identity.executablePath,
        args: [
            '--user-data-dir=C:/Evidence/cell/profile',
            '--remote-debugging-port={port}',
            '--enable-features=CDPScreenshotNewSurface',
        ],
    },
};
function boundary(
    failure?:
        | 'start'
        | 'close'
        | 'witness'
        | 'anchor'
        | 'snapshot'
        | 'permission'
        | 'permission-uncertain'
        | 'elevation-fallback'
        | 'elevated-token'
        | 'elevated-root'
        | 'malformed-status',
    profile = 'C:/Evidence/cell/profile',
) {
    const calls: { method: string; params: Record<string, unknown>; timeout?: number }[] = [];
    const sequence: string[] = [];
    const records: { kind: string; value: unknown }[] = [];
    let connected = false;
    let stopped = false;
    let operation = 'start';
    let stdioClosed = false;
    const io: ApplicationAdapterIO = {
        environment: { Path: 'C:/System', WEBVIEW2_USER_DATA_FOLDER: 'old' },
        now: () => Date.parse(identity.startedAtUtc),
        client(entry, options) {
            assert.equal(entry.replaceAll('\\', '/'), 'C:/Evidence/sealed/dist/mcp-bootstrap.mjs');
            assert.ok(options.env && !('WEBVIEW2_USER_DATA_FOLDER' in options.env));
            return {
                child: { pid: 4000, spawnargs: ['node', entry], exitCode: null, signalCode: null },
                async request(method, params = {}, timeout) {
                    calls.push({ method, params, ...(timeout === undefined ? {} : { timeout }) });
                    if (method === 'initialize') return {};
                    assert.equal(method, 'tools/call');
                    const args = params.arguments;
                    assert.ok(args && typeof args === 'object');
                    if (params.name === 'dct_connection_status') {
                        if (failure === 'malformed-status')
                            return {
                                structuredContent: { entryId, connections: [{ ...connection, status: 'corrupt' }] },
                            };
                        if (typeof args === 'object' && 'toolNames' in args)
                            return {
                                structuredContent: {
                                    ...connection,
                                    toolAvailability: ['list_pages', 'evaluate_script', 'take_screenshot'].map(
                                        (name) => ({ name, inputSchema: {} }),
                                    ),
                                },
                            };
                        return { structuredContent: { entryId, connections: connected ? [connection] : [] } };
                    }
                    if (params.name === 'dct_connection_start') {
                        connected = true;
                        operation = 'start';
                        return { structuredContent: { operationId } };
                    }
                    if (params.name === 'dct_connection_stop') {
                        operation = 'stop';
                        sequence.push('normal-close');
                        if (failure === 'close') throw new Error('Close denied');
                        return { structuredContent: { operationId } };
                    }
                    if (params.name === 'dct_operation_cancel') {
                        sequence.push('cancel-permission-attempt');
                        return {
                            structuredContent: {
                                entryId,
                                operationId,
                                state: failure === 'permission-uncertain' ? 'cancelling' : 'cancelled',
                                cursor: 2,
                            },
                        };
                    }
                    if (params.name === 'dct_operation_wait') {
                        if (
                            operation === 'start' &&
                            ['permission', 'permission-uncertain', 'elevation-fallback'].includes(failure ?? '')
                        ) {
                            if (calls.filter((call) => call.params.name === 'dct_operation_wait').length > 1) {
                                if (!sequence.includes('cancel-permission-attempt'))
                                    throw new Error('Continued readiness polling after permission boundary.');
                                return {
                                    structuredContent: {
                                        complete: false,
                                        cursor: 2,
                                        operation: {
                                            entryId,
                                            operationId,
                                            state: 'cancelling',
                                            phase: 'awaiting-permission',
                                            connectionId,
                                            sessionId,
                                        },
                                    },
                                };
                            }
                            if (failure === 'elevation-fallback')
                                return {
                                    structuredContent: {
                                        complete: true,
                                        cursor: 1,
                                        events: [{ phase: 'awaiting-permission', connectionId, sessionId }],
                                        operation: {
                                            entryId,
                                            operationId,
                                            state: 'succeeded',
                                            phase: 'succeeded',
                                            result: connection,
                                        },
                                    },
                                };
                            return {
                                structuredContent: {
                                    complete: false,
                                    cursor: 1,
                                    events: [],
                                    operation: {
                                        entryId,
                                        operationId,
                                        state: 'running',
                                        phase: 'awaiting-permission',
                                        connectionId,
                                        sessionId,
                                        error: { nativeError: 740 },
                                    },
                                },
                            };
                        }
                        if (operation === 'start' && failure === 'start')
                            return {
                                structuredContent: {
                                    complete: true,
                                    cursor: 1,
                                    operation: { state: 'failed', error: { message: 'partial start failure' } },
                                },
                            };
                        if (operation === 'stop') {
                            connected = false;
                            stopped = true;
                        }
                        return {
                            structuredContent: {
                                complete: true,
                                cursor: 1,
                                operation: {
                                    state: 'succeeded',
                                    result: operation === 'start' ? connection : { ...connection, status: 'idle' },
                                },
                            },
                        };
                    }
                    return { content: [] };
                },
                notify() {},
                async close() {
                    stdioClosed = true;
                    sequence.push('gateway-close');
                    this.child.exitCode = 0;
                },
            };
        },
        async snapshot(processId) {
            if (failure === 'snapshot' && !stopped) throw new Error('snapshot unavailable');
            return {
                root: stopped
                    ? { exists: false }
                    : {
                          exists: true,
                          executablePath: identity.executablePath,
                          startedAtUtc: processId === 4450 ? '2026-10-07T00:00:00.0000002Z' : identity.startedAtUtc,
                          sessionId: 1,
                      },
                currentSessionId: 1,
                processIds: stopped ? [] : failure === 'elevated-root' ? [4400, 4450] : [4400],
                listeners: stopped
                    ? []
                    : [{ localAddress: '127.0.0.1', owningProcess: failure === 'elevated-root' ? 4450 : 4400 }],
            };
        },
        async endpoint() {
            return {
                Browser: 'Chrome/150.0.0.0',
                webSocketDebuggerUrl: 'ws://127.0.0.1:20222/devtools/browser/fixture',
            };
        },
        async powershell(_script, args) {
            assert.ok(args.includes('-ApplicationPid'));
            const processId = Number(args[args.indexOf('-ApplicationPid') + 1]);
            return {
                raw: {
                    identity: {
                        ...identity,
                        processId,
                        startedAtUtc: processId === 4450 ? '2026-10-07T00:00:00.0000002Z' : identity.startedAtUtc,
                    },
                    commandLine: 'fixture',
                    argv: [
                        identity.executablePath,
                        `--user-data-dir=${profile}`,
                        '--remote-debugging-port=20222',
                        '--enable-features=CDPScreenshotNewSurface',
                    ],
                    file: { sha256: 'a'.repeat(64), fileVersion: '1', productVersion: '1' },
                    elevated: failure === 'elevated-token' || (failure === 'elevated-root' && processId === 4400),
                    identityVerifiedBefore: true,
                    identityVerifiedAfter: true,
                },
                stdout: '{}',
                stderr: '',
            };
        },
        witness(identities) {
            sequence.push('arm-witness');
            return {
                armed: Promise.resolve(),
                async finish() {
                    sequence.push('exit-witness');
                    return {
                        event: 'observed',
                        receipts: identities.map((owned) => ({
                            ...owned,
                            identityVerified: true,
                            processExited: failure !== 'witness' && failure !== 'permission-uncertain',
                            waitResult: 0,
                            waitError: 0,
                            exitCode: 0,
                        })),
                    };
                },
            };
        },
        anchor: {
            async prepare() {
                return [];
            },
            async observe() {
                return [];
            },
            async cleanup() {
                sequence.push('anchor-close');
                if (failure === 'anchor') throw new Error('anchor retained');
                return { anchorNotAcquired: true };
            },
        },
    };
    const adapter = createApplicationScreenshotAdapter(
        config,
        'C:/Evidence/cell',
        async (kind, value) => {
            records.push({ kind, value });
        },
        io,
    );
    return { adapter, calls, sequence, records, closed: () => stdioClosed };
}
test('application adapter uses sealed entry generic-cdp identities and unchanged 90s receipt timeout', async () => {
    const io = boundary();
    const route = await io.adapter.acquire(prepared, { root: config.payload.root, inventoryDigest: 'b'.repeat(64) });
    await route.qualify();
    await route.call('list_pages', {});
    const official = io.calls.find((call) => call.params.name === 'list_pages');
    assert.deepEqual(official?.params.arguments, { _dct: { connectionId, sessionId } });
    assert.equal(official?.timeout, 90_000);
    const start = io.calls.find((call) => call.params.name === 'dct_connection_start');
    assert.ok(start?.params.arguments && typeof start.params.arguments === 'object');
    assert.equal('targetKind' in start.params.arguments && start.params.arguments.targetKind, 'generic-cdp');
    assert.equal((await io.adapter.cleanup()).ok, true);
    assert.ok(io.sequence.indexOf('arm-witness') < io.sequence.indexOf('normal-close'));
    assert.ok(io.sequence.indexOf('exit-witness') < io.sequence.indexOf('gateway-close'));
    assert.equal(io.closed(), true);
});
test('partial start discovered ownership is normally closed and actual exit proved', async () => {
    const io = boundary('start');
    await assert.rejects(io.adapter.acquire(prepared, { root: config.payload.root, inventoryDigest: 'b'.repeat(64) }));
    assert.equal((await io.adapter.cleanup()).ok, true);
    assert.ok(io.sequence.includes('normal-close') && io.sequence.includes('exit-witness'));
});

test('runtime profile evidence is bound to the reviewed expanded carrier instead of a guessed folder name', async () => {
    const profile = 'C:/Evidence/cell/fresh-data';
    const io = boundary(undefined, profile);
    const route = await io.adapter.acquire(
        {
            ...prepared,
            launch: {
                ...prepared.launch,
                args: (prepared.launch.args ?? []).map((arg) =>
                    arg.startsWith('--user-data-dir=') ? `--user-data-dir=${profile}` : arg,
                ),
            },
        },
        { root: config.payload.root, inventoryDigest: 'b'.repeat(64) },
    );
    await route.qualify();
    assert.equal((await io.adapter.cleanup()).ok, true);
});
test('target witness or anchor uncertainty keeps gateway stdio and retained identities', async () => {
    for (const failure of ['close', 'witness', 'anchor', 'snapshot'] as const) {
        const io = boundary(failure);
        try {
            await io.adapter.acquire(prepared, { root: config.payload.root, inventoryDigest: 'b'.repeat(64) });
        } catch {}
        const result = await io.adapter.cleanup();
        assert.equal(result.ok, false);
        assert.equal(io.closed(), false);
        assert.ok(io.sequence.includes('normal-close') && io.sequence.includes('anchor-close'));
        assert.ok('retained' in result);
    }
});

test('permission waiting or prior elevation fallback cancels the attempt and never proceeds to official tools', async () => {
    for (const failure of ['permission', 'permission-uncertain', 'elevation-fallback'] as const) {
        const io = boundary(failure);
        await assert.rejects(
            io.adapter.acquire(prepared, { root: config.payload.root, inventoryDigest: 'b'.repeat(64) }),
            /permission|elevation/i,
        );
        assert.equal(io.calls.filter((call) => call.params.name === 'dct_operation_cancel').length, 1);
        assert.ok(
            !io.calls.some((call) =>
                ['evaluate_script', 'list_pages', 'take_screenshot'].includes(String(call.params.name)),
            ),
        );
        const cleanup = await io.adapter.cleanup();
        assert.ok(io.sequence.includes('normal-close') && io.sequence.includes('anchor-close'));
        if (failure === 'permission-uncertain') {
            assert.equal(cleanup.ok, false);
            assert.equal(io.closed(), false);
        }
    }
});

test('measured elevated Obsidian token blocks official qualification and still normally closes the target', async () => {
    const io = boundary('elevated-token');
    const route = await io.adapter.acquire(prepared, { root: config.payload.root, inventoryDigest: 'b'.repeat(64) });
    await assert.rejects(route.qualify(), /ordinary privileges/);
    assert.ok(io.records.some((event) => event.kind === 'browser-process-output'));
    assert.ok(
        !io.calls.some((call) =>
            ['list_pages', 'evaluate_script', 'take_screenshot'].includes(String(call.params.name)),
        ),
    );
    assert.equal((await io.adapter.cleanup()).ok, true);
    assert.ok(io.sequence.includes('normal-close'));
});

test('ordinary browser listener evidence cannot substitute for a distinct elevated root token', async () => {
    const io = boundary('elevated-root');
    const route = await io.adapter.acquire(prepared, { root: config.payload.root, inventoryDigest: 'b'.repeat(64) });
    await assert.rejects(route.qualify(), /ordinary privileges/);
    assert.ok(
        !io.calls.some((call) =>
            ['list_pages', 'evaluate_script', 'take_screenshot'].includes(String(call.params.name)),
        ),
    );
    assert.equal((await io.adapter.cleanup()).ok, true);
});

test('malformed ownership receipts are saved before boundary validation rejects them', async () => {
    const io = boundary('malformed-status');
    await assert.rejects(io.adapter.acquire(prepared, { root: config.payload.root, inventoryDigest: 'b'.repeat(64) }));
    assert.ok(
        io.records.some(
            (event) =>
                event.kind === 'mcp-result' &&
                typeof event.value === 'object' &&
                event.value !== null &&
                'name' in event.value &&
                event.value.name === 'dct_connection_status',
        ),
    );
    assert.equal((await io.adapter.cleanup()).ok, false);
    assert.equal(io.closed(), false);
});
