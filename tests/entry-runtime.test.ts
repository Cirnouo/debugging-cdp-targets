import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRecord } from '../src/shared/errors.ts';
import { connectionStatus, createConnectionRuntimeFixture, createCoreFixture } from './fixtures/core-runtime.ts';

test('Close ends upstream and later start reuses the entry without host reconnection', async () => {
    const f = await createConnectionRuntimeFixture();
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
        await f.runtime.cleanup();
    }
    assert.equal(f.counts().closes, 3);
    assert.equal(f.runtime.core.admin.cleanupState(), 'closed');
});

test('native cancellation that completed cleanup remains cancelled through the runtime boundary', async () => {
    const f = await createConnectionRuntimeFixture({ waitForCancellation: true });
    try {
        assert.ok(f.runtime.control);
        const accepted = await f.runtime.control({
            isolation: { mode: 'none' },
            action: 'start',
            requestId: 'native-cancel',
            launch: { executable: 'fixture' },
        });
        assert.equal(typeof accepted.operationId, 'string');
        if (typeof accepted.operationId !== 'string') throw new Error('Missing operation ID');
        await new Promise<void>((resolve) => setImmediate(resolve));
        await f.runtime.control({ action: 'cancel', operationId: accepted.operationId });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const state = await f.runtime.control({
            action: 'status',
            operationId: accepted.operationId,
        });
        assert.equal(state.state, 'cancelled');
        assert.deepEqual(f.controller.status(), { connections: [] });
    } finally {
        await f.runtime.cleanup();
    }
});

test('a settled official error does not close a healthy connection or invent an application exit', async () => {
    const f = await createConnectionRuntimeFixture({ timeoutCall: true });
    try {
        const first = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        const second = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'other' } });
        const signal = new AbortController().signal;
        await assert.rejects(
            f.runtime.invoke(
                'list_pages',
                { _dct: { connectionId: first.connectionId, sessionId: first.sessionId } },
                signal,
                () => {},
            ),
            /Request timed out/,
        );
        const retained = connectionStatus(f.controller, first.connectionId);
        assert.equal(retained.status, 'active');
        assert.equal(retained.reason, undefined);
        assert.equal(retained.processId, first.processId);
        assert.equal(retained.sessionId, first.sessionId);
        assert.equal(f.counts().closes, 1);
        assert.equal(f.runtime.core.admin.connections().length, 2);
        await f.runtime.invoke(
            'list_pages',
            { _dct: { connectionId: second.connectionId, sessionId: second.sessionId } },
            signal,
            () => {},
        );
        assert.equal(connectionStatus(f.controller, second.connectionId).status, 'active');
        assert.equal(f.launches.length, 2);
        assert.ok(first.sessionId);
        const recovered = await f.controller.restart({
            connectionId: first.connectionId,
            sessionId: first.sessionId,
            scope: 'both',
        });
        assert.notEqual(recovered.sessionId, first.sessionId);
    } finally {
        await f.runtime.cleanup();
    }
});

test('unexpected upstream exit gates calls without announcing process exit', async () => {
    const f = await createConnectionRuntimeFixture();
    try {
        const active = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        f.exits[0]?.();
        assert.equal(connectionStatus(f.controller, active.connectionId).reason, 'official-disconnected');
        await f.runtime.invoke(
            'list_pages',
            { _dct: { connectionId: active.connectionId, sessionId: active.sessionId } },
            new AbortController().signal,
            () => {},
        );
        assert.equal(f.counts().calls, 0);
    } finally {
        await f.runtime.cleanup();
    }
});

test('catalog validation failure closes acquired resources without launching a target', async () => {
    let closes = 0;
    let routerCloses = 0;
    let launched = false;
    await assert.rejects(
        createCoreFixture({
            createRouter: async () => ({
                url: 'http://127.0.0.1:31000',
                isBusy: () => false,
                setTarget: () => {},
                clearTarget: () => {},
                close: async () => {
                    routerCloses += 1;
                },
            }),
            loadCatalog: async () => {
                throw new Error('Catalog validation failed.');
            },
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
        }),
        /Catalog validation failed/,
    );
    assert.equal(closes, 1);
    assert.equal(routerCloses, 1);
    assert.equal(launched, false);
});

test('one gateway allocates at least four independent connections', async () => {
    const f = await createConnectionRuntimeFixture();
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
        await f.runtime.cleanup();
    }
});

test('parallel routes reach separate upstreams, strip routing, and preserve inputs', async () => {
    const f = await createConnectionRuntimeFixture();
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
                f.runtime.invoke('list_pages', arguments_, new AbortController().signal, () => {}),
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
            f.runtime.invoke('list_pages', firstArguments, new AbortController().signal, () => {}),
            /closed|absent/,
        );
        const next = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'next' } });
        assert.notEqual(next.connectionId, first.connectionId);
        await f.runtime.invoke('list_pages', secondArguments, new AbortController().signal, () => {});
    } finally {
        await f.runtime.cleanup();
    }
});

test('malformed and stale routes fail before official tool invocation', async () => {
    const f = await createConnectionRuntimeFixture();
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
                f.runtime.invoke('list_pages', { _dct: routing }, new AbortController().signal, () => {}),
            );
        }
        assert.equal(f.counts().calls, 0);
    } finally {
        await f.runtime.cleanup();
    }
});

test('failed startup rolls back one provisional connection while retained startup carries retry IDs', async () => {
    const f = await createConnectionRuntimeFixture({ failLaunch: 'bad' });
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
        await f.runtime.cleanup();
    }
    const retained = await createConnectionRuntimeFixture({
        failLaunch: 'bad',
        retainLaunch: true,
        failTargetClose: true,
    });
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
        await retained.runtime.cleanup();
    }
});

test('live restart preserves the selected connection and original profile across independent target runs', async () => {
    const f = await createConnectionRuntimeFixture();
    try {
        const first = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        const second = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'other' } });
        assert.ok(first.sessionId);
        const restarted = await f.controller.restart({
            connectionId: first.connectionId,
            sessionId: first.sessionId,
            scope: 'both',
        });
        assert.equal(restarted.connectionId, first.connectionId);
        assert.notEqual(restarted.sessionId, first.sessionId);
        assert.equal(f.launches[2]?.exactPort, undefined);
        assert.equal(f.launches[2]?.preparedLaunch?.portPolicy.kind, 'automatic');
        assert.deepEqual(f.launches[2]?.launchDefinition, {
            executablePath: process.execPath,
            arguments: ['--port=9222'],
            cwd: process.cwd(),
        });
        assert.ok(restarted.sessionId);
        await f.controller.restart({
            connectionId: restarted.connectionId,
            sessionId: restarted.sessionId,
            scope: 'both',
        });
        f.targets[0]?.emit('exit');
        assert.equal(f.targets[0]?.listenerCount('exit'), 0);
        assert.equal(f.targets[2]?.listenerCount('exit'), 0);
        await assert.rejects(
            f.runtime.invoke(
                'list_pages',
                { _dct: { connectionId: first.connectionId, sessionId: first.sessionId } },
                new AbortController().signal,
                () => {},
            ),
            /stale/,
        );
        assert.equal(connectionStatus(f.controller, second.connectionId).sessionId, second.sessionId);
    } finally {
        await f.runtime.cleanup();
    }
});
