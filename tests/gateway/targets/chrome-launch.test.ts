import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyChromePreset } from '../../../src/adapters/target-host.ts';
import { createTargetHostFixture } from '../../fixtures/target-host.ts';

test('Chrome none never inserts an implicit data directory', () => {
    assert.ok(!applyChromePreset([]).some((argument) => argument.startsWith('--user-data-dir')));
});

test('Chrome preserves an explicit canonical directory argument without mutating the input', () => {
    const args = ['--user-data-dir=chosen profile'];
    assert.deepEqual(applyChromePreset(args).slice(0, 1), args);
    for (const invalid of [['--user-data-dir'], ['--user-data-dir='], ['--user-data-dir=a', '--user-data-dir=b']])
        assert.throws(() => applyChromePreset(invalid), /profile|user-data-dir/i);
});

test('Chrome launch disables updater scheduling and preserves the switch during exact recovery', async () => {
    const f = createTargetHostFixture();
    const directory = path.join(os.tmpdir(), 'dct-updater-preset-fixture');
    try {
        const target = await f.launch(directory);
        assert.equal(f.launchedArguments[0]?.filter((value) => value === '--disable-updater-scheduler').length, 1);
        assert.ok(target.launchDefinition);
        assert.equal(await f.host.close(target), true);
        await f.host.launch({
            isolation: { mode: 'none' },
            targetKind: 'chrome',
            launch: { executable: '' },
            exactPort: target.port,
            launchDefinition: target.launchDefinition,
        });
        assert.deepEqual(f.launchedArguments[1], f.launchedArguments[0]);
    } finally {
        f.finish();
    }
});

test('Chrome preset preserves an explicit updater scheduler switch without mutating caller arguments', () => {
    const arguments_ = ['--user-data-dir=chosen profile', '--disable-updater-scheduler'];
    const result = applyChromePreset(arguments_);
    assert.equal(result.filter((value) => value === '--disable-updater-scheduler').length, 1);
    assert.deepEqual(arguments_, ['--user-data-dir=chosen profile', '--disable-updater-scheduler']);
    assert.deepEqual(applyChromePreset(result), result);
});

test('Windows Chrome spawns the fixed screenshot feature and preserves exact recovery argv', {
    skip: process.platform !== 'win32',
}, async () => {
    const f = createTargetHostFixture();
    const directory = path.join(os.tmpdir(), 'dct-screenshot-preset-fixture');
    const launch = {
        executable: process.execPath,
        args: [
            `--user-data-dir=${directory}`,
            '--remote-debugging-port={port}',
            '--enable-features=Other:param/value',
            '--disable-features=Unrelated',
            '--label=中文',
        ],
    };
    try {
        const target = await f.host.launch({ isolation: { mode: 'none' }, targetKind: 'chrome', launch });
        assert.ok(f.launchedArguments[0]?.includes('--enable-features=Other:param/value,CDPScreenshotNewSurface'));
        assert.ok(f.launchedArguments[0]?.includes('--disable-features=Unrelated'));
        assert.ok(f.launchedArguments[0]?.includes('--label=中文'));
        assert.equal(launch.args[2], '--enable-features=Other:param/value');
        assert.ok(target.launchDefinition);
        await f.host.close(target);
        await f.host.launch({
            isolation: { mode: 'none' },
            targetKind: 'chrome',
            launch: { executable: '' },
            exactPort: target.port,
            launchDefinition: target.launchDefinition,
        });
        assert.deepEqual(f.launchedArguments[1], f.launchedArguments[0]);
    } finally {
        f.finish();
    }
});

test('Windows Chrome feature conflicts fail before profile acquisition and spawn and release the claimed port', {
    skip: process.platform !== 'win32',
}, async () => {
    const f = createTargetHostFixture();
    const directory = path.join(os.tmpdir(), 'dct-screenshot-conflict-fixture');
    try {
        await assert.rejects(
            f.host.launch({
                isolation: { mode: 'none' },
                targetKind: 'chrome',
                basePort: 20222,
                launch: {
                    executable: process.execPath,
                    args: [`--user-data-dir=${directory}`, '--disable-features=CDPScreenshotNewSurface'],
                },
            }),
            /CDPScreenshotNewSurface.*(disable|conflict)/i,
        );
        assert.deepEqual(f.inspected, []);
        assert.deepEqual(f.launchedArguments, []);
        const target = await f.host.launch({
            isolation: { mode: 'none' },
            targetKind: 'chrome',
            basePort: 20222,
            launch: { executable: process.execPath, args: [`--user-data-dir=${directory}`] },
        });
        assert.equal(target.port, 20222, 'The rejected launch leaked its transient port claim.');
        assert.equal(f.inspected.length, 1);
        await f.host.close(target);
    } finally {
        f.finish();
    }
});

test('generic CDP launch preserves caller feature choices without applying the Chrome preset', async () => {
    const f = createTargetHostFixture();
    const args = ['--remote-debugging-port={port}', '--disable-features=CDPScreenshotNewSurface', '--label=中文'];
    try {
        const target = await f.host.launch({
            isolation: { mode: 'none' },
            targetKind: 'generic-cdp',
            basePort: 20222,
            launch: { executable: process.execPath, args },
        });
        assert.deepEqual(f.launchedArguments[0], [
            '--remote-debugging-port=20222',
            '--disable-features=CDPScreenshotNewSurface',
            '--label=中文',
        ]);
        assert.deepEqual(f.inspected, []);
        await f.host.close(target);
    } finally {
        f.finish();
    }
});

for (const [label, option] of [
    ['native NEL terminator', '\u0085--'],
    ['native NEL target disable', '\u0085--disable-features=CDPScreenshotNewSurface'],
    ['native NEL single-argument key', '\u0085--single-argument=value'],
    ['repeated complete-entry colons', '--enable-features=Other:one/two:three/four'],
    ['empty dot-stage input', '--enable-features=:value'],
    ['repeated prefix dots', '--enable-features=Other.Group.More:param/value'],
    ['empty less-than-stage input', '--enable-features=.Group'],
    ['repeated prefix less-than separators', '--enable-features=Other<Trial<Again.Group:param/value'],
] as const) {
    test(`Windows Chrome rejects ${label} before profile/spawn and releases the claimed port`, {
        skip: process.platform !== 'win32',
    }, async () => {
        const f = createTargetHostFixture();
        const directory = path.join(os.tmpdir(), 'dct-effective-feature-conflict-fixture');
        try {
            await assert.rejects(
                f.host.launch({
                    isolation: { mode: 'none' },
                    targetKind: 'chrome',
                    basePort: 20222,
                    launch: { executable: process.execPath, args: [`--user-data-dir=${directory}`, option] },
                }),
                /terminator|single-argument|feature.*(?:ambiguous|malformed|parse|invalid)/i,
            );
            assert.equal(f.inspected.length, 0);
            assert.equal(f.launchedArguments.length, 0);
            const target = await f.host.launch({
                isolation: { mode: 'none' },
                targetKind: 'chrome',
                basePort: 20222,
                launch: { executable: process.execPath, args: [`--user-data-dir=${directory}`] },
            });
            assert.equal(target.port, 20222, 'The rejected effective-feature input leaked its transient port.');
            assert.equal(f.inspected.length, 1);
            assert.ok(f.launchedArguments[0]?.includes('--enable-features=CDPScreenshotNewSurface'));
            await f.host.close(target);
        } finally {
            f.finish();
        }
    });
}

test('Windows Chrome preserves FEFF positional args and legal parameter delimiters during exact recovery', {
    skip: process.platform !== 'win32',
}, async () => {
    const f = createTargetHostFixture();
    const directory = path.join(os.tmpdir(), 'dct-feature-feff-fixture');
    const args = [
        `--user-data-dir=${directory}`,
        '--remote-debugging-port={port}',
        '--enable-features=Other<Trial.Group:key/value.with.dots<allowed<again,Last:param/one/unpaired',
        '\ufeff--',
        '\ufeff--disable-features=CDPScreenshotNewSurface',
        '\ufeff--single-argument=value',
        '--',
        '\u0085--',
        '--enable-features=:value',
    ];
    try {
        const target = await f.host.launch({
            isolation: { mode: 'none' },
            targetKind: 'chrome',
            basePort: 20222,
            launch: { executable: process.execPath, args },
        });
        assert.deepEqual(f.launchedArguments[0]?.slice(0, args.length), [
            `--user-data-dir=${directory}`,
            '--remote-debugging-port=20222',
            '--enable-features=Other<Trial.Group:key/value.with.dots<allowed<again,Last:param/one/unpaired,CDPScreenshotNewSurface',
            '\ufeff--',
            '\ufeff--disable-features=CDPScreenshotNewSurface',
            '\ufeff--single-argument=value',
            '--',
            '\u0085--',
            '--enable-features=:value',
        ]);
        assert.ok(target.launchDefinition);
        await f.host.close(target);
        await f.host.launch({
            isolation: { mode: 'none' },
            targetKind: 'chrome',
            launch: { executable: '' },
            exactPort: target.port,
            launchDefinition: target.launchDefinition,
        });
        assert.deepEqual(f.launchedArguments[1], f.launchedArguments[0]);
    } finally {
        f.finish();
    }
});

const preset = [
    '--user-data-dir=feature-fixture',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-updater-scheduler',
];

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
