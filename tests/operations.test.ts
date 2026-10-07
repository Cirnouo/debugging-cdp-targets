import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperationRegistry } from '../src/application/operations.ts';
import { DetailedError } from '../src/shared/errors.ts';

const entryId = '11111111-1111-4111-8111-111111111111';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('isolation evidence clones input and updates after terminal completion without new events or notices', async () => {
    const registry = createOperationRegistry(entryId);
    let update: (value: { mode: 'data-dir'; path: string; cleanup: 'retain'; state: 'held' | 'retained' }) => void =
        () => {};
    const initial = {
        mode: 'data-dir' as const,
        path: '/private/path',
        cleanup: 'retain' as const,
        state: 'held' as const,
    };
    const accepted = registry.submit('isolation-metadata', { action: 'start' }, async (context) => {
        assert.ok('isolation' in context && typeof context.isolation === 'function');
        update = context.isolation;
        update(initial);
        initial.path = '/mutated/input';
        return { status: 'active' };
    });
    await tick();
    const complete = registry.get(accepted.operationId);
    assert.equal(complete.state, 'succeeded');
    assert.ok('isolation' in complete && typeof complete.isolation === 'object' && complete.isolation !== null);
    assert.equal('path' in complete.isolation && complete.isolation.path, '/private/path');
    assert.equal(registry.takeNotices().length, 1);
    update({ mode: 'data-dir', path: '/private/path', cleanup: 'retain', state: 'retained' });
    const later = registry.get(accepted.operationId);
    assert.equal(later.cursor, complete.cursor);
    assert.equal(later.state, complete.state);
    assert.deepEqual(later.result, complete.result);
    assert.deepEqual(later.error, complete.error);
    assert.deepEqual(registry.takeNotices(), []);
    assert.deepEqual((await registry.wait(accepted.operationId, complete.cursor)).events, []);
    assert.ok('isolation' in later && typeof later.isolation === 'object' && later.isolation !== null);
    assert.equal('state' in later.isolation && later.isolation.state, 'retained');
});

test('acceptance is immediate, duplicate requests share a result and conflicting reuse fails', async () => {
    const registry = createOperationRegistry(entryId);
    let finish: () => void = () => {};
    let calls = 0;
    let jobOperationId: string | undefined;
    const job = async (context: { operationId: string }) => {
        calls += 1;
        jobOperationId = context.operationId;
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        return { value: 'ready' };
    };
    const first = registry.submit(
        'request',
        { isolation: { mode: 'none' }, action: 'start', launch: { env: { SECRET: 'private' } } },
        job,
    );
    assert.equal(first.state, 'accepted');
    const duplicate = registry.submit(
        'request',
        { isolation: { mode: 'none' }, launch: { env: { SECRET: 'private' } }, action: 'start' },
        job,
    );
    assert.equal(duplicate.operationId, first.operationId);
    assert.throws(() => registry.submit('request', { action: 'stop' }, job), /different/);
    await tick();
    assert.equal(calls, 1);
    assert.equal(jobOperationId, first.operationId);
    finish();
    await tick();
    const result = await registry.wait(first.operationId, 0);
    assert.equal(result.operation.state, 'succeeded');
    assert.deepEqual(result.operation.result, { value: 'ready' });
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.deepEqual(await registry.wait(first.operationId, 0), result);
    assert.equal(registry.takeNotices().length, 1);
    assert.equal(registry.takeNotices().length, 0);
});

test('cancelling a wait leaves the operation running and completion remains queryable', async () => {
    const registry = createOperationRegistry(entryId);
    let finish: () => void = () => {};
    const first = registry.submit('one', {}, async () => {
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        return { done: true };
    });
    await tick();
    const cursor = registry.get(first.operationId).cursor;
    const abort = new AbortController();
    const waiting = registry.wait(first.operationId, cursor, abort.signal);
    abort.abort();
    await assert.rejects(waiting, /abort/i);
    assert.equal(registry.get(first.operationId).state, 'running');
    finish();
    await tick();
    assert.equal(registry.get(first.operationId).state, 'succeeded');
});

test('operation cancellation waits for cleanup and never re-executes completed work', async () => {
    const registry = createOperationRegistry(entryId);
    let cleaned = false;
    const first = registry.submit('cancel', {}, async (context) => {
        await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }));
        await tick();
        cleaned = true;
        throw context.signal.reason;
    });
    await tick();
    assert.equal(registry.cancel(first.operationId).state, 'cancelling');
    assert.equal(cleaned, false);
    await tick();
    await tick();
    assert.equal(cleaned, true);
    assert.equal(registry.get(first.operationId).state, 'cancelled');
    assert.equal(registry.cancel(first.operationId).state, 'cancelled');
    const complete = registry.submit('complete', {}, async () => ({ done: true }));
    await tick();
    assert.equal(registry.cancel(complete.operationId).state, 'succeeded');
});

test('cleanup failures preserve route and error evidence instead of claiming cancellation', async () => {
    const registry = createOperationRegistry(entryId);
    const route = {
        connectionId: '22222222-2222-4222-8222-222222222222',
        sessionId: '33333333-3333-4333-8333-333333333333',
    };
    const first = registry.submit('failure', {}, async (context) => {
        context.identity(route);
        await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new Error('Normal close failed');
    });
    await tick();
    registry.cancel(first.operationId);
    await tick();
    const failed = registry.get(first.operationId);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.sessionId, route.sessionId);
    assert.equal(failed.error?.message, 'Normal close failed');
    assert.throws(() => registry.get('44444444-4444-4444-8444-444444444444'), /absent/);
    await assert.rejects(registry.wait(first.operationId, failed.cursor + 1), /cursor/);
});

test('pre-execution cancellation releases reservations and bounded replay reports truncation', async () => {
    const registry = createOperationRegistry(entryId);
    let ran = false;
    let settled = 0;
    const first = registry.submit(
        'early',
        {},
        async () => {
            ran = true;
            return {};
        },
        () => {
            settled++;
        },
    );
    registry.cancel(first.operationId);
    await tick();
    assert.equal(ran, false);
    assert.equal(settled, 1);
    assert.equal(registry.get(first.operationId).state, 'cancelled');
    const many = registry.submit('events', {}, async (context) => {
        for (let index = 0; index < 140; index++) context.phase('launching');
        return {};
    });
    await tick();
    const replay = await registry.wait(many.operationId);
    assert.equal(replay.events.length, 128);
    assert.equal(replay.replayTruncated, true);
});

test('Hook operation notices contain independent completion metadata without result or failure payloads', async () => {
    const registry = createOperationRegistry(entryId);
    const route = {
        connectionId: '22222222-2222-4222-8222-222222222222',
        sessionId: '33333333-3333-4333-8333-333333333333',
    };
    const accepted = registry.submit('notice', { action: 'stop' }, async (context) => {
        context.identity(route);
        context.phase('closing-target');
        const error = new DetailedError('Normal close failed');
        error.details = {
            code: 'NORMAL_CLOSE_FAILED',
            phase: 'send-close',
            category: 'access-denied',
            nativeError: 5,
            exceptionType: 'System.ComponentModel.Win32Exception',
            closeRequested: false,
            processExited: false,
            listenerState: 'missing',
            closeConfirmed: false,
            cause: 'private cause',
            mcpArgs: ['private'],
            diagnostics: [{ secret: 'private' }],
        };
        throw error;
    });
    await tick();
    const [notice] = registry.takeNotices();
    assert.deepEqual(notice, {
        kind: 'operation',
        entryId,
        operationId: accepted.operationId,
        action: 'stop',
        state: 'failed',
        phase: 'send-close',
        elapsedMs: notice?.elapsedMs,
        ...route,
        code: 'NORMAL_CLOSE_FAILED',
        category: 'access-denied',
        nativeError: 5,
        exceptionType: 'System.ComponentModel.Win32Exception',
        closeRequested: false,
        processExited: false,
        listenerState: 'missing',
        closeConfirmed: false,
    });
    assert.equal(JSON.stringify(notice).includes('private'), false);
    const snapshot = registry.get(accepted.operationId);
    assert.equal(snapshot.error?.nativeError, 5);
    assert.equal(snapshot.error?.mcpArgs, undefined);
    assert.equal(snapshot.error?.diagnostics, undefined);
});

test('ordinary failures retain the last active phase in error evidence and the compact Hook notice', async () => {
    const registry = createOperationRegistry(entryId);
    const accepted = registry.submit('sdk-initialization', { action: 'start' }, async (context) => {
        context.phase('starting-official-server');
        throw new Error('private SDK initialization failure');
    });
    await tick();
    const snapshot = registry.get(accepted.operationId);
    assert.equal(snapshot.phase, 'failed');
    assert.equal(snapshot.error?.phase, 'starting-official-server');
    const [notice] = registry.takeNotices();
    assert.equal(notice?.phase, 'starting-official-server');
    assert.equal(JSON.stringify(notice).includes('private'), false);
});

test('an aborted operation cannot succeed from a late result or accept late context events', async () => {
    const registry = createOperationRegistry(entryId);
    let finish: () => void = () => {};
    let latePhase: () => void = () => {};
    const first = registry.submit('late', {}, async (context) => {
        latePhase = () => context.phase('late-private-phase');
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        return { result: 'private' };
    });
    await tick();
    registry.cancel(first.operationId);
    finish();
    await tick();
    const terminal = registry.get(first.operationId);
    assert.equal(terminal.state, 'cancelled');
    assert.equal(terminal.result, undefined);
    latePhase();
    assert.deepEqual(registry.get(first.operationId), terminal);
});

test('25 second wait is a single incomplete wait and never expires its operation', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const registry = createOperationRegistry(entryId);
    let finish: () => void = () => {};
    const first = registry.submit('long-job', {}, async () => {
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        return { done: true };
    });
    await tick();
    const waiting = registry.wait(first.operationId, registry.get(first.operationId).cursor);
    context.mock.timers.tick(25_000);
    const incomplete = await waiting;
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.operation.state, 'running');
    finish();
    await tick();
    assert.equal(registry.get(first.operationId).state, 'succeeded');
});

test('route cancellation isolates the exact session and leaves Close and restart operations running', async () => {
    const registry = createOperationRegistry(entryId);
    const route = {
        connectionId: '22222222-2222-4222-8222-222222222222',
        sessionId: '33333333-3333-4333-8333-333333333333',
    };
    const fresh = { ...route, sessionId: '44444444-4444-4444-8444-444444444444' };
    const release: (() => void)[] = [];
    const submit = (requestId: string, action: string, identity = route) =>
        registry.submit(requestId, { action }, async (context) => {
            context.identity(identity);
            await new Promise<void>((resolve) => {
                release.push(resolve);
            });
            return { done: true };
        });
    const old = submit('old', 'start');
    const next = submit('new', 'start', fresh);
    const close = submit('close', 'stop');
    const restart = submit('restart', 'restart');
    await tick();
    assert.equal(typeof registry.cancelRoute, 'function');
    const cancelled = registry.cancelRoute(route);
    assert.deepEqual(
        cancelled.map((snapshot) => snapshot.operationId),
        [old.operationId],
    );
    assert.equal(registry.get(old.operationId).state, 'cancelling');
    for (const operation of [next, close, restart]) assert.equal(registry.get(operation.operationId).state, 'running');
    for (const finish of release) finish();
    await tick();
    assert.equal(registry.get(old.operationId).state, 'cancelled');
    assert.equal(registry.get(next.operationId).state, 'succeeded');
});

test('markRead acknowledges only terminal snapshots and never suppresses future completion', async () => {
    const registry = createOperationRegistry(entryId);
    let finish: () => void = () => {};
    const first = registry.submit('read', {}, async () => {
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        return { done: true };
    });
    assert.equal(typeof registry.markRead, 'function');
    registry.markRead(first.operationId);
    await tick();
    finish();
    await tick();
    assert.equal(registry.takeNotices().length, 1);
    const second = registry.submit('terminal-read', {}, async () => ({ done: true }));
    await tick();
    registry.markRead(second.operationId);
    assert.deepEqual(registry.takeNotices(), []);
});

test('takeNotices retains terminal notices rejected by the delivery predicate', async () => {
    const registry = createOperationRegistry(entryId);
    const close = registry.submit('pending-exit-cleanup', { action: 'stop' }, async () => ({ done: true }));
    const restart = registry.submit('ready-exit-cleanup', { action: 'restart' }, async () => ({ done: true }));
    const direct = registry.submit('without-action', {}, async () => ({ done: true }));
    await tick();
    assert.deepEqual(
        registry.takeNotices(() => false),
        [],
    );
    assert.deepEqual(
        registry.takeNotices((notice) => notice.action === 'restart').map((notice) => notice.operationId),
        [restart.operationId],
    );
    const remaining = registry.takeNotices();
    assert.deepEqual(
        remaining.map((notice) => notice.operationId),
        [close.operationId, direct.operationId],
    );
    assert.equal(Object.hasOwn(remaining[1] ?? {}, 'action'), false);
    assert.deepEqual(registry.takeNotices(), []);
});
