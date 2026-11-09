import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as management from '../../../src/desktop/renderer/elapsed.ts';

test('elapsed clocks retain hours above 24, clamp future timestamps and show unavailable evidence', () => {
    const format: unknown = Reflect.get(management, 'formatAppElapsed');
    assert.equal(typeof format, 'function', 'elapsed clock formatter is available');
    if (typeof format !== 'function') return;
    assert.equal(format(0, 90_061_000), '25:01:01');
    assert.equal(format(10_000, 1_000), '00:00:00');
    for (const timestamp of [undefined, null, NaN, Infinity, -1]) assert.equal(format(timestamp, 1000), 'Unavailable');
});
