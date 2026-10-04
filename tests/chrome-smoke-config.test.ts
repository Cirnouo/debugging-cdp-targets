import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import type { ControlRequest, ControlResult } from '../src/domains/control-contract.ts';
import { closeSmokeConnection } from './smoke/lifecycle-client.ts';

test('an explicit smoke Close waits for busy CDP without changing target identity', async () => {
    const request = {
        action: 'stop' as const,
        entryId: randomUUID(),
        connectionId: randomUUID(),
        sessionId: randomUUID(),
        requestId: randomUUID(),
        disposition: 'Close' as const,
    };
    const calls: ControlRequest[] = [];
    let clock = 0;
    const result: ControlResult = { entryId: request.entryId, connectionId: request.connectionId, status: 'idle' };
    assert.equal(
        await closeSmokeConnection(
            async (next) => {
                calls.push(next);
                if (calls.length === 1) throw new Error('CDP is busy; retry after the current request completes.');
                return result;
            },
            request,
            {
                now: () => clock,
                sleep: async (ms) => {
                    clock += ms;
                },
            },
        ),
        result,
    );
    assert.equal(calls.length, 2);
    const first = calls[0];
    const second = calls[1];
    assert.ok(first && second && 'requestId' in first && 'requestId' in second);
    assert.notEqual(first.requestId, second.requestId);
    for (const call of calls) {
        assert.deepEqual({ ...call, requestId: request.requestId }, request);
    }
});

test('smoke Close bounds busy waiting and never retries other failures', async () => {
    const request = {
        action: 'stop' as const,
        entryId: randomUUID(),
        connectionId: randomUUID(),
        sessionId: randomUUID(),
        requestId: randomUUID(),
        disposition: 'Close' as const,
    };
    for (const message of ['CDP is busy; retry after the current request completes.', 'Stale session', 'MCP timeout']) {
        const failure = new Error(message);
        let calls = 0;
        let clock = 0;
        await assert.rejects(
            closeSmokeConnection(
                async () => {
                    calls += 1;
                    throw failure;
                },
                request,
                {
                    now: () => clock,
                    sleep: async (ms) => {
                        clock += ms;
                    },
                    timeoutMs: 250,
                },
            ),
            (error: unknown) => error === failure,
        );
        assert.equal(calls, message.startsWith('CDP is busy') ? 2 : 1);
        assert.ok(clock <= 250);
    }
});

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
