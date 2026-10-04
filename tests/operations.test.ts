import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperationRegistry } from '../src/application/operations.ts';

const entryId = '11111111-1111-4111-8111-111111111111';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('acceptance is immediate, duplicate requests share a result and conflicting reuse fails', async () => {
    const registry = createOperationRegistry(entryId);
    let finish: () => void = () => {};
    let calls = 0;
    const job = async () => {
        calls += 1;
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        return { value: 'ready' };
    };
    const first = registry.submit('request', { action: 'start', launch: { env: { SECRET: 'private' } } }, job);
    assert.equal(first.state, 'accepted');
    const duplicate = registry.submit('request', { launch: { env: { SECRET: 'private' } }, action: 'start' }, job);
    assert.equal(duplicate.operationId, first.operationId);
    assert.throws(() => registry.submit('request', { action: 'stop' }, job), /different/);
    await tick();
    assert.equal(calls, 1);
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
