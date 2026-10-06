import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyChromePreset } from '../src/adapters/target-host.ts';
import { withChromeScreenshotFeature } from '../src/domains/chromium-features.ts';

const preset = [
    '--user-data-dir=feature-fixture',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-updater-scheduler',
];

test('Windows Chrome adds the bare screenshot feature before an exact positional boundary', () => {
    const args = [...preset, '--label=中文', '--', '--disable-features=CDPScreenshotNewSurface', ' -- '];
    Object.freeze(args);
    const result = withChromeScreenshotFeature(args);
    assert.deepEqual(result, [
        ...preset,
        '--label=中文',
        '--enable-features=CDPScreenshotNewSurface',
        '--',
        '--disable-features=CDPScreenshotNewSurface',
        ' -- ',
    ]);
    assert.deepEqual(withChromeScreenshotFeature(result), result);
    assert.deepEqual(args, [...preset, '--label=中文', '--', '--disable-features=CDPScreenshotNewSurface', ' -- ']);
});

test('Windows Chrome preserves unrelated ASCII feature parameters and differently cased names', () => {
    assert.deepEqual(
        withChromeScreenshotFeature([
            ...preset,
            '--enable-features= Other<Trial.Group:key/value,cdpscreenshotnewsurface,,Another:param/a=b',
            '--disable-features=OtherDisabled<Trial, SecondDisabled',
            '--label=中文',
        ]),
        [
            ...preset,
            '--enable-features= Other<Trial.Group:key/value,cdpscreenshotnewsurface,,Another:param/a=b,CDPScreenshotNewSurface',
            '--disable-features=OtherDisabled<Trial, SecondDisabled',
            '--label=中文',
        ],
    );
});

test('Windows Chrome keeps one existing bare screenshot feature immutably and idempotently', () => {
    const args = [...preset, '--enable-features=Other:param/value,CDPScreenshotNewSurface,Last'];
    Object.freeze(args);
    const result = withChromeScreenshotFeature(args);
    assert.deepEqual(result, [...preset, '--enable-features=Other:param/value,CDPScreenshotNewSurface,Last']);
    assert.notEqual(result, args);
    assert.deepEqual(withChromeScreenshotFeature(result), result);
    assert.deepEqual(args, [...preset, '--enable-features=Other:param/value,CDPScreenshotNewSurface,Last']);
});

test('Windows Chrome rejects target feature decorations and explicit disable without replacing caller choice', () => {
    for (const entry of [
        ' CDPScreenshotNewSurface',
        'CDPScreenshotNewSurface ',
        'CDPScreenshotNewSurface:mode/value',
        'CDPScreenshotNewSurface :mode/value',
        'CDPScreenshotNewSurface<Trial',
        'CDPScreenshotNewSurface <Trial',
        'CDPScreenshotNewSurface.Group',
        'CDPScreenshotNewSurface .Group',
        '*CDPScreenshotNewSurface',
        '*CDPScreenshotNewSurface :mode/value',
        'CDPScreenshotNewSurface,CDPScreenshotNewSurface',
    ]) {
        const args = [...preset, `--enable-features=Other,${entry},Last`];
        const original = [...args];
        assert.throws(
            () => withChromeScreenshotFeature(args),
            /CDPScreenshotNewSurface.*(bare|duplicate|conflict)/i,
            entry,
        );
        assert.deepEqual(args, original);
    }
    for (const entry of ['CDPScreenshotNewSurface', ' CDPScreenshotNewSurface <Trial', '*CDPScreenshotNewSurface']) {
        assert.throws(
            () => withChromeScreenshotFeature([...preset, `--disable-features=Other,${entry}`]),
            /CDPScreenshotNewSurface.*(disable|conflict)/i,
        );
    }
});

test('Windows Chrome rejects ambiguous effective feature switches before composing a feature', () => {
    for (const options of [
        ['--enable-features=Other', '--enable-features=Last'],
        ['--disable-features=Other', '--disable-features=Last'],
        ['--enable-features', 'Other'],
        ['--disable-features', 'Other'],
        ['/enable-features=Other'],
        ['-disable-features=Other'],
        ['--ENABLE-FEATURES=Other'],
        ['--Disable-Features=Other'],
        [' --enable-features=Other'],
        ['--enable-features=Other '],
        ['--enable-features:Other'],
        ['--enable-features =Other'],
        ['-- enable-features=Other'],
    ]) {
        assert.throws(
            () => withChromeScreenshotFeature([...preset, ...options]),
            /feature.*(canonical|ambiguous|duplicate)/i,
        );
    }
});

test('Windows Chrome rejects trimmed terminators and single-argument parsing before the exact boundary', () => {
    for (const option of [
        ' -- ',
        '\t--',
        '--single-argument',
        '--single-argument=remaining text',
        '-single-argument',
        '/single-argument=remaining text',
        '--SINGLE-ARGUMENT',
        ' --single-argument=remaining text ',
        '--single-argument:remaining text',
    ]) {
        assert.throws(() => withChromeScreenshotFeature([...preset, option]), /terminator|single-argument/i, option);
    }
    assert.deepEqual(withChromeScreenshotFeature([...preset, '--', '--single-argument', '--enable-features=中文']), [
        ...preset,
        '--enable-features=CDPScreenshotNewSurface',
        '--',
        '--single-argument',
        '--enable-features=中文',
    ]);
});

test('Windows Chrome refuses non-ASCII feature values but preserves Unicode outside feature switches', () => {
    for (const option of ['--enable-features=Other:param/中文', '--disable-features=Other,param/é']) {
        assert.throws(() => withChromeScreenshotFeature([...preset, option]), /ASCII.*feature|feature.*ASCII/i);
    }
    assert.deepEqual(withChromeScreenshotFeature([...preset, '--label=中文', '文档.html']), [
        ...preset,
        '--label=中文',
        '文档.html',
        '--enable-features=CDPScreenshotNewSurface',
    ]);
});

test('non-Windows Chrome keeps existing feature choices outside the Windows compatibility rule', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    assert.ok(original);
    try {
        for (const platform of ['linux', 'darwin']) {
            Object.defineProperty(process, 'platform', { value: platform });
            const args = [...preset, '--disable-features=CDPScreenshotNewSurface', '--label=中文'];
            assert.deepEqual(applyChromePreset(args), args);
        }
    } finally {
        Object.defineProperty(process, 'platform', original);
    }
});
