import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlatformAdapter } from '../src/adapters/platform-process.ts';
import type { ManagedTarget, ProcessEvidence, ProcessTarget } from '../src/domains/cdp-target.ts';
import { DetailedError, errorDetails } from '../src/shared/errors.ts';

const identity: ProcessTarget = {
    processId: 601,
    port: 9222,
    executablePath: process.execPath,
    startedAtUtc: '2026-10-04T00:00:00Z',
    targetKind: 'generic-cdp',
};
function evidence(listeners: ProcessEvidence['listeners'] = []): ProcessEvidence {
    return {
        root: {
            exists: true,
            executablePath: identity.executablePath,
            startedAtUtc: identity.startedAtUtc,
            sessionId: 1,
        },
        currentSessionId: 1,
        processIds: [601],
        listeners,
    };
}
function receipt(overrides: Record<string, unknown> = {}) {
    return {
        event: 'closed',
        closed: true,
        processExited: true,
        closeRequested: true,
        phase: 'wait-exit',
        nativeError: 0,
        waitResult: 0,
        waitError: 0,
        processId: 601,
        startedAtUtc: '2026-10-04T00:00:00Z',
        ...overrides,
    };
}

test('absent and foreign listeners permit closing only the verified application', async () => {
    for (const listeners of [[], [{ localAddress: '127.0.0.1', owningProcess: 900 }]]) {
        const requested: number[] = [];
        const platform = createPlatformAdapter({
            platform: 'win32',
            snapshot: async () => evidence(listeners),
            closeWindows: async (target) => {
                requested.push(target.processId);
                return receipt();
            },
        });
        assert.equal(await platform.close({ ...identity }), true);
        assert.deepEqual(requested, [601]);
    }
});

test('PID snapshot absence cannot prove application exit or authorize a signal', async () => {
    let requested = false;
    const platform = createPlatformAdapter({
        platform: 'darwin',
        snapshot: async () => ({ root: { exists: false }, currentSessionId: 1, processIds: [], listeners: [] }),
        requestUnixClose: () => {
            requested = true;
        },
    });
    await assert.rejects(platform.close({ ...identity }), (error: unknown) => {
        assert.equal(errorDetails(error)?.processExited, false);
        assert.equal(errorDetails(error)?.closeRequested, false);
        return true;
    });
    assert.equal(requested, false);
});

test('Windows waits require a matching native handle receipt rather than boolean claims or snapshot absence', async () => {
    for (const overrides of [
        { waitResult: undefined },
        { waitResult: 258, closed: false, processExited: false },
        { waitResult: 4294967295, waitError: 6, closed: false, processExited: false },
        { processId: 900 },
        { startedAtUtc: '2026-10-04T00:00:01Z' },
    ]) {
        let snapshots = 0;
        const platform = createPlatformAdapter({
            platform: 'win32',
            snapshot: async () => {
                snapshots += 1;
                return snapshots === 1
                    ? evidence()
                    : { root: { exists: false }, currentSessionId: 1, processIds: [], listeners: [] };
            },
            closeWindows: async () => receipt(overrides),
        });
        await assert.rejects(platform.close({ ...identity }), (error: unknown) => {
            assert.equal(errorDetails(error)?.processExited, false);
            if (overrides.waitResult === 4294967295) assert.equal(errorDetails(error)?.waitError, 6);
            return true;
        });
    }
});

test('native-close cancellation retains listener diagnostics and permits explicit retry', async () => {
    let requests = 0;
    const platform = createPlatformAdapter({
        platform: 'win32',
        snapshot: async () => evidence(),
        closeWindows: async () => {
            requests += 1;
            const error = new DetailedError('Authorization cancelled.');
            error.details = { phase: 'awaiting-permission', nativeError: 1223, closeRequested: false };
            throw error;
        },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(platform.close({ ...identity }), (error: unknown) => {
            assert.equal(errorDetails(error)?.nativeError, 1223);
            assert.equal(errorDetails(error)?.listenerState, 'absent');
            return true;
        });
    }
    assert.equal(requests, 2);
});

test('Unix close awaits the direct child exit without process or listener polling', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    const target: ManagedTarget = { ...identity, child };
    let snapshots = 0;
    const signals: number[] = [];
    const platform = createPlatformAdapter({
        platform: 'darwin',
        snapshot: async () => {
            snapshots += 1;
            if (snapshots > 1) throw new Error('No process polling is permitted.');
            return evidence([{ localAddress: '127.0.0.1', owningProcess: 900 }]);
        },
        requestUnixClose: (pid) => {
            signals.push(pid);
            queueMicrotask(() => child.emit('exit', 0));
        },
    });
    assert.equal(await platform.close(target), true);
    assert.deepEqual(signals, [601]);
    assert.equal(snapshots, 1);
});

test('an already observed direct-child exit latches success without snapshotting a reused PID', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null });
    const platform = createPlatformAdapter({
        platform: 'darwin',
        snapshot: async () => {
            throw new Error('The PID has been reused.');
        },
        requestUnixClose: () => {
            throw new Error('A reused PID must never receive a signal.');
        },
    });
    assert.equal(await platform.close({ ...identity, child }), true);
});

for (const change of ['actual-exit', 'cancelled-live'] as const) {
    test(`a pending Unix close snapshot cannot authorize a later signal after ${change}`, async () => {
        const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
        const target: ManagedTarget = { ...identity, child };
        const abort = new AbortController();
        const cancellation = new Error('Close request cancelled during identity snapshot.');
        let releaseSnapshot = () => {};
        let enterSnapshot = () => {};
        const snapshotGate = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        const entered = new Promise<void>((resolve) => {
            enterSnapshot = resolve;
        });
        const signals: number[] = [];
        const platform = createPlatformAdapter({
            platform: 'darwin',
            snapshot: async () => {
                enterSnapshot();
                await snapshotGate;
                return evidence();
            },
            requestUnixClose: (pid) => signals.push(pid),
        });
        assert.ok(platform.requestNormalClose);
        const outcome = platform.requestNormalClose(target, { signal: abort.signal }).then(
            (result) => result,
            (error: unknown) => error,
        );
        await entered;
        if (change === 'actual-exit') child.emit('exit', 0);
        abort.abort(cancellation);
        releaseSnapshot();
        const result = await outcome;
        assert.deepEqual(signals, [], 'A late snapshot must never cause a signal to an exited or cancelled PID.');
        if (change === 'actual-exit') assert.deepEqual(result, { closeRequested: false, processExited: true });
        else assert.equal(result, cancellation);
    });
}
