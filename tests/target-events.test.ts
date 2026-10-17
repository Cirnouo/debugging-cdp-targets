import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import type { ControlHandler } from '../src/domains/control-contract.ts';
import { createCoreFixture } from './fixtures/core-runtime.ts';

async function fixture(
    options: {
        exitedAtLaunch?: boolean;
        failClose?: boolean;
        failRouter?: boolean;
        exitOnClose?: boolean;
        closeResult?: 'false' | 'throw';
    } = {},
) {
    let closes = 0;
    let routerCloses = 0;
    let healthChecks = 0;
    let health: 'healthy' | 'unavailable' = 'healthy';
    let busy = false;
    const children: (EventEmitter & { exitCode: number | null; signalCode: string | null })[] = [];
    const upstreamExits: (() => void)[] = [];
    const runtime = await createCoreFixture({
        loadCatalog: async (tools = []) =>
            createToolCatalog({
                version: '1.11.0',
                tools: tools.map((tool) => ({ name: tool.name, requires: {}, variants: [tool] })),
            }),
        createRouter: async () => ({
            url: 'http://127.0.0.1:12345',
            isBusy: () => busy,
            pause: () => {
                if (busy) throw new Error('CDP router is busy with in-flight requests.');
            },
            setTarget: () => {},
            clearTarget: () => {},
            close: async () => {
                routerCloses += 1;
                if (options.failRouter && routerCloses === 2) throw new Error('router cleanup failed');
            },
        }),
        createHost: () => ({
            launch: async (_options, context) => {
                const child = Object.assign(new EventEmitter(), {
                    exitCode: options.exitedAtLaunch ? 0 : null,
                    signalCode: null,
                });
                children.push(child);
                const target = {
                    processId: 40 + children.length,
                    port: 9222,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    targetKind: 'generic-cdp' as const,
                    child,
                    launchDefinition: {
                        executablePath: process.execPath,
                        arguments: ['--port=9222'],
                        cwd: process.cwd(),
                    },
                };
                context?.onCreated?.(target);
                return target;
            },
            close: async (target) => {
                const child = children[target.processId - 41];
                assert.ok(child);
                const exit = () => {
                    child.exitCode = 0;
                    child.emit('exit', 0);
                };
                if (options.exitOnClose === false) setImmediate(exit);
                else exit();
                if (options.closeResult === 'false') return false;
                if (options.closeResult === 'throw') throw new Error('close evidence failed');
                return true;
            },
            health: async () => {
                healthChecks += 1;
                return health;
            },
        }),
        createConnection: async () => ({
            tools: [{ name: 'list_pages', inputSchema: { type: 'object', properties: {} } }],
            call: async () => ({ content: [] }),
            rootsChanged: async () => {},
            onExit: (callback) => {
                upstreamExits.push(callback);
            },
            close: async () => {
                closes += 1;
                if (options.failClose && closes === 2) throw new Error('cleanup failed');
            },
        }),
    });
    const control = runtime.controller;
    assert.ok(runtime);
    return {
        runtime,
        control,

        children,
        upstreamExits,
        counts: () => ({ closes, routerCloses, healthChecks }),
        unavailable: () => {
            health = 'unavailable';
        },
        busy: (value: boolean) => {
            busy = value;
        },
        exit: (index = 0) => {
            const child = children[index];
            assert.ok(child);
            child.exitCode = 0;
            child.emit('exit', 0);
        },
    };
}

function selected(control: ControlHandler, id: string) {
    const current = control.status(id);
    assert.ok('connectionId' in current);
    return current;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('start monitors silently without watches or periodic health checks', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.equal(current.status, 'active');
        assert.equal(f.runtime.core.admin.registrations()[0]?.resources, 1);
        await tick();
        assert.equal(f.counts().healthChecks, 0);
    } finally {
        await f.runtime.cleanup();
    }
});

test('process exit retires its route exactly once', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        f.exit();
        f.exit();
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await tick();
    } finally {
        await f.runtime.cleanup();
    }
});

test('exit already recorded during startup is not missed', async () => {
    const f = await fixture({ exitedAtLaunch: true });
    try {
        await assert.rejects(
            f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } }),
            /exited/,
        );
        assert.deepEqual(f.control.status(), { connections: [] });
        assert.equal(f.counts().closes, 1, 'An already exited target must not acquire an official connection.');
    } finally {
        await f.runtime.cleanup();
    }
});

for (const end of ['Keep'] as const) {
    test(`${end} retains live target, then exit closes only its upstream and removes its record`, async () => {
        const f = await fixture();
        try {
            const first = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'first' } });
            const second = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'second' } });
            assert.ok(first.sessionId);
            const route = { connectionId: first.connectionId, sessionId: first.sessionId };
            await f.control.stop({ ...route, disposition: 'Keep' });
            assert.equal(f.counts().closes, 1);
            f.exit();
            await tick();
            const status = f.control.status();
            assert.ok('connections' in status);
            assert.deepEqual(
                status.connections.map((item) => item.connectionId),
                [second.connectionId],
            );
            assert.equal(f.counts().closes, 2);
        } finally {
            await f.runtime.cleanup();
        }
    });
}

test('Keep after exit rejects the closed route', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        f.exit();
        await assert.rejects(
            f.control.stop({ connectionId: current.connectionId, sessionId: current.sessionId, disposition: 'Keep' }),
            /closed/,
        );
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await tick();
    } finally {
        await f.runtime.cleanup();
    }
});

test('official use preserves a kept connection and old-session exits cannot affect a restart', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.stop({ ...route, disposition: 'Keep' });
        await f.runtime.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {});

        const next = await f.control.restart({ ...route, scope: 'both' });
        f.exit();
        assert.equal(selected(f.control, current.connectionId).sessionId, next.sessionId);
        assert.equal(selected(f.control, current.connectionId).status, 'active');
        assert.notEqual(next.sessionId, current.sessionId);

        assert.equal(f.children[0]?.listenerCount('exit'), 0);
    } finally {
        await f.runtime.cleanup();
    }
});

test('CDP and upstream errors do not announce process exit, but a later exit does', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        f.unavailable();
        const result = await f.runtime.invoke(
            'list_pages',
            { _dct: { connectionId: current.connectionId, sessionId: current.sessionId } },
            new AbortController().signal,
            () => {},
        );
        assert.equal(result.isError, true);

        f.upstreamExits[0]?.();
        f.exit();
        await tick();
    } finally {
        await f.runtime.cleanup();
    }
});

test('failed retired-upstream cleanup closes its public route and retries only at gateway cleanup', async () => {
    const f = await fixture({ failClose: true });
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.stop({ ...route, disposition: 'Keep' });
        f.exit();
        await tick();
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /closed/);
        assert.equal(f.counts().closes, 2);
        await f.runtime.cleanup();
        assert.equal(f.counts().closes, 3);
        assert.throws(() => f.control.status(current.connectionId), /closed/);
    } finally {
        await f.runtime.cleanup();
    }
});

test('router cleanup failure retains internal ownership and retries after its route is removed', async () => {
    const f = await fixture({ failRouter: true });
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.stop({ ...route, disposition: 'Keep' });
        f.exit();
        await tick();
        assert.throws(() => f.control.status(current.connectionId), /closed/);

        assert.equal(f.counts().routerCloses, 2);
        await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /closed/);
        await f.runtime.cleanup();
        assert.equal(f.counts().routerCloses, 3);
        assert.throws(() => f.control.status(current.connectionId), /closed/);
    } finally {
        await f.runtime.cleanup();
    }
});

test('normal Close and concurrent peer exit retire their independent routes', async () => {
    const f = await fixture({ exitOnClose: true });
    try {
        const first = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'first' } });
        const second = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'second' } });
        assert.ok(first.sessionId && second.sessionId);
        f.exit();
        await f.control.stop({ connectionId: second.connectionId, sessionId: second.sessionId, disposition: 'Close' });
    } finally {
        await f.runtime.cleanup();
    }
});

for (const operation of ['Close', 'restart'] as const) {
    for (const timing of ['during', 'after'] as const) {
        test(`${operation} expected exit ${timing} normal-close evidence survives failed upstream cleanup without automatic retry`, async () => {
            const f = await fixture({ failClose: true, exitOnClose: timing === 'during' });
            try {
                const current = await f.control.start({
                    isolation: { mode: 'none' },
                    launch: { executable: 'fixture' },
                });
                assert.ok(current.sessionId);
                const route = { connectionId: current.connectionId, sessionId: current.sessionId };
                if (operation === 'restart') {
                    f.unavailable();
                    await f.runtime.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {});
                    await assert.rejects(f.control.restart({ ...route, scope: 'both' }), /cleanup failed/);
                } else {
                    await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /cleanup failed/);
                }
                await tick();
                assert.throws(() => f.control.status(current.connectionId), /closed/);
                assert.equal(f.counts().closes, 2);

                await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /closed/);
                await f.runtime.cleanup();
                assert.equal(f.counts().closes, 3);
                assert.throws(() => f.control.status(current.connectionId), /closed/);
            } finally {
                await f.runtime.cleanup();
            }
        });
    }
}

test('an unexpected target exit retires its route despite a busy router and a new start creates fresh IDs', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        f.busy(true);
        f.exit();
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /closed/);
        await assert.rejects(
            f.runtime.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {}),
            /closed/,
        );
        await tick();
        assert.equal(f.counts().closes, 2);
        f.busy(false);
        const next = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'new-task' } });
        assert.equal(next.status, 'active');
        assert.notEqual(next.connectionId, current.connectionId);
        assert.notEqual(next.sessionId, current.sessionId);
    } finally {
        await f.runtime.cleanup();
    }
});

for (const operation of ['Close', 'restart'] as const) {
    for (const closeResult of ['false', 'throw'] as const) {
        test(`${operation} reconciles a native exit before close evidence ${closeResult}`, async () => {
            const f = await fixture({ exitOnClose: true, closeResult });
            try {
                const current = await f.control.start({
                    isolation: { mode: 'none' },
                    launch: { executable: 'fixture' },
                });
                assert.ok(current.sessionId);
                const route = { connectionId: current.connectionId, sessionId: current.sessionId };
                if (operation === 'restart') {
                    const next = await f.control.restart({ ...route, scope: 'both' });
                    assert.equal(next.status, 'active');
                    assert.notEqual(next.sessionId, current.sessionId);
                } else {
                    const result = await f.control.stop({ ...route, disposition: 'Close' });
                    assert.equal(result.status, 'idle');
                    assert.throws(() => f.control.status(current.connectionId), /closed/);
                }
            } finally {
                await f.runtime.cleanup();
            }
        });
    }
}

test('Keep cannot restore an exited route when router cleanup fails', async () => {
    const f = await fixture({ failRouter: true });
    try {
        const current = await f.control.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        f.exit();
        await assert.rejects(f.control.stop({ ...route, disposition: 'Keep' }), /closed/);
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await tick();
        assert.equal(f.counts().routerCloses, 2);
        await f.runtime.cleanup();
        assert.equal(f.counts().routerCloses, 3);
    } finally {
        await f.runtime.cleanup();
    }
});
