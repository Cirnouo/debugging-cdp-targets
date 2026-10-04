import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createTargetController } from '../src/application/target-controller.ts';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';
import type { LaunchOptions } from '../src/domains/control-contract.ts';

const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture() {
    const child = new EventEmitter();
    const launches: LaunchOptions[] = [];
    let health = 'healthy';
    let closeSucceeds = true;
    let closes = 0;
    let serverCloses = 0;
    let cleared = 0;
    let processId = 42;
    const controller = createTargetController({
        entryId,
        router: {
            isBusy: () => false,
            setTarget: () => {},
            clearTarget: () => {
                cleared += 1;
            },
        },
        host: {
            launch: async (options) => {
                launches.push(options);
                return {
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
            },
            close: async (_target: ManagedTarget) => {
                closes += 1;
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
        child,
        launches,
        setHealth: (value: string) => {
            health = value;
        },
        failClose: () => {
            closeSucceeds = false;
        },
        counts: () => ({ closes, serverCloses, cleared }),
    };
}

test('Keep preserves both sides across tasks; Close retires the session and reuses its entry', async () => {
    const f = fixture();
    const first = await f.controller.start({ launch: { executable: 'fixture' }, targetKind: 'chrome' });
    assert.equal(first.entryId, entryId);
    assert.ok(first.sessionId);
    assert.equal((await f.controller.stop({ sessionId: first.sessionId, disposition: 'Keep' })).status, 'active');
    assert.deepEqual(f.counts(), { closes: 0, serverCloses: 0, cleared: 0 });
    await f.controller.endTask({ sessionId: first.sessionId });
    assert.equal(f.controller.status().status, 'active');
    assert.equal((await f.controller.stop({ sessionId: first.sessionId, disposition: 'Close' })).status, 'idle');
    assert.equal(f.counts().serverCloses, 1);
    const second = await f.controller.start({ launch: { executable: 'new-fixture' } });
    assert.notEqual(second.sessionId, first.sessionId);
    await assert.rejects(f.controller.stop({ sessionId: first.sessionId, disposition: 'Close' }), /session/i);
    assert.equal(f.controller.status().status, 'active');
    await f.controller.cleanupOnDisconnect();
});

test('manual exit invalidates routes, retains exact launch evidence, and notifies once', async () => {
    const f = fixture();
    const active = await f.controller.start({ launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    assert.equal(f.controller.status().taskActive, true);
    f.child.emit('exit', 0);
    f.setHealth('gone');
    await f.controller.checkHealth();
    assert.equal(f.controller.status().status, 'lost');
    assert.equal(f.counts().cleared, 1);
    f.child.emit('exit', 0);
    await f.controller.checkHealth();
    assert.equal(f.counts().cleared, 1);
    const restarted = await f.controller.restart({ sessionId: active.sessionId });
    assert.equal(restarted.port, 9227);
    assert.notEqual(restarted.sessionId, active.sessionId);
    assert.equal(f.launches[1]?.exactPort, 9227);
    assert.deepEqual(f.launches[1]?.launchDefinition?.arguments, ['--port=9227']);
    await f.controller.cleanupOnDisconnect();
});

test('connection unavailability gates tools while process monitoring stays active', async () => {
    const f = fixture();
    await f.controller.start({ launch: { executable: 'fixture' } });
    f.setHealth('unavailable');
    await f.controller.checkHealth();
    assert.equal(f.controller.status().status, 'lost');
    assert.equal(f.controller.status().taskActive, true);
    assert.equal(f.controller.status().reason, 'target-unavailable');
    f.child.emit('exit');
    assert.equal(f.controller.status().reason, 'process-exited');
    await f.controller.cleanupOnDisconnect();
});

test('failed normal close keeps evidence and official connection for retry', async () => {
    const f = fixture();
    const active = await f.controller.start({ launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    f.failClose();
    await assert.rejects(f.controller.stop({ sessionId: active.sessionId, disposition: 'Close' }), /normally/i);
    assert.equal(f.controller.status().status, 'active');
    assert.equal(f.counts().serverCloses, 0);
    assert.equal(f.counts().cleared, 0);
    assert.deepEqual(await f.controller.cleanupOnDisconnect(), { processId: 42, port: 9227 });
});

test('Close forgets an exited owned process even when its old port now belongs to another process', async () => {
    const f = fixture();
    const active = await f.controller.start({ launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    f.child.emit('exit', 0);
    f.setHealth('gone');
    f.failClose();
    const result = await f.controller.stop({ sessionId: active.sessionId, disposition: 'Close' });
    assert.equal(result.status, 'idle');
    assert.equal(f.counts().closes, 0);
    assert.equal(f.counts().serverCloses, 1);
});
