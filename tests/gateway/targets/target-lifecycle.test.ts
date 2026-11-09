import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { LaunchOptions } from '../../../src/domains/control-contract.ts';
import type { ManagedTarget } from '../../../src/gateway/targets/model/target-contract.ts';
import { createTargetLifecycle, type TargetExitEvent } from '../../../src/gateway/targets/target-lifecycle.ts';
import { DetailedError, isRecord } from '../../../src/shared/errors.ts';

const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
type FixtureChild = EventEmitter & { exitCode: number | null; signalCode: string | null };
function fixture() {
    const children: FixtureChild[] = [];
    const exits: TargetExitEvent[] = [];
    const launches: LaunchOptions[] = [];
    let health = 'healthy';
    let closeSucceeds = true;
    let closes = 0;
    let serverCloses = 0;
    let cleared = 0;
    let processId = 42;
    const controller = createTargetLifecycle({
        entryId,
        onProcessExit: (event) => exits.push(event),
        router: {
            isBusy: () => false,
            setTarget: () => {},
            clearTarget: () => {
                cleared += 1;
            },
        },
        host: {
            launch: async (options, context) => {
                launches.push(options);
                const child = Object.assign(new EventEmitter(), {
                    exitCode: null as number | null,
                    signalCode: null as string | null,
                });
                children.push(child);
                const target: ManagedTarget = {
                    port: options.exactPort ?? 9227,
                    processId: processId++,
                    targetKind: 'chrome',
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    launchDefinition: {
                        executablePath: process.execPath,
                        arguments: ['--port=9227'],
                        cwd: process.cwd(),
                    },
                    child,
                };
                context?.onCreated?.(target);
                return target;
            },
            close: async (target: ManagedTarget) => {
                closes += 1;
                if (closeSucceeds) {
                    const child = target.child as FixtureChild;
                    child.exitCode = 0;
                    child.emit('exit', 0);
                }
                return closeSucceeds;
            },
            health: async () => {
                if (health === 'gone') return 'gone';
                if (health === 'unavailable') return 'unavailable';
                if (health === 'identity-changed') return 'identity-changed';
                return 'healthy';
            },
        },
        server: {
            ensure: async () => {},
            close: async () => {
                serverCloses += 1;
            },
        },
    });
    return {
        controller,
        children,
        exits,
        exit: (index = children.length - 1) => {
            const child = children[index];
            assert.ok(child);
            child.exitCode = 0;
            child.emit('exit', 0);
        },
        launches,
        setHealth: (value: string) => {
            health = value;
        },
        failClose: () => {
            closeSucceeds = false;
        },
        allowClose: () => {
            closeSucceeds = true;
        },
        counts: () => ({ closes, serverCloses, cleared }),
    };
}

test('Keep preserves target and upstream; Close retires the session and permits a fresh start', async () => {
    const f = fixture();
    const first = await f.controller.start({
        isolation: { mode: 'none' },
        launch: { executable: 'fixture' },
        targetKind: 'chrome',
    });
    assert.ok(first.sessionId);
    assert.equal((await f.controller.stop({ sessionId: first.sessionId, disposition: 'Keep' })).status, 'active');
    assert.deepEqual(f.counts(), { closes: 0, serverCloses: 0, cleared: 0 });
    assert.equal(f.controller.status().status, 'active');
    assert.equal((await f.controller.stop({ sessionId: first.sessionId, disposition: 'Close' })).status, 'idle');
    assert.equal(f.counts().serverCloses, 1);
    const second = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'new-fixture' } });
    assert.notEqual(second.sessionId, first.sessionId);
    await assert.rejects(f.controller.stop({ sessionId: first.sessionId, disposition: 'Close' }), /session/i);
    assert.equal(f.controller.status().status, 'active');
    await f.controller.cleanup();
});

test('manual exit invalidates routes once, retires the dead session and permits a fresh start', async () => {
    const f = fixture();
    const active = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    f.exit();
    f.setHealth('gone');
    await f.controller.checkHealth();
    assert.equal(f.controller.status().status, 'lost');
    assert.equal(f.counts().cleared, 1);
    f.exit();
    await f.controller.checkHealth();
    assert.equal(f.counts().cleared, 1);
    assert.equal(f.exits.length, 1);
    assert.equal(f.exits[0]?.sessionId, active.sessionId);
    await assert.rejects(f.controller.restart({ sessionId: active.sessionId }), /session/i);
    assert.equal(f.launches.length, 1);
    assert.equal((await f.controller.retireExited({ sessionId: active.sessionId })).status, 'idle');
    const next = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fresh-fixture' } });
    assert.notEqual(next.sessionId, active.sessionId);
    assert.notEqual(f.children[0], f.children[1]);
    assert.equal(f.launches[1]?.exactPort, undefined);
    f.exit(0);
    assert.equal(f.controller.status().status, 'active');
    assert.equal(f.controller.status().sessionId, next.sessionId);
    await f.controller.cleanup();
});

test('a live unavailable target restarts with its exact port and launch evidence after confirmed exit', async () => {
    const f = fixture();
    const active = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    f.setHealth('gone');
    await f.controller.checkHealth();
    assert.equal(f.controller.status().status, 'lost');
    assert.equal(f.controller.status().reason, 'target-unavailable');
    assert.equal(f.exits.length, 0);
    assert.equal(f.children[0]?.exitCode, null);
    const restarted = await f.controller.restart({ sessionId: active.sessionId });
    assert.equal(restarted.port, 9227);
    assert.notEqual(restarted.sessionId, active.sessionId);
    assert.equal(f.launches[1]?.exactPort, 9227);
    assert.deepEqual(f.launches[1]?.launchDefinition?.arguments, ['--port=9227']);
    assert.equal(f.exits[0]?.expected, 'restart');
    assert.notEqual(f.children[0], f.children[1]);
    f.exit(0);
    assert.equal(f.controller.status().status, 'active');
    assert.equal(f.controller.status().sessionId, restarted.sessionId);
    await f.controller.cleanup();
});

test('connection unavailability gates tools while process monitoring stays active', async () => {
    const f = fixture();
    await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
    f.setHealth('unavailable');
    await f.controller.checkHealth();
    assert.equal(f.controller.status().status, 'lost');
    assert.equal(f.controller.status().reason, 'target-unavailable');
    f.exit();
    assert.equal(f.controller.status().reason, 'process-exited');
    await f.controller.cleanup();
});

test('failed normal Close retains target identity and upstream for retry', async () => {
    const f = fixture();
    const active = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    f.failClose();
    await assert.rejects(f.controller.stop({ sessionId: active.sessionId, disposition: 'Close' }), /normally/i);
    assert.equal(f.controller.status().status, 'active');
    assert.equal(f.counts().serverCloses, 0);
    assert.equal(f.counts().cleared, 0);
    assert.equal(f.controller.canInvoke(), true);
    assert.equal(f.exits.length, 0);
    f.allowClose();
    assert.equal((await f.controller.stop({ sessionId: active.sessionId, disposition: 'Close' })).status, 'idle');
    assert.equal(f.counts().closes, 2);
    assert.equal(f.exits.length, 1);
    assert.equal(f.counts().serverCloses, 1);
});

test('explicit lifecycle cleanup retains live identity when normal Close is rejected', async () => {
    const f = fixture();
    await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
    f.failClose();
    assert.deepEqual(await f.controller.cleanup(), { processId: 42, port: 9227 });
    assert.equal(f.children[0]?.exitCode, null);
    assert.equal(f.exits.length, 0);
});

test('retiring an exited target sends no further Close request', async () => {
    const f = fixture();
    const active = await f.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    f.exit();
    f.setHealth('gone');
    f.failClose();
    await assert.rejects(f.controller.stop({ sessionId: active.sessionId, disposition: 'Close' }), /session/i);
    const result = await f.controller.retireExited({ sessionId: active.sessionId });
    assert.equal(result.status, 'idle');
    assert.equal(f.counts().closes, 0);
    assert.equal(f.counts().serverCloses, 1);
});

const pluginEntryId = randomUUID();
function targetFixture(port: number, processId = 42): ManagedTarget {
    return {
        port,
        processId,
        targetKind: 'generic-cdp',
        executablePath: process.execPath,
        startedAtUtc: '2026-09-30T00:00:00Z',
    };
}

test('failed normal Close pauses and resumes routing while preserving identity despite busy CDP', async () => {
    const events: string[] = [];
    let busy = false;
    const controller = createTargetLifecycle({
        entryId: pluginEntryId,
        router: {
            isBusy: () => busy,
            pause: () => {
                events.push('pause');
            },
            resume: () => {
                events.push('resume');
            },
            setTarget: () => {
                events.push('route');
            },
            clearTarget: () => {
                events.push('clear');
            },
        },
        host: {
            launch: async () => targetFixture(9222),
            close: async () => {
                events.push('close');
                return false;
            },
        },
        server: {
            ensure: async () => {},
            close: async () => {
                events.push('official-close');
            },
        },
    });
    const active = await controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    busy = true;
    await assert.rejects(controller.stop({ sessionId: active.sessionId, disposition: 'Close' }), (error: unknown) => {
        assert.ok(error instanceof DetailedError && isRecord(error.details));
        assert.deepEqual(error.details.retainedTargets, [{ processId: 42, port: 9222 }]);
        return true;
    });
    assert.deepEqual(events, ['route', 'pause', 'close', 'resume']);
    busy = false;
    assert.equal(controller.status().sessionId, active.sessionId);
    assert.equal(controller.status().status, 'active');
});

test('failed route attachment normally closes only the newly launched target', async () => {
    const closed: number[] = [];
    const child = new EventEmitter();
    const controller = createTargetLifecycle({
        entryId: pluginEntryId,
        router: {
            isBusy: () => false,
            setTarget: () => {
                throw new Error('route failed');
            },
            clearTarget: () => {},
        },
        host: {
            launch: async () => ({ ...targetFixture(9222), child }),
            close: async (target) => {
                closed.push(target.processId);
                child.emit('exit');
                return true;
            },
        },
        server: { ensure: async () => {}, close: async () => {} },
    });
    await assert.rejects(
        controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } }),
        /route failed/,
    );
    assert.deepEqual(closed, [42]);
    assert.equal(controller.status().status, 'idle');
});
