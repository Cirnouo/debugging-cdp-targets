import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlatformAdapter } from '../src/adapters/platform-process.ts';
import type { ManagedTarget, ProcessEvidence, ProcessTarget } from '../src/gateway/targets/model/target-contract.ts';
import { DetailedError, errorDetails } from '../src/shared/errors.ts';

const windowsIdentity: { platform: NodeJS.Platform; architecture: string } = {
    platform: 'win32',
    architecture: 'x64',
};
const windowsEvidence = { ...windowsIdentity, reservedRanges: async () => [] };

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
            ...windowsEvidence,
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

test('PID snapshot absence cannot prove application exit or authorize native Close', async () => {
    let requested = false;
    const platform = createPlatformAdapter({
        ...windowsEvidence,
        snapshot: async () => ({ root: { exists: false }, currentSessionId: 1, processIds: [], listeners: [] }),
        closeWindows: async () => {
            requested = true;
            return receipt();
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
            ...windowsEvidence,
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
        ...windowsEvidence,
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

test('Windows Close awaits actual exit without process or listener polling', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    const target: ManagedTarget = { ...identity, child };
    let snapshots = 0;
    const requests: number[] = [];
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const platform = createPlatformAdapter({
        ...windowsEvidence,
        snapshot: async () => {
            snapshots += 1;
            if (snapshots > 1) throw new Error('No process polling is permitted.');
            return evidence([{ localAddress: '127.0.0.1', owningProcess: 900 }]);
        },
        requestWindowsClose: async (selected) => {
            requests.push(selected.processId);
            queueMicrotask(() => child.emit('exit', 0));
            return { closeRequested: true, processExited: false };
        },
        waitWindowsExit: async () => {
            await exited;
            return receipt();
        },
    });
    assert.equal(await platform.close(target), true);
    assert.deepEqual(requests, [601]);
    assert.equal(snapshots, 1);
});

test('an already observed direct-child exit latches success without snapshotting a reused PID', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null });
    const platform = createPlatformAdapter({
        ...windowsEvidence,
        snapshot: async () => {
            throw new Error('The PID has been reused.');
        },
        closeWindows: async () => {
            throw new Error('A reused PID must never receive native Close.');
        },
    });
    assert.equal(await platform.close({ ...identity, child }), true);
});

for (const change of ['actual-exit', 'cancelled-live'] as const) {
    test(`a pending Windows Close snapshot cannot authorize a later native request after ${change}`, async () => {
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
        const requests: number[] = [];
        const platform = createPlatformAdapter({
            ...windowsEvidence,
            snapshot: async () => {
                enterSnapshot();
                await snapshotGate;
                return evidence();
            },
            requestWindowsClose: async (selected) => {
                requests.push(selected.processId);
                return { closeRequested: true, processExited: false };
            },
            waitWindowsExit: async () => receipt(),
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
        assert.deepEqual(requests, [], 'A late snapshot must never request Close for an exited or cancelled PID.');
        if (change === 'actual-exit') assert.deepEqual(result, { closeRequested: false, processExited: true });
        else assert.equal(result, cancellation);
    });
}
