import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { startPluginRuntime } from '../src/application/plugin-runtime.ts';
import type { ControlHandler } from '../src/domains/control-contract.ts';
import { isRecord } from '../src/shared/errors.ts';

async function fixture(
    options: {
        exitedAtLaunch?: boolean;
        failClose?: boolean;
        failRouter?: boolean;
        exitOnClose?: boolean;
        closeResult?: 'false' | 'throw';
    } = {},
) {
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
        loadCatalog: async (tools = []) =>
            createToolCatalog({
                version: '1.10.1',
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
    const control = runtime.controller;
    assert.ok(entry);
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

function hookExits(output: Record<string, unknown>) {
    const context =
        typeof output.reason === 'string'
            ? output.reason
            : isRecord(output.hookSpecificOutput)
              ? output.hookSpecificOutput.additionalContext
              : undefined;
    assert.equal(typeof context, 'string');
    if (typeof context !== 'string') throw new Error('Missing Hook context.');
    const line = context.split('\n')[0];
    assert.ok(line);
    const payload: unknown = JSON.parse(line.slice(line.indexOf('{')));
    assert.ok(isRecord(payload) && Array.isArray(payload.exits));
    return payload.exits.map((event: unknown) => {
        assert.ok(isRecord(event));
        return event;
    });
}

test('start monitors silently without watches or periodic health checks', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launch: { executable: 'fixture' } });
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
        const current = await f.control.start({ launch: { executable: 'fixture' } });
        f.exit();
        f.exit();
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await tick();
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
        await assert.rejects(f.control.start({ launch: { executable: 'fixture' } }), /exited/);
        assert.deepEqual(f.control.status(), { entryId: f.runtime.entryId, connections: [] });
        assert.equal(f.counts().closes, 1, 'An already exited target must not acquire an official connection.');
        assert.ok(f.entry.status('PreToolUse').hookSpecificOutput);
    } finally {
        await f.runtime.close();
    }
});

for (const end of ['Keep', 'end-task'] as const) {
    test(`${end} retains live target, then exit closes only its upstream and removes its record`, async () => {
        const f = await fixture();
        try {
            const first = await f.control.start({ launch: { executable: 'first' } });
            const second = await f.control.start({ launch: { executable: 'second' } });
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
            const events = hookExits(f.entry.status('PostToolUse'));
            assert.equal(events.length, 1);
            assert.equal(events[0]?.connectionId, first.connectionId);
            assert.equal(events[0]?.sessionId, first.sessionId);
            assert.equal(events[0]?.taskActive, false);
            assert.deepEqual(f.entry.status('PostToolUse'), {});
        } finally {
            await f.runtime.close();
        }
    });
}

test('end-task after exit rejects the closed route and preserves its immutable reminder', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        f.exit();
        await assert.rejects(
            f.control.endTask({ connectionId: current.connectionId, sessionId: current.sessionId }),
            /closed/,
        );
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await tick();
        const events = hookExits(f.entry.status('Stop'));
        assert.equal(events[0]?.connectionId, current.connectionId);
        assert.equal(events[0]?.taskActive, true);
        assert.deepEqual(f.entry.status('Stop'), {});
    } finally {
        await f.runtime.close();
    }
});

test('first official use resumes a kept task and old-session exits cannot affect a restart', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.stop({ ...route, disposition: 'Keep' });
        await f.entry.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {});
        assert.equal(selected(f.control, current.connectionId).taskActive, true);
        const next = await f.control.restart(route);
        f.exit();
        assert.equal(selected(f.control, current.connectionId).sessionId, next.sessionId);
        assert.equal(selected(f.control, current.connectionId).status, 'active');
        assert.notEqual(next.sessionId, current.sessionId);
        assert.deepEqual(f.entry.status('PostToolUse'), {});
        assert.equal(f.children[0]?.listenerCount('exit'), 0);
    } finally {
        await f.runtime.close();
    }
});

test('CDP and upstream errors do not announce process exit, but a later exit does', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launch: { executable: 'fixture' } });
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
        await tick();
        assert.ok(f.entry.status('UserPromptSubmit').hookSpecificOutput);
    } finally {
        await f.runtime.close();
    }
});

test('failed retired-upstream cleanup closes its public route and retries only at gateway cleanup', async () => {
    const f = await fixture({ failClose: true });
    try {
        const current = await f.control.start({ launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.endTask(route);
        f.exit();
        await tick();
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /closed/);
        assert.equal(f.counts().closes, 2);
        await f.runtime.close();
        assert.equal(f.counts().closes, 3);
        assert.throws(() => f.control.status(current.connectionId), /closed/);
    } finally {
        await f.runtime.close();
    }
});

test('router cleanup failure retains internal ownership and retries after its route is removed', async () => {
    const f = await fixture({ failRouter: true });
    try {
        const current = await f.control.start({ launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        await f.control.endTask(route);
        f.exit();
        await tick();
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        const events = hookExits(f.entry.status('Stop'));
        assert.equal(events[0]?.processId, current.processId);
        assert.equal(events[0]?.port, current.port);
        assert.equal(events[0]?.sessionId, current.sessionId);
        assert.equal(events[0]?.cleanupError, 'router cleanup failed');
        assert.equal(f.counts().routerCloses, 2);
        await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /closed/);
        await f.runtime.close();
        assert.equal(f.counts().routerCloses, 3);
        assert.throws(() => f.control.status(current.connectionId), /closed/);
    } finally {
        await f.runtime.close();
    }
});

test('normal Close suppresses its exit event while other concurrent exits remain pending', async () => {
    const f = await fixture({ exitOnClose: true });
    try {
        const first = await f.control.start({ launch: { executable: 'first' } });
        const second = await f.control.start({ launch: { executable: 'second' } });
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
        test(`${operation} expected exit ${timing} normal-close evidence survives failed upstream cleanup without automatic retry`, async () => {
            const f = await fixture({ failClose: true, exitOnClose: timing === 'during' });
            try {
                const current = await f.control.start({ launch: { executable: 'fixture' } });
                assert.ok(current.sessionId);
                const route = { connectionId: current.connectionId, sessionId: current.sessionId };
                if (operation === 'restart') {
                    f.unavailable();
                    await f.entry.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {});
                    await assert.rejects(f.control.restart(route), /cleanup failed/);
                } else {
                    await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /cleanup failed/);
                }
                await tick();
                assert.throws(() => f.control.status(current.connectionId), /closed/);
                assert.equal(f.counts().closes, 2);
                const events = hookExits(f.entry.status('Stop'));
                assert.equal(events.length, 1);
                assert.equal(events[0]?.sessionId, current.sessionId);
                assert.equal(events[0]?.processId, current.processId);
                assert.equal(events[0]?.port, current.port);
                assert.equal(events[0]?.expected, operation === 'Close' ? 'close' : 'restart');
                assert.deepEqual(f.entry.status('Stop'), {});
                await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /closed/);
                await f.runtime.close();
                assert.equal(f.counts().closes, 3);
                assert.throws(() => f.control.status(current.connectionId), /closed/);
            } finally {
                await f.runtime.close();
            }
        });
    }
}

test('an unexpected target exit retires its route despite a busy router and a new start creates fresh IDs', async () => {
    const f = await fixture();
    try {
        const current = await f.control.start({ launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        f.busy(true);
        f.exit();
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await assert.rejects(f.control.stop({ ...route, disposition: 'Close' }), /closed/);
        await assert.rejects(
            f.entry.invoke('list_pages', { _dct: route }, new AbortController().signal, () => {}),
            /closed/,
        );
        await tick();
        assert.equal(f.counts().closes, 2);
        f.busy(false);
        const next = await f.control.start({ launch: { executable: 'new-task' } });
        assert.equal(next.status, 'active');
        assert.notEqual(next.connectionId, current.connectionId);
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
                const current = await f.control.start({ launch: { executable: 'fixture' } });
                assert.ok(current.sessionId);
                const route = { connectionId: current.connectionId, sessionId: current.sessionId };
                if (operation === 'restart') {
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

test('end-task cannot restore an exited route when router cleanup fails', async () => {
    const f = await fixture({ failRouter: true });
    try {
        const current = await f.control.start({ launch: { executable: 'fixture' } });
        assert.ok(current.sessionId);
        const route = { connectionId: current.connectionId, sessionId: current.sessionId };
        f.exit();
        await assert.rejects(f.control.endTask(route), /closed/);
        assert.throws(() => f.control.status(current.connectionId), /closed/);
        await tick();
        assert.equal(f.counts().routerCloses, 2);
        await f.runtime.close();
        assert.equal(f.counts().routerCloses, 3);
    } finally {
        await f.runtime.close();
    }
});
