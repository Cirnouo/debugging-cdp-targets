import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
    type FixtureEvent,
    type LinuxPrivateIntervalV1,
    runFixtureObservation,
    subscribeFixtureDiagnostics,
} from '../src/adapters/fixture-diagnostics.ts';
import { createPlatformAdapter } from '../src/adapters/platform-process.ts';
import { createTargetHost } from '../src/adapters/target-host.ts';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';
import { RetainedTargetError } from '../src/domains/cdp-target.ts';
import { createFirstStartHarness, drainFirstStart, firstStartRoute } from './fixtures/first-start-capture-fake.ts';
import { validateFirstStartCaptureRecord } from './smoke/linux-first-start-capture-record.ts';

function identityFixture(onUptime?: () => Promise<void>, onNow?: () => void) {
    const state = {
        now: 1_000_500,
        ticks: '100050',
        h: '100',
        boot: '0',
        uid: 7,
        uptime: '1000.50 0.00\n',
        signals: 0,
        uptimeReads: 0,
        statReads: 0,
        listeners: true,
        exitOnSignal: false,
    };
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        exitCode: null as number | null,
        monitoringFailure: '',
    });
    const target: ManagedTarget = {
        processId: 42,
        port: 9222,
        executablePath: process.execPath,
        startedAtUtc: '1970-01-01T00:16:40.500Z',
        targetKind: 'generic-cdp',
        child,
    };
    const adapter = createPlatformAdapter({
        platform: 'linux',
        now: () => {
            onNow?.();
            return state.now;
        },
        unix: {
            currentUser: () => state.uid,
            readlink: async () => process.execPath,
            readText: async (file) => {
                if (file === '/proc/uptime') {
                    state.uptimeReads++;
                    await onUptime?.();
                    return state.uptime;
                }
                if (file === '/proc/stat') return `btime ${state.boot}\n`;
                assert.equal(file, '/proc/42/stat');
                state.statReads++;
                return `42 (chrome) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 ${state.ticks}\n`;
            },
            run: async (command) => ({
                code: 0,
                stderr: '',
                stdout:
                    command === 'getconf'
                        ? `${state.h}\n`
                        : command === 'ps'
                          ? `42 1 ${state.uid} Thu Jan  1 00:16:40 1970 chrome\n`
                          : state.listeners
                            ? 'p42\nn127.0.0.1:9222\n'
                            : '',
            }),
        },
        requestUnixClose: () => {
            state.signals++;
            if (state.exitOnSignal) {
                child.exitCode = 0;
                child.emit('exit', 0);
            }
        },
    });
    return { state, child, target, adapter };
}

function gate() {
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { pending, release };
}

test('Linux identity rejects a changed child PID even when the target PID is unchanged', async () => {
    const f = identityFixture();
    f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
    const evidence = await f.adapter.snapshot(42, 9222);
    f.child.pid = 43;
    await assert.rejects(f.adapter.validateIdentity(evidence, f.target), /identity/);
});

for (const mutation of ['copy', 'session', 'exit', 'monitor', 'cancel'] as const) {
    test(`Linux first binding rechecks ${mutation} after the associated uptime await`, async () => {
        const entered = gate();
        const blocked = gate();
        let block = false;
        const f = identityFixture(async () => {
            if (block) {
                entered.release();
                await blocked.pending;
            }
        });
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        const evidence = await f.adapter.snapshot(42, 9222);
        block = true;
        const abort = new AbortController();
        const operation = f.adapter.validateIdentity(evidence, f.target, { signal: abort.signal });
        const rejected = assert.rejects(operation);
        await entered.pending;
        if (mutation === 'copy') evidence.root = { ...evidence.root };
        if (mutation === 'session') evidence.currentSessionId = 8;
        if (mutation === 'exit') f.child.emit('exit', 0);
        if (mutation === 'monitor') f.child.monitoringFailure = 'observer failed';
        if (mutation === 'cancel') abort.abort(new Error('cancelled'));
        blocked.release();
        await rejected;
        assert.equal(f.state.signals, 0);
    });
}

test('two readiness attempts freeze birth identity and health, verification and close reject later ticks', async () => {
    const f = identityFixture();
    let versions = 0;
    const host = createTargetHost({
        platformAdapter: { ...f.adapter, reservedRanges: async () => [] },
        probe: async () => true,
        now: () => f.state.now,
        spawn: async (_exe, _args, _port, _cwd, _env, context) => {
            context?.onCreated?.(f.child);
            return f.child;
        },
        sleep: async () => {
            f.state.now += 100;
        },
        getVersion: async () => {
            if (++versions === 1) throw new Error('not ready');
            return { Browser: 'Chrome/155', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/ready' };
        },
    });
    const target = await host.launch({
        isolation: { mode: 'none' },
        launch: { executable: process.execPath },
        basePort: 9222,
    });
    assert.equal(versions, 2);
    assert.equal(target.startedAtUtc, '1970-01-01T00:16:40.500Z');
    assert.equal(f.state.uptimeReads, 2);
    f.state.uptime = 'malformed';
    assert.equal(await host.health(target), 'healthy');
    await target.verify?.();
    f.state.listeners = false;
    assert.equal(await host.health(target), 'unavailable');
    f.state.listeners = true;
    f.state.ticks = '100051';
    assert.equal(await host.health(target), 'identity-changed');
    await assert.rejects(target.verify?.() ?? Promise.reject(new Error('missing verify')), /identity/);
    await assert.rejects(host.requestNormalClose(target), /identity/);
    assert.equal(f.state.signals, 0);
    f.child.emit('exit', 0);
    assert.equal(await host.health(target), 'gone');
});

test('a cancelled prelaunch calibration cannot spawn after its late completion', async () => {
    const entered = gate();
    const blocked = gate();
    const f = identityFixture(async () => {
        entered.release();
        await blocked.pending;
    });
    const abort = new AbortController();
    let spawned = 0;
    const host = createTargetHost({
        platformAdapter: { ...f.adapter, reservedRanges: async () => [] },
        probe: async () => true,
        now: () => f.state.now,
        spawn: async () => {
            spawned++;
            return f.child;
        },
    });
    const operation = host.launch(
        { isolation: { mode: 'none' }, launch: { executable: process.execPath }, basePort: 9222 },
        { signal: abort.signal },
    );
    const rejected = assert.rejects(operation, /cancelled/);
    await entered.pending;
    abort.abort(new Error('cancelled'));
    await rejected;
    blocked.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(spawned, 0);
});

test('expired calibration cannot bind before delayed timeout delivery but independent rollback can bind', async (t) => {
    const pendingTimer = new AbortController();
    const budgets: number[] = [];
    t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
        budgets.push(milliseconds);
        return pendingTimer.signal;
    });
    const f = identityFixture(async () => {
        if (f.state.uptimeReads === 2) {
            f.state.now += 10;
            f.state.uptime = '1020.50 0.00\n';
        }
    });
    t.after(() => f.child.emit('exit', 0));
    f.state.now = 1_000_501;
    f.state.exitOnSignal = true;
    let snapshots = 0;
    let endpoints = 0;
    let rollbackStartedAt: string | undefined;
    const host = createTargetHost({
        platformAdapter: {
            ...f.adapter,
            reservedRanges: async () => [],
            snapshot: async (pid, port) => {
                const evidence = await f.adapter.snapshot(pid, port);
                if (++snapshots === 1) f.state.now += 19_995;
                return evidence;
            },
        },
        probe: async () => true,
        now: () => f.state.now,
        spawn: async () => f.child,
        sleep: async () => {},
        getVersion: async () => {
            endpoints++;
            return { Browser: 'Chrome/155', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/ready' };
        },
    });
    await assert.rejects(
        host.launch(
            { isolation: { mode: 'none' }, launch: { executable: process.execPath }, basePort: 9222 },
            {
                onRollback: (target) => {
                    rollbackStartedAt = target.startedAtUtc;
                },
            },
        ),
        /readiness budget expired/,
    );
    assert.equal(pendingTimer.signal.aborted, false, 'Elapsed expiry must not depend on timeout callback delivery.');
    assert.deepEqual(budgets, [5]);
    assert.equal(f.state.now, 1_020_506);
    assert.equal(
        rollbackStartedAt,
        '1970-01-01T00:16:40.501Z',
        'The expired decision must still be unbound at rollback entry.',
    );
    assert.equal(endpoints, 0);
    assert.equal(f.state.uptimeReads, 3, 'Independent rollback must perform its own first-binding calibration.');
    assert.equal(f.state.signals, 1, 'Verified independent normal cleanup remains authorized after readiness expiry.');
    assert.equal(f.child.exitCode, 0);
});

test('readiness rechecks elapsed time after validation before endpoint discovery', async (t) => {
    const pendingTimer = new AbortController();
    t.mock.method(AbortSignal, 'timeout', () => pendingTimer.signal);
    const f = identityFixture();
    t.after(() => f.child.emit('exit', 0));
    f.state.now = 1_000_501;
    f.state.exitOnSignal = true;
    let endpoints = 0;
    let rollbackStartedAt: string | undefined;
    const host = createTargetHost({
        platformAdapter: {
            ...f.adapter,
            reservedRanges: async () => [],
            validateIdentity: async (evidence, target, context) => {
                await f.adapter.validateIdentity(evidence, target, context);
                f.state.now += 20_000;
            },
        },
        probe: async () => true,
        now: () => f.state.now,
        spawn: async () => f.child,
        sleep: async () => {},
        getVersion: async () => {
            endpoints++;
            return { Browser: 'Chrome/155', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/ready' };
        },
    });
    await assert.rejects(
        host.launch(
            { isolation: { mode: 'none' }, launch: { executable: process.execPath }, basePort: 9222 },
            {
                onRollback: (target) => {
                    rollbackStartedAt = target.startedAtUtc;
                },
            },
        ),
        /readiness budget expired/,
    );
    assert.equal(pendingTimer.signal.aborted, false);
    assert.equal(
        rollbackStartedAt,
        '1970-01-01T00:16:40.500Z',
        'The earlier valid binding survives independent cleanup.',
    );
    assert.equal(endpoints, 0);
    assert.equal(f.state.uptimeReads, 2, 'Already bound cleanup does not recalibrate.');
    assert.equal(f.state.signals, 1);
    assert.equal(f.child.exitCode, 0);
});

test('post-root calibration uses only the remaining readiness budget and late completion cannot bind', async (t) => {
    const entered = gate();
    const blocked = gate();
    const deadline = new AbortController();
    const budgets: number[] = [];
    t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
        budgets.push(milliseconds);
        return deadline.signal;
    });
    const f = identityFixture(async () => {
        if (f.state.uptimeReads === 2) {
            entered.release();
            await blocked.pending;
        } else if (f.state.uptimeReads > 2) f.state.uptime = '';
    });
    f.state.now = 1_000_501;
    let endpointCalls = 0;
    let created: ManagedTarget | undefined;
    const host = createTargetHost({
        platformAdapter: {
            ...f.adapter,
            reservedRanges: async () => [],
            snapshot: async (pid, port) => {
                const evidence = await f.adapter.snapshot(pid, port);
                f.state.now += 19_995;
                return evidence;
            },
        },
        probe: async () => true,
        now: () => f.state.now,
        spawn: async () => f.child,
        sleep: async (ms) => {
            f.state.now += ms;
        },
        getVersion: async () => {
            endpointCalls++;
            return {};
        },
    });
    const operation = host.launch(
        { isolation: { mode: 'none' }, launch: { executable: process.execPath }, basePort: 9222 },
        {
            onCreated: (target) => {
                created = target;
            },
        },
    );
    const rejected = assert.rejects(operation, (error: unknown) => error instanceof RetainedTargetError);
    await entered.pending;
    assert.deepEqual(budgets, [5]);
    f.state.now += 5;
    deadline.abort(new Error('readiness budget expired'));
    await rejected;
    blocked.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(created?.startedAtUtc, '1970-01-01T00:16:40.501Z');
    assert.equal(endpointCalls, 0);
    assert.equal(f.state.signals, 0);
    f.child.emit('exit', 0);
});

for (const diagnostics of ['off', 'on', 'throwing'] as const) {
    test(`Linux proof remains enforced with diagnostics ${diagnostics}`, async (t) => {
        if (diagnostics !== 'off')
            t.after(
                subscribeFixtureDiagnostics(() => {
                    if (diagnostics === 'throwing') throw new Error('observer failed');
                }),
            );
        const f = identityFixture();
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
        f.state.ticks = '100051';
        await assert.rejects(
            f.adapter.requestNormalClose?.(f.target) ?? Promise.reject(new Error('missing close')),
            /identity/,
        );
        assert.equal(f.state.signals, 0);
    });
}

test('a different onCreated child cannot replace retained actual ownership', async () => {
    const f = identityFixture();
    const other = Object.assign(new EventEmitter(), { pid: 43, exitCode: null });
    const host = createTargetHost({
        platformAdapter: { ...f.adapter, reservedRanges: async () => [] },
        probe: async () => true,
        now: () => f.state.now,
        spawn: async (_exe, _args, _port, _cwd, _env, context) => {
            context?.onCreated?.(f.child);
            f.state.uptime = '';
            context?.onCreated?.(other);
            return other;
        },
    });
    await assert.rejects(
        host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath }, basePort: 9222 }),
        (error: unknown) => {
            assert.ok(error instanceof RetainedTargetError);
            assert.equal(error.target.child, f.child);
            assert.equal(error.target.processId, 42);
            return true;
        },
    );
    assert.equal(f.state.signals, 0);
    f.child.emit('exit', 0);
});

test('first binding rejects a backwards uptime bracket even when offset intervals overlap', async () => {
    const f = identityFixture();
    f.state.ticks = '100049';
    f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
    f.state.uptime = '1000.49 0.00\n';
    await assert.rejects(f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target), /identity|clock/);
});

test('first binding rejects backwards UTC between otherwise overlapping calibration brackets', async () => {
    const f = identityFixture(async () => {
        if (f.state.uptimeReads === 1) f.state.now = 1_000_510;
    });
    f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), 1_000_500);
    f.state.now = 1_000_505;
    await assert.rejects(f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target), /identity|clock/);
});

for (const fault of ['missing-uptime', 'conflicting-boot', 'conflicting-offset', 'changed-h', 'changed-uid'] as const) {
    test(`Linux ${fault} cannot authorize initial binding or a cleanup signal`, async () => {
        const f = identityFixture();
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        if (fault === 'changed-h' || fault === 'changed-uid')
            await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
        if (fault === 'missing-uptime') f.state.uptime = '';
        if (fault === 'conflicting-boot') f.state.boot = '10';
        if (fault === 'conflicting-offset') f.state.now += 10_000;
        if (fault === 'changed-h') f.state.h = '60';
        if (fault === 'changed-uid') f.state.uid = 8;
        await assert.rejects(f.adapter.requestNormalClose?.(f.target) ?? Promise.reject(new Error('missing close')));
        assert.equal(f.state.signals, 0);
        f.child.emit('exit', 0);
        assert.equal(await f.adapter.close(f.target), true);
    });
}

test('root stat precedes its associated upper sample and q zero remains valid', async () => {
    let reads = 0;
    const f = identityFixture(async () => {
        if (++reads === 2) assert.equal(f.state.statReads, 1);
    });
    f.state.now = 0;
    f.state.ticks = '0';
    f.state.uptime = '0.00 0.00\n';
    f.target.startedAtUtc = '1970-01-01T00:00:00.000Z';
    f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), 0);
    await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
    assert.equal(f.target.startedAtUtc, '1970-01-01T00:00:00.000Z');
});

test('Linux first binding requires registered actual child and exact adapter root provenance', async () => {
    const f = identityFixture();
    assert.equal(typeof f.adapter.prepareLaunch, 'function', 'Actual-child launch calibration is required.');
    const calibration = await f.adapter.prepareLaunch();
    const earlier = await f.adapter.snapshot(42, 9222);
    await assert.rejects(f.adapter.validateIdentity(earlier, f.target), /identity|registered/);
    f.adapter.registerLaunch(f.target, calibration, 1_000_500);
    await assert.rejects(f.adapter.validateIdentity(earlier, f.target), /identity|proof/);
    const evidence = await f.adapter.snapshot(42, 9222);
    f.adapter.registerLaunch(f.target, calibration, 1_000_500);
    await assert.rejects(
        f.adapter.validateIdentity({ ...evidence, root: { ...evidence.root } }, f.target),
        /identity|proof/,
    );
    const foreign = identityFixture();
    await assert.rejects(
        f.adapter.validateIdentity(await foreign.adapter.snapshot(42, 9222), f.target),
        /identity|proof/,
    );
    await f.adapter.validateIdentity(evidence, f.target);
    assert.equal(f.target.startedAtUtc, '1970-01-01T00:16:40.500Z');
    const copy = { ...f.target };
    await assert.rejects(f.adapter.validateIdentity(evidence, copy), /identity|registered/);
    f.target.child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null });
    assert.throws(() => f.adapter.registerLaunch(f.target, calibration, 1_000_500), /identity|child/);
    await assert.rejects(f.adapter.validateIdentity(evidence, f.target), /identity|child/);
});

test('Linux bound identity keeps raw continuity without a new UTC calibration', async () => {
    const f = identityFixture();
    assert.equal(typeof f.adapter.prepareLaunch, 'function');
    f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
    await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
    const reads = f.state.uptimeReads;
    f.state.now += 100_000;
    f.state.uptime = 'malformed';
    f.state.boot = 'malformed';
    await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
    assert.equal(f.state.uptimeReads, reads);
    f.state.ticks = '100051';
    await assert.rejects(f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target), /identity|changed/);
    await assert.rejects(
        f.adapter.requestNormalClose?.(f.target) ?? Promise.reject(new Error('missing close')),
        /identity|changed/,
    );
    assert.equal(f.state.signals, 0);
});

test('Linux native close applies identical first binding and rejects mutated evidence', async () => {
    const f = identityFixture();
    assert.equal(typeof f.adapter.prepareLaunch, 'function');
    f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
    await f.adapter.requestNormalClose?.(f.target);
    assert.equal(f.state.signals, 1);
    for (const accessor of [false, true]) {
        const evidence = await f.adapter.snapshot(42, 9222);
        if (!evidence.root.exists) throw new Error('fixture root missing');
        if (accessor) Object.defineProperty(evidence.root, 'startedAtUtc', { get: () => f.target.startedAtUtc });
        else evidence.root.startedAtUtc = '1970-01-01T00:16:40.501Z';
        await assert.rejects(f.adapter.validateIdentity(evidence, f.target), /identity|proof/);
    }
});

test('one child or live PID cannot receive a second launch registration and actual exit permits a fresh target', async () => {
    const f = identityFixture();
    f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
    const secondToken = await f.adapter.prepareLaunch();
    assert.throws(() => f.adapter.registerLaunch({ ...f.target }, secondToken, f.state.now), /identity|registered/);
    const child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null });
    const next: ManagedTarget = { ...f.target, child };
    assert.throws(() => f.adapter.registerLaunch(next, secondToken, f.state.now), /identity|registered/);
    await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
    f.child.emit('exit', 0);
    f.state.now = 1_001_500;
    f.state.ticks = '100150';
    f.state.uptime = '1001.50 0.00\n';
    next.startedAtUtc = '1970-01-01T00:16:41.500Z';
    f.adapter.registerLaunch(next, await f.adapter.prepareLaunch(), f.state.now);
    await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), next);
    assert.equal(next.startedAtUtc, '1970-01-01T00:16:41.500Z');
    await assert.rejects(f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target), /identity/);
    child.emit('exit', 0);
});

test('an exited or failed actual child cannot acquire launch authorization', async () => {
    for (const failure of ['exit', 'monitor'] as const) {
        const f = identityFixture();
        const token = await f.adapter.prepareLaunch();
        if (failure === 'exit') f.child.exitCode = 0;
        else f.child.monitoringFailure = 'observer failed';
        assert.throws(() => f.adapter.registerLaunch(f.target, token, f.state.now), /identity/);
    }
});

test('native close rechecks observation immediately before signaling after async binding', async () => {
    let reads = 0;
    const f = identityFixture(undefined, () => {
        if (++reads === 5)
            queueMicrotask(() => {
                f.child.monitoringFailure = 'observer failed';
            });
    });
    f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
    await assert.rejects(
        f.adapter.requestNormalClose?.(f.target) ?? Promise.reject(new Error('missing close')),
        /identity/,
    );
    assert.equal(f.state.signals, 0);
});

test('readiness cannot discover an endpoint after observation fails during binding completion', async () => {
    let reads = 0;
    const f = identityFixture(undefined, () => {
        if (++reads === 5)
            queueMicrotask(() => {
                f.child.monitoringFailure = 'observer failed';
            });
    });
    let endpoints = 0;
    const host = createTargetHost({
        platformAdapter: { ...f.adapter, reservedRanges: async () => [] },
        probe: async () => true,
        now: () => f.state.now,
        spawn: async () => f.child,
        getVersion: async () => {
            endpoints++;
            return { Browser: 'Chrome/155', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/ready' };
        },
    });
    await assert.rejects(
        host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath }, basePort: 9222 }),
        (error: unknown) => error instanceof RetainedTargetError,
    );
    assert.equal(endpoints, 0);
    assert.equal(f.state.signals, 0);
    f.child.emit('exit', 0);
});

// These literal expectations catch wrong kernel branches, inclusive edges and
// accidental selection of a recent inverse after uint64 multiplication wraps.
test('Linux birth inverse encloses the reviewed kernel branches and zero', async () => {
    const module = await import('../src/adapters/linux-creation-identity.ts').catch(() => undefined);
    assert.ok(module, 'The exact Linux creation interval provider is required.');
    for (const [rawTicks, clkTck, readerBirthUpperNs, expected] of [
        [0n, 100n, 9_999_999n, { lowerNs: 0n, upperNs: 9_999_999n }],
        [12_345n, 100n, 123_469_999_999n, { lowerNs: 123_450_000_000n, upperNs: 123_459_999_999n }],
        [1n, 60n, 100_000_000n, { lowerNs: 16_666_667n, upperNs: 33_333_333n }],
        [1n, 144n, 100_000_000n, { lowerNs: 6_944_445n, upperNs: 13_888_888n }],
        [1n, 300n, 100_000_000n, { lowerNs: 3_333_334n, upperNs: 6_666_666n }],
        [1n, 1024n, 100_000_000n, { lowerNs: 976_563n, upperNs: 1_953_124n }],
        [0n, 1024n, 18_014_398_509_481_984n, { lowerNs: 0n, upperNs: 18_014_398_509_481_984n }],
        [0n, 18_000_000_001n, 100n, undefined],
        [-1n, 100n, 100n, undefined],
        [0n, 0n, 100n, undefined],
        [10n, 100n, 1n, undefined],
        [0n, 100n, 18_446_744_073_709_551_616n, undefined],
    ] as const) {
        assert.deepEqual(module.linuxBirthInterval({ rawTicks, clkTck, readerBirthUpperNs }), expected);
    }
});

test('strict uptime brackets preserve scheduling uncertainty and reject malformed clocks', async () => {
    const module = await import('../src/adapters/linux-creation-identity.ts').catch(() => undefined);
    assert.ok(module, 'The direct uptime provider is required.');
    assert.deepEqual(
        await module.readLinuxCalibration(
            async () => '0.00 0.00\n',
            () => 1_000,
        ),
        {
            lowerNs: 990_000_000n,
            upperNs: 1_001_000_000n,
            uptimeUpperNs: 9_999_999n,
            beforeUtcMs: 1_000,
            afterUtcMs: 1_000,
        },
    );
    let scheduled = 1_000;
    const wide = await module.readLinuxCalibration(
        async () => {
            scheduled = 3_000;
            return '0.00 0.00\n';
        },
        () => scheduled,
    );
    assert.deepEqual([wide.lowerNs, wide.upperNs], [990_000_000n, 3_001_000_000n]);
    assert.equal(
        module.linuxPublicTime(wide, 2_000, 2_000),
        undefined,
        'An overlapping midpoint cannot hide wide uncertainty.',
    );
    for (const invalid of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
        await assert.rejects(
            module.readLinuxCalibration(
                async () => '0.00 0.00\n',
                () => invalid,
            ),
            /unverifiable/,
        );
    for (const text of [
        '0',
        '0.0 0.00',
        '-1.00 0.00',
        '1.000 0.00',
        'NaN 0.00',
        '1e2 0.00',
        '',
        '18446744074.00 0.00',
    ]) {
        await assert.rejects(
            module.readLinuxCalibration(
                async () => text,
                () => 1_000,
            ),
            /unverifiable/,
        );
    }
    let clock = 1_000;
    await assert.rejects(
        module.readLinuxCalibration(
            async () => {
                clock = 999;
                return '0.00 0.00';
            },
            () => clock,
        ),
        /unverifiable/,
    );
});

test('UTC interval containment keeps the exact allowance and chooses an in-range integer Date', async () => {
    const module = await import('../src/adapters/linux-creation-identity.ts').catch(() => undefined);
    assert.ok(module, 'The interval containment policy is required.');
    assert.equal(
        module.linuxPublicTime({ lowerNs: 0n, upperNs: 2_000_000_000n }, 1_000, 1_000),
        '1970-01-01T00:00:00.000Z',
    );
    assert.equal(module.linuxPublicTime({ lowerNs: -1n, upperNs: 2_000_000_000n }, 1_000, 1_000), undefined);
    assert.equal(module.linuxPublicTime({ lowerNs: 0n, upperNs: 2_000_000_001n }, 1_000, 1_000), undefined);
    assert.equal(module.linuxPublicTime({ lowerNs: 1n, upperNs: 999_999n }, 0, 0), undefined);
    assert.equal(module.linuxPublicTime({ lowerNs: -999_999n, upperNs: 0n }, 0, 0), '1970-01-01T00:00:00.000Z');
    assert.equal(
        module.linuxPublicTime(
            { lowerNs: 8_640_000_000_000_000_000_000n, upperNs: 8_640_000_000_000_000_000_000n },
            8_640_000_000_000_000,
            8_640_000_000_000_000,
        ),
        '+275760-09-13T00:00:00.000Z',
    );
    assert.equal(
        module.linuxPublicTime(
            { lowerNs: 8_640_000_000_000_001_000_000n, upperNs: 8_640_000_000_000_001_000_000n },
            8_640_000_000_000_000,
            8_640_000_000_000_000,
        ),
        undefined,
    );
});

test('current Linux owned adapter publishes accepted and rejected private intervals through capture receipts', async () => {
    const h = createFirstStartHarness();
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics(
        (event) => {
            events.push(event);
            h.observe(event);
        },
        undefined,
        undefined,
        { creationIdentity: { matches: h.matchesCreationOrigin } },
    );
    try {
        h.event('spawn', 'begin', { pid: 42, port: 9222 });
        h.event('spawn', 'decision', { reason: 'acquired', pid: 42, port: 9222 });
        h.event('readiness', 'begin', { phase: 'waiting-cdp', pid: 42, port: 9222 });
        await runFixtureObservation({ ...firstStartRoute, pid: 42, port: 9222 }, async () => {
            const f = identityFixture();
            f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
            const evidence = await f.adapter.snapshot(42, 9222);
            await f.adapter.validateIdentity(evidence, f.target);
            f.state.ticks = '100051';
            await assert.rejects(
                f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target),
                /identity changed/,
            );
            assert.equal(f.state.uptimeReads, 2);
            assert.equal(f.state.statReads, 2);
            assert.equal(f.target.startedAtUtc, '1970-01-01T00:16:40.500Z');
        });
        const decisions = events.filter((event) => event.stage === 'process-creation-identity');
        assert.equal(decisions.length, 2, 'Actual registered Linux validation must publish both decisions.');
        assert.deepEqual(
            decisions.map((event) => Reflect.get(event, 'linuxIdentity')?.decision),
            ['initial-accepted', 'established-changed'],
        );
        h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed', pid: 42 });
        assert.equal(h.records.length, 0);
        h.event('native-close', 'end', { pid: 42 });
        await drainFirstStart(h);
        const receipts = h.records.filter((record) => record.creation);
        assert.equal(receipts.length, 2);
        assert.deepEqual(
            receipts.map((record) => record.status),
            ['complete', 'identity-invalid'],
        );
        for (const record of receipts) {
            assert.ok(validateFirstStartCaptureRecord(record));
            assert.equal(Reflect.get(record.creation ?? {}, 'model'), 'linux-private-interval-v1');
            assert.equal(Reflect.get(record.creation ?? {}, 'linuxIdentity'), undefined);
        }
    } finally {
        stop();
        h.finish();
    }
});
async function observeOwned(
    job: (events: LinuxPrivateIntervalV1[], stats: () => { comparisons: number; tokens: number }) => Promise<void>,
) {
    const events: LinuxPrivateIntervalV1[] = [];
    const stop = subscribeFixtureDiagnostics(
        (event) => {
            if (event.linuxIdentity) events.push(event.linuxIdentity);
        },
        undefined,
        undefined,
        {
            creationIdentity: { matches: (origin) => origin.pid === 42 && origin.port === 9222 },
        },
    );
    try {
        await runFixtureObservation({ ...firstStartRoute, pid: 42, port: 9222 }, () =>
            job(events, stop.creationIdentityStats),
        );
    } finally {
        stop();
    }
}
for (const [h, q, branch] of [
    ['100', '100050', 'divide'],
    ['1024', '1024512', 'multiply-512'],
    ['300', '300150', 'multiply-9'],
] as const) {
    test(`owned Linux interval records actual ${branch} and established reads omit calibration`, async () => {
        await observeOwned(async (events) => {
            let calls = 0;
            const f = identityFixture(undefined, () => {
                calls++;
            });
            f.state.h = h;
            f.state.ticks = q;
            f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
            await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
            await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
            assert.deepEqual(
                events.map((event) => event.decision),
                ['initial-accepted', 'established-accepted'],
            );
            assert.equal(events[0]?.facts.birth?.branch, branch);
            assert.equal(events[0]?.facts.birth?.result, 'present');
            assert.deepEqual(Object.keys(events[1]?.facts ?? {}).sort(), ['raw', 'selectedMs']);
            assert.equal(calls, 5);
            assert.equal(f.state.uptimeReads, 2);
            assert.equal(f.state.statReads, 2);
        });
    });
}
for (const scenario of [
    'no-launch',
    'launch-check-threw',
    'root-proof-rejected',
    'clock-order-rejected',
    'root-proof-changed',
    'post-launch-check-threw',
    'decision-clock-rejected',
    'interval-rejected',
    'readiness-check-threw',
    'final-launch-check-threw',
] as const) {
    test(`owned Linux reached facts stop at ${scenario}`, async () => {
        await observeOwned(async (events) => {
            let calls = 0;
            const native = new Error('exact readiness failure');
            const f = identityFixture(
                async () => {
                    if (f.state.uptimeReads === 2) {
                        if (scenario === 'root-proof-changed') evidence.root = { ...evidence.root };
                        if (scenario === 'post-launch-check-threw') f.child.pid = 43;
                        if (scenario === 'clock-order-rejected') f.state.uptime = '1000.49 0.00\n';
                    }
                },
                () => {
                    if (++calls === 5 && scenario === 'decision-clock-rejected') f.state.now--;
                },
            );
            if (scenario !== 'no-launch')
                f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
            if (scenario === 'interval-rejected') f.state.boot = '1';
            const evidence = await f.adapter.snapshot(42, 9222);
            if (scenario === 'launch-check-threw') f.child.pid = 43;
            if (scenario === 'root-proof-rejected' && evidence.root.exists) evidence.root.sessionId = 8;
            await assert.rejects(
                f.adapter.validateIdentity(evidence, f.target, {
                    assertReadinessActive: () => {
                        if (scenario === 'readiness-check-threw') throw native;
                        if (scenario === 'final-launch-check-threw') f.child.pid = 43;
                    },
                }),
                (error) => (scenario === 'readiness-check-threw' ? error === native : error instanceof Error),
            );
            assert.equal(events.length, 1);
            assert.equal(events[0]?.decision, scenario);
            const facts = events[0]?.facts;
            assert.equal(facts?.selectedMs, undefined);
            if (scenario === 'no-launch' || scenario === 'launch-check-threw' || scenario === 'root-proof-rejected')
                assert.deepEqual(facts, {});
            if (scenario === 'interval-rejected') {
                assert.deepEqual(facts?.offset, { status: 'empty', lowerNs: '1000000000', upperNs: '1000000' });
                assert.equal(facts?.birth?.result, 'present');
                assert.equal(facts?.public, undefined);
            }
            if (scenario === 'decision-clock-rejected') {
                assert.equal(facts?.birth?.result, 'present');
                assert.equal(facts?.decisionUtcMs, 1000499);
                assert.equal(facts?.public, undefined);
            }
            assert.equal(f.state.signals, 0);
        });
    });
}
for (const position of [3, 4, 5]) {
    test(`owned Linux now exception at call ${position} remains exact and unclassified through abortable`, async () => {
        await observeOwned(async (events, stats) => {
            const original = { clock: position };
            let calls = 0;
            const f = identityFixture(undefined, () => {
                if (++calls === position) throw original;
            });
            f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
            const evidence = await f.adapter.snapshot(42, 9222);
            await assert.rejects(f.adapter.validateIdentity(evidence, f.target), (error) => error === original);
            assert.equal(events.length, 0);
            assert.equal(stats().comparisons, 0);
            assert.equal(calls, position);
        });
    });
}
for (const failure of ['read-or-abort', 'bracket-or-text-invalid', 'uptime-out-of-range'] as const) {
    test(`owned Linux post calibration traces ${failure} without parsing native errors`, async () => {
        await observeOwned(async (events) => {
            const original = { private: 'opaque read failure' };
            const f = identityFixture(async () => {
                if (f.state.uptimeReads === 2 && failure === 'read-or-abort') throw original;
            });
            f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
            const evidence = await f.adapter.snapshot(42, 9222);
            if (failure === 'bracket-or-text-invalid') f.state.uptime = 'bad';
            if (failure === 'uptime-out-of-range') f.state.uptime = '18446744074.00 0.00\n';
            await assert.rejects(f.adapter.validateIdentity(evidence, f.target), (error) =>
                failure === 'read-or-abort' ? error === original : error instanceof Error,
            );
            assert.equal(events[0]?.decision, 'post-calibration-threw');
            assert.deepEqual(events[0]?.facts.postFailure, { branch: failure });
            assert.equal(events[0]?.facts.post, undefined);
        });
    });
}
test('owned Linux abort snapshot remains frozen after late calibration and cannot bind or publish again', async () => {
    await observeOwned(async (events) => {
        const entered = gate(),
            pending = gate();
        const f = identityFixture(async () => {
            if (f.state.uptimeReads === 2) {
                entered.release();
                await pending.pending;
            }
        });
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        const evidence = await f.adapter.snapshot(42, 9222);
        const abort = new AbortController();
        const original = new Error('cancel exact');
        const operation = f.adapter.validateIdentity(evidence, f.target, { signal: abort.signal });
        const rejection = assert.rejects(operation, (error) => error === original);
        await entered.pending;
        abort.abort(original);
        await rejection;
        assert.deepEqual(events[0]?.facts.postFailure, { branch: 'read-or-abort' });
        const frozen = JSON.stringify(events);
        pending.release();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(JSON.stringify(events), frozen);
        assert.ok(Object.isFrozen(events[0]?.facts.pre?.offset));
        await f.adapter.validateIdentity(evidence, f.target);
        assert.equal(events[1]?.mode, 'initial');
        assert.equal(f.state.uptimeReads, 3);
    });
});
test('concurrent owned Linux initial decision retains its own candidate and the first bound point', async () => {
    await observeOwned(async (events) => {
        const entered = gate(),
            pending = gate();
        const f = identityFixture(async () => {
            if (f.state.uptimeReads === 2) {
                entered.release();
                await pending.pending;
            }
        });
        f.state.now = 1000501;
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        const evidence = await f.adapter.snapshot(42, 9222);
        const first = f.adapter.validateIdentity(evidence, f.target);
        await entered.pending;
        f.state.now = 1000511;
        await f.adapter.validateIdentity(evidence, f.target);
        pending.release();
        await first;
        assert.deepEqual(
            events.map((event) => event.mode),
            ['initial', 'initial'],
        );
        assert.deepEqual(
            events.map((event) => event.facts.public?.pointMs),
            ['1000501', '1000500'],
        );
        assert.deepEqual(
            events.map((event) => event.facts.selectedMs),
            [1000501, 1000501],
        );
    });
});
test('owned Linux comparison consumes token128 unused frame once and refuses repeat admission', async () => {
    await observeOwned(async (events, stats) => {
        const f = identityFixture();
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        for (let index = 0; index < 127; index++) await f.adapter.snapshot(42, 9222);
        const evidence = await f.adapter.snapshot(42, 9222);
        await f.adapter.validateIdentity(evidence, f.target);
        await f.adapter.validateIdentity(evidence, f.target);
        assert.equal(events.length, 1);
        assert.equal(stats().tokens, 128);
        assert.equal(stats().comparisons, 1);
    });
});
test('owned Linux reserves comparison before a failed serializer while native bind still succeeds', async (t) => {
    await observeOwned(async (events, stats) => {
        const f = identityFixture();
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        const evidence = await f.adapter.snapshot(42, 9222);
        const broken = t.mock.method(JSON, 'stringify', () => {
            throw new Error('diagnostic serialization');
        });
        await f.adapter.validateIdentity(evidence, f.target);
        broken.mock.restore();
        assert.equal(events.length, 0);
        assert.equal(stats().comparisons, 1);
        await f.adapter.validateIdentity(evidence, f.target);
        assert.equal(events[0]?.decision, 'established-accepted');
    });
});
for (const kind of [
    'copied',
    'foreign-origin',
    'foreign-pid',
    'foreign-port',
    'foreign-adapter',
    'stale-source',
    'mutated-root',
] as const) {
    test(`owned Linux association respects ${kind} without inventing provenance`, async () => {
        await observeOwned(async (events, stats) => {
            const f = identityFixture();
            const stale = kind === 'stale-source' ? await f.adapter.snapshot(42, 9222) : undefined;
            f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
            const evidence = stale ?? (await f.adapter.snapshot(42, 9222));
            if (kind === 'copied') evidence.root = { ...evidence.root };
            if (kind === 'mutated-root' && evidence.root.exists)
                evidence.root.startedAtUtc = '2000-01-01T00:00:00.000Z';
            if (kind === 'foreign-adapter') {
                const other = identityFixture();
                other.adapter.registerLaunch(other.target, await other.adapter.prepareLaunch(), other.state.now);
                await assert.rejects(other.adapter.validateIdentity(evidence, other.target));
            } else {
                const scope = {
                    ...firstStartRoute,
                    pid: kind === 'foreign-pid' ? 43 : 42,
                    port: kind === 'foreign-port' ? 9223 : 9222,
                    operationId:
                        kind === 'foreign-origin'
                            ? '66666666-6666-4666-8666-666666666666'
                            : firstStartRoute.operationId,
                };
                const operation = runFixtureObservation(scope, () => f.adapter.validateIdentity(evidence, f.target));
                if (['copied', 'mutated-root', 'stale-source'].includes(kind)) await assert.rejects(operation);
                else await operation;
            }
            if (['foreign-adapter', 'stale-source', 'mutated-root'].includes(kind)) {
                assert.equal(events[0]?.decision, 'root-proof-rejected');
                assert.equal(stats().comparisons, 1);
            } else {
                assert.equal(events.length, 0);
                assert.equal(stats().comparisons, 0);
            }
        });
    });
}
test('owned Linux concurrent changed ticks reject the waiting initial call after the completed bind', async () => {
    await observeOwned(async (events) => {
        const entered = gate(),
            pending = gate();
        const f = identityFixture(async () => {
            if (f.state.uptimeReads === 2) {
                entered.release();
                await pending.pending;
            }
        });
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        const evidence = await f.adapter.snapshot(42, 9222);
        const first = f.adapter.validateIdentity(evidence, f.target);
        const rejected = assert.rejects(first, /identity changed/);
        await entered.pending;
        f.state.ticks = '100049';
        await f.adapter.validateIdentity(await f.adapter.snapshot(42, 9222), f.target);
        pending.release();
        await rejected;
        assert.equal(events[1]?.decision, 'concurrent-changed');
        assert.equal(events[1]?.mode, 'initial');
        assert.equal(events[1]?.facts.public?.branch, 'accepted');
        assert.equal(events[1]?.facts.selectedMs, undefined);
    });
});

test('terminal diagnostic point conversion failure cannot replace completed native binding', async (t) => {
    await observeOwned(async (events, stats) => {
        const f = identityFixture();
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        const evidence = await f.adapter.snapshot(42, 9222);
        const failed = t.mock.method(Date, 'parse', () => {
            throw new Error('diagnostic conversion failed');
        });
        await f.adapter.validateIdentity(evidence, f.target);
        failed.mock.restore();
        assert.equal(events.length, 0);
        assert.equal(stats().comparisons, 1);
        await f.adapter.validateIdentity(evidence, f.target);
        assert.equal(events[0]?.decision, 'established-accepted');
    });
});
test('direct-helper traces distinguish invalid inputs and inverse guard exits without changing arithmetic', async () => {
    const module = await import('../src/adapters/linux-creation-identity.ts');
    for (const [q, h, x, branch, result] of [
        [-1n, 100n, 1n, 'input-rejected', 'input-rejected'],
        [1n, 9007199254740991n, 1n, 'multiply-9', 'zero-divisor'],
        [9007199254740991n, 1024n, 1n, 'multiply-512', 'range-rejected'],
        [2n, 100n, 0n, 'divide', 'empty'],
    ] as const) {
        const trace: import('../src/adapters/linux-creation-identity.ts').LinuxBirthTrace = {};
        assert.equal(module.linuxBirthInterval({ rawTicks: q, clkTck: h, readerBirthUpperNs: x }, trace), undefined);
        assert.deepEqual(trace, { branch, result, readerUpperNs: x });
    }
    const frozen = Object.freeze({});
    assert.deepEqual(module.linuxBirthInterval({ rawTicks: 0n, clkTck: 100n, readerBirthUpperNs: 1n }, frozen), {
        lowerNs: 0n,
        upperNs: 1n,
    });
    assert.equal(module.linuxPublicTime({ lowerNs: 0n, upperNs: 1000000n }, 0, 0, frozen), '1970-01-01T00:00:00.000Z');
});
for (const fault of ['matcher-throw', 'matcher-revoke', 'observer-throw', 'missing-stat-time'] as const) {
    test(`owned Linux supported diagnostic ${fault} cannot change native identity`, async (t) => {
        const events: FixtureEvent[] = [];
        let matches = 0;
        const stop = subscribeFixtureDiagnostics(
            (event) => {
                if (event.stage === 'process-creation-identity') {
                    events.push(event);
                    if (fault === 'observer-throw') throw new Error('observer');
                }
            },
            undefined,
            undefined,
            {
                creationIdentity: {
                    matches: () => {
                        if (++matches === 2) {
                            if (fault === 'matcher-throw') throw new Error('matcher');
                            if (fault === 'matcher-revoke') stop.revokeCreationIdentity();
                        }
                        return true;
                    },
                },
            },
        );
        try {
            await runFixtureObservation({ ...firstStartRoute, pid: 42, port: 9222 }, async () => {
                const f = identityFixture();
                f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
                const clock = fault === 'missing-stat-time' ? t.mock.method(performance, 'now', () => NaN) : undefined;
                const evidence = await f.adapter.snapshot(42, 9222);
                clock?.mock.restore();
                await f.adapter.validateIdentity(evidence, f.target);
                assert.equal(events.length, fault === 'observer-throw' ? 1 : 0);
                assert.equal(f.state.uptimeReads, 2);
                assert.equal(f.target.startedAtUtc, '1970-01-01T00:16:40.500Z');
            });
        } finally {
            stop();
        }
    });
}
test('prebranch diagnostics never evaluate a root accessor before native launch guards', async () => {
    await observeOwned(async () => {
        const f = identityFixture();
        const evidence = await f.adapter.snapshot(42, 9222);
        let accessed = 0;
        Object.defineProperty(evidence, 'root', {
            get() {
                accessed++;
                throw new Error('must not reach root');
            },
        });
        await assert.rejects(f.adapter.validateIdentity(evidence, f.target), /no registered launch/);
        f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
        f.child.pid = 43;
        await assert.rejects(f.adapter.validateIdentity(evidence, f.target), /registered Linux child/);
        assert.equal(accessed, 0);
    });
});

test('current timestamp is the associated Stat completion with no decision-time monotonic probe', async (t) => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics(
        (event) => {
            if (event.stage === 'process-creation-identity') events.push(event);
        },
        undefined,
        undefined,
        { creationIdentity: { matches: () => true } },
    );
    try {
        await runFixtureObservation({ ...firstStartRoute, pid: 42, port: 9222 }, async () => {
            const f = identityFixture();
            f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
            let probe = 42,
                calls = 0;
            t.mock.method(performance, 'now', () => {
                calls++;
                return probe;
            });
            const evidence = await f.adapter.snapshot(42, 9222);
            const before = calls;
            probe = 200;
            await f.adapter.validateIdentity(evidence, f.target);
            assert.equal(events[0]?.timestampMs, 42);
            assert.equal(calls, before);
            assert.equal(events[0]?.linuxIdentity?.timeBasis, 'source-stat-read-ended');
        });
    } finally {
        stop();
    }
});

for (const armed of [false, true]) {
    test(`fix1 preserves exact first native reflection fault with observation ${armed}`, async (t) => {
        const f = identityFixture();
        const decisions: FixtureEvent[] = [];
        const stop = armed
            ? subscribeFixtureDiagnostics(
                  (event) => {
                      if (event.stage === 'process-creation-identity') decisions.push(event);
                  },
                  undefined,
                  undefined,
                  { creationIdentity: { matches: () => true } },
              )
            : undefined;
        try {
            await runFixtureObservation({ ...firstStartRoute, pid: 42, port: 9222 }, async () => {
                f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
                const evidence = await f.adapter.snapshot(42, 9222);
                const original = Object.getOwnPropertyDescriptor;
                const sentinel = { reflection: 'original native error' };
                let firstObject: unknown;
                let firstKey: PropertyKey | undefined;
                let pending = true;
                const fault = t.mock.method(Object, 'getOwnPropertyDescriptor', (object: object, key: PropertyKey) => {
                    if (pending) {
                        pending = false;
                        firstObject = object;
                        firstKey = key;
                        throw sentinel;
                    }
                    return original(object, key);
                });
                let result: unknown;
                try {
                    await f.adapter.validateIdentity(evidence, f.target);
                } catch (error) {
                    result = error;
                }
                fault.mock.restore();
                assert.equal(result, sentinel);
                assert.equal(firstObject, f.child);
                assert.equal(firstKey, 'pid');
                assert.equal(f.state.uptimeReads, 1, 'The native failure precedes post calibration and binding.');
                assert.equal(
                    decisions.some((event) => event.linuxIdentity?.decision.endsWith('accepted')),
                    false,
                );
                await f.adapter.validateIdentity(evidence, f.target);
                assert.equal(
                    f.state.uptimeReads,
                    2,
                    'Retry still takes the initial branch because the failed call did not bind.',
                );
                if (armed)
                    assert.deepEqual(
                        decisions.map((event) => event.linuxIdentity?.decision),
                        ['launch-check-threw', 'initial-accepted'],
                    );
            });
        } finally {
            stop?.();
        }
    });
    test(`fix1 evidence descriptor Proxy does not execute before native guards with observation ${armed}`, async () => {
        const f = identityFixture();
        const stop = armed
            ? subscribeFixtureDiagnostics(() => {}, undefined, undefined, { creationIdentity: { matches: () => true } })
            : undefined;
        try {
            f.adapter.registerLaunch(f.target, await f.adapter.prepareLaunch(), f.state.now);
            const evidence = await f.adapter.snapshot(42, 9222);
            let traps = 0;
            const proxy = new Proxy(evidence, {
                getOwnPropertyDescriptor(target, key) {
                    traps++;
                    f.child.pid = 42;
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            });
            f.child.pid = 43;
            await assert.rejects(f.adapter.validateIdentity(proxy, f.target), /registered Linux child/);
            assert.equal(traps, 0);
            assert.equal(f.state.uptimeReads, 1);
            f.child.pid = 42;
            await f.adapter.validateIdentity(proxy, f.target);
            assert.equal(traps, 0);
            assert.equal(f.state.uptimeReads, 2);
        } finally {
            stop?.();
        }
    });
}
