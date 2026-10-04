import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

async function host() {
    assert.ok(
        existsSync(new URL('./smoke/chrome-host.ts', import.meta.url)),
        'A cross-platform Chrome smoke host is required.',
    );
    return import('./smoke/chrome-host.ts');
}

test('portable Chrome smoke requires an explicit absolute executable without fallback', async () => {
    const { resolveChromeSmokeExecutable } = await host();
    for (const platform of ['linux', 'darwin'] as const) {
        assert.throws(() => resolveChromeSmokeExecutable(platform, {}), /DCT_SMOKE_CHROME_EXECUTABLE/);
        for (const executable of ['', 'chrome', './chrome', '/chrome\0.exe']) {
            assert.throws(
                () => resolveChromeSmokeExecutable(platform, { DCT_SMOKE_CHROME_EXECUTABLE: executable }),
                /absolute|NUL|empty/,
            );
        }
    }
    for (const [platform, executable] of [
        ['linux', '/opt/google/chrome/chrome'],
        ['darwin', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    ] as const) {
        assert.equal(resolveChromeSmokeExecutable(platform, { DCT_SMOKE_CHROME_EXECUTABLE: executable }), executable);
    }
});

test('Windows keeps its Chrome default but rejects root-relative overrides and unsupported hosts', async () => {
    const { resolveChromeSmokeExecutable } = await host();
    assert.equal(resolveChromeSmokeExecutable('win32', {}), 'C:/Program Files/Google/Chrome/Application/chrome.exe');
    assert.equal(
        resolveChromeSmokeExecutable('win32', { DCT_SMOKE_CHROME_EXECUTABLE: 'D:/Chrome/chrome.exe' }),
        'D:/Chrome/chrome.exe',
    );
    assert.throws(
        () => resolveChromeSmokeExecutable('win32', { DCT_SMOKE_CHROME_EXECUTABLE: '/chrome.exe' }),
        /absolute/,
    );
    assert.throws(() => resolveChromeSmokeExecutable('freebsd', {}), /Unsupported/);
});

test('Chrome smoke launch preserves literal paths and isolates its temporary profile', async () => {
    const { createChromeSmokeLaunch } = await host();
    const launch = createChromeSmokeLaunch(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/tmp/test profile',
        'data:text/html,<title>LOCAL</title>',
        'darwin',
    );
    assert.deepEqual(launch, {
        executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: [
            '--no-first-run',
            '--disable-background-networking',
            '--disable-background-mode',
            '--user-data-dir=/tmp/test profile',
            '--remote-debugging-port={port}',
            'data:text/html,<title>LOCAL</title>',
        ],
    });
    assert.throws(() => createChromeSmokeLaunch('/chrome', 'relative-profile', 'data:text/html,', 'linux'), /absolute/);
});

test('Chrome smoke records the owned browser version and fails unsupported products or versions', async () => {
    const { chromeSmokeVersion } = await host();
    assert.equal(chromeSmokeVersion({ Browser: 'Chrome/154.0.8037.93' }), '154.0.8037.93');
    for (const endpoint of [
        { Browser: 'Chrome/148.0.0.0' },
        { Browser: 'HeadlessChrome/154.0.0.0' },
        { Browser: 'Electron/45.0.0.0' },
        { Browser: 'Chrome/154' },
        {},
        null,
    ]) {
        assert.throws(() => chromeSmokeVersion(endpoint), /Chrome|version/);
    }
});
