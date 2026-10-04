import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createTargetController, type TargetHealth } from '../src/application/target-controller.ts';

async function fixture() {
    let disposed = 0;
    let released = 0;
    let closeCalls = 0;
    let health: TargetHealth = 'healthy';
    const child = Object.assign(new EventEmitter(), {
        exitCode: null,
        disposeMonitor: () => {
            disposed++;
        },
        onMonitorError: (listener: () => void) => {
            child.on('monitor-error', listener);
            return () => {
                child.off('monitor-error', listener);
            };
        },
    });
    const controller = createTargetController({
        entryId: 'entry',
        router: { setTarget: () => {}, clearTarget: () => {}, isBusy: () => false },
        server: { ensure: async () => {}, close: async () => {} },
        host: {
            launch: async () => ({
                processId: 43,
                port: 9222,
                executablePath: 'C:/Apps/app.exe',
                startedAtUtc: '2026-10-04T00:00:00Z',
                targetKind: 'generic-cdp',
                child,
                releaseProfile: () => {
                    released++;
                },
            }),
            close: async () => {
                closeCalls++;
                return false;
            },
            health: async () => health,
        },
    });
    const started = await controller.start({ launch: { executable: 'C:/Apps/app.exe' } }, 'session');
    assert.equal(started.status, 'active');
    return {
        controller,
        child,
        counts: () => ({ disposed, released, closeCalls }),
        gone: () => {
            health = 'gone';
        },
    };
}

test('failed Close retains observation for retry; gateway disconnect releases observation without declaring exit', async () => {
    const f = await fixture();
    await assert.rejects(f.controller.stop({ sessionId: 'session', disposition: 'Close' }), /did not close/);
    assert.equal(f.counts().disposed, 0);
    assert.deepEqual(await f.controller.cleanupOnDisconnect(), { processId: 43, port: 9222 });
    assert.equal(f.counts().disposed, 1);
    assert.equal(f.counts().released, 0, 'A retained live process must still own its profile.');
    assert.equal(f.child.exitCode, null);
});

test('confirmed exit after observer loss releases the profile without closing an unknown process', async () => {
    const f = await fixture();
    f.child.emit('monitor-error');
    assert.equal(f.controller.status().reason, 'process-monitor-lost');
    assert.equal(f.counts().released, 0);
    f.gone();
    assert.equal((await f.controller.stop({ sessionId: 'session', disposition: 'Close' })).status, 'idle');
    assert.equal(f.counts().closeCalls, 0);
    assert.equal(f.counts().released, 1);
    assert.ok(f.counts().disposed > 0);
});
