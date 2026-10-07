import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveChromeProfileArgument } from '../src/domains/chrome-profile.ts';
import { parseDataIsolation } from '../src/domains/data-isolation.ts';

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

test('effective Chrome profile needs one canonical equals switch before the exact terminator', () => {
    assert.equal(
        effectiveChromeProfileArgument(['--user-data-dir=/real path', '--', '--user-data-dir=/ignored'], 'linux'),
        '/real path',
    );
    assert.equal(effectiveChromeProfileArgument(['page', '--user-data-dir=/real'], 'darwin'), '/real');
    assert.equal(effectiveChromeProfileArgument(['--', '--user-data-dir=/ignored'], 'win32'), undefined);
    for (const args of [
        ['--user-data-dir', '/profile'],
        ['--user-data-dir='],
        ['--user-data-dir=/a', '--user-data-dir=/b'],
        ['-user-data-dir=/a'],
        [' --user-data-dir=/a'],
        ['--user-data-dir=/a '],
        ['--user-data-dir=/a', ' -- ', '--user-data-dir=/b'],
    ])
        assert.throws(() => effectiveChromeProfileArgument(args, 'linux'));
});

test('effective Chrome profile enforces native platform case, slash and whitespace semantics', () => {
    for (const token of [
        '--USER-DATA-DIR=/b',
        '/user-data-dir=/b',
        '\u0085--user-data-dir=/b',
        '--user-data-dir=/b\u3000',
    ]) {
        assert.throws(() => effectiveChromeProfileArgument(['--user-data-dir=/a', token], 'win32'));
    }
    assert.equal(
        effectiveChromeProfileArgument(['--user-data-dir=/a', '/user-data-dir=/b', '--USER-DATA-DIR=/b'], 'linux'),
        '/a',
    );
    assert.equal(effectiveChromeProfileArgument(['--user-data-dir=/a', '\u0085--user-data-dir=/b'], 'linux'), '/a');
    assert.throws(() => effectiveChromeProfileArgument(['--user-data-dir=/a', '--single-argument=x'], 'win32'));
});
