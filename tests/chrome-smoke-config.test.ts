import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ControlRequest, ControlResult } from '../src/domains/control-contract.ts';
import type { ProcessTarget } from '../src/gateway/targets/model/target-contract.ts';
import type { ProfileStat } from './smoke/chrome-host.ts';
import {
    createFixtureArtifacts,
    createSmokeFailures,
    type ProfileDirectoryRecord,
    validateProfileDirectoryRecord,
} from './smoke/fixture-artifacts.ts';
import { closeSmokeConnection } from './smoke/lifecycle-client.ts';

function profileStat(
    dev: bigint,
    ino: bigint,
    kind: 'directory' | 'file' | 'symlink' | 'other' = 'directory',
): ProfileStat {
    return {
        dev,
        ino,
        isDirectory: () => kind === 'directory',
        isFile: () => kind === 'file',
        isSymbolicLink: () => kind === 'symlink',
    };
}

function profileSink() {
    const rows: Readonly<ProfileDirectoryRecord>[] = [];
    let rejected = 0;
    return {
        rows,
        get rejectedCount() {
            return rejected;
        },
        profileDirectory(value: unknown) {
            const safe = validateProfileDirectoryRecord(value);
            assert.ok(safe);
            rows.push(safe);
        },
        rejected() {
            rejected++;
        },
    };
}

test('profile observations retain first directory identity, classify replacements and never rebaseline', async () => {
    const { createChromeProfileObservations } = await host();
    const sink = profileSink();
    let value = profileStat(10n, 101n);
    let clock = 100;
    const paths: string[] = [];
    const observer = createChromeProfileObservations(true, sink, {
        inspect: async (file) => {
            paths.push(file);
            return value;
        },
        now: () => clock++,
    });
    await observer.sample('first', 'after-close');
    await observer.register('first', 'PRIVATE_FIRST');
    await observer.register('first', 'PRIVATE_REPLACEMENT');
    await observer.sample('first', 'before-second-start');
    value = profileStat(10n, 102n);
    await observer.sample('first', 'after-second-start');
    await observer.sample('first', 'registered');
    value = profileStat(10n, 101n, 'file');
    await observer.sample('first', 'before-gateway-close');
    value = profileStat(11n, 101n);
    await observer.sample('first', 'after-gateway-close');
    value = profileStat(10n, 101n);
    await observer.sample('first', 'final-check');
    assert.deepEqual(
        sink.rows.map((row) => [row.point, row.entryKind, row.matchesBaseline]),
        [
            ['registered', 'directory', true],
            ['before-second-start', 'directory', true],
            ['after-second-start', 'directory', false],
            ['registered', 'directory', false],
            ['before-gateway-close', 'file', false],
            ['after-gateway-close', 'directory', false],
            ['final-check', 'directory', true],
        ],
    );
    assert.deepEqual(paths, Array(7).fill('PRIVATE_FIRST'));
    assert.equal(sink.rejectedCount, 1);
    assert.deepEqual(
        sink.rows.map((row) => [row.elapsedMs, row.readDurationMs]),
        [
            [2, 1],
            [4, 1],
            [6, 1],
            [8, 1],
            [10, 1],
            [12, 1],
            [14, 1],
        ],
    );
    assert.doesNotMatch(JSON.stringify(sink.rows), /PRIVATE|dev|ino/);
});

test('profile observations classify own error codes and keep unavailable or nondirectory baselines unknown', async () => {
    const { createChromeProfileObservations } = await host();
    for (const initial of [new Error('PRIVATE'), profileStat(1n, 2n, 'file')]) {
        const sink = profileSink();
        let value: ProfileStat | Error = initial;
        let clock = 0;
        const observer = createChromeProfileObservations(true, sink, {
            inspect: async () => {
                if (value instanceof Error) throw value;
                return value;
            },
            now: () => clock++,
        });
        await observer.register('first', 'PRIVATE');
        value = profileStat(1n, 2n);
        await observer.sample('first', 'final-check');
        assert.equal(sink.rows[1]?.matchesBaseline, null);
        await observer.sample('first', 'registered');
        assert.equal(sink.rows[2]?.matchesBaseline, null);
    }
    let reads = 0;
    const getterError = Object.defineProperty(new Error('PRIVATE'), 'code', {
        get() {
            reads++;
            return 'ENOENT';
        },
    });
    const sink = profileSink();
    let clock = 0;
    let error: unknown = Object.assign(new Error('PRIVATE'), { code: 'ENOENT' });
    const observer = createChromeProfileObservations(true, sink, {
        inspect: async () => {
            throw error;
        },
        now: () => clock++,
    });
    await observer.register('first', 'PRIVATE');
    for (const next of [
        Object.assign(new Error('PRIVATE'), { code: 'EACCES' }),
        Object.assign(new Error('PRIVATE'), { code: 'EPERM' }),
        getterError,
        Object.create({ code: 'ENOENT' }),
    ]) {
        error = next;
        await observer.sample('first', 'after-close');
    }
    assert.deepEqual(
        sink.rows.map((row) => [row.result, row.entryKind, row.matchesBaseline, row.readError]),
        [
            ['absent', 'none', null, 'none'],
            ['unavailable', 'unknown', null, 'denied'],
            ['unavailable', 'unknown', null, 'denied'],
            ['unavailable', 'unknown', null, 'other'],
            ['unavailable', 'unknown', null, 'other'],
        ],
    );
    assert.equal(reads, 0);
});

test('ordinary profile boundaries produce twelve rows in role order without duplicating assertion reads', async () => {
    const { createChromeProfileObservations } = await host();
    const sink = profileSink();
    const inspected: string[] = [];
    let clock = 0;
    const observer = createChromeProfileObservations(true, sink, {
        inspect: async (file) => {
            inspected.push(file);
            return profileStat(3n, file === 'first' ? 1n : 2n);
        },
        now: () => clock++,
    });
    const missing = Object.assign(new Error('PRIVATE'), { code: 'ENOENT' });
    await observer.register('first', 'first');
    await assert.rejects(observer.observeCheck('first', 'after-close', Promise.reject(missing)), { code: 'ENOENT' });
    await observer.sample('first', 'before-second-start');
    await observer.sample('first', 'after-second-start');
    await observer.register('second', 'second');
    await assert.rejects(observer.observeCheck('second', 'after-close', Promise.reject(missing)), { code: 'ENOENT' });
    await observer.sampleAll('before-gateway-close');
    await observer.sampleAll('after-gateway-close');
    for (const file of new Set(['first', 'second']))
        await assert.rejects(observer.observeCheck(file, 'final-check', Promise.reject(missing)), { code: 'ENOENT' });
    assert.deepEqual(inspected, ['first', 'first', 'first', 'second', 'first', 'second', 'first', 'second']);
    assert.deepEqual(
        sink.rows.map((row) => [row.role, row.point]),
        [
            ['first', 'registered'],
            ['first', 'after-close'],
            ['first', 'before-second-start'],
            ['first', 'after-second-start'],
            ['second', 'registered'],
            ['second', 'after-close'],
            ['first', 'before-gateway-close'],
            ['second', 'before-gateway-close'],
            ['first', 'after-gateway-close'],
            ['second', 'after-gateway-close'],
            ['first', 'final-check'],
            ['second', 'final-check'],
        ],
    );
});

test('profile observations distinguish symlinks and other entries from the captured directory', async () => {
    const { createChromeProfileObservations } = await host();
    const sink = profileSink();
    let value = profileStat(1n, 2n);
    let clock = 0;
    const observer = createChromeProfileObservations(true, sink, {
        inspect: async () => value,
        now: () => clock++,
    });
    await observer.register('first', 'PRIVATE');
    value = profileStat(1n, 2n, 'symlink');
    await observer.sample('first', 'after-close');
    value = profileStat(1n, 2n, 'other');
    await observer.sample('first', 'final-check');
    assert.deepEqual(
        sink.rows.map((row) => [row.entryKind, row.matchesBaseline]),
        [
            ['directory', true],
            ['symlink', false],
            ['other', false],
        ],
    );
});

test('a racing sample cannot replace the registration baseline while its first read is pending', async () => {
    const { createChromeProfileObservations } = await host();
    const sink = profileSink();
    let resolveRegistration: (value: ProfileStat) => void = () => {
        assert.fail('Registration read was not started.');
    };
    const pending = new Promise<ProfileStat>((resolve) => {
        resolveRegistration = resolve;
    });
    let reads = 0;
    let clock = 0;
    const observer = createChromeProfileObservations(true, sink, {
        inspect: async () => (++reads === 1 ? pending : profileStat(4n, 99n)),
        now: () => clock++,
    });
    const registering = observer.register('first', 'PRIVATE');
    await observer.sample('first', 'registered');
    resolveRegistration(profileStat(4n, 10n));
    await registering;
    const value = profileStat(4n, 10n);
    assert.equal(await observer.observeCheck('PRIVATE', 'final-check', Promise.resolve(value)), value);
    assert.deepEqual(
        sink.rows.map((row) => row.matchesBaseline),
        [null, true, true],
    );
});

test('official smoke wires only controlled ordinary profile observations around unchanged acceptance checks', async () => {
    const source = await readFile(new URL('./smoke/official-server.ts', import.meta.url), 'utf8');
    assert.match(source, /createChromeProfileObservations\(controlledDiagnostics && !startupStudy, artifacts\)/);
    for (const role of ['first', 'second']) {
        assert.match(
            source,
            new RegExp(
                `managedDirectories\\.add\\(${role}Directory\\);\\s*await profileObservations\\.register\\('${role}', ${role}Directory\\)`,
            ),
        );
        assert.match(
            source,
            new RegExp(
                `assert\\.rejects\\(\\s*profileObservations\\.observeCheck\\(${role}Directory, 'after-close', lstat\\(${role}Directory, \\{ bigint: true \\}\\)\\),\\s*\\{ code: 'ENOENT' \\}`,
            ),
        );
    }
    assert.match(
        source,
        /await emptyGateway\(\);\s*await profileObservations\.sample\('first', 'before-second-start'\);\s*const second = await control/,
    );
    assert.match(
        source,
        /active = second;\s*await profileObservations\.sample\('first', 'after-second-start'\);\s*const secondFixture/,
    );
    assert.match(
        source,
        /await profileObservations\.sampleAll\('before-gateway-close'\);\s*await failures\.cleanup\('gateway-close', async \(\) => \{\s*try \{/,
    );
    assert.match(source, /finally \{\s*await profileObservations\.sampleAll\('after-gateway-close'\);/);
    assert.match(
        source,
        /for \(const directory of managedDirectories\)\s*await failures\.cleanup\('profile-cleanup', \(\) =>\s*assert\.rejects\(\s*profileObservations\.observeCheck\(directory, 'final-check', lstat\(directory, \{ bigint: true \}\)\),\s*\{ code: 'ENOENT' \}/,
    );
    assert.equal(source.match(/profileObservations\.observeCheck\(/g)?.length, 3);
    assert.equal(source.match(/lstat\(/g)?.length, 3);
    assert.ok(
        source.indexOf("sampleAll('before-gateway-close')") > source.indexOf("failures.cleanup('target-cleanup'"),
    );
});

test('profile observation disabled mode does no I/O or clock work and returns the existing check promise', async () => {
    const { createChromeProfileObservations } = await host();
    const fail = () => {
        assert.fail('Disabled diagnostics must do no optional work.');
    };
    const observer = createChromeProfileObservations(
        false,
        { profileDirectory: fail, rejected: fail },
        { inspect: fail, now: fail },
    );
    await observer.register('first', 'PRIVATE');
    await observer.sample('first', 'after-close');
    await observer.sampleAll('before-gateway-close');
    const value = profileStat(1n, 2n);
    const pending = Promise.resolve(value);
    assert.equal(observer.observeCheck('PRIVATE', 'after-close', pending), pending);
    assert.equal(await pending, value);
});

test('profile checks preserve exact outcomes through bad clocks, inspect and throwing diagnostic sinks', async () => {
    const { createChromeProfileObservations } = await host();
    for (const clock of [
        () => Number.NaN,
        () => {
            throw new Error('PRIVATE_CLOCK');
        },
        (() => {
            let now = 10;
            return () => now--;
        })(),
    ]) {
        let rejected = 0;
        const sink = {
            profileDirectory() {
                assert.fail('Invalid clock cannot fabricate a record.');
            },
            rejected() {
                rejected++;
            },
        };
        const value = profileStat(1n, 2n);
        const observer = createChromeProfileObservations(true, sink, { inspect: async () => value, now: clock });
        await observer.register('first', 'PRIVATE');
        assert.equal(await observer.observeCheck('PRIVATE', 'final-check', Promise.resolve(value)), value);
        assert.ok(rejected > 0);
    }
    let clock = 0;
    const value = profileStat(1n, 2n);
    const observer = createChromeProfileObservations(
        true,
        {
            profileDirectory() {
                throw new Error('PRIVATE_WRITE');
            },
            rejected() {
                throw new Error('PRIVATE_REJECT');
            },
        },
        {
            inspect: async () => {
                throw new Error('PRIVATE_IO');
            },
            now: () => clock++,
        },
    );
    await observer.register('first', 'PRIVATE');
    await observer.sampleAll('before-gateway-close');
    assert.equal(await observer.observeCheck('PRIVATE', 'after-close', Promise.resolve(value)), value);
    const error = Object.assign(new Error('PRIVATE_ASSERTION'), { code: 'ENOENT' });
    await assert.rejects(
        observer.observeCheck('PRIVATE', 'final-check', Promise.reject(error)),
        (actual) => actual === error,
    );
});

test('profile final presence preserves the real first AssertionError and still checks the second profile', async (t) => {
    const { createChromeProfileObservations } = await host();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-profile-acceptance-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const artifacts = createFixtureArtifacts(directory, 'official-server');
    const failures = createSmokeFailures(artifacts);
    let clock = 0;
    let inspections = 0;
    const observer = createChromeProfileObservations(true, artifacts, {
        inspect: async (file) => {
            inspections++;
            return file === 'PRIVATE_FIRST' ? profileStat(7n, 10n) : profileStat(7n, 20n);
        },
        now: () => clock++,
    });
    const managedDirectories = new Set(['PRIVATE_FIRST', 'PRIVATE_SECOND']);
    await observer.register('first', 'PRIVATE_FIRST');
    await observer.register('second', 'PRIVATE_SECOND');
    const missing = Object.assign(new Error('PRIVATE'), { code: 'ENOENT' });
    await assert.rejects(observer.observeCheck('PRIVATE_FIRST', 'after-close', Promise.reject(missing)), {
        code: 'ENOENT',
    });
    const checked: string[] = [];
    let primary: unknown;
    for (const file of managedDirectories)
        await failures.cleanup('profile-cleanup', async () => {
            checked.push(file);
            try {
                await assert.rejects(
                    observer.observeCheck(
                        file,
                        'final-check',
                        file === 'PRIVATE_FIRST'
                            ? Promise.resolve(profileStat(7n, 99n, 'file'))
                            : Promise.reject(missing),
                    ),
                    { code: 'ENOENT' },
                );
            } catch (error) {
                primary = error;
                throw error;
            }
        });
    assert.ok(primary instanceof assert.AssertionError);
    assert.throws(
        () => failures.finish(),
        (error) => error === primary,
    );
    assert.deepEqual(checked, ['PRIVATE_FIRST', 'PRIVATE_SECOND']);
    assert.equal(inspections, 2, 'The four acceptance reads must not cause another inspect.');
    const rows = (await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => validateProfileDirectoryRecord(JSON.parse(line)))
        .filter((row) => row !== undefined);
    assert.deepEqual(
        rows.map((row) => [row.role, row.point, row.result, row.entryKind, row.matchesBaseline]),
        [
            ['first', 'registered', 'present', 'directory', true],
            ['second', 'registered', 'present', 'directory', true],
            ['first', 'after-close', 'absent', 'none', null],
            ['first', 'final-check', 'present', 'file', false],
            ['second', 'final-check', 'absent', 'none', null],
        ],
    );
    assert.equal(artifacts.snapshot().primary?.stage, 'profile-cleanup');
    assert.equal(artifacts.snapshot().secondary.length, 0);
});

test('an explicit smoke Close waits for busy CDP without changing target identity', async () => {
    const request = {
        action: 'stop' as const,
        connectionId: randomUUID(),
        sessionId: randomUUID(),
        requestId: randomUUID(),
        disposition: 'Close' as const,
    };
    const calls: ControlRequest[] = [];
    let clock = 0;
    const result: ControlResult = { connectionId: request.connectionId, status: 'idle' };
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

test('Chrome smoke verifies actual native profile evidence despite the official chrome URL refusal and restores selection', async (t) => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-smoke-proof-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(path.join(directory, 'Default'));
    const nestedProfile = path.join(directory, 'nested', 'Default');
    await mkdir(nestedProfile, { recursive: true });
    const module = await host();
    assert.ok('inspectChromeSmokeDirectory' in module && typeof module.inspectChromeSmokeDirectory === 'function');
    const target = {
        connectionId: randomUUID(),
        sessionId: randomUUID(),
        status: 'active' as const,
        processId: 4100,
        port: 19422,
        targetKind: 'chrome' as const,
    };
    const fixture: ProcessTarget = {
        processId: 4100,
        port: 19422,
        targetKind: 'chrome',
        executablePath: '/synthetic/chrome',
        startedAtUtc: '2026-10-07T00:00:00.000Z',
    };
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let reportedPath = path.join(directory, 'Default');
    let restorationFailure: Error | undefined;
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === 'dct_connection_status')
            return {
                structuredContent: {
                    isolation: { mode: 'data-dir', path: directory, cleanup: 'delete-on-release', state: 'held' },
                },
            };
        if (name === 'new_page' || name === 'navigate_page')
            return {
                content: [{ type: 'text', text: 'Error: Navigating to chrome: URLs is not allowed.' }],
                isError: true,
            };
        assert.ok(name === 'list_pages' || name === 'select_page');
        if (name === 'select_page' && restorationFailure) throw restorationFailure;
        return {
            content: [{ type: 'text', text: name === 'list_pages' ? '12: data:text/html,fixture [selected]' : 'done' }],
        };
    };
    const observe = async (observed: ProcessTarget) => {
        assert.equal(observed, fixture);
        return reportedPath;
    };
    assert.equal(await module.inspectChromeSmokeDirectory(tool, target, fixture, observe), directory);
    assert.deepEqual(
        calls.map((call) => call.name),
        ['dct_connection_status', 'list_pages', 'select_page'],
    );
    assert.deepEqual(calls.at(-1)?.args, {
        _dct: { connectionId: target.connectionId, sessionId: target.sessionId },
        pageId: 12,
    });
    for (const rejectedPath of [path.dirname(directory), directory, nestedProfile]) {
        reportedPath = rejectedPath;
        await assert.rejects(module.inspectChromeSmokeDirectory(tool, target, fixture, observe), /profile|directory/i);
        assert.deepEqual(calls.at(-1), {
            name: 'select_page',
            args: { _dct: { connectionId: target.connectionId, sessionId: target.sessionId }, pageId: 12 },
        });
    }
    const failure = new Error('The owned profile observation failed.');
    await assert.rejects(
        module.inspectChromeSmokeDirectory(tool, target, fixture, async () => {
            throw failure;
        }),
        (error: unknown) => error === failure,
    );
    assert.deepEqual(calls.at(-1), {
        name: 'select_page',
        args: { _dct: { connectionId: target.connectionId, sessionId: target.sessionId }, pageId: 12 },
    });
    const primary = new AggregateError(
        [new Error('Native identity changed.'), new Error('Probe cleanup refused.')],
        'The owned profile probe and cleanup failed.',
    );
    restorationFailure = new Error('The application page selection could not be restored.');
    await assert.rejects(
        module.inspectChromeSmokeDirectory(tool, target, fixture, async () => {
            throw primary;
        }),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [primary, restorationFailure]);
            return true;
        },
    );
    reportedPath = path.join(directory, 'Default');
    await assert.rejects(
        module.inspectChromeSmokeDirectory(tool, target, fixture, observe),
        (error: unknown) => error === restorationFailure,
    );
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
    assert.match(source, /normalCloseRequestedAt/);
    assert.doesNotMatch(source, /closeCompleted|normallyClosed|millisecondsFromCloseCompletion/);
});

test('Windows console smoke observes monitor stream closure before startup can await and consume its exit', async () => {
    const source = await readFile(new URL('./smoke/official-server.ts', import.meta.url), 'utf8');
    const captured = source.indexOf('const monitoringEnded =');
    const firstAwait = source.indexOf('await ', source.indexOf('const monitor ='));
    assert.ok(
        captured >= 0 && captured < firstAwait,
        'Monitor closure observation must precede the first await after spawning the monitor.',
    );
    assert.match(source.slice(captured, firstAwait), /monitor\.once\('close'/);
    assert.doesNotMatch(source.slice(source.indexOf('} finally {')), /monitor\.once\('(?:exit|close)'/);
    assert.match(source.slice(source.indexOf('} finally {')), /await monitoringEnded/);
});
