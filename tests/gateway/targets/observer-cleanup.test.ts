import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createTargetLifecycle, type TargetHealth } from '../../../src/gateway/targets/target-lifecycle.ts';

const sessionId = '11111111-1111-4111-8111-111111111111';

async function fixture() {
    let disposed = 0;
    let released = 0;
    let closeCalls = 0;
    let health: TargetHealth = 'healthy';
    let retirement: Promise<unknown> | undefined;
    const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
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
    const controller: ReturnType<typeof createTargetLifecycle> = createTargetLifecycle({
        entryId: 'entry',
        router: { setTarget: () => {}, clearTarget: () => {}, isBusy: () => false },
        server: { ensure: async () => {}, close: async () => {} },
        onProcessExit: (event) => {
            retirement = controller.retireExited({ sessionId: event.sessionId });
        },
        host: {
            launch: async (_options, context) => {
                const target = {
                    processId: 43,
                    port: 9222,
                    executablePath: 'C:/Apps/app.exe',
                    startedAtUtc: '2026-10-04T00:00:00Z',
                    targetKind: 'generic-cdp' as const,
                    child,
                    releaseProfile: () => {
                        released++;
                    },
                };
                context?.onCreated?.(target);
                return target;
            },
            close: async () => {
                closeCalls++;
                return false;
            },
            health: async () => health,
        },
    });
    const started = await controller.start(
        { isolation: { mode: 'none' }, launch: { executable: 'C:/Apps/app.exe' } },
        sessionId,
    );
    assert.equal(started.status, 'active');
    return {
        controller,
        child,
        counts: () => ({ disposed, released, closeCalls }),
        gone: () => {
            health = 'gone';
        },
        exit: async () => {
            child.exitCode = 0;
            child.emit('exit', 0);
            await retirement;
        },
    };
}

test('failed Close and explicit lifecycle cleanup retain observation until actual exit releases the profile', async () => {
    const f = await fixture();
    await assert.rejects(f.controller.stop({ sessionId, disposition: 'Close' }), /did not close/);
    assert.equal(f.counts().disposed, 0);
    assert.deepEqual(await f.controller.cleanup(), { processId: 43, port: 9222 });
    assert.equal(f.counts().disposed, 0);
    assert.equal(f.counts().released, 0, 'A retained live process must still own its profile.');
    assert.equal(f.child.exitCode, null);
    await f.exit();
    assert.equal(f.counts().disposed, 1);
    assert.equal(f.counts().released, 1);
    assert.equal(f.child.listenerCount('exit'), 0);
});

test('confirmed exit after observation failure releases the profile without another Close request', async () => {
    const f = await fixture();
    f.child.emit('monitor-error');
    assert.equal(f.controller.status().reason, 'process-monitor-lost');
    assert.equal(f.counts().released, 0);
    f.gone();
    await f.controller.checkHealth();
    assert.equal(f.counts().released, 0, 'Health cannot substitute for actual exit observation.');
    await f.exit();
    assert.equal(f.controller.status().status, 'idle');
    assert.equal(f.counts().closeCalls, 0);
    assert.equal(f.counts().released, 1);
    assert.ok(f.counts().disposed > 0);
});
