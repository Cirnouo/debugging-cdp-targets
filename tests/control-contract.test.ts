import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contract from '../src/domains/control-contract.ts';

test('IPC boundary accepts validated commands and rejects malformed external values', () => {
    assert.equal(typeof contract.parseControlRequest, 'function');
    const { parseControlRequest, parseControlResponse } = contract;
    const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    assert.deepEqual(parseControlRequest({ action: 'status', entryId }), { action: 'status', entryId });
    assert.deepEqual(parseControlRequest({ action: 'start', entryId, launchCommand: 'app' }), {
        action: 'start',
        entryId,
        launchCommand: 'app',
    });
    for (const value of [
        null,
        [],
        { action: 'status' },
        { action: 'invoke', entryId },
        { action: 'stop', entryId, sessionId, disposition: 'Kill' },
        { action: 'start', entryId, launchCommand: 123 },
        { action: 'start', entryId, launchCommand: 'app', basePort: '9222' },
    ]) {
        assert.throws(() => parseControlRequest(value));
    }
    assert.deepEqual(parseControlResponse({ ok: true, result: { entryId, status: 'idle' } }), {
        ok: true,
        result: { entryId, status: 'idle' },
    });
    for (const value of [null, { ok: true, result: {} }, { ok: false, error: 1 }])
        assert.throws(() => parseControlResponse(value));
});
