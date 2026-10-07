import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import type { OfficialConnection } from '../src/adapters/mcp-bridge.ts';
import type { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { startPluginRuntime } from '../src/application/plugin-runtime.ts';
import { RetainedTargetError } from '../src/domains/cdp-target.ts';
import type { ConnectionStatus, ControlHandler, LaunchOptions } from '../src/domains/control-contract.ts';
import { isRecord } from '../src/shared/errors.ts';

function connectionStatus(controller: ControlHandler, connectionId: string): ConnectionStatus {
    const status = controller.status(connectionId);
    assert.ok('connectionId' in status);
    return status;
}

async function fixture({
    failOfficialClose = false,
    failCloseUntil = 2,
    mismatchCatalog = false,
    failLaunch = '',
    retainLaunch = false,
    failTargetClose = false,
    waitForCancellation = false,
    timeoutCall = false,
} = {}) {
    let callbacks: Parameters<typeof createMcpEntryServer>[0] | undefined;
    let connections = 0;
    let closes = 0;
    let calls = 0;
    let routers = 0;
    let routerCloses = 0;
    const received: { url: string; arguments: Record<string, unknown> }[] = [];
    const launches: LaunchOptions[] = [];
    const exits: (() => void)[] = [];
    const targets: EventEmitter[] = [];
    let releaseLaunch: () => void = () => {};
    let targetCloses = 0;
    let targetCloseFails = failTargetClose;
    let resolveClosed: () => void = () => {};
    const gatewayClosed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
    });
    const runtime = await startPluginRuntime({
        loadCatalog: async (tools = []) =>
            createToolCatalog({
                version: '1.10.1',
                tools: tools.map((tool) => ({ name: tool.name, requires: {}, variants: [tool] })),
            }),
        createRouter: async () => ({
            url: `http://127.0.0.1:${31000 + routers++}`,
            isBusy: () => false,
            setTarget: () => {},
            clearTarget: () => {},
            close: async () => {
                routerCloses += 1;
            },
        }),
        createHost: () => ({
            launch: async (options, context) => {
                if (options.launch.executable === 'wait-cleanup') {
                    await new Promise<void>((resolve) => {
                        releaseLaunch = resolve;
                    });
                    context?.signal?.throwIfAborted();
                }
                if (waitForCancellation && context?.signal) {
                    const signal = context.signal;
                    if (!signal.aborted)
                        await new Promise<void>((resolve) =>
                            signal.addEventListener('abort', () => resolve(), { once: true }),
                        );
                    throw signal.reason;
                }
                launches.push(options);
                if (options.launch.executable === failLaunch && !retainLaunch) throw new Error('Launch failed.');
                const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null });
                targets.push(child);
                const target = {
                    processId: 42 + targets.length,
                    port: options.exactPort ?? 9222,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    targetKind: 'chrome' as const,
                    child,
                    launchDefinition: {
                        executablePath: process.execPath,
                        arguments: ['--port=9222'],
                        cwd: process.cwd(),
                    },
                };
                context?.onCreated?.(target);
                if (options.launch.executable === failLaunch && retainLaunch)
                    throw new RetainedTargetError('Rollback failed.', target);
                return target;
            },
            close: async (target) => {
                targetCloses++;
                if (targetCloseFails) return false;
                const child = targets[target.processId - 43];
                assert.ok(child);
                Object.assign(child, { exitCode: 0 });
                child.emit('exit', 0);
                return true;
            },
        }),
        createConnection: async (url): Promise<OfficialConnection> => {
            connections += 1;
            return {
                tools: [
                    {
                        name: mismatchCatalog && connections > 1 ? 'changed_pages' : 'list_pages',
                        inputSchema: { type: 'object', properties: {} },
                    },
                ],
                call: async (_name, arguments_) => {
                    received.push({ url, arguments: arguments_ });
                    calls += 1;
                    if (timeoutCall && url.endsWith(':31001'))
                        throw new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out.');
                    return { content: [] };
                },
                close: async () => {
                    closes += 1;
                    if (failOfficialClose && closes >= 2 && closes <= failCloseUntil)
                        throw new Error('Official normal close timed out.');
                },
                onExit: (listener) => {
                    exits.push(listener);
                },
                rootsChanged: async () => {},
            };
        },
        createEntry: (options) => {
            callbacks = options;
            return {
                connect: async () => {},
                closed: gatewayClosed,
                close: async () => {
                    resolveClosed();
                },
                roots: async () => ({ roots: [] }),
                supportsRoots: () => false,
                supportsFormElicitation: () => false,
                elicit: async () => ({ action: 'cancel' }),
            };
        },
    });
    const controller = runtime.controller;
    assert.ok(callbacks);
    return {
        runtime,
        controller,
        callbacks,
        targets,
        exits,
        received,
        launches,
        routerCloses: () => routerCloses,
        counts: () => ({ connections, closes, calls }),
        releaseLaunch: () => releaseLaunch(),
        targetCloses: () => targetCloses,
        allowTargetClose: () => {
            targetCloseFails = false;
        },
    };
}

test('Close ends upstream and later start reuses the entry without host reconnection', async () => {
    const f = await fixture();
    try {
        assert.deepEqual(f.counts(), { connections: 1, closes: 1, calls: 0 });
        const first = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.ok(first.sessionId);
        await f.controller.stop({ connectionId: first.connectionId, sessionId: first.sessionId, disposition: 'Keep' });
        assert.equal(f.counts().closes, 1);
        await f.controller.stop({ connectionId: first.connectionId, sessionId: first.sessionId, disposition: 'Close' });
        assert.equal(f.counts().closes, 2);
        const second = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture2' } });
        assert.notEqual(first.sessionId, second.sessionId);
        assert.equal(f.counts().connections, 3);
    } finally {
        await f.runtime.close();
    }
    assert.equal(f.counts().closes, 3);
    await f.runtime.closed;
});

test('gateway disconnect begins cleanup of other connections while one permission operation still waits', async () => {
    const f = await fixture();
    await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'ready' } });
    assert.ok(f.callbacks.control);
    await f.callbacks.control({
        isolation: { mode: 'none' },
        action: 'start',
        entryId: f.runtime.entryId,
        requestId: 'waiting',
        launch: { executable: 'wait-cleanup' },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const closed = f.runtime.close();
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(f.targetCloses(), 1);
    } finally {
        f.releaseLaunch();
        await closed;
    }
});

test('native cancellation that completed cleanup remains cancelled through the runtime boundary', async () => {
    const f = await fixture({ waitForCancellation: true });
    try {
        assert.ok(f.callbacks.control);
        const accepted = await f.callbacks.control({
            isolation: { mode: 'none' },
            action: 'start',
            entryId: f.runtime.entryId,
            requestId: 'native-cancel',
            launch: { executable: 'fixture' },
        });
        assert.equal(typeof accepted.operationId, 'string');
        if (typeof accepted.operationId !== 'string') throw new Error('Missing operation ID');
        await new Promise<void>((resolve) => setImmediate(resolve));
        await f.callbacks.control({ action: 'cancel', entryId: f.runtime.entryId, operationId: accepted.operationId });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const state = await f.callbacks.control({
            action: 'status',
            entryId: f.runtime.entryId,
            operationId: accepted.operationId,
        });
        assert.equal(state.state, 'cancelled');
        assert.deepEqual(f.controller.status(), { entryId: f.runtime.entryId, connections: [] });
    } finally {
        await f.runtime.close();
    }
});

test('an unfinished official timeout isolates only its connection and retains application identity for explicit recovery', async () => {
    const f = await fixture({ timeoutCall: true });
    try {
        const first = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        const second = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'other' } });
        const signal = new AbortController().signal;
        const result = await f.callbacks.invoke(
            'list_pages',
            { _dct: { connectionId: first.connectionId, sessionId: first.sessionId } },
            signal,
            () => {},
        );
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.structuredContent), /CONNECTION_RECOVERY_REQUIRED/);
        const retained = connectionStatus(f.controller, first.connectionId);
        assert.equal(retained.reason, 'upstream-timeout');
        assert.equal(retained.processId, first.processId);
        assert.equal(retained.sessionId, first.sessionId);
        assert.equal(f.counts().closes, 2);
        assert.ok(!JSON.stringify(f.callbacks.status('PostToolUse')).includes('process-exited'));
        await f.callbacks.invoke(
            'list_pages',
            { _dct: { connectionId: second.connectionId, sessionId: second.sessionId } },
            signal,
            () => {},
        );
        assert.equal(connectionStatus(f.controller, second.connectionId).status, 'active');
        assert.equal(f.launches.length, 2);
        assert.ok(first.sessionId);
        const recovered = await f.controller.restart({ connectionId: first.connectionId, sessionId: first.sessionId });
        assert.notEqual(recovered.sessionId, first.sessionId);
    } finally {
        await f.runtime.close();
    }
});

test('an official cleanup failure after actual target exit removes routing and retries through gateway cleanup', async () => {
    const f = await fixture({ failOfficialClose: true });
    try {
        const active = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.ok(active.sessionId);
        await assert.rejects(
            f.controller.stop({ connectionId: active.connectionId, sessionId: active.sessionId, disposition: 'Close' }),
            /timed out/,
        );
        assert.throws(() => f.controller.status(active.connectionId), /closed/);
        const other = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'next' } });
        assert.notEqual(other.connectionId, active.connectionId);
        await assert.rejects(
            f.controller.stop({ connectionId: active.connectionId, sessionId: active.sessionId, disposition: 'Keep' }),
            /closed/,
        );
        await assert.rejects(
            f.controller.stop({
                connectionId: active.connectionId,
                sessionId: active.sessionId,
                disposition: 'Close',
            }),
            /closed/,
        );
        assert.equal(f.counts().closes, 2, 'Closed routes must not retry failed resources automatically.');
        assert.equal(connectionStatus(f.controller, other.connectionId).status, 'active');
        await f.runtime.close();
        assert.equal(f.counts().closes, 4);
    } finally {
        await f.runtime.close();
    }
});

test('unexpected upstream exit gates calls without announcing process exit', async () => {
    const f = await fixture();
    try {
        const active = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        f.exits[0]?.();
        assert.equal(connectionStatus(f.controller, active.connectionId).reason, 'official-disconnected');
        await f.callbacks.invoke(
            'list_pages',
            { _dct: { connectionId: active.connectionId, sessionId: active.sessionId } },
            new AbortController().signal,
            () => {},
        );
        assert.equal(f.counts().calls, 0);
    } finally {
        await f.runtime.close();
    }
});

test('bootstrap failure closes catalog connection and router without launching a target', async () => {
    let closes = 0;
    let routerCloses = 0;
    let launched = false;
    await assert.rejects(
        startPluginRuntime({
            createRouter: async () => ({
                url: 'http://127.0.0.1:31000',
                isBusy: () => false,
                setTarget: () => {},
                clearTarget: () => {},
                close: async () => {
                    routerCloses += 1;
                },
            }),
            createHost: () => ({
                launch: async () => {
                    launched = true;
                    throw new Error('unexpected');
                },
                close: async () => true,
            }),
            createConnection: async () => ({
                tools: [],
                call: async () => ({ content: [] }),
                close: async () => {
                    closes += 1;
                },
                onExit: () => {},
                rootsChanged: async () => {},
            }),
            createEntry: () => {
                throw new Error('gateway failed');
            },
        }),
        /gateway failed/,
    );
    assert.equal(closes, 1);
    assert.equal(routerCloses, 1);
    assert.equal(launched, false);
});

test('one gateway allocates at least four independent connections', async () => {
    const f = await fixture();
    try {
        const started = await Promise.all(
            Array.from({ length: 4 }, (_, index) =>
                f.controller.start({ isolation: { mode: 'none' }, launch: { executable: `fixture${index}` } }),
            ),
        );
        const status = f.controller.status();
        assert.ok('connections' in status);
        assert.equal(status.connections.length, 4);
        assert.equal(new Set(started.map((item) => ('connectionId' in item ? item.connectionId : undefined))).size, 4);
    } finally {
        await f.runtime.close();
    }
});

test('parallel routes reach separate upstreams, strip routing, and preserve inputs', async () => {
    const f = await fixture();
    try {
        const started = await Promise.all(
            Array.from({ length: 4 }, (_, index) =>
                f.controller.start({ isolation: { mode: 'none' }, launch: { executable: `fixture${index}` } }),
            ),
        );
        const argumentsList = started.map((connection, index) => ({
            value: index,
            _dct: { connectionId: connection.connectionId, sessionId: connection.sessionId },
        }));
        const before = structuredClone(argumentsList);
        await Promise.all(
            argumentsList.map((arguments_) =>
                f.callbacks.invoke('list_pages', arguments_, new AbortController().signal, () => {}),
            ),
        );
        assert.equal(new Set(f.received.map((call) => call.url)).size, 4);
        assert.deepEqual(
            f.received.map((call) => call.arguments),
            [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }],
        );
        assert.deepEqual(argumentsList, before);
        const first = started[0];
        assert.ok(first?.sessionId);
        await f.controller.stop({ connectionId: first.connectionId, sessionId: first.sessionId, disposition: 'Keep' });
        assert.equal(connectionStatus(f.controller, first.connectionId).sessionId, first.sessionId);
        await f.controller.stop({ connectionId: first.connectionId, sessionId: first.sessionId, disposition: 'Close' });
        const aggregate = f.controller.status();
        assert.ok('connections' in aggregate);
        assert.equal(aggregate.connections.length, 3);
        const firstArguments = argumentsList[0];
        const secondArguments = argumentsList[1];
        assert.ok(firstArguments && secondArguments);
        await assert.rejects(
            f.callbacks.invoke('list_pages', firstArguments, new AbortController().signal, () => {}),
            /closed/,
        );
        const next = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'next' } });
        assert.notEqual(next.connectionId, first.connectionId);
        await f.callbacks.invoke('list_pages', secondArguments, new AbortController().signal, () => {});
    } finally {
        await f.runtime.close();
    }
});

test('malformed and stale routes fail before official tool invocation', async () => {
    const f = await fixture();
    try {
        const first = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        for (const routing of [
            undefined,
            {},
            { connectionId: first.connectionId },
            { connectionId: first.connectionId.toUpperCase(), sessionId: first.sessionId },
            { connectionId: first.connectionId, sessionId: first.sessionId, extra: true },
            { connectionId: '11111111-1111-4111-8111-111111111111', sessionId: first.sessionId },
            { connectionId: first.connectionId, sessionId: '22222222-2222-4222-8222-222222222222' },
        ]) {
            await assert.rejects(
                f.callbacks.invoke('list_pages', { _dct: routing }, new AbortController().signal, () => {}),
            );
        }
        assert.equal(f.counts().calls, 0);
    } finally {
        await f.runtime.close();
    }
});

test('failed startup rolls back one provisional connection while retained startup carries retry IDs', async () => {
    const f = await fixture({ failLaunch: 'bad' });
    try {
        const active = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'good' } });
        await assert.rejects(
            f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'bad' } }),
            /Launch failed/,
        );
        const aggregate = f.controller.status();
        assert.ok('connections' in aggregate);
        assert.equal(aggregate.connections.length, 1);
        assert.equal(aggregate.connections[0]?.connectionId, active.connectionId);
        assert.equal(f.counts().closes, 1, 'Target launch failure precedes official connection acquisition.');
        assert.equal(f.routerCloses(), 2);
    } finally {
        await f.runtime.close();
    }
    const retained = await fixture({ failLaunch: 'bad', retainLaunch: true, failTargetClose: true });
    try {
        await retained.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'good' } });
        await assert.rejects(
            retained.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'bad' } }),
            (error: unknown) => {
                assert.ok(error instanceof Error && 'details' in error);
                const details = error.details;
                assert.ok(isRecord(details));
                assert.equal(typeof details.connectionId, 'string');
                assert.equal(typeof details.sessionId, 'string');
                assert.equal(details.processId, 44);
                assert.equal(details.port, 9222);
                return true;
            },
        );
        const aggregate = retained.controller.status();
        assert.ok('connections' in aggregate);
        assert.equal(aggregate.connections.length, 2);
        const failed = aggregate.connections.find((connection) => connection.status === 'close-failed');
        assert.ok(failed?.sessionId);
        retained.allowTargetClose();
        await retained.controller.stop({
            connectionId: failed.connectionId,
            sessionId: failed.sessionId,
            disposition: 'Close',
        });
        const good = aggregate.connections[0];
        assert.ok(good);
        assert.equal(connectionStatus(retained.controller, good.connectionId).status, 'active');
    } finally {
        await retained.runtime.close();
    }
});

test('live restart preserves the selected connection and original profile across independent target runs', async () => {
    const f = await fixture();
    try {
        const first = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        const second = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'other' } });
        assert.ok(first.sessionId);
        const restarted = await f.controller.restart({ connectionId: first.connectionId, sessionId: first.sessionId });
        assert.equal(restarted.connectionId, first.connectionId);
        assert.notEqual(restarted.sessionId, first.sessionId);
        assert.equal(f.launches[2]?.exactPort, first.port);
        assert.deepEqual(f.launches[2]?.launchDefinition, {
            executablePath: process.execPath,
            arguments: ['--port=9222'],
            cwd: process.cwd(),
        });
        assert.ok(restarted.sessionId);
        await f.controller.restart({ connectionId: restarted.connectionId, sessionId: restarted.sessionId });
        f.targets[0]?.emit('exit');
        assert.equal(f.targets[0]?.listenerCount('exit'), 0);
        assert.equal(f.targets[2]?.listenerCount('exit'), 0);
        await assert.rejects(
            f.callbacks.invoke(
                'list_pages',
                { _dct: { connectionId: first.connectionId, sessionId: first.sessionId } },
                new AbortController().signal,
                () => {},
            ),
            /stale/,
        );
        assert.equal(connectionStatus(f.controller, second.connectionId).sessionId, second.sessionId);
    } finally {
        await f.runtime.close();
    }
});

test('disconnect cleanup continues across a failed official Close', async () => {
    const f = await fixture({ failOfficialClose: true });
    await Promise.all(
        Array.from({ length: 4 }, () =>
            f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } }),
        ),
    );
    await f.runtime.close();
    assert.equal(f.counts().closes, 6, 'Gateway cleanup retries its failed official resource once.');
    assert.equal(f.routerCloses(), 5);
});

test('target launch failure never acquires an official child or retains a public connection', async () => {
    const f = await fixture({ failLaunch: 'bad', failOfficialClose: true });
    try {
        await assert.rejects(
            f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'bad' } }),
            /Launch failed/,
        );
        const aggregate = f.controller.status();
        assert.ok('connections' in aggregate);
        assert.equal(aggregate.connections.length, 0);
        assert.deepEqual(f.counts(), { connections: 1, closes: 1, calls: 0 });
        assert.equal(f.launches.length, 1);
        assert.equal(f.routerCloses(), 2);
    } finally {
        await f.runtime.close();
    }
});

test('a catalog mismatch retires its actual target and keeps failed upstream disposal in the gateway ledger', async () => {
    const f = await fixture({ mismatchCatalog: true, failOfficialClose: true, failCloseUntil: 2 });
    try {
        await assert.rejects(
            f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } }),
            /timed out/,
        );
        assert.equal(f.launches.length, 1);
        assert.equal(f.targets[0]?.listenerCount('exit'), 0);
        const aggregate = f.controller.status();
        assert.ok('connections' in aggregate);
        assert.equal(aggregate.connections.length, 0);
        assert.equal(f.counts().closes, 2);
        await f.runtime.close();
        assert.equal(f.counts().closes, 3);
    } finally {
        await f.runtime.close();
    }
});

test('catalog bootstrap attempts its router disposal even when official disposal needs a retry', async () => {
    const events: string[] = [];
    let closeAttempts = 0;
    await assert.rejects(
        startPluginRuntime({
            createRouter: async () => ({
                url: 'http://127.0.0.1:31000',
                isBusy: () => false,
                setTarget: () => {},
                clearTarget: () => {},
                close: async () => {
                    events.push('router-close');
                },
            }),
            createConnection: async () => ({
                tools: [],
                call: async () => ({ content: [] }),
                close: async () => {
                    events.push('upstream-close');
                    if (++closeAttempts === 1) throw new Error('Catalog normal close failed.');
                },
                onExit: () => {},
                rootsChanged: async () => {},
            }),
        }),
        /Catalog normal close failed/,
    );
    assert.equal(closeAttempts, 2);
    assert.deepEqual(events, ['upstream-close', 'router-close', 'upstream-close']);
});

test('catalog cleanup reports a persistent official disposal failure after attempting its router', async () => {
    let closeAttempts = 0;
    let routerCloses = 0;
    const diagnostics: string[] = [];
    const observing = mock.method(process.stderr, 'write', (chunk: unknown) => {
        diagnostics.push(String(chunk));
        return true;
    });
    await assert.rejects(
        startPluginRuntime({
            createRouter: async () => ({
                url: 'http://127.0.0.1:31000',
                isBusy: () => false,
                setTarget: () => {},
                clearTarget: () => {},
                close: async () => {
                    routerCloses += 1;
                },
            }),
            createConnection: async () => ({
                tools: [],
                call: async () => ({ content: [] }),
                close: async () => {
                    closeAttempts += 1;
                    throw new Error('Catalog close still failed.');
                },
                onExit: () => {},
                rootsChanged: async () => {},
            }),
        }),
        /Catalog close still failed/,
    );
    observing.mock.restore();
    assert.equal(closeAttempts, 2);
    assert.equal(routerCloses, 1);
    assert.ok(diagnostics.some((message) => message.includes('Gateway cleanup failed: Catalog close still failed.')));
});
