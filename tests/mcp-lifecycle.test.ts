import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLifecycleService } from '../src/application/mcp-lifecycle.ts';
import type { ConnectionStatus, ControlHandler } from '../src/domains/control-contract.ts';

const entryId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const nextSession = '44444444-4444-4444-8444-444444444444';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
    let current: ConnectionStatus = { entryId, connectionId, sessionId, status: 'active' };
    let starts = 0;
    let closes = 0;
    const operationIds = new Map<string, string | undefined>();
    let release: () => void = () => {};
    const handler: ControlHandler = {
        status: (id) => (id ? { ...current } : { entryId, connections: [current] }),
        start: async (_options, context) => {
            starts++;
            operationIds.set('start', context?.operationId);
            context?.onIdentity?.({ connectionId, sessionId });
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            return { ...current };
        },
        restart: async (_options, context) => {
            operationIds.set('restart', context?.operationId);
            current = { ...current, sessionId: nextSession };
            return { ...current };
        },
        stop: async (_options, context) => {
            closes++;
            operationIds.set('stop', context?.operationId);
            return { ...current, status: 'idle' };
        },
        endTask: async () => ({ ...current }),
    };
    const service = createLifecycleService({ entryId, handler });
    return { service, release: () => release(), counts: () => ({ starts, closes }), operationIds };
}

async function terminalFixture(state: 'succeeded' | 'failed' | 'cancelled') {
    const current: ConnectionStatus = { entryId, connectionId, sessionId, status: 'active' };
    let starts = 0;
    const handler: ControlHandler = {
        status: () => current,
        start: async (_options, context) => {
            starts++;
            if (state === 'failed') throw new Error('launch failed');
            if (state === 'cancelled') {
                await new Promise<void>((resolve) =>
                    context?.signal?.addEventListener('abort', () => resolve(), { once: true }),
                );
                context?.signal?.throwIfAborted();
            }
            return current;
        },
        restart: async () => current,
        stop: async () => current,
        endTask: async () => current,
    };
    const service = createLifecycleService({ entryId, handler });
    const request = {
        action: 'start' as const,
        entryId,
        requestId: `terminal-${state}`,
        launch: { executable: 'fixture' },
    };
    const accepted = await service.control(request);
    if (typeof accepted.operationId !== 'string') throw new Error('Missing operation ID');
    await tick();
    if (state === 'cancelled') await service.control({ action: 'cancel', entryId, operationId: accepted.operationId });
    await tick();
    return { service, request, operationId: accepted.operationId, starts: () => starts };
}

test('MCP dispatch rejects wrong entry, stale new requests and accepts retries of completed requests', async () => {
    const f = fixture();
    const request = { action: 'restart' as const, entryId, connectionId, sessionId, requestId: 'restart' };
    await assert.rejects(f.service.control({ ...request, entryId: nextSession }), /entry/);
    const accepted = await f.service.control(request);
    assert.equal(typeof accepted.operationId, 'string');
    await tick();
    assert.equal(f.operationIds.get('restart'), accepted.operationId);
    assert.equal((await f.service.control(request)).operationId, accepted.operationId);
    await assert.rejects(f.service.control({ ...request, requestId: 'new' }), /stale/);
    assert.equal((await f.service.control({ action: 'status' })).entryId, entryId);
});

test('cancellation after application creation normally closes it before reporting cancelled', async () => {
    const f = fixture();
    const accepted = await f.service.control({
        action: 'start',
        entryId,
        requestId: 'start',
        launch: { executable: 'fixture' },
    });
    assert.equal(typeof accepted.operationId, 'string');
    if (typeof accepted.operationId !== 'string') throw new Error('Missing operation ID');
    await tick();
    assert.equal(f.operationIds.get('start'), accepted.operationId);
    await f.service.control({ action: 'cancel', entryId, operationId: accepted.operationId });
    f.release();
    await tick();
    const status = await f.service.control({ action: 'status', entryId, operationId: accepted.operationId });
    assert.equal(status.state, 'cancelled');
    assert.deepEqual(f.counts(), { starts: 1, closes: 1 });
    assert.equal(f.operationIds.get('stop'), accepted.operationId);
});

test('lifecycle success returns only a connection summary and selected status remains available for details', async () => {
    const detailed: ConnectionStatus = {
        entryId,
        connectionId,
        sessionId,
        status: 'active',
        processId: 42,
        port: 9222,
        enabledToolCount: 1,
        upstreamStatus: 'connected',
        mcpArgs: ['--workspace=private'],
        enabledTools: ['evaluate_script'],
        workspace: { private: true },
        diagnostics: [],
    };
    const handler: ControlHandler = {
        status: () => ({ ...detailed }),
        start: async () => ({ ...detailed }),
        restart: async () => ({ ...detailed }),
        stop: async () => ({ ...detailed }),
        endTask: async () => ({ ...detailed }),
    };
    const service = createLifecycleService({ entryId, handler });
    const accepted = await service.control({
        action: 'end-task',
        entryId,
        connectionId,
        sessionId,
        requestId: 'summary',
    });
    if (typeof accepted.operationId !== 'string') throw new Error('Missing operation ID');
    await tick();
    const complete = await service.control({ action: 'status', entryId, operationId: accepted.operationId });
    assert.deepEqual(complete.result, {
        entryId,
        connectionId,
        sessionId,
        status: 'active',
        processId: 42,
        port: 9222,
        enabledToolCount: 1,
        upstreamStatus: 'connected',
    });
});

test('successfully delivered terminal operation status and wait acknowledge notices even after connection removal', async () => {
    let removed = false;
    const current: ConnectionStatus = { entryId, connectionId, sessionId, status: 'active' };
    const handler: ControlHandler = {
        status: () => {
            if (removed) throw new Error('connection removed');
            return current;
        },
        start: async () => current,
        restart: async () => current,
        stop: async () => {
            removed = true;
            return { ...current, status: 'idle' };
        },
        endTask: async () => current,
    };
    const service = createLifecycleService({ entryId, handler });
    const accepted = await service.control({
        action: 'stop',
        entryId,
        connectionId,
        sessionId,
        disposition: 'Close',
        requestId: 'read-status',
    });
    if (typeof accepted.operationId !== 'string') throw new Error('Missing operation ID');
    await tick();
    const status = await service.control({ action: 'status', entryId, operationId: accepted.operationId });
    assert.equal(status.state, 'succeeded');
    assert.deepEqual(service.takeNotices(), []);
    assert.equal(
        (await service.control({ action: 'wait', entryId, operationId: accepted.operationId })).complete,
        true,
    );
});

test('terminal wait acknowledges once while cancelled and incomplete waits leave future completion notices intact', async () => {
    const f = fixture();
    const accepted = await f.service.control({
        action: 'start',
        entryId,
        requestId: 'read-wait',
        launch: { executable: 'fixture' },
    });
    if (typeof accepted.operationId !== 'string') throw new Error('Missing operation ID');
    await tick();
    const running = await f.service.control({ action: 'status', entryId, operationId: accepted.operationId });
    const abort = new AbortController();
    const waiting = f.service.control(
        { action: 'wait', entryId, operationId: accepted.operationId, cursor: Number(running.cursor) },
        abort.signal,
    );
    abort.abort();
    await assert.rejects(waiting, /abort/i);
    f.release();
    await tick();
    assert.equal(f.service.takeNotices().length, 1);
    const again = fixture();
    const next = await again.service.control({
        action: 'start',
        entryId,
        requestId: 'complete-wait',
        launch: { executable: 'fixture' },
    });
    if (typeof next.operationId !== 'string') throw new Error('Missing operation ID');
    await tick();
    again.release();
    await tick();
    assert.equal(
        (await again.service.control({ action: 'wait', entryId, operationId: next.operationId })).complete,
        true,
    );
    assert.deepEqual(again.service.takeNotices(), []);
});

test('stop forwards its cancellation signal and holds the connection admission gate until cleanup finishes', async () => {
    let closeSignal: AbortSignal | undefined;
    let closeOperationId: string | undefined;
    let finish: () => void = () => {};
    const current: ConnectionStatus = { entryId, connectionId, sessionId, status: 'active' };
    const handler: ControlHandler = {
        status: () => current,
        start: async () => current,
        restart: async () => current,
        endTask: async () => current,
        stop: async (_options, context) => {
            closeSignal = context?.signal;
            closeOperationId = context?.operationId;
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
            return { ...current, status: 'idle' };
        },
    };
    const service = createLifecycleService({ entryId, handler });
    const first = await service.control({
        action: 'stop',
        entryId,
        connectionId,
        sessionId,
        disposition: 'Close',
        requestId: 'close',
    });
    if (typeof first.operationId !== 'string') throw new Error('Missing operation ID');
    await tick();
    assert.equal(closeOperationId, first.operationId);
    await service.control({ action: 'cancel', entryId, operationId: first.operationId });
    assert.equal(closeSignal?.aborted, true);
    await assert.rejects(
        service.control({ action: 'end-task', entryId, connectionId, sessionId, requestId: 'blocked' }),
        /already running/,
    );
    finish();
    await tick();
    assert.equal(
        (await service.control({ action: 'status', entryId, operationId: first.operationId })).state,
        'cancelled',
    );
});

test('cancel of an already terminal operation delivers its snapshot and acknowledges its notice', async () => {
    for (const state of ['succeeded', 'failed', 'cancelled'] as const) {
        const f = await terminalFixture(state);
        const delivered = await f.service.control({ action: 'cancel', entryId, operationId: f.operationId });
        assert.equal(delivered.state, state);
        assert.equal(f.starts(), 1);
        assert.deepEqual(f.service.takeNotices(), []);
    }
});

test('an idempotent retry delivers a terminal snapshot and acknowledges its notice without repeating work', async () => {
    for (const state of ['succeeded', 'failed', 'cancelled'] as const) {
        const f = await terminalFixture(state);
        const delivered = await f.service.control(f.request);
        assert.equal(delivered.operationId, f.operationId);
        assert.equal(delivered.state, state);
        assert.equal(f.starts(), 1);
        assert.deepEqual(f.service.takeNotices(), []);
    }
});

test('aborted terminal cancel and idempotent retry requests leave notices unread', async () => {
    for (const path of ['cancel', 'retry'] as const) {
        const f = await terminalFixture('succeeded');
        const abort = new AbortController();
        abort.abort();
        await assert.rejects(
            f.service.control(
                path === 'cancel' ? { action: 'cancel', entryId, operationId: f.operationId } : f.request,
                abort.signal,
            ),
            /abort/i,
        );
        assert.deepEqual(
            f.service.takeNotices().map((notice) => notice.operationId),
            [f.operationId],
        );
    }
});

test('running retries and cancelling snapshots never acknowledge future completion notices', async () => {
    for (const path of ['cancel', 'retry'] as const) {
        const f = fixture();
        const request = {
            action: 'start' as const,
            entryId,
            requestId: `pending-${path}`,
            launch: { executable: 'fixture' },
        };
        const accepted = await f.service.control(request);
        if (typeof accepted.operationId !== 'string') throw new Error('Missing operation ID');
        await tick();
        const pending = await f.service.control(
            path === 'cancel' ? { action: 'cancel', entryId, operationId: accepted.operationId } : request,
        );
        assert.equal(pending.state, path === 'cancel' ? 'cancelling' : 'running');
        f.release();
        await tick();
        const [notice] = f.service.takeNotices();
        assert.equal(notice?.operationId, accepted.operationId);
        assert.equal(notice?.state, path === 'cancel' ? 'cancelled' : 'succeeded');
    }
});
