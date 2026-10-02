import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { OfficialConnection } from '../src/adapters/mcp-bridge.ts';
import type { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';
import { startPluginRuntime } from '../src/application/plugin-runtime.ts';
import { RetainedTargetError } from '../src/domains/cdp-target.ts';
import type { ConnectionStatus, ControlHandler, LaunchOptions } from '../src/domains/control-contract.ts';

function connectionStatus(controller: ControlHandler, connectionId: string): ConnectionStatus {
    const status = controller.status(connectionId);
    assert.ok('connectionId' in status);
    return status;
}

async function fixture({
    watchLeaseMs = 25_000,
    promptWait = false,
    failOfficialClose = false,
    failCloseUntil = 2,
    mismatchCatalog = false,
    failLaunch = '',
    retainLaunch = false,
    failTargetClose = false,
} = {}) {
    let controller: ControlHandler | undefined;
    let callbacks: Parameters<typeof createMcpEntryServer>[0] | undefined;
    let connections = 0;
    let closes = 0;
    let asks = 0;
    let calls = 0;
    let routers = 0;
    let routerCloses = 0;
    const received: { url: string; arguments: Record<string, unknown> }[] = [];
    const launches: LaunchOptions[] = [];
    const exits: (() => void)[] = [];
    const targets: EventEmitter[] = [];
    let resolveClosed: () => void = () => {};
    const gatewayClosed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
    });
    const runtime = await startPluginRuntime({
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
            launch: async (options) => {
                launches.push(options);
                if (options.launchCommand === failLaunch && !retainLaunch) throw new Error('Launch failed.');
                const child = new EventEmitter();
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
                if (options.launchCommand === failLaunch && retainLaunch)
                    throw new RetainedTargetError('Rollback failed.', target);
                return target;
            },
            close: async () => !failTargetClose,
        }),
        createControl: async (options) => {
            controller = options.controller;
            return { close: async () => {} };
        },
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
                askLoss: async (_message, signal) => {
                    asks += 1;
                    if (promptWait)
                        await new Promise<void>((resolve) => {
                            signal?.addEventListener('abort', () => resolve(), { once: true });
                            if (signal?.aborted) resolve();
                        });
                    return signal?.aborted ? 'pending' : 'restart';
                },
            };
        },
        pollIntervalMs: 100_000,
        watchLeaseMs,
    });
    assert.ok(controller);
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
        counts: () => ({ connections, closes, asks, calls }),
    };
}

test('Close ends upstream and later start reuses the entry without host reconnection', async () => {
    const f = await fixture();
    try {
        assert.deepEqual(f.counts(), { connections: 1, closes: 1, asks: 0, calls: 0 });
        const first = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(first.sessionId);
        await f.controller.stop({ connectionId: first.connectionId, sessionId: first.sessionId, disposition: 'Keep' });
        assert.equal(f.counts().closes, 1);
        await f.controller.stop({ connectionId: first.connectionId, sessionId: first.sessionId, disposition: 'Close' });
        assert.equal(f.counts().closes, 2);
        const second = await f.controller.start({ launchCommand: 'fixture2' });
        assert.notEqual(first.sessionId, second.sessionId);
        assert.equal(f.counts().connections, 3);
    } finally {
        await f.runtime.close();
    }
    assert.equal(f.counts().closes, 3);
    await f.runtime.closed;
});

test('manual exit watch and blocked calls share one explicit choice and never replay', async () => {
    const f = await fixture();
    try {
        const active = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(active.sessionId);
        const watch = f.callbacks.watch(
            { connectionId: active.connectionId, sessionId: active.sessionId },
            new AbortController().signal,
        );
        f.targets[0]?.emit('exit', 0);
        const result = await watch;
        assert.equal(result.choice, 'restart');
        assert.equal(connectionStatus(f.controller, active.connectionId).status, 'lost');
        const blocked = await f.callbacks.invoke(
            'list_pages',
            { _dct: { connectionId: active.connectionId, sessionId: active.sessionId } },
            new AbortController().signal,
            () => {},
        );
        assert.equal(blocked.isError, true);
        assert.equal(f.counts().asks, 1);
        assert.equal(f.counts().calls, 0);
        assert.equal(f.counts().connections, 2);
        const restarted = await f.controller.restart({
            connectionId: active.connectionId,
            sessionId: active.sessionId,
        });
        assert.equal(restarted.pageIdsInvalidated, true);
        assert.equal(restarted.port, 9222);
        await assert.rejects(
            f.controller.restart({ connectionId: active.connectionId, sessionId: active.sessionId }),
            /session/i,
        );
    } finally {
        await f.runtime.close();
    }
});

test('an official close failure retains identity until a matching Close retry succeeds', async () => {
    const f = await fixture({ failOfficialClose: true });
    try {
        const active = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(active.sessionId);
        await assert.rejects(
            f.controller.stop({ connectionId: active.connectionId, sessionId: active.sessionId, disposition: 'Close' }),
            /timed out/,
        );
        assert.equal(connectionStatus(f.controller, active.connectionId).status, 'close-failed');
        assert.equal(connectionStatus(f.controller, active.connectionId).sessionId, active.sessionId);
        const other = await f.controller.start({ launchCommand: 'next' });
        assert.notEqual(other.connectionId, active.connectionId);
        await assert.rejects(
            f.controller.stop({ connectionId: active.connectionId, sessionId: active.sessionId, disposition: 'Keep' }),
            /Close retry/,
        );
        const closed = await f.controller.stop({
            connectionId: active.connectionId,
            sessionId: active.sessionId,
            disposition: 'Close',
        });
        assert.equal(closed.status, 'idle');
        assert.equal(f.counts().closes, 3);
    } finally {
        await f.runtime.close();
    }
});

test('idle exit asks only at next use; unexpected upstream exit gates the current target', async () => {
    const f = await fixture();
    try {
        const active = await f.controller.start({ launchCommand: 'fixture' });
        f.exits[0]?.();
        assert.equal(connectionStatus(f.controller, active.connectionId).reason, 'official-disconnected');
        assert.equal(f.counts().asks, 0);
        await f.callbacks.invoke(
            'list_pages',
            { _dct: { connectionId: active.connectionId, sessionId: active.sessionId } },
            new AbortController().signal,
            () => {},
        );
        assert.equal(f.counts().asks, 1);
        assert.equal(f.counts().calls, 0);
    } finally {
        await f.runtime.close();
    }
});

test('end-task aborts an unanswered loss prompt without accepting a late choice', async () => {
    const f = await fixture({ promptWait: true });
    try {
        const active = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(active.sessionId);
        const watch = f.callbacks.watch(
            { connectionId: active.connectionId, sessionId: active.sessionId },
            new AbortController().signal,
        );
        f.targets[0]?.emit('exit', 0);
        await new Promise<void>((resolve) => setImmediate(resolve));
        await f.controller.endTask({ connectionId: active.connectionId, sessionId: active.sessionId });
        assert.equal((await watch).choice, 'pending');
        assert.equal(connectionStatus(f.controller, active.connectionId).status, 'lost');
    } finally {
        await f.runtime.close();
    }
});

test('one cancelled caller leaves a shared loss prompt available to its live watcher', async () => {
    const f = await fixture({ promptWait: true });
    try {
        const active = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(active.sessionId);
        const watch = f.callbacks.watch(
            { connectionId: active.connectionId, sessionId: active.sessionId },
            new AbortController().signal,
        );
        f.targets[0]?.emit('exit', 0);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const abort = new AbortController();
        const blocked = f.callbacks.invoke(
            'list_pages',
            { _dct: { connectionId: active.connectionId, sessionId: active.sessionId } },
            abort.signal,
            () => {},
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        abort.abort();
        const result = await Promise.race([
            blocked,
            new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 30)),
        ]);
        assert.ok(result, 'cancelled call must stop waiting while its watcher stays live');
        assert.equal(result.structuredContent?.choice, 'pending');
        assert.equal(f.counts().asks, 1);
        await f.controller.endTask({ connectionId: active.connectionId, sessionId: active.sessionId });
        assert.equal((await watch).choice, 'pending');
    } finally {
        await f.runtime.close();
    }
});

test('watch leases end quietly and can be renewed while the target remains available', async () => {
    const f = await fixture({ watchLeaseMs: 5 });
    try {
        const active = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(active.sessionId);
        const result = await f.callbacks.watch(
            { connectionId: active.connectionId, sessionId: active.sessionId },
            new AbortController().signal,
        );
        assert.equal(result.reason, 'watch-renew');
        assert.equal(f.counts().asks, 0);
        const watch = f.callbacks.watch(
            { connectionId: active.connectionId, sessionId: active.sessionId },
            new AbortController().signal,
        );
        f.targets[0]?.emit('exit', 0);
        assert.equal((await watch).choice, 'restart');
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
            Array.from({ length: 4 }, (_, index) => f.controller.start({ launchCommand: `fixture${index}` })),
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
            Array.from({ length: 4 }, (_, index) => f.controller.start({ launchCommand: `fixture${index}` })),
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
        const next = await f.controller.start({ launchCommand: 'next' });
        assert.notEqual(next.connectionId, first.connectionId);
        await f.callbacks.invoke('list_pages', secondArguments, new AbortController().signal, () => {});
    } finally {
        await f.runtime.close();
    }
});

test('malformed and stale routes fail before official tool invocation', async () => {
    const f = await fixture();
    try {
        const first = await f.controller.start({ launchCommand: 'fixture' });
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
        const active = await f.controller.start({ launchCommand: 'good' });
        await assert.rejects(f.controller.start({ launchCommand: 'bad' }), /Launch failed/);
        const aggregate = f.controller.status();
        assert.ok('connections' in aggregate);
        assert.equal(aggregate.connections.length, 1);
        assert.equal(aggregate.connections[0]?.connectionId, active.connectionId);
        assert.equal(f.counts().closes, 2);
        assert.equal(f.routerCloses(), 2);
    } finally {
        await f.runtime.close();
    }
    const retained = await fixture({ failLaunch: 'bad', retainLaunch: true });
    try {
        await retained.controller.start({ launchCommand: 'good' });
        await assert.rejects(retained.controller.start({ launchCommand: 'bad' }), (error: unknown) => {
            assert.ok(error instanceof Error && 'details' in error);
            const details = error.details;
            assert.ok(details && typeof details === 'object' && 'connectionId' in details && 'sessionId' in details);
            return true;
        });
        const aggregate = retained.controller.status();
        assert.ok('connections' in aggregate);
        assert.equal(aggregate.connections.length, 2);
        const failed = aggregate.connections.find((connection) => connection.status === 'close-failed');
        assert.ok(failed?.sessionId);
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

test('recovery retains only selected connection and preserves original profile across repeated runs', async () => {
    const f = await fixture();
    try {
        const first = await f.controller.start({ launchCommand: 'fixture' });
        const second = await f.controller.start({ launchCommand: 'other' });
        assert.ok(first.sessionId);
        f.targets[0]?.emit('exit');
        const restarted = await f.controller.restart({ connectionId: first.connectionId, sessionId: first.sessionId });
        assert.equal(restarted.connectionId, first.connectionId);
        assert.notEqual(restarted.sessionId, first.sessionId);
        assert.equal(f.launches[2]?.exactPort, first.port);
        assert.deepEqual(f.launches[2]?.launchDefinition, {
            executablePath: process.execPath,
            arguments: ['--port=9222'],
            cwd: process.cwd(),
        });
        assert.equal(f.launches[2]?.profileKey, f.launches[0]?.profileKey);
        assert.ok(restarted.sessionId);
        f.targets[2]?.emit('exit');
        await f.controller.restart({ connectionId: restarted.connectionId, sessionId: restarted.sessionId });
        assert.equal(f.launches[3]?.profileKey, f.launches[0]?.profileKey);
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

test('simultaneous target loss and cancellation are isolated by connection and session', async () => {
    const f = await fixture({ promptWait: true });
    try {
        const first = await f.controller.start({ launchCommand: 'first' });
        const second = await f.controller.start({ launchCommand: 'second' });
        assert.ok(first.sessionId && second.sessionId);
        const firstAbort = new AbortController();
        const firstWatch = f.callbacks.watch(
            { connectionId: first.connectionId, sessionId: first.sessionId },
            firstAbort.signal,
        );
        const secondWatch = f.callbacks.watch(
            { connectionId: second.connectionId, sessionId: second.sessionId },
            new AbortController().signal,
        );
        f.targets[0]?.emit('exit');
        f.targets[1]?.emit('exit');
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(f.counts().asks, 2);
        firstAbort.abort();
        assert.equal((await firstWatch).choice, 'pending');
        let secondSettled = false;
        void secondWatch.then(() => {
            secondSettled = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(secondSettled, false);
        await f.controller.endTask({ connectionId: second.connectionId, sessionId: second.sessionId });
        assert.equal((await secondWatch).choice, 'pending');
    } finally {
        await f.runtime.close();
    }
});

test('disconnect cleanup continues across a failed official Close', async () => {
    const f = await fixture({ failOfficialClose: true });
    await Promise.all(Array.from({ length: 4 }, () => f.controller.start({ launchCommand: 'fixture' })));
    await f.runtime.close();
    assert.equal(f.counts().closes, 5);
    assert.equal(f.routerCloses(), 5);
});

test('upstream-only failed startup remains retryable through its connection and session IDs', async () => {
    const f = await fixture({ failLaunch: 'bad', failOfficialClose: true });
    try {
        await assert.rejects(f.controller.start({ launchCommand: 'bad' }), /Launch failed/);
        const aggregate = f.controller.status();
        assert.ok('connections' in aggregate);
        const retained = aggregate.connections[0];
        assert.ok(retained?.sessionId);
        assert.equal(retained.reason, 'startup-cleanup-failed');
        await assert.rejects(
            f.controller.stop({
                connectionId: retained.connectionId,
                sessionId: retained.sessionId,
                disposition: 'Keep',
            }),
            /Close retry/,
        );
        await f.controller.stop({
            connectionId: retained.connectionId,
            sessionId: retained.sessionId,
            disposition: 'Close',
        });
        const after = f.controller.status();
        assert.ok('connections' in after);
        assert.equal(after.connections.length, 0);
    } finally {
        await f.runtime.close();
    }
});

test('a catalog mismatch whose normal close fails retains the official child for retry', async () => {
    const f = await fixture({ mismatchCatalog: true, failOfficialClose: true, failCloseUntil: 3 });
    try {
        await assert.rejects(f.controller.start({ launchCommand: 'fixture' }), /timed out/);
        assert.equal(f.launches.length, 0);
        const aggregate = f.controller.status();
        assert.ok('connections' in aggregate);
        const retained = aggregate.connections[0];
        assert.ok(retained?.sessionId);
        assert.equal(retained.reason, 'startup-cleanup-failed');
        await f.controller.stop({
            connectionId: retained.connectionId,
            sessionId: retained.sessionId,
            disposition: 'Close',
        });
        assert.equal(f.counts().closes, 4);
    } finally {
        await f.runtime.close();
    }
});

test('catalog bootstrap retries failed normal upstream close before closing its router', async () => {
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
    assert.deepEqual(events, ['upstream-close', 'upstream-close', 'router-close']);
});

test('catalog cleanup reports retained upstream evidence when normal close retry also fails', async () => {
    let closeAttempts = 0;
    let routerCloses = 0;
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
        (error: unknown) => {
            assert.ok(error instanceof Error && 'details' in error);
            const details = error.details;
            assert.ok(
                details &&
                    typeof details === 'object' &&
                    'catalogUpstreamRetained' in details &&
                    'entryId' in details &&
                    'cleanupError' in details,
            );
            assert.equal(details.catalogUpstreamRetained, true);
            assert.equal(details.cleanupError, 'Catalog close still failed.');
            return true;
        },
    );
    assert.equal(closeAttempts, 2);
    assert.equal(routerCloses, 1);
});
