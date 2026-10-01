import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contract from '../src/domains/control-contract.ts';

test('IPC boundary accepts validated commands and rejects malformed external values', () => {
    assert.equal(typeof contract.parseControlRequest, 'function');
    const { parseControlRequest, parseControlResponse } = contract;
    assert.deepEqual(parseControlRequest({ action: 'status' }), { action: 'status' });
    assert.deepEqual(parseControlRequest({ action: 'start', launchCommand: 'app' }), {
        action: 'start',
        launchCommand: 'app',
    });
    for (const value of [
        null,
        [],
        { action: 'invoke' },
        { action: 'stop', disposition: 'Kill' },
        { action: 'start', launchCommand: 123 },
        { action: 'start', launchCommand: 'app', basePort: '9222' },
    ]) {
        assert.throws(() => parseControlRequest(value));
    }
    assert.deepEqual(parseControlResponse({ ok: true, result: { status: 'none' } }), {
        ok: true,
        result: { status: 'none' },
    });
    for (const value of [null, { ok: true, result: {} }, { ok: false, error: 1 }])
        assert.throws(() => parseControlResponse(value));
});
