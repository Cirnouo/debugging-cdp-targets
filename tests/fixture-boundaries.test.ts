import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { profileAvailable, reserveProfile } from '../src/adapters/chrome-profile.ts';
import { DataDirectoryError, DataDirectoryRegistry } from '../src/adapters/data-directory.ts';
import {
    type FixtureEvent,
    runFixtureObservation,
    subscribeFixtureDiagnostics,
} from '../src/adapters/fixture-diagnostics.ts';
import { resolveUnixExecutable, unixSnapshot } from '../src/adapters/platform-process.ts';
import { createTargetHost, type HostDependencies } from '../src/adapters/target-host.ts';
import { createConnectionDirectory } from '../src/application/connection-directory.ts';
import { createConnectionOwner } from '../src/application/connection-owner.ts';

const first = {
    entryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    connectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    action: 'start' as const,
};
const successor = {
    ...first,
    operationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    action: 'stop' as const,
};

function observations(t: TestContext) {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    return records;
}

function ioError(code = 'EACCES', syscall = 'readlink') {
    return Object.assign(new Error('private /fixture/profile secret content'), { code, syscall, errno: -13 });
}

for (const observed of [false, true]) {
    test(`normal close retains the original error with hostile metadata, observer ${observed}`, async (t) => {
        if (observed) observations(t);
        let reads = 0;
        const failure = Object.defineProperty(new Error('primary normal close failure'), 'details', {
            get() {
                reads++;
                throw new Error('diagnostic metadata getter failure');
            },
        });
        const host = createTargetHost({
            platformAdapter: {
                reservedRanges: async () => [],
                validateNewRoot: () => {},
                snapshot: async () => ({
                    root: { exists: false },
                    currentSessionId: 0,
                    processIds: [],
                    listeners: [],
                }),
                close: async () => {
                    throw failure;
                },
            },
        });
        await assert.rejects(
            host.requestNormalClose({
                processId: 42,
                port: 9222,
                executablePath: process.execPath,
                startedAtUtc: '1970-01-01T00:00:00Z',
                targetKind: 'generic-cdp',
            }),
            (error) => error === failure,
        );
        assert.equal(reads, 0, 'diagnostics must not invoke arbitrary details getters');
    });
}

for (const [code, stderr] of [
    [2, 'private stderr'],
    [null, ''],
    [0, 'private stderr'],
] as const) {
    test(`native command observations preserve ${code} exit and stderr presence without output`, async (t) => {
        const records = observations(t);
        await assert.rejects(
            runFixtureObservation(first, () =>
                resolveUnixExecutable({
                    platform: 'darwin',
                    pid: 42,
                    comm: '/private/fixture/app',
                    run: async () => ({ code, stdout: 'private process output', stderr }),
                }),
            ),
            /unverifiable/,
        );
        const begin = records.find((record) => record.stage === 'native-command' && record.event === 'begin');
        const end = records.find((record) => record.stage === 'native-command' && record.event === 'end');
        assert.equal(begin?.command, 'lsof');
        assert.equal(end?.exitCode, code);
        assert.equal(end?.stderrPresent, !!stderr);
        assert.ok(end && end.durationMs >= 0);
        assert.ok(!JSON.stringify(records).includes('private'));
    });
}

test('native command exception is recorded before identity wrapping and remains the original failure', async (t) => {
    const records = observations(t);
    const failure = new Error('private failure', { cause: ioError('ENOENT', 'spawn') });
    await assert.rejects(
        runFixtureObservation(first, () =>
            unixSnapshot(42, 9222, {
                platform: 'linux',
                run: async () => {
                    throw failure;
                },
            }),
        ),
        (error) => error === failure,
    );
    const record = records.find((value) => value.stage === 'native-command' && value.event === 'end');
    assert.equal(record?.command, 'ps');
    assert.equal(record?.outcome, 'failed');
    assert.equal(record?.error?.cause?.code, 'ENOENT');
    assert.equal(record?.error?.cause?.syscall, 'spawn');
});

test('kernel file failure and getconf command have independent begin evidence', async (t) => {
    const records = observations(t);
    const failure = ioError('EIO', 'read');
    await assert.rejects(
        runFixtureObservation(first, () =>
            unixSnapshot(42, 9222, {
                platform: 'linux',
                currentUser: () => 7,
                run: async (command) =>
                    command === 'ps'
                        ? { code: 0, stdout: '42 1 7 Thu Jan  1 00:16:40 1970 chrome\n', stderr: '' }
                        : { code: 1, stdout: '', stderr: 'private' },
                readText: async () => {
                    throw failure;
                },
            }),
        ),
        (error) => error === failure,
    );
    assert.ok(
        records.some(
            (record) => record.stage === 'native-command' && record.command === 'getconf' && record.event === 'begin',
        ),
    );
    assert.ok(
        records.some(
            (record) => record.stage === 'native-file' && record.event === 'end' && record.error?.code === 'EIO',
        ),
    );
});

test('Darwin failed file identity is observed before its ambiguity wrapper', async (t) => {
    const records = observations(t);
    await assert.rejects(
        runFixtureObservation(first, () =>
            resolveUnixExecutable({
                platform: 'darwin',
                pid: 42,
                comm: '/private/app',
                run: async () => ({ code: 0, stdout: 'p42\nftxt\nD0x11\ni42\nn/private/alias/app\n', stderr: '' }),
                fileIdentity: async () => {
                    throw ioError('EACCES', 'stat');
                },
            }),
        ),
        /ambiguous/,
    );
    assert.ok(records.some((record) => record.stage === 'native-file' && record.error?.syscall === 'stat'));
});

for (const [lock, live, available, reason] of [
    ['fixture-host-42', true, false, 'live-lock-owner'],
    ['fixture-host-42', false, true, 'process-absent'],
    ['foreign-host-42', false, false, 'foreign-host'],
    ['fixture-host-invalid', false, false, 'invalid-lock'],
] as const) {
    test(`profile availability records ${reason} without the lock text`, async (t) => {
        const records = observations(t);
        assert.equal(
            await runFixtureObservation(first, () =>
                profileAvailable('/private/profile', {
                    platform: 'linux',
                    hostname: () => 'fixture-host',
                    readlink: async () => lock,
                    probeProcessExists: () => live,
                }),
            ),
            available,
        );
        assert.ok(
            records.some(
                (record) =>
                    record.stage === 'profile-check' && record.reason === reason && record.available === available,
            ),
        );
        assert.ok(!JSON.stringify(records).includes(lock));
    });
}

for (const lock of ['123', '-123']) {
    test(`malformed singleton lock ${JSON.stringify(lock)} is refused without a native process probe`, async (t) => {
        const records = observations(t);
        let probes = 0;
        assert.equal(
            await profileAvailable('/private/profile', {
                platform: 'linux',
                hostname: () => 'fixture-host',
                readlink: async () => lock,
                probeProcessExists: () => {
                    probes++;
                    return false;
                },
            }),
            false,
        );
        assert.equal(probes, 0);
        assert.ok(records.some((record) => record.reason === 'invalid-lock' && record.available === false));
    });
}

test('profile readlink and process-probe exceptions are safe before reservation swallows them', async (t) => {
    const records = observations(t);
    for (const fault of ['readlink', 'process-probe']) {
        await assert.rejects(
            runFixtureObservation(first, () =>
                reserveProfile(path.join(os.tmpdir(), `dct-fixture-${fault}`), () =>
                    profileAvailable('/private/profile', {
                        platform: 'linux',
                        hostname: () => 'fixture-host',
                        readlink: async () => {
                            if (fault === 'readlink') throw ioError();
                            return 'fixture-host-42';
                        },
                        probeProcessExists: () => {
                            throw ioError('EPERM', 'kill');
                        },
                    }),
                ),
            ),
            /occupied or unverifiable/,
        );
    }
    assert.ok(records.some((record) => record.reason === 'lock-access-failed' && record.error?.syscall === 'readlink'));
    assert.ok(records.some((record) => record.reason === 'process-probe-failed' && record.error?.syscall === 'kill'));
    assert.ok(!JSON.stringify(records).includes('private'));
});

async function directoryFixture(t: TestContext) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-observation-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const identity = await lstat(root, { bigint: true });
    return {
        canonical: async (value: string) => value,
        inspect: async () => identity,
        entries: async () => [],
        remove: async () => {},
    };
}

for (const fault of ['inspect', 'remove'] as const) {
    test(`directory ${fault} failures retain safe original errno and domain cause`, async (t) => {
        const records = observations(t);
        const io = await directoryFixture(t);
        const failure = ioError('EIO', fault === 'inspect' ? 'lstat' : 'rmdir');
        let failing = false;
        const registry = new DataDirectoryRegistry({
            platform: 'linux',
            io: {
                ...io,
                ...(fault === 'inspect'
                    ? {
                          inspect: async () => {
                              if (failing) throw failure;
                              return io.inspect();
                          },
                      }
                    : {
                          remove: async () => {
                              if (failing) throw failure;
                          },
                      }),
            },
        });
        const lease = await runFixtureObservation(first, () =>
            registry.acquire({ kind: 'existing', path: '/fixture' }, 'delete-on-release'),
        );
        failing = true;
        await assert.rejects(
            runFixtureObservation(successor, () => lease.release()),
            (error: unknown) => {
                assert.ok(error instanceof DataDirectoryError);
                assert.equal(error.code, 'directory-cleanup-failed');
                assert.equal(error.cause, failure);
                return true;
            },
        );
        const record = records.find(
            (value) => value.stage === 'data-directory-cleanup' && value.phase === fault && value.event === 'end',
        );
        assert.equal(record?.error?.errno, -13);
        assert.equal(record?.originOperationId, first.operationId);
        assert.equal(record?.operationId, successor.operationId);
        assert.equal(record?.connectionId, first.connectionId);
        assert.equal(record?.sessionId, undefined);
        assert.ok(!JSON.stringify(records).includes('private'));
    });
}

for (const throws of [false, true]) {
    test(`connection availability ${throws ? 'exception' : 'false decision'} retains its origin and blocks deletion`, async (t) => {
        const records = observations(t);
        const io = await directoryFixture(t);
        let removes = 0;
        const registry = new DataDirectoryRegistry({
            platform: 'linux',
            io: {
                ...io,
                remove: async () => {
                    removes++;
                },
            },
        });
        const failure = ioError('EACCES', 'open');
        const directory = runFixtureObservation(first, () =>
            createConnectionDirectory(
                registry,
                {
                    mode: 'data-dir',
                    directory: { kind: 'existing', path: '/fixture' },
                    cleanup: 'delete-on-release',
                },
                undefined,
                async () => {
                    if (throws) throw failure;
                    return false;
                },
            ),
        );
        await runFixtureObservation(first, () => directory.acquire());
        directory.requestRelease();
        await assert.rejects(
            runFixtureObservation(successor, () => directory.retry()),
            (error: unknown) => {
                assert.ok(error instanceof DataDirectoryError);
                if (throws) assert.equal(error.cause, failure);
                return true;
            },
        );
        assert.equal(removes, 0);
        const record = records.find(
            (value) => value.stage === 'directory-lease' && value.phase === 'availability' && value.event === 'end',
        );
        assert.equal(record?.outcome, throws ? 'failed' : 'rejected');
        assert.equal(record?.originOperationId, first.operationId);
        assert.equal(record?.operationId, successor.operationId);
        assert.equal(record?.sessionId, undefined);
    });
}

test('connection release barriers and shared pending release retain one attempt across successor observers', async (t) => {
    const records = observations(t);
    const io = await directoryFixture(t);
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const registry = new DataDirectoryRegistry({ platform: 'linux', io: { ...io, remove: () => pending } });
    const directory = runFixtureObservation(first, () =>
        createConnectionDirectory(registry, {
            mode: 'data-dir',
            directory: { kind: 'existing', path: '/fixture' },
            cleanup: 'delete-on-release',
        }),
    );
    await runFixtureObservation(first, () => directory.acquire());
    const owner = createConnectionOwner('first-session');
    owner.track(pending);
    directory.addOwner(owner);
    directory.requestRelease();
    await runFixtureObservation(successor, () => directory.retry());
    assert.ok(records.some((record) => record.stage === 'directory-lease' && record.reason === 'resources-pending'));
    finish();
    await pending;
    const a = runFixtureObservation(successor, () => directory.retry());
    const b = runFixtureObservation({ ...successor, operationId: '11111111-1111-4111-8111-111111111111' }, () =>
        directory.retry(),
    );
    assert.equal(a, b);
    await a;
    assert.equal(
        records.filter((record) => record.stage === 'data-directory-release' && record.event === 'begin').length,
        1,
    );
});

function endpointHost(
    _port: number,
    sleep: () => Promise<void>,
    getVersion?: (port: number) => Promise<unknown>,
    dependencies: HostDependencies = {},
) {
    let clock = 0;
    const child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null as number | null });
    return createTargetHost({
        now: () => clock,
        sleep: async () => {
            clock += 20_000;
            await sleep();
        },
        probe: async () => true,
        ...(getVersion ? { getVersion } : {}),
        spawn: async (_executable, _args, _port, _cwd, _env, context) => {
            context?.onCreated?.(child);
            return child;
        },
        platformAdapter: {
            reservedRanges: async () => [],
            validateNewRoot: () => {},
            snapshot: async () => ({
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    sessionId: 7,
                    startedAtUtc: '1970-01-01T00:00:00Z',
                },
                currentSessionId: 7,
                processIds: [42],
                listeners: [{ owningProcess: 42, localAddress: '127.0.0.1' }],
            }),
            close: async () => {
                child.exitCode = 0;
                child.emit('exit', 0);
                return true;
            },
        },
        ...dependencies,
    });
}

for (const fault of ['headers', 'body', 'json'] as const) {
    test(`endpoint ${fault} failure retains the exact request/header/body boundary`, async (t) => {
        const records = observations(t);
        const server = http.createServer((_request, response) => {
            if (fault === 'headers') return;
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.flushHeaders();
            if (fault === 'json') response.end('invalid private JSON');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        t.after(() => {
            server.closeAllConnections();
            return new Promise<void>((resolve) => server.close(() => resolve()));
        });
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const host = endpointHost(address.port, async () => {});
        await assert.rejects(
            runFixtureObservation(first, () =>
                host.launch({
                    isolation: { mode: 'none' },
                    launch: { executable: process.execPath },
                    exactPort: address.port,
                }),
            ),
            /verified CDP endpoint/,
        );
        const endpoint = records.filter((record) => record.stage === 'endpoint');
        assert.ok(endpoint.some((record) => record.phase === 'request-start' && record.event === 'begin'));
        assert.equal(
            endpoint.some((record) => record.phase === 'headers'),
            fault !== 'headers',
        );
        assert.equal(
            endpoint.some((record) => record.phase === 'body-start'),
            fault !== 'headers',
        );
        assert.equal(
            endpoint.some((record) => record.phase === 'body-failed'),
            fault !== 'headers',
        );
        const failed = endpoint.findLast((record) => record.outcome === 'failed');
        assert.equal(failed?.error?.name, fault === 'json' ? 'SyntaxError' : 'TimeoutError', JSON.stringify(failed));
        assert.ok(!JSON.stringify(records).includes('private'));
    });
}

test('readiness attempt budget remains tied to the original predicate and rollback has two boundaries', async (t) => {
    const records = observations(t);
    const host = endpointHost(
        9222,
        async () => {},
        async () => {
            throw ioError('ECONNREFUSED', 'connect');
        },
    );
    await assert.rejects(
        runFixtureObservation(first, () =>
            host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath }, basePort: 9222 }),
        ),
        /verified CDP endpoint/,
    );
    const attempts = records.filter((record) => record.stage === 'readiness' && record.phase === 'attempt');
    assert.deepEqual(
        attempts.map((record) => [record.event, record.attempt]),
        [
            ['begin', 1],
            ['end', 1],
        ],
    );
    const firstAttempt = attempts[0];
    assert.ok(firstAttempt && typeof firstAttempt.elapsedMs === 'number');
    assert.equal(firstAttempt.remainingMs, Math.max(0, 20_000 - firstAttempt.elapsedMs));
    assert.ok(records.some((record) => record.phase === 'rollback-request' && record.event === 'begin'));
    assert.ok(records.some((record) => record.phase === 'rollback-exit' && record.event === 'begin'));
});

test('successful endpoint records body completion and only one discovery request', async (t) => {
    const records = observations(t);
    let requests = 0;
    const server = http.createServer((_request, response) => {
        requests++;
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
            JSON.stringify({
                Browser: 'Fixture/1.0',
                webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/browser/private-guid`,
            }),
        );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
        server.closeAllConnections();
        return new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const host = endpointHost(address.port, async () => {});
    const target = await runFixtureObservation(first, () =>
        host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath }, exactPort: address.port }),
    );
    await runFixtureObservation(successor, () => host.close(target));
    assert.equal(requests, 1);
    assert.ok(
        records.some(
            (record) => record.stage === 'endpoint' && record.phase === 'headers' && record.httpStatus === 200,
        ),
    );
    assert.ok(
        records.some(
            (record) =>
                record.stage === 'endpoint' && record.phase === 'body-complete' && record.outcome === 'succeeded',
        ),
    );
    assert.ok(!JSON.stringify(records).includes('private-guid'));
});

test('native process-close exceptions are observed before the generic normal-close wrapper', async (t) => {
    const records = observations(t);
    const { createPlatformAdapter } = await import('../src/adapters/platform-process.ts');
    const failure = ioError('EPERM', 'kill');
    const platform = createPlatformAdapter({
        platform: 'win32',
        snapshot: async () => ({
            root: {
                exists: true,
                executablePath: process.execPath,
                sessionId: 7,
                startedAtUtc: '1970-01-01T00:00:00Z',
            },
            currentSessionId: 7,
            processIds: [42],
            listeners: [],
        }),
        requestWindowsClose: async () => {
            throw failure;
        },
    });
    const target = {
        processId: 42,
        port: 9222,
        targetKind: 'generic-cdp' as const,
        executablePath: process.execPath,
        startedAtUtc: '1970-01-01T00:00:00Z',
        child: Object.assign(new EventEmitter(), { exitCode: null }),
    };
    assert.ok(platform.requestNormalClose);
    const close = platform.requestNormalClose;
    await assert.rejects(
        runFixtureObservation(first, () => close(target)),
        /private/,
    );
    assert.ok(
        records.some(
            (record) =>
                record.stage === 'native-close' && record.error?.code === 'EPERM' && record.error.syscall === 'kill',
        ),
    );
});

test('cleanup identity guard completes independently after inspection fails and does not remove', async (t) => {
    const records = observations(t);
    const io = await directoryFixture(t);
    let failing = false;
    let removes = 0;
    const registry = new DataDirectoryRegistry({
        platform: 'linux',
        io: {
            ...io,
            inspect: async () => {
                if (failing) throw ioError('EIO', 'lstat');
                return io.inspect();
            },
            remove: async () => {
                removes++;
            },
        },
    });
    const lease = await runFixtureObservation(first, () =>
        registry.acquire({ kind: 'existing', path: '/fixture' }, 'delete-on-release'),
    );
    failing = true;
    await assert.rejects(
        runFixtureObservation(successor, () => lease.release()),
        { code: 'directory-cleanup-failed' },
    );
    assert.equal(removes, 0);
    assert.ok(
        records.some(
            (record) =>
                record.stage === 'data-directory-cleanup' &&
                record.phase === 'identity' &&
                record.event === 'end' &&
                record.outcome === 'failed',
        ),
    );
});

for (const [code, reason, available] of [
    ['ENOENT', 'missing-lock', true],
    ['EACCES', 'lock-refused', false],
    ['EPERM', 'lock-refused', false],
    ['EBUSY', 'lock-refused', false],
] as const) {
    test(`Windows profile lock ${code} keeps its access decision`, async (t) => {
        const records = observations(t);
        assert.equal(
            await runFixtureObservation(first, () =>
                profileAvailable('/private/profile', {
                    platform: 'win32',
                    openLock: async () => {
                        throw ioError(code, 'open');
                    },
                }),
            ),
            available,
        );
        assert.ok(
            records.some(
                (record) =>
                    record.stage === 'profile-check' && record.reason === reason && record.available === available,
            ),
        );
    });
}

test('no subscriber invokes neither route identity getter nor error getters and preserves failures', async () => {
    let routes = 0;
    let metadata = 0;
    const error = new Error('private');
    Object.defineProperty(error, 'code', {
        get: () => {
            metadata++;
            return 'EIO';
        },
    });
    await assert.rejects(
        runFixtureObservation(
            () => {
                routes++;
                return first;
            },
            () =>
                unixSnapshot(42, 9222, {
                    platform: 'linux',
                    run: async () => {
                        throw error;
                    },
                }),
        ),
        (failure) => failure === error,
    );
    assert.equal(routes, 0);
    assert.equal(metadata, 0);
});

test('throwing safe subscriber cannot alter native I/O outcome or profile release', async (t) => {
    t.after(
        subscribeFixtureDiagnostics(() => {
            throw new Error('sink unavailable');
        }),
    );
    const resolved = await runFixtureObservation(first, () =>
        resolveUnixExecutable({ platform: 'linux', pid: 42, comm: 'app', readlink: async () => '/private/app' }),
    );
    assert.equal(resolved, '/private/app');
    assert.equal(
        await profileAvailable('/private/profile', {
            platform: 'linux',
            readlink: async () => {
                throw ioError('ENOENT');
            },
        }),
        true,
    );
});

test('readiness keeps the original clock-call predicate and 200ms retry spacing with observation enabled', async (t) => {
    const records = observations(t);
    let timeReads = 0;
    const sleeps: number[] = [];
    const host = endpointHost(
        9222,
        async () => {},
        async () => {
            throw ioError('ECONNREFUSED', 'connect');
        },
        {
            now: () => timeReads++ * 6_000,
            sleep: async (milliseconds) => {
                sleeps.push(milliseconds);
            },
        },
    );
    await assert.rejects(
        runFixtureObservation(first, () =>
            host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath } }),
        ),
        /verified CDP endpoint/,
    );
    assert.equal(timeReads, 6);
    assert.deepEqual(sleeps, [200, 200, 200]);
    const attempts = records.filter(
        (record) => record.stage === 'readiness' && record.phase === 'attempt' && record.event === 'begin',
    );
    assert.deepEqual(
        attempts.map((record) => record.attempt),
        [1, 2, 3],
    );
    let previousElapsed = 0;
    for (const record of attempts) {
        assert.ok(typeof record.elapsedMs === 'number', 'readiness evidence requires independent monotonic elapsed');
        assert.ok(typeof record.remainingMs === 'number');
        assert.ok(record.elapsedMs >= previousElapsed);
        assert.equal(record.remainingMs, Math.max(0, 20_000 - record.elapsedMs));
        previousElapsed = record.elapsedMs;
    }
});

test('a hung native snapshot leaves a correlated begin before cancellation and performs no extra probe', async (t) => {
    const records = observations(t);
    let signalSnapshot = () => {};
    const entered = new Promise<void>((resolve) => {
        signalSnapshot = resolve;
    });
    const pending = new Promise<never>(() => {});
    let snapshots = 0;
    const abort = new AbortController();
    const child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null });
    const host = endpointHost(9222, async () => {}, undefined, {
        spawn: async () => child,
        platformAdapter: {
            reservedRanges: async () => [],
            validateNewRoot: () => {},
            snapshot: () => {
                snapshots++;
                signalSnapshot();
                return pending;
            },
            close: async () => {
                child.emit('exit', 0);
                return true;
            },
        },
    });
    const outcome = runFixtureObservation(first, () =>
        host.launch(
            { isolation: { mode: 'none' }, launch: { executable: process.execPath } },
            { signal: abort.signal },
        ),
    ).catch((error: unknown) => error);
    await entered;
    const begin = records.find((record) => record.stage === 'native-snapshot' && record.event === 'begin');
    assert.equal(begin?.connectionId, first.connectionId);
    assert.equal(begin?.sessionId, first.sessionId);
    assert.equal(begin?.pid, 42);
    assert.ok(!records.some((record) => record.stage === 'native-snapshot' && record.event === 'end'));
    abort.abort(new Error('cancelled fixture'));
    assert.ok((await outcome) instanceof Error);
    assert.equal(snapshots, 1);
});

test('a lease acquired after its caller route advances keeps the original connection without a session', async (t) => {
    const records = observations(t);
    const io = await directoryFixture(t);
    let canonicalStarted = () => {};
    const entered = new Promise<void>((resolve) => {
        canonicalStarted = resolve;
    });
    let resolveCanonical = (_value: string) => {};
    const canonical = new Promise<string>((resolve) => {
        resolveCanonical = resolve;
    });
    let identity = first;
    const registry = new DataDirectoryRegistry({
        platform: 'linux',
        io: {
            ...io,
            canonical: () => {
                canonicalStarted();
                return canonical;
            },
        },
    });
    const acquisition = runFixtureObservation(
        () => identity,
        () => registry.acquire({ kind: 'existing', path: '/fixture' }, 'retain'),
    );
    await entered;
    identity = {
        ...first,
        connectionId: '11111111-1111-4111-8111-111111111111',
        sessionId: successor.sessionId,
        operationId: successor.operationId,
    };
    resolveCanonical('/fixture');
    const lease = await acquisition;
    await runFixtureObservation(successor, () => lease.release());
    const completed = records.find(
        (record) => record.stage === 'data-directory-acquire' && record.phase === 'canonical' && record.event === 'end',
    );
    assert.equal(completed?.connectionId, first.connectionId);
    assert.equal(completed?.originOperationId, first.operationId);
    assert.equal(completed?.sessionId, undefined);
});

test('health records both existing snapshots under the original resource and current operation', async (t) => {
    const records = observations(t);
    const host = endpointHost(
        9222,
        async () => {},
        async () => ({
            Browser: 'Fixture/1.0',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/private-guid',
        }),
    );
    const target = await runFixtureObservation(first, () =>
        host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath } }),
    );
    records.length = 0;
    assert.equal(await runFixtureObservation(successor, () => host.health(target)), 'healthy');
    const snapshots = records.filter((record) => record.stage === 'native-snapshot' && record.event === 'begin');
    assert.equal(snapshots.length, 2);
    assert.ok(
        snapshots.every(
            (record) =>
                record.sessionId === first.sessionId &&
                record.operationId === successor.operationId &&
                record.pid === 42,
        ),
    );
    await host.close(target);
});
