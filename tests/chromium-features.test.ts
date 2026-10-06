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

const nativeWindowsWhitespace = [
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
    0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];

for (const [label, token, error] of [
    ['terminator', '--', /terminator/i],
    ['feature switch', '--disable-features=CDPScreenshotNewSurface', /feature.*(?:canonical|ambiguous)/i],
    ['single-argument key', '--single-argument', /single-argument/i],
] as const) {
    test(`native Windows whitespace cannot hide an effective ${label}`, () => {
        for (const codePoint of nativeWindowsWhitespace) {
            const whitespace = String.fromCharCode(codePoint);
            for (const option of [`${whitespace}${token}`, `${token}${whitespace}`]) {
                const args = [option];
                Object.freeze(args);
                assert.throws(() => withChromeScreenshotFeature(args), error, `U+${codePoint.toString(16)}`);
                assert.deepEqual(args, [option]);
            }
        }
    });
}

test('FEFF-prefixed positional tokens stay unchanged because Windows Chromium does not trim FEFF', () => {
    const args = [
        '\ufeff--',
        '\ufeff--disable-features=CDPScreenshotNewSurface',
        '\ufeff--single-argument=value',
        '中文',
    ];
    Object.freeze(args);
    const result = withChromeScreenshotFeature(args);
    assert.deepEqual(result, [
        '\ufeff--',
        '\ufeff--disable-features=CDPScreenshotNewSurface',
        '\ufeff--single-argument=value',
        '中文',
        '--enable-features=CDPScreenshotNewSurface',
    ]);
    assert.deepEqual(withChromeScreenshotFeature(result), result);
    assert.deepEqual(args, [
        '\ufeff--',
        '\ufeff--disable-features=CDPScreenshotNewSurface',
        '\ufeff--single-argument=value',
        '中文',
    ]);
});

for (const [label, entry] of [
    ['repeated complete-entry colons', 'Other:one/two:three/four'],
    ['empty dot-stage input', ':value'],
    ['ASCII-trimmed empty dot-stage input', ' \t: value'],
    ['repeated prefix dots', 'Other.Group.More:param/value'],
    ['empty less-than-stage input', '.Group'],
    ['ASCII-trimmed empty less-than-stage input', ' \t.Group:param/value'],
    ['repeated prefix less-than separators', 'Other<Trial<Again.Group:param/value'],
] as const) {
    test(`an unrelated enable entry cannot invalidate the complete list through ${label}`, () => {
        for (const existingTarget of ['', ',CDPScreenshotNewSurface']) {
            const args = [`--enable-features=First,${entry},Last${existingTarget}`];
            Object.freeze(args);
            assert.throws(
                () => withChromeScreenshotFeature(args),
                /enable.*(?:list|entry).*(?:malformed|parse|invalid)/i,
            );
            assert.deepEqual(args, [`--enable-features=First,${entry},Last${existingTarget}`]);
        }
    });
}

test('ordered enable parsing preserves parameter delimiters, blank comma entries and later parameter association input', () => {
    for (const value of [
        ' Other<Trial.Group:key/value.with.dots<allowed<again',
        'Other.Group<allowed<again:param/value',
        'Other<,Another.,Last:param/one/unpaired',
        ', \t ,Other:,\t,',
        '',
    ]) {
        const args = [`--enable-features=${value}`, '--disable-features=Other:one/two:three/four'];
        Object.freeze(args);
        const result = withChromeScreenshotFeature(args);
        assert.deepEqual(result, [
            `--enable-features=${value}${value ? ',' : ''}CDPScreenshotNewSurface`,
            '--disable-features=Other:one/two:three/four',
        ]);
        assert.deepEqual(withChromeScreenshotFeature(result), result);
        assert.deepEqual(args, [`--enable-features=${value}`, '--disable-features=Other:one/two:three/four']);
    }
});

test('native whitespace and malformed-looking feature tokens after exact -- stay positional', () => {
    const tail = nativeWindowsWhitespace.flatMap((codePoint) => {
        const whitespace = String.fromCharCode(codePoint);
        return [
            `${whitespace}--`,
            `${whitespace}--disable-features=CDPScreenshotNewSurface`,
            `${whitespace}--single-argument`,
        ];
    });
    tail.push('--enable-features=:value', '--enable-features=Other:one/two:three/four', '\ufeff--');
    const args = ['--', ...tail];
    Object.freeze(args);
    const result = withChromeScreenshotFeature(args);
    assert.deepEqual(result, ['--enable-features=CDPScreenshotNewSurface', '--', ...tail]);
    assert.deepEqual(withChromeScreenshotFeature(result), result);
    assert.deepEqual(args, ['--', ...tail]);
});
