import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { isRecord } from '../src/shared/errors.ts';
import { type NativeCloseRuntime, nativeCloseRuntime } from './fixtures/native-close-runtime.ts';

async function awaitingExit(f: NativeCloseRuntime, operationId: string) {
    await f.accepted;
    assert.equal(f.application.exitCode, null, 'An accepted Close request cannot prove actual root process exit.');
    let snapshot = await f.operation(operationId);
    while (snapshot.phase !== 'awaiting-target-exit') {
        assert.equal(snapshot.state, 'running');
        const update = await f.readControl({ action: 'wait', operationId, cursor: snapshot.cursor });
        assert.ok(isRecord(update.operation));
        snapshot = update.operation;
    }
    assert.equal(snapshot.state, 'running');
    assert.equal(snapshot.connectionId, f.current.connectionId);
    assert.equal(snapshot.sessionId, f.current.sessionId);
    return snapshot;
}

async function retainedLiveRoot(f: NativeCloseRuntime) {
    assert.equal(f.listenerPresent(), false);
    assert.equal(f.application.pid, 1601);
    assert.equal(f.application.startedAtUtc, '2026-10-12T01:00:00.000Z');
    assert.equal(f.application.exitCode, null);
    assert.equal(f.application.monitorDisposed, false);
    assert.equal(f.application.monitoringFailure, undefined);
    assert.equal(f.helpers[0]?.child.stdin.writableEnded, false);
    const retained = f.runtime.controller.status(f.current.connectionId);
    assert.ok('sessionId' in retained);
    assert.equal(retained.sessionId, f.current.sessionId);
    assert.equal(retained.processId, 1601);
    assert.equal(retained.port, 19333);
    assert.equal(await f.directoryExists(), true);
    assert.equal(
        await readFile(path.join(f.profile, 'owned-marker'), 'utf8'),
        'retained until root exit and resource release',
    );
    const evidence = f.isolation();
    assert.ok(evidence?.mode === 'data-dir');
    assert.equal(evidence.state, 'held');
    assert.equal(evidence.path, f.profile);
    await assert.rejects(f.directories.acquire({ kind: 'existing', path: f.profile }, 'retain'), {
        code: 'directory-overlap',
    });
    assert.equal(f.order.includes('upstream-disposing'), false);
    assert.equal(f.order.includes('route-revoked'), false);
}

function operationId(accepted: Record<string, unknown>) {
    assert.equal(typeof accepted.operationId, 'string');
    return String(accepted.operationId);
}

async function terminalOperation(f: NativeCloseRuntime, id: string) {
    let snapshot = await f.operation(id);
    while (!['succeeded', 'failed', 'cancelled'].includes(String(snapshot.state))) {
        const update = await f.readControl({ action: 'wait', operationId: id, cursor: snapshot.cursor });
        assert.ok(isRecord(update.operation));
        snapshot = update.operation;
    }
    return snapshot;
}

async function completeClose(f: NativeCloseRuntime, operationId: string) {
    f.emitClose();
    assert.equal(f.application.exitCode, 0);
    assert.equal(f.application.monitorDisposed, false);
    assert.throws(() => f.runtime.controller.status(f.current.connectionId), /absent|closed/);
    f.launchObserverExit();
    await assert.rejects(f.invoke(), /absent|closed/);
    await f.upstreamDisposing;
    assert.equal(await f.directoryExists(), true);
    await assert.rejects(f.directories.acquire({ kind: 'existing', path: f.profile }, 'retain'), {
        code: 'directory-overlap',
    });
    const pending = await f.operation(operationId);
    assert.equal(pending.state, 'running');
    f.allowDisposal();
    await f.deleted;
    const result = await terminalOperation(f, operationId);
    assert.equal(result.state, 'succeeded');
    assert.equal(result.connectionId, f.current.connectionId);
    assert.equal(result.sessionId, f.current.sessionId);
    assert.equal(result.state, 'succeeded');
    await assert.rejects(lstat(f.profile), { code: 'ENOENT' });
    assert.equal(f.order.filter((value) => value === 'application-exit').length, 1);
    assert.equal(f.order.filter((value) => value === 'upstream-disposed').length, 1);
    assert.equal(f.order.filter((value) => value === 'router-disposed').length, 1);
    assert.ok(f.order.indexOf('application-exit') < f.order.indexOf('upstream-disposing'));
    assert.ok(f.order.indexOf('upstream-disposed') < f.order.indexOf('router-disposed'));
}

test('accepted native Close retains live root ownership after its listener disappears until actual exit and disposal', {
    timeout: 10_000,
}, async (t) => {
    const f = await nativeCloseRuntime(t);
    const id = operationId(await f.close('close-root-alive'));
    await awaitingExit(f, id);
    await retainedLiveRoot(f);
    await assert.rejects(f.invoke(), /busy/);
    assert.equal(f.officialCalls(), 0);
    await completeClose(f, id);
});

test('native root Close receipt cannot finish its operation before independent descendant resources close', {
    timeout: 10_000,
}, async (t) => {
    const f = await nativeCloseRuntime(t);
    const id = operationId(await f.close('close-resource-users'));
    await awaitingExit(f, id);
    f.emitClose();
    f.launchObserverExit(false);
    assert.equal(f.application.exitCode, 0);
    assert.equal(f.application.monitorDisposed, false);
    assert.throws(() => f.runtime.controller.status(f.current.connectionId), /absent|closed/);
    await f.upstreamDisposing;
    f.allowDisposal();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await f.directoryExists(), true);
    assert.equal((await f.operation(id)).state, 'running');
    f.launchResourcesClosed();
    await f.deleted;
    assert.equal((await terminalOperation(f, id)).state, 'succeeded');
    assert.equal(f.application.monitorDisposed, true);
});

test('aborting operation_wait leaves the accepted native Close job and observer running without repost or cancellation', {
    timeout: 10_000,
}, async (t) => {
    const f = await nativeCloseRuntime(t);
    const id = operationId(await f.close('wait-abort-root-alive'));
    const snapshot = await awaitingExit(f, id);
    const abort = new AbortController();
    const reason = new Error('only this protocol wait was aborted');
    const waiting = f.readControl({ action: 'wait', operationId: id, cursor: snapshot.cursor }, abort.signal);
    abort.abort(reason);
    await assert.rejects(waiting, (error: unknown) => error === reason);
    await retainedLiveRoot(f);
    assert.equal((await f.operation(id)).state, 'running');
    assert.equal(f.requests.filter((request) => request.action === 'close').length, 1);
    assert.equal(
        f.requests.some((request) => request.cancel === true),
        false,
    );
    await completeClose(f, id);
});

test('a new Close after operation cancellation reuses the accepted native request while owning a new operation', {
    timeout: 10_000,
}, async (t) => {
    const f = await nativeCloseRuntime(t);
    const cancelledId = operationId(await f.close('cancel-root-alive'));
    await awaitingExit(f, cancelledId);
    await f.readControl({ action: 'cancel', operationId: cancelledId });
    const cancelled = await terminalOperation(f, cancelledId);
    assert.equal(cancelled.state, 'cancelled');
    await retainedLiveRoot(f);
    assert.equal(
        f.operations().some((operation) => operation.state === 'succeeded'),
        false,
    );
    const retryId = operationId(await f.close('retry-root-alive'));
    assert.notEqual(retryId, cancelledId);
    await awaitingExit(f, retryId);
    assert.equal(f.requests.filter((request) => request.action === 'close').length, 1);
    assert.equal(f.helpers.length, 2);
    await retainedLiveRoot(f);
    await completeClose(f, retryId);
    assert.equal((await f.operation(cancelledId)).state, 'cancelled');
});

for (const failure of ['helper-eof', 'wrong-pid', 'wrong-started-at'] as const) {
    test(`native Close ${failure} cannot prove root exit or release the retained observer and directory`, {
        timeout: 10_000,
    }, async (t) => {
        const f = await nativeCloseRuntime(t);
        const id = operationId(await f.close(`invalid-close-${failure}`));
        await awaitingExit(f, id);
        if (failure === 'helper-eof') f.helpers[1]?.child.stdout.emit('end');
        else if (failure === 'wrong-pid') f.emitClose({ processId: 1602 });
        else f.emitClose({ startedAtUtc: '2026-10-12T01:00:01.000Z' });
        const terminal = await terminalOperation(f, id);
        assert.equal(terminal.state, 'failed');
        assert.ok(isRecord(terminal.error));
        assert.notEqual(terminal.error.processExited, true);
        await retainedLiveRoot(f);
        const result = await f.invoke();
        assert.equal(result.isError, true);
        assert.equal(f.officialCalls(), 0);
        assert.equal(
            f.operations().some((operation) => operation.state === 'succeeded'),
            false,
        );
        f.launchObserverExit();
        assert.equal(f.application.exitCode, 0);
        assert.throws(() => f.runtime.controller.status(f.current.connectionId), /absent|closed/);
        await f.upstreamDisposing;
        assert.equal(await f.directoryExists(), true);
        f.allowDisposal();
        await f.deleted;
        assert.equal(f.application.monitorDisposed, true);
        assert.equal(f.order.filter((value) => value === 'application-exit').length, 1);
        assert.equal(f.order.filter((value) => value === 'upstream-disposed').length, 1);
        assert.equal((await f.operation(id)).state, 'failed');
        await assert.rejects(lstat(f.profile), { code: 'ENOENT' });
    });
}
