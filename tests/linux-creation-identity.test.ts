import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { subscribeFixtureDiagnostics } from '../src/adapters/fixture-diagnostics.ts';
import { createPlatformAdapter } from '../src/adapters/platform-process.ts';
import { createTargetHost } from '../src/adapters/target-host.ts';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';
import { RetainedTargetError } from '../src/domains/cdp-target.ts';

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
