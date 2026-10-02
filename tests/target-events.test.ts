import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';
import { startPluginRuntime } from '../src/application/plugin-runtime.ts';
import type { ControlHandler } from '../src/domains/control-contract.ts';

async function fixture(
    options: {
        exitedAtLaunch?: boolean;
        failClose?: boolean;
        failRouter?: boolean;
        exitOnClose?: boolean;
        closeResult?: 'false' | 'throw';
    } = {},
) {
    let control: ControlHandler | undefined;
    let entry: Parameters<typeof createMcpEntryServer>[0] | undefined;
    let closes = 0;
    let routerCloses = 0;
    let healthChecks = 0;
    let health: 'healthy' | 'unavailable' = 'healthy';
    let busy = false;
    let resolveClosed = () => {};
    const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
    });
    const children: (EventEmitter & { exitCode: number | null; signalCode: string | null })[] = [];
    const upstreamExits: (() => void)[] = [];
    const runtime = await startPluginRuntime({
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
            launch: async () => {
                const child = Object.assign(new EventEmitter(), {
                    exitCode: options.exitedAtLaunch ? 0 : null,
                    signalCode: null,
                });
                children.push(child);
                return {
                    processId: 40 + children.length,
                    port: 9222,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    targetKind: 'generic-cdp',
                    child,
                    launchDefinition: {
                        executablePath: process.execPath,
                        arguments: ['--port=9222'],
                        cwd: process.cwd(),
                    },
                };
            },
            close: async () => {
                if (options.exitOnClose) children.at(-1)?.emit('exit', 0);
                if (options.closeResult === 'false') return false;
                if (options.closeResult === 'throw') throw new Error('close evidence failed');
                return true;
            },
            health: async () => {
                healthChecks += 1;
                return health;
            },
        }),
        createControl: async ({ controller }) => {
            control = controller;
            return { close: async () => {} };
        },
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
        createEntry: (callbacks) => {
            entry = callbacks;
            return {
                connect: async () => {},
                closed,
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
    assert.ok(control && entry);
    return {
        runtime,
        control,
        entry,
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
        const current = await f.control.start({ launchCommand: 'fixture' });
        assert.equal(current.taskActive, true);
        assert.deepEqual(f.entry.status('PostToolUse'), {});
        await tick();
        assert.equal(f.counts().healthChecks, 0);
    } finally {
        await f.runtime.close();
    }
});

test('process exit queues one model-visible Hook context and Stop continuation does not loop', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        f.exit();
        f.exit();
        assert.equal(selected(f.control, current.connectionId).status, 'lost');
        const output = f.entry.status('Stop');
        assert.equal(output.decision, 'block');
        assert.match(String(output.reason), /process-exited/);
        assert.match(String(output.reason), new RegExp(current.connectionId));
        assert.deepEqual(f.entry.status('Stop'), {});
    } finally {
        await f.runtime.close();
    }
});

test('exit already recorded during startup is not missed', async () => {
    const f = await fixture({ exitedAtLaunch: true });
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        assert.equal(current.status, 'lost');
        assert.ok(f.entry.status('PreToolUse').hookSpecificOutput);
    } finally {
        await f.runtime.close();
    }
});

for (const end of ['Keep', 'end-task'] as const) {
    test(`${end} retains live target, then exit closes only its upstream and removes its record`, async () => {
        const f = await fixture();
        try {
            const first = await f.control.start({ launchCommand: 'first' });
            const second = await f.control.start({ launchCommand: 'second' });
            assert.ok(first.sessionId);
            const route = { connectionId: first.connectionId, sessionId: first.sessionId };
            if (end === 'Keep') await f.control.stop({ ...route, disposition: 'Keep' });
            else await f.control.endTask(route);
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
            assert.deepEqual(f.entry.status('PostToolUse'), {});
        } finally {
            await f.runtime.close();
        }
    });
}

test('end-task after exit clears pending reminders and retires the connection', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        assert.ok(current.sessionId);
        f.exit();
        await f.control.endTask({ connectionId: current.connectionId, sessionId: current.sessionId });
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        assert.deepEqual(f.entry.status('Stop'), {});
    } finally {
        await f.runtime.close();
    }
});

test('first official use resumes a kept task and old-session exits cannot affect a restart', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.stop({ ...route, disposition: 'Keep' });
        await f.entry.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {});
        assert.equal(selected(f.control, current.connectionId).taskActive, true);
        f.exit();
        const next = await f.control.restart(route);
        f.exit();
        assert.equal(selected(f.control, current.connectionId).sessionId, next.sessionId);
        assert.equal(selected(f.control, current.connectionId).status, 'active');
        assert.deepEqual(f.entry.status('PostToolUse'), {});
        assert.equal(f.children[0]?.listenerCount('exit'), 0);
    } finally {
        await f.runtime.close();
    }
});

test('CDP and upstream errors do not announce process exit, but a later exit does', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        f.unavailable();
        const result = await f.entry.invoke(
            'list_pages',
            { _dct: { connectionId: current.connectionId, sessionId: current.sessionId } },
            new AbortController().signal,
            () => {},
        );
        assert.equal(result.isError, true);
        assert.deepEqual(f.entry.status('PostToolUse'), {});
        f.upstreamExits[0]?.();
        f.exit();
        assert.ok(f.entry.status('UserPromptSubmit').hookSpecificOutput);
    } finally {
        await f.runtime.close();
    }
});

test('failed retired-upstream cleanup retains retry identity without disturbing other targets', async () => {
    const f = await fixture({ failClose: true });
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.endTask(route);
        f.exit();
        await tick();
        assert.equal(selected(f.control, current.connectionId).status, 'close-failed');
        await f.control.stop({ ...route, disposition: 'Close' });
        assert.throws(() => f.control.status(current.connectionId), /closed/);
    } finally {
        await f.runtime.close();
    }
});

test('router cleanup failure retains PID, port and route for a Close retry', async () => {
    const f = await fixture({ failRouter: true });
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.endTask(route);
        f.exit();
        await tick();
        const retained = selected(f.control, current.connectionId);
        assert.equal(retained.status, 'close-failed');
        assert.equal(retained.processId, current.processId);
        assert.equal(retained.port, current.port);
        assert.equal(retained.sessionId, current.sessionId);
        assert.deepEqual(f.entry.status('Stop'), {});
        await f.control.stop({ ...route, disposition: 'Close' });
        assert.throws(() => f.control.status(current.connectionId), /closed/);
    } finally {
        await f.runtime.close();
    }
});

test('normal Close suppresses its exit event while other concurrent exits remain pending', async () => {
    const f = await fixture({ exitOnClose: true });
    try {
        const first = await f.control.start({ launchCommand: 'first' });
        const second = await f.control.start({ launchCommand: 'second' });
        assert.ok(first.sessionId && second.sessionId);
        f.exit();
        await f.control.stop({ connectionId: second.connectionId, sessionId: second.sessionId, disposition: 'Close' });
        const output = JSON.stringify(f.entry.status('PostToolUse'));
        assert.ok(output.includes(first.connectionId));
        assert.ok(!output.includes(second.connectionId));
        assert.deepEqual(f.entry.status('Stop'), {});
    } finally {
        await f.runtime.close();
    }
});

for (const operation of ['Close', 'restart'] as const) {
    for (const timing of ['during', 'after'] as const) {
        test(`${operation} expected exit ${timing} failed upstream cleanup does not retry automatically`, async () => {
            const f = await fixture({ failClose: true, exitOnClose: timing === 'during' });
            try {
                const current = await f.control.start({ launchCommand: 'fixture' });
                assert.ok(current.sessionId);
                const route = { connectionId: current.connectionId, sessionId: current.sessionId };
                if (operation === 'restart') {
                    f.unavailable();
                    await f.entry.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {});
                    await assert.rejects(f.control.restart(route), /cleanup failed/);
                } else {
                    await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /cleanup failed/);
                }
                if (timing === 'after') f.exit();
                await tick();
                const retained = selected(f.control, current.connectionId);
                assert.equal(retained.status, 'close-failed');
                assert.equal(retained.sessionId, current.sessionId);
                assert.equal(retained.processId, current.processId);
                assert.equal(retained.port, current.port);
                assert.equal(f.counts().closes, 2);
                assert.deepEqual(f.entry.status('Stop'), {});
                await f.control.stop({ ...route, disposition: 'Close' });
                assert.equal(f.counts().closes, 3);
                assert.throws(() => f.control.status(current.connectionId), /closed/);
            } finally {
                await f.runtime.close();
            }
        });
    }
}

test('a lost target stays recoverable when a busy router rejects Close', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        f.exit();
        f.busy(true);
        await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /busy with in-flight requests/);
        assert.equal(selected(f.control, current.connectionId).status, 'lost');
        assert.equal(selected(f.control, current.connectionId).sessionId, current.sessionId);
        f.busy(false);
        const next = await f.control.restart(route);
        assert.equal(next.status, 'active');
        assert.notEqual(next.sessionId, current.sessionId);
    } finally {
        await f.runtime.close();
    }
});

for (const operation of ['Close', 'restart'] as const) {
    for (const closeResult of ['false', 'throw'] as const) {
        test(`${operation} reconciles a native exit before close evidence ${closeResult}`, async () => {
            const f = await fixture({ exitOnClose: true, closeResult });
            try {
                const current = await f.control.start({ launchCommand: 'fixture' });
                assert.ok(current.sessionId);
                const route = { connectionId: current.connectionId, sessionId: current.sessionId };
                if (operation === 'restart') {
                    f.unavailable();
                    await f.entry.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {});
                    const next = await f.control.restart(route);
                    assert.equal(next.status, 'active');
                    assert.notEqual(next.sessionId, current.sessionId);
                } else {
                    const result = await f.control.stop({ ...route, disposition: 'Close' });
                    assert.equal(result.status, 'idle');
                    assert.throws(() => f.control.status(current.connectionId), /closed/);
                }
                assert.deepEqual(f.entry.status('Stop'), {});
            } finally {
                await f.runtime.close();
            }
        });
    }
}

test('end-task after exit retains a route when router cleanup fails', async () => {
    const f = await fixture({ failRouter: true });
    try {
        const current = await f.control.start({ launchCommand: 'fixture' });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        f.exit();
        await assert.rejects(f.control.endTask(route), /router cleanup failed/);
        assert.equal(selected(f.control, current.connectionId).sessionId, current.sessionId);
        assert.equal(selected(f.control, current.connectionId).status, 'close-failed');
        await f.control.stop({ ...route, disposition: 'Close' });
    } finally {
        await f.runtime.close();
    }
});
