import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ProcessTarget } from '../src/domains/cdp-target.ts';
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
        isolation: {
            mode: 'data-dir',
            directory: { kind: 'new', parent: '/tmp', name: 'test profile' },
            cleanup: 'delete-on-release',
        },
        targetKind: 'chrome',
        launch: {
            executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: [
                '--no-first-run',
                '--disable-background-networking',
                '--disable-background-mode',
                '--user-data-dir={dataDir}',
                '--remote-debugging-port={port}',
                'data:text/html,<title>LOCAL</title>',
            ],
        },
    });
    assert.throws(() => createChromeSmokeLaunch('/chrome', 'relative-profile', 'data:text/html,', 'linux'), /absolute/);
});

test('Chrome smoke verifies browser-reported actual profile path through official tools and closes its probe', async (t) => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-smoke-proof-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(path.join(directory, 'Default'));
    const nestedProfile = path.join(directory, 'nested', 'Default');
    await mkdir(nestedProfile, { recursive: true });
    const module = await host();
    assert.ok('inspectChromeSmokeDirectory' in module && typeof module.inspectChromeSmokeDirectory === 'function');
    const target = {
        entryId: randomUUID(),
        connectionId: randomUUID(),
        sessionId: randomUUID(),
        status: 'active' as const,
    };
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let reportedPath = path.join(directory, 'Default');
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === 'dct_connection_status')
            return {
                structuredContent: {
                    isolation: { mode: 'data-dir', path: directory, cleanup: 'delete-on-release', state: 'held' },
                },
            };
        const text =
            name === 'list_pages'
                ? '12: data:text/html,fixture [selected]'
                : name === 'new_page'
                  ? '12: data:text/html,fixture\n13: chrome://version/ [selected]'
                  : name === 'evaluate_script'
                    ? `Script ran on page and returned:\n\`\`\`json\n${JSON.stringify({ profilePath: reportedPath })}\n\`\`\``
                    : 'done';
        return { content: [{ type: 'text', text }] };
    };
    assert.equal(await module.inspectChromeSmokeDirectory(tool, target), directory);
    assert.deepEqual(
        calls.map((call) => call.name),
        [
            'dct_connection_status',
            'list_pages',
            'new_page',
            'select_page',
            'evaluate_script',
            'close_page',
            'select_page',
        ],
    );
    assert.equal(calls.find((call) => call.name === 'evaluate_script')?.args.pageId, 13);
    assert.deepEqual(calls.at(-1)?.args, {
        _dct: { connectionId: target.connectionId, sessionId: target.sessionId },
        pageId: 12,
    });
    for (const rejectedPath of [path.dirname(directory), directory, nestedProfile]) {
        reportedPath = rejectedPath;
        await assert.rejects(module.inspectChromeSmokeDirectory(tool, target), /profile|directory/i);
        assert.deepEqual(calls.slice(-2), [
            {
                name: 'close_page',
                args: { _dct: { connectionId: target.connectionId, sessionId: target.sessionId }, pageId: 13 },
            },
            {
                name: 'select_page',
                args: { _dct: { connectionId: target.connectionId, sessionId: target.sessionId }, pageId: 12 },
            },
        ]);
    }
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

test('external Chrome smoke Close only requests normal close without inventing an exit observer', async () => {
    const { requestChromeSmokeClose } = await host();
    const fixture: ProcessTarget = {
        processId: 4100,
        port: 19422,
        targetKind: 'chrome',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        startedAtUtc: '2026-10-04T22:11:00.000Z',
    };
    const calls: string[] = [];
    const platform = {
        async requestNormalClose(target: ProcessTarget) {
            assert.equal(target, fixture);
            calls.push('request');
            return { closeRequested: true, processExited: false };
        },
        async close() {
            assert.fail('An inspect-only fixture cannot await platform.close.');
        },
        async waitForExit() {
            assert.fail('The gateway owns the actual application exit observer.');
        },
        async snapshot() {
            assert.fail('The close stimulus cannot poll process or listener absence.');
        },
    };
    assert.equal(await requestChromeSmokeClose(fixture, platform), true);
    assert.deepEqual(calls, ['request']);
    assert.equal('child' in fixture, false);
    assert.deepEqual(fixture, {
        processId: 4100,
        port: 19422,
        targetKind: 'chrome',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        startedAtUtc: '2026-10-04T22:11:00.000Z',
    });
    assert.equal(
        await requestChromeSmokeClose(fixture, {
            requestNormalClose: async () => ({ closeRequested: false, processExited: true }),
        }),
        false,
        'An observed exit receipt is not acceptance of this external close request.',
    );
    const failure = new Error('Native normal Close request failed.');
    await assert.rejects(
        requestChromeSmokeClose(fixture, {
            requestNormalClose: async () => {
                throw failure;
            },
        }),
        (error: unknown) => error === failure,
    );
    await assert.rejects(requestChromeSmokeClose(fixture, {}), /normal Close request/i);
});

test('connection recovery smoke separates external normal Close requests from gateway exit proof', async () => {
    const source = await readFile(new URL('./smoke/entry-recovery.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /platform\.(?:close|waitForExit)\s*\(/);
    assert.match(source, /requestChromeSmokeClose\(fixture, platform\)/);
    assert.match(source, /await until\(async \(\) => \{[\s\S]*?!current\.connections\.some/);
    assert.match(source, /const closed = await Promise\.allSettled\(\[client\.close\(\)\]\)/);
    assert.match(source, /assert\.equal\(retainedAfterGatewayCleanup, false,/);
    assert.match(source, /reminderReceived - connectionRetirementObservedAt <= 5_000/);
    assert.match(source, /normalCloseRequestedAt/);
    assert.doesNotMatch(source, /closeCompleted|normallyClosed|millisecondsFromCloseCompletion/);
});
