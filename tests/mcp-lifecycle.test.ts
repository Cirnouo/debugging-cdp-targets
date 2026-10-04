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
    let release: () => void = () => {};
    const handler: ControlHandler = {
        status: (id) => (id ? { ...current } : { entryId, connections: [current] }),
        start: async (_options, context) => {
            starts++;
            context?.onIdentity?.({ connectionId, sessionId });
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            return { ...current };
        },
        restart: async () => {
            current = { ...current, sessionId: nextSession };
            return { ...current };
        },
        stop: async () => {
            closes++;
            return { ...current, status: 'idle' };
        },
        endTask: async () => ({ ...current }),
    };
    const service = createLifecycleService({ entryId, handler });
    return { service, release: () => release(), counts: () => ({ starts, closes }) };
}

test('MCP dispatch rejects wrong entry, stale new requests and accepts retries of completed requests', async () => {
    const f = fixture();
    const request = { action: 'restart' as const, entryId, connectionId, sessionId, requestId: 'restart' };
    await assert.rejects(f.service.control({ ...request, entryId: nextSession }), /entry/);
    const accepted = await f.service.control(request);
    assert.equal(typeof accepted.operationId, 'string');
    await tick();
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
    await f.service.control({ action: 'cancel', entryId, operationId: accepted.operationId });
    f.release();
    await tick();
    const status = await f.service.control({ action: 'status', entryId, operationId: accepted.operationId });
    assert.equal(status.state, 'cancelled');
    assert.deepEqual(f.counts(), { starts: 1, closes: 1 });
});
