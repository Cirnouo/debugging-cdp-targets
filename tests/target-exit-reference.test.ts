import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { waitForTargetExit } from '../src/adapters/platform-process.ts';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';
import { isRecord } from '../src/shared/errors.ts';

for (const mode of ['single', 'cancel-one', 'cancel-all']) {
    test(`actual Node exit observation retains the event loop only while ${mode} waiters need it`, () => {
        const result = spawnSync(
            process.execPath,
            [fileURLToPath(new URL('./fixtures/target-exit-reference.ts', import.meta.url)), mode],
            { encoding: 'utf8', shell: false, windowsHide: true },
        );
        assert.equal(result.error, undefined);
        const messages: unknown[] = result.stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        const created = messages[0];
        assert.ok(isRecord(created));
        assert.equal(created.phase, 'waiting');
        assert.ok(typeof created.processId === 'number' && created.processId > 0);
        assert.equal(created.exitListeners, mode === 'cancel-one' ? 3 : 2);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(messages[1], {
            phase: mode === 'cancel-all' ? 'cancelled' : 'exited',
            exitCode: mode === 'cancel-all' ? null : 0,
        });
    });
}

function referencedTarget() {
    let refs = 0;
    let unrefs = 0;
    const monitorCallbacks: (() => void)[] = [];
    const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        ref: () => {
            refs += 1;
        },
        unref: () => {
            unrefs += 1;
        },
        onMonitorError: (callback: () => void) => {
            monitorCallbacks.push(callback);
            return () => {};
        },
    });
    const target: ManagedTarget = {
        processId: 601,
        port: 9222,
        executablePath: process.execPath,
        startedAtUtc: '2026-10-04T00:00:00Z',
        targetKind: 'generic-cdp',
        child,
    };
    return { target, child, monitorCallbacks, references: () => ({ refs, unrefs }) };
}

test('cancelling one exit waiter preserves another waiter reference until actual exit', async () => {
    const f = referencedTarget();
    const abort = new AbortController();
    const first = waitForTargetExit(f.target, abort.signal);
    const second = waitForTargetExit(f.target);
    assert.deepEqual(f.references(), { refs: 1, unrefs: 0 });
    const cancelled = assert.rejects(first, /cancelled/);
    abort.abort(new Error('One waiter cancelled.'));
    await cancelled;
    assert.deepEqual(f.references(), { refs: 1, unrefs: 0 });
    f.child.emit('exit', 0);
    await second;
    assert.deepEqual(f.references(), { refs: 1, unrefs: 1 });
    f.child.emit('exit', 0);
    abort.abort();
    assert.deepEqual(f.references(), { refs: 1, unrefs: 1 });
});

test('a late callback from a cancelled exit waiter cannot release a newer waiter reference', async () => {
    const f = referencedTarget();
    const abort = new AbortController();
    const first = waitForTargetExit(f.target, abort.signal);
    const cancelled = assert.rejects(first, /cancelled/);
    abort.abort(new Error('Old waiter cancelled.'));
    await cancelled;
    assert.deepEqual(f.references(), { refs: 1, unrefs: 1 });
    const second = waitForTargetExit(f.target);
    f.monitorCallbacks[0]?.();
    assert.deepEqual(f.references(), { refs: 2, unrefs: 1 });
    f.child.emit('exit', 0);
    await second;
    assert.deepEqual(f.references(), { refs: 2, unrefs: 2 });
});

test('synchronous monitor failure releases its wait reference and returned subscription exactly once', async () => {
    const f = referencedTarget();
    let subscriptionsReleased = 0;
    f.child.onMonitorError = (callback) => {
        callback();
        return () => {
            subscriptionsReleased += 1;
        };
    };
    await assert.rejects(waitForTargetExit(f.target), /observer failed/);
    assert.deepEqual(f.references(), { refs: 1, unrefs: 1 });
    assert.equal(subscriptionsReleased, 1);
});
