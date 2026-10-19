import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDataIsolation } from '../../../src/gateway/targets/model/isolation.ts';

test('isolation parser preserves explicit selection and cleanup without filesystem guesses', () => {
    for (const value of [
        { mode: 'none' },
        { mode: 'data-dir', directory: { kind: 'existing', path: '/profiles/中文 $&' }, cleanup: 'retain' },
        { mode: 'data-dir', directory: { kind: 'new', parent: 'C:/data' }, cleanup: 'delete-on-release' },
        {
            mode: 'data-dir',
            directory: { kind: 'new', parent: '/data', name: '中文 %NAME% {dataDir}' },
            cleanup: 'retain',
        },
    ]) {
        assert.deepEqual(parseDataIsolation(value), value);
    }
});

test('isolation parser rejects absent cleanup, mixed selection and unsafe leaves', () => {
    for (const value of [
        undefined,
        null,
        {},
        { mode: 'none', cleanup: 'retain' },
        { mode: 'none', directory: {} },
        { mode: 'data-dir', directory: { kind: 'existing', path: '/p' } },
        { mode: 'data-dir', directory: { kind: 'existing', path: '/p', parent: '/p' }, cleanup: 'retain' },
        { mode: 'data-dir', directory: { kind: 'new', parent: '/p', path: '/p' }, cleanup: 'retain' },
        { mode: 'data-dir', directory: { kind: 'existing', path: ' \0 ' }, cleanup: 'retain' },
        { mode: 'data-dir', directory: { kind: 'existing', path: '/p' }, cleanup: 'remove' },
        { mode: 'data-dir', directory: { kind: 'existing', path: '/p' }, cleanup: 'retain', extra: 1 },
        ...['', ' ', '.', '..', 'a/b', 'a\\b', 'a:b', 'bad\0'].map((name) => ({
            mode: 'data-dir',
            directory: { kind: 'new', parent: '/p', name },
            cleanup: 'retain',
        })),
    ])
        assert.throws(() => parseDataIsolation(value));
});
