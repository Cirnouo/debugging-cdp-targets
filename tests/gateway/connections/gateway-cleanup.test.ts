import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { connectionStatus, createConnectionRuntimeFixture, createCoreFixture } from '../../fixtures/core-runtime.ts';

test('gateway cleanup begins closing other connections while one permission operation still waits', async () => {
    const f = await createConnectionRuntimeFixture();
    await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'ready' } });
    assert.ok(f.runtime.control);
    await f.runtime.control({
        isolation: { mode: 'none' },
        action: 'start',
        requestId: 'waiting',
        launch: { executable: 'wait-cleanup' },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const closed = f.runtime.cleanup();
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(f.targetCloses(), 1);
    } finally {
        f.releaseLaunch();
        await closed;
    }
});

test('an official cleanup failure after actual target exit removes routing and retries through gateway cleanup', async () => {
    const f = await createConnectionRuntimeFixture({ failOfficialClose: true });
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
        await f.runtime.cleanup();
        assert.equal(f.counts().closes, 4);
    } finally {
        await f.runtime.cleanup();
    }
});

test('gateway cleanup continues across a failed official Close', async () => {
    const f = await createConnectionRuntimeFixture({ failOfficialClose: true });
    await Promise.all(
        Array.from({ length: 4 }, () =>
            f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } }),
        ),
    );
    await assert.rejects(f.runtime.cleanup(), /cleanup failed/);
    await f.runtime.cleanup();
    assert.equal(f.counts().closes, 6, 'Gateway cleanup retries its failed official resource once.');
    assert.equal(f.routerCloses(), 5);
});

test('target launch failure never acquires an official child or retains a public connection', async () => {
    const f = await createConnectionRuntimeFixture({ failLaunch: 'bad', failOfficialClose: true });
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
        await f.runtime.cleanup();
    }
});

test('a catalog mismatch retires its actual target and keeps failed upstream disposal in the gateway ledger', async () => {
    const f = await createConnectionRuntimeFixture({
        mismatchCatalog: true,
        failOfficialClose: true,
        failCloseUntil: 2,
    });
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
        await f.runtime.cleanup();
        assert.equal(f.counts().closes, 3);
    } finally {
        await f.runtime.cleanup();
    }
});

test('catalog bootstrap attempts its router disposal even when official disposal needs a retry', async () => {
    const events: string[] = [];
    let closeAttempts = 0;
    await assert.rejects(
        createCoreFixture({
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
    assert.deepEqual(diagnostics, []);
});
