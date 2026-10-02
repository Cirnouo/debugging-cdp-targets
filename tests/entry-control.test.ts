import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createControlServer, recoverStaleEndpoint, sendControlRequest } from '../src/adapters/control-ipc.ts';
import { type ControlHandler, parseControlRequest, parseControlResponse } from '../src/domains/control-contract.ts';
import { parseControlArguments } from '../src/interface/control-arguments.ts';

const entryId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

test('Unix recovery removes only an unchanged owned refused socket', async () => {
    let removed = 0;
    const identity = { uid: 123, ino: 4, dev: 5, ctimeMs: 6, isSocket: () => true };
    const io = {
        platform: 'linux',
        uid: 123,
        inspect: async () => identity,
        probe: async () => 'refused',
        remove: async () => {
            removed++;
        },
    };
    await recoverStaleEndpoint('entry.sock', io);
    assert.equal(removed, 1);
    await assert.rejects(recoverStaleEndpoint('entry.sock', { ...io, uid: 999 }));
    await assert.rejects(recoverStaleEndpoint('entry.sock', { ...io, probe: async () => 'live' }));
    let inspections = 0;
    await assert.rejects(
        recoverStaleEndpoint('entry.sock', {
            ...io,
            inspect: async () => ({ ...identity, ino: inspections++ === 0 ? 4 : 7 }),
        }),
    );
    assert.equal(removed, 1);
});

test('entry requests require canonical IDs and reject obsolete and extraneous fields', () => {
    assert.deepEqual(parseControlRequest({ action: 'status', entryId }), { action: 'status', entryId });
    for (const request of [
        { action: 'status' },
        { action: 'status', entryId: entryId.toUpperCase().replace('1111', 'ABCD') },
        { action: 'switch', entryId },
        { action: 'status', entryId, sessionId },
        { action: 'restart', entryId },
        { action: 'start', entryId, launchCommand: 'target', exactPort: 9000 },
        { action: 'stop', entryId, sessionId, disposition: 'Close', launchCommand: 'target' },
    ])
        assert.throws(() => parseControlRequest(request));
    assert.deepEqual(parseControlRequest({ action: 'end-task', entryId, sessionId }), {
        action: 'end-task',
        entryId,
        sessionId,
    });
});

test('CLI requires explicit entry and session options and disallows duplicates or aliases', () => {
    assert.deepEqual(parseControlArguments(['status', '--entry-id', entryId]), { action: 'status', entryId });
    assert.deepEqual(parseControlArguments(['restart', '--entry-id', entryId, '--session-id', sessionId]), {
        action: 'restart',
        entryId,
        sessionId,
    });
    for (const args of [
        ['status'],
        ['switch', '--entry-id', entryId],
        ['restart', '--entry-id', entryId],
        ['status', '--entry-id', entryId, '--entry-id', entryId],
        ['status', '--entry-id', entryId, '--base-port', '9222'],
    ])
        assert.throws(() => parseControlArguments(args));
});

test('response validates complete target identity and unknown fields', () => {
    const result = { entryId, status: 'active', sessionId, port: 9222, processId: 12, targetKind: 'chrome' };
    assert.deepEqual(parseControlResponse({ ok: true, result }), { ok: true, result });
    assert.throws(() => parseControlResponse({ ok: true, result: { ...result, port: 0 } }));
    assert.throws(() => parseControlResponse({ ok: true, result: { ...result, surprise: true } }));
    assert.throws(() => parseControlResponse({ ok: false, error: 'failure', surprise: true }));
    assert.deepEqual(parseControlResponse({ ok: false, error: 'failure', details: { reason: 'normal-close' } }), {
        ok: false,
        error: 'failure',
        details: { reason: 'normal-close' },
    });
});

test('simultaneous IPC entries stay independent and reject wrong entry before dispatch', async () => {
    const secondId = randomUUID();
    let calls = 0;
    const handler = (id: string): ControlHandler => ({
        status: () => ({ entryId: id, status: 'idle' }),
        start: async () => {
            calls++;
            return { entryId: id, status: 'idle' };
        },
        restart: async () => ({ entryId: id, status: 'idle' }),
        stop: async () => ({ entryId: id, status: 'idle' }),
        endTask: async () => ({ entryId: id, status: 'idle' }),
    });
    const first = await createControlServer({ entryId, controller: handler(entryId) });
    const second = await createControlServer({ entryId: secondId, controller: handler(secondId) });
    try {
        assert.notEqual(first.endpoint, second.endpoint);
        assert.deepEqual(await sendControlRequest(first.endpoint, { action: 'status', entryId }), {
            ok: true,
            result: { entryId, status: 'idle' },
        });
        assert.deepEqual(await sendControlRequest(second.endpoint, { action: 'status', entryId: secondId }), {
            ok: true,
            result: { entryId: secondId, status: 'idle' },
        });
        const wrong = await sendControlRequest(first.endpoint, {
            action: 'start',
            entryId: secondId,
            launchCommand: 'target',
        });
        assert.equal(wrong.ok, false);
        assert.equal(calls, 0);
    } finally {
        await first.close();
        await second.close();
    }
});
