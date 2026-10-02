import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { OfficialConnection } from '../src/adapters/mcp-bridge.ts';
import type { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';
import { startPluginRuntime } from '../src/application/plugin-runtime.ts';
import type { ControlHandler } from '../src/domains/control-contract.ts';

async function fixture({ watchLeaseMs = 25_000, promptWait = false, failOfficialClose = false } = {}) {
    let controller: ControlHandler | undefined;
    let callbacks: Parameters<typeof createMcpEntryServer>[0] | undefined;
    let connections = 0;
    let closes = 0;
    let asks = 0;
    let calls = 0;
    const exits: (() => void)[] = [];
    const targets: EventEmitter[] = [];
    let resolveClosed: () => void = () => {};
    const gatewayClosed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
    });
    const runtime = await startPluginRuntime({
        createRouter: async () => ({
            url: 'http://127.0.0.1:31000',
            isBusy: () => false,
            setTarget: () => {},
            clearTarget: () => {},
            close: async () => {},
        }),
        createHost: () => ({
            launch: async (options) => {
                const child = new EventEmitter();
                targets.push(child);
                return {
                    processId: 42 + targets.length,
                    port: options.exactPort ?? 9222,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    targetKind: 'chrome',
                    child,
                    launchDefinition: {
                        executablePath: process.execPath,
                        arguments: ['--port=9222'],
                        cwd: process.cwd(),
                    },
                };
            },
            close: async () => true,
        }),
        createControl: async (options) => {
            controller = options.controller;
            return { close: async () => {} };
        },
        createConnection: async (): Promise<OfficialConnection> => {
            connections += 1;
            return {
                tools: [{ name: 'list_pages', inputSchema: { type: 'object', properties: {} } }],
                call: async () => {
                    calls += 1;
                    return { content: [] };
                },
                close: async () => {
                    closes += 1;
                    if (failOfficialClose && closes === 2) throw new Error('Official normal close timed out.');
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
    return { runtime, controller, callbacks, targets, exits, counts: () => ({ connections, closes, asks, calls }) };
}

test('Close ends upstream and later start reuses the entry without host reconnection', async () => {
    const f = await fixture();
    try {
        assert.deepEqual(f.counts(), { connections: 1, closes: 1, asks: 0, calls: 0 });
        const first = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(first.sessionId);
        await f.controller.stop({ sessionId: first.sessionId, disposition: 'Keep' });
        assert.equal(f.counts().closes, 1);
        await f.controller.stop({ sessionId: first.sessionId, disposition: 'Close' });
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
        const watch = f.callbacks.watch(new AbortController().signal, async () => 'pending');
        f.targets[0]?.emit('exit', 0);
        const result = await watch;
        assert.equal(result.choice, 'restart');
        assert.equal(f.controller.status().status, 'lost');
        const blocked = await f.callbacks.invoke('list_pages', {}, new AbortController().signal, () => {});
        assert.equal(blocked.isError, true);
        assert.equal(f.counts().asks, 1);
        assert.equal(f.counts().calls, 0);
        assert.equal(f.counts().connections, 2);
        const restarted = await f.controller.restart({ sessionId: active.sessionId });
        assert.equal(restarted.pageIdsInvalidated, true);
        assert.equal(restarted.port, 9222);
        await assert.rejects(f.controller.restart({ sessionId: active.sessionId }), /session/i);
    } finally {
        await f.runtime.close();
    }
});

test('an official close failure retains identity until a matching Close retry succeeds', async () => {
    const f = await fixture({ failOfficialClose: true });
    try {
        const active = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(active.sessionId);
        await assert.rejects(f.controller.stop({ sessionId: active.sessionId, disposition: 'Close' }), /timed out/);
        assert.equal(f.controller.status().status, 'close-failed');
        assert.equal(f.controller.status().sessionId, active.sessionId);
        await assert.rejects(f.controller.start({ launchCommand: 'next' }), /explicitly closed/);
        await assert.rejects(f.controller.stop({ sessionId: active.sessionId, disposition: 'Keep' }), /Close retry/);
        const closed = await f.controller.stop({ sessionId: active.sessionId, disposition: 'Close' });
        assert.equal(closed.status, 'idle');
        assert.equal(f.counts().closes, 3);
    } finally {
        await f.runtime.close();
    }
});

test('idle exit asks only at next use; unexpected upstream exit gates the current target', async () => {
    const f = await fixture();
    try {
        await f.controller.start({ launchCommand: 'fixture' });
        f.exits[0]?.();
        assert.equal(f.controller.status().reason, 'official-disconnected');
        assert.equal(f.counts().asks, 0);
        await f.callbacks.invoke('list_pages', {}, new AbortController().signal, () => {});
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
        const watch = f.callbacks.watch(new AbortController().signal, async () => 'pending');
        f.targets[0]?.emit('exit', 0);
        await new Promise<void>((resolve) => setImmediate(resolve));
        await f.controller.endTask({ sessionId: active.sessionId });
        assert.equal((await watch).choice, 'pending');
        assert.equal(f.controller.status().status, 'lost');
    } finally {
        await f.runtime.close();
    }
});

test('one cancelled caller leaves a shared loss prompt available to its live watcher', async () => {
    const f = await fixture({ promptWait: true });
    try {
        const active = await f.controller.start({ launchCommand: 'fixture' });
        assert.ok(active.sessionId);
        const watch = f.callbacks.watch(new AbortController().signal, async () => 'pending');
        f.targets[0]?.emit('exit', 0);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const abort = new AbortController();
        const blocked = f.callbacks.invoke('list_pages', {}, abort.signal, () => {});
        await new Promise<void>((resolve) => setImmediate(resolve));
        abort.abort();
        const result = await Promise.race([
            blocked,
            new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 30)),
        ]);
        assert.ok(result, 'cancelled call must stop waiting while its watcher stays live');
        assert.equal(result.structuredContent?.choice, 'pending');
        assert.equal(f.counts().asks, 1);
        await f.controller.endTask({ sessionId: active.sessionId });
        assert.equal((await watch).choice, 'pending');
    } finally {
        await f.runtime.close();
    }
});

test('watch leases end quietly and can be renewed while the target remains available', async () => {
    const f = await fixture({ watchLeaseMs: 5 });
    try {
        await f.controller.start({ launchCommand: 'fixture' });
        const result = await f.callbacks.watch(new AbortController().signal, async () => 'pending');
        assert.equal(result.reason, 'watch-renew');
        assert.equal(f.counts().asks, 0);
        const watch = f.callbacks.watch(new AbortController().signal, async () => 'pending');
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
