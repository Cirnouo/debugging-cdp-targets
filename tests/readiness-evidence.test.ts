import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
    emitFixtureEvent,
    type FixtureEvent,
    runFixtureObservation,
    subscribeFixtureDiagnostics,
    validateFixtureEvent,
} from '../src/adapters/fixture-diagnostics.ts';
import { unixSnapshot } from '../src/adapters/platform-process.ts';
import { createTargetHost } from '../src/adapters/target-host.ts';
import { errorDetails } from '../src/shared/errors.ts';
import { type BoundedLinuxRead, createLinuxStartupWaitSampler } from './smoke/linux-startup-wait.ts';

const event = { stage: 'readiness', event: 'decision', outcome: 'observed', timestampMs: 1, durationMs: 0 };

const counterFields = [
    'rootStartTicks',
    'rootUserTicks',
    'rootSystemTicks',
    'rootMajorFaults',
    'rootBlockIoTicks',
] as const;

test('proc counter metadata accepts only closed optional safe nonnegative integers', () => {
    for (const field of counterFields) {
        for (const value of [0, 42, Number.MAX_SAFE_INTEGER]) {
            const accepted = validateFixtureEvent({ ...event, [field]: value });
            assert.ok(accepted);
            assert.equal(accepted[field], value);
        }
        for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, '42', null]) {
            assert.equal(validateFixtureEvent({ ...event, [field]: value }), undefined);
        }
        assert.equal(Object.hasOwn(validateFixtureEvent(event) ?? {}, field), false);
    }
    assert.equal(validateFixtureEvent({ ...event, rootPrivateCounter: 1 }), undefined);
});

async function linuxCounterSnapshot(stat: string, reads: string[] = []) {
    return unixSnapshot(42, 9222, {
        platform: 'linux',
        currentUser: () => 7,
        readlink: async () => process.execPath,
        readText: async (file) => {
            reads.push(file);
            if (file === '/proc/stat') return 'btime 0\n';
            assert.equal(file, '/proc/42/stat');
            return stat;
        },
        run: async (command) => {
            if (command === 'ps') return { code: 0, stdout: '42 1 7 Thu Jan  1 00:16:40 1970 chrome\n', stderr: '' };
            if (command === 'getconf') return { code: 0, stdout: '100\n', stderr: '' };
            assert.equal(command, 'lsof');
            return { code: 1, stdout: '', stderr: '' };
        },
    });
}

const completeProcStat =
    '42 (private name ) with (parentheses)) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 100050 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39\n';

test('Linux proc counters reuse the creation read with complex comm and preserve creation identity', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    const reads: string[] = [];
    const evidence = await linuxCounterSnapshot(completeProcStat, reads);
    assert.ok(evidence.root.exists);
    assert.equal(evidence.root.startedAtUtc, '1970-01-01T00:16:40.500Z');
    assert.deepEqual(reads.sort(), ['/proc/42/stat', '/proc/stat']);
    const decision = records.find((record) => record.command === 'proc-stat' && record.event === 'decision');
    assert.ok(decision);
    assert.equal(decision.valid, true);
    assert.equal(decision.rootStartTicks, 100050);
    assert.equal(decision.rootMajorFaults, 9);
    assert.equal(decision.rootUserTicks, 11);
    assert.equal(decision.rootSystemTicks, 12);
    assert.equal(decision.rootBlockIoTicks, 39);
    assert.equal(JSON.stringify(records).includes('private name'), false);
});

for (const [field, index] of [
    ['rootMajorFaults', 9],
    ['rootUserTicks', 11],
    ['rootSystemTicks', 12],
    ['rootBlockIoTicks', 39],
] as const) {
    test(`malformed optional ${field} omits only that counter without rejecting identity`, async (t) => {
        const records: FixtureEvent[] = [];
        t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
        for (const malformed of ['-1', '0.5', '9007199254740992', 'PRIVATE_TOKEN', '+1', '1e2']) {
            const fields = completeProcStat
                .slice(completeProcStat.lastIndexOf(') ') + 2)
                .trim()
                .split(/\s+/);
            fields[index] = malformed;
            const evidence = await linuxCounterSnapshot(`42 (chrome) ${fields.join(' ')}\n`);
            assert.ok(evidence.root.exists);
            assert.equal(evidence.root.startedAtUtc, '1970-01-01T00:16:40.500Z');
            const decision = records.findLast(
                (record) => record.command === 'proc-stat' && record.event === 'decision',
            );
            assert.ok(decision);
            assert.equal(decision.valid, true);
            assert.equal(Object.hasOwn(decision, field), false);
            assert.equal(decision.rootStartTicks, 100050);
            for (const [otherField, value] of [
                ['rootMajorFaults', 9],
                ['rootUserTicks', 11],
                ['rootSystemTicks', 12],
                ['rootBlockIoTicks', 39],
            ] as const) {
                if (otherField !== field) assert.equal(decision[otherField], value);
            }
            assert.equal(JSON.stringify(records).includes('PRIVATE_TOKEN'), false);
        }
    });
}

test('missing late proc counters remain absent while earlier counters stay available', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    await linuxCounterSnapshot('42 (chrome) S 1 2 3 4 5 6 7 8 0 10 0 0 13 14 15 16 17 18 100050\n');
    const decision = records.find((record) => record.command === 'proc-stat' && record.event === 'decision');
    assert.ok(decision);
    assert.equal(decision.rootMajorFaults, 0);
    assert.equal(decision.rootUserTicks, 0);
    assert.equal(decision.rootSystemTicks, 0);
    assert.equal(Object.hasOwn(decision, 'rootBlockIoTicks'), false);
});

test('invalid Linux PID or start ticks still reject creation evidence and publish no counters', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    for (const stat of [
        completeProcStat.replace(/^42 /, '43 '),
        completeProcStat.replace('100050', '-1'),
        completeProcStat.replace('100050', '9007199254740992'),
        '42 (chrome) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18\n',
    ]) {
        await assert.rejects(linuxCounterSnapshot(stat), /creation evidence is unverifiable/);
        const decision = records.findLast((record) => record.command === 'proc-stat' && record.event === 'decision');
        assert.ok(decision);
        assert.equal(decision.valid, false);
        for (const field of counterFields) assert.equal(Object.hasOwn(decision, field), false);
    }
});

test('default Linux creation inspection skips optional counter conversion and extra reads', async () => {
    const reads: string[] = [];
    let conversions = 0;
    const originalNumber = globalThis.Number;
    const instrumentedNumber = new Proxy(originalNumber, {
        apply(target, thisArg: unknown, args: unknown[]) {
            if (args[0] === '987654321') {
                conversions++;
                throw new Error('optional counter conversion must be disabled');
            }
            return Reflect.apply(target, thisArg, args);
        },
    });
    globalThis.Number = instrumentedNumber;
    try {
        const evidence = await linuxCounterSnapshot(completeProcStat.replace(' 11 ', ' 987654321 '), reads);
        assert.ok(evidence.root.exists);
        assert.equal(evidence.root.startedAtUtc, '1970-01-01T00:16:40.500Z');
        assert.equal(conversions, 0);
        assert.deepEqual(reads.sort(), ['/proc/42/stat', '/proc/stat']);
    } finally {
        globalThis.Number = originalNumber;
    }
});

test('readiness receiver admits closed process evidence and distinguishes missing from explicit null exit', () => {
    const accepted = validateFixtureEvent({
        ...event,
        rootProcessState: 'sleeping',
        ownedDescendantCount: 5,
        exitObserved: false,
        exitCode: null,
        signalCode: null,
        monitoringFailed: false,
    });
    assert.ok(accepted);
    assert.equal(accepted.rootProcessState, 'sleeping');
    assert.equal(accepted.ownedDescendantCount, 5);
    assert.equal(accepted.exitObserved, false);
    assert.equal(accepted.exitCode, null);
    assert.equal(accepted.signalCode, null);
    assert.equal(accepted.monitoringFailed, false);
    const missing = validateFixtureEvent(event);
    assert.ok(missing);
    assert.equal(Object.hasOwn(missing, 'exitCode'), false);
    assert.equal(Object.hasOwn(missing, 'signalCode'), false);
    assert.equal(validateFixtureEvent({ ...event, exitCode: -2_147_483_648 })?.exitCode, -2_147_483_648);
    assert.equal(validateFixtureEvent({ ...event, exitCode: 4_294_967_295 })?.exitCode, 4_294_967_295);
    assert.equal(validateFixtureEvent({ ...event, signalCode: 'SIGTERM' })?.signalCode, 'SIGTERM');
    assert.equal(validateFixtureEvent({ ...event, signalCode: 'SIGBREAK' })?.signalCode, 'SIGBREAK');
    assert.equal(
        validateFixtureEvent({ ...event, ownedDescendantCount: Number.MAX_SAFE_INTEGER })?.ownedDescendantCount,
        Number.MAX_SAFE_INTEGER,
    );
});

test('readiness receiver rejects unbounded exit codes, private state or signals, and malformed counts', () => {
    for (const fields of [
        { rootProcessState: '/private/process/state' },
        { signalCode: 'SIG_PRIVATE_TOKEN' },
        { exitObserved: 'false' },
        { monitoringFailed: '/private/monitor-error' },
        { exitCode: -2_147_483_649 },
        { exitCode: 4_294_967_296 },
        { exitCode: 0.5 },
        { ownedDescendantCount: -1 },
        { ownedDescendantCount: 0.5 },
        { ownedDescendantCount: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
        assert.equal(validateFixtureEvent({ ...event, ...fields }), undefined);
    }
});

for (const [state, expected] of [
    ['R', 'running'],
    ['S', 'sleeping'],
    ['D', 'disk-sleep'],
    ['T', 'stopped'],
    ['t', 'tracing-stop'],
    ['X', 'dead'],
    ['Z', 'zombie'],
    ['P', 'parked'],
    ['I', 'idle'],
    ['W', 'unknown'],
    ['PRIVATE_TOKEN', 'unknown'],
] as const) {
    test(`Linux root state ${state} is observed from the existing creation-time read only`, async (t) => {
        const records: FixtureEvent[] = [];
        t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
        const reads: string[] = [];
        const commands: string[] = [];
        const evidence = await unixSnapshot(42, 9222, {
            platform: 'linux',
            currentUser: () => 7,
            readlink: async () => process.execPath,
            readText: async (file) => {
                reads.push(file);
                if (file === '/proc/stat') return 'btime 0\n';
                assert.equal(file, '/proc/42/stat');
                return `42 (private name ) with parentheses) ${state} 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 100050\n`;
            },
            run: async (command) => {
                commands.push(command);
                if (command === 'ps')
                    return { code: 0, stdout: '42 1 7 Thu Jan  1 00:16:40 1970 chrome\n', stderr: '' };
                if (command === 'getconf') return { code: 0, stdout: '100\n', stderr: '' };
                assert.equal(command, 'lsof');
                return { code: 1, stdout: '', stderr: '' };
            },
        });
        assert.ok(evidence.root.exists);
        assert.equal(evidence.root.startedAtUtc, '1970-01-01T00:16:40.500Z');
        assert.deepEqual(reads.sort(), ['/proc/42/stat', '/proc/stat']);
        assert.deepEqual(commands, ['ps', 'getconf', 'lsof']);
        const stateRecords = records.filter(
            (record) => record.stage === 'native-file' && record.command === 'proc-stat' && record.event === 'decision',
        );
        assert.equal(stateRecords.length, 1);
        assert.equal(stateRecords[0]?.valid, true);
        assert.equal(stateRecords[0]?.rootProcessState, expected);
        assert.equal(JSON.stringify(records).includes('PRIVATE_TOKEN'), false);
        assert.equal(JSON.stringify(records).includes('private name'), false);
    });
}

function readinessFixture({
    processIds = [42],
    listeners = false,
    nativeCloseResult,
}: {
    processIds?: number[];
    listeners?: boolean;
    nativeCloseResult?: Record<string, unknown>;
} = {}) {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        exitCode: null as number | null,
        signalCode: null as string | null,
    });
    const failure = Object.assign(new Error('Controlled endpoint refusal'), { code: 'ECONNREFUSED' });
    let clock = 0;
    let beforeClose: (() => void) | undefined;
    let afterAttempt: (() => void) | undefined;
    let beforeSnapshot: (() => void) | undefined;
    let snapshotCalls = 0;
    let closeCalls = 0;
    const host = createTargetHost({
        probe: async () => true,
        spawn: async () => child,
        getVersion: async () => {
            throw failure;
        },
        now: () => clock,
        sleep: async (ms) => {
            assert.equal(ms, 200);
            clock += 25_000;
            afterAttempt?.();
        },
        platformAdapter: {
            reservedRanges: async () => [],
            validateNewRoot: () => {},
            ...(nativeCloseResult === undefined
                ? {}
                : {
                      requestNormalClose: async () => {
                          closeCalls++;
                          beforeClose?.();
                          child.exitCode = 0;
                          child.emit('exit', 0);
                          return nativeCloseResult;
                      },
                  }),
            snapshot: async () => {
                snapshotCalls++;
                beforeSnapshot?.();
                return {
                    root: {
                        exists: true,
                        executablePath: process.execPath,
                        startedAtUtc: '2026-10-09T00:00:00Z',
                        sessionId: 7,
                    },
                    currentSessionId: 7,
                    processIds,
                    listeners: listeners ? [{ localAddress: '127.0.0.1', owningProcess: 42 }] : [],
                };
            },
            close: async () => {
                closeCalls++;
                beforeClose?.();
                child.exitCode = 0;
                child.emit('exit', 0);
                return true;
            },
        },
    });
    return {
        child,
        failure,
        launch: () =>
            host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath }, basePort: 9222 }),
        calls: () => ({ snapshots: snapshotCalls, closes: closeCalls }),
        beforeClose: (job: () => void) => {
            beforeClose = job;
        },
        afterAttempt: (job: () => void) => {
            afterAttempt = job;
        },
        beforeSnapshot: (job: () => void) => {
            beforeSnapshot = job;
        },
    };
}

for (const status of ['owned', 'foreign', 'absent'] as const) {
    test(`rollback preserves the existing native Close listener state ${status}`, async (t) => {
        const records: FixtureEvent[] = [];
        t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
        const fixture = readinessFixture({
            nativeCloseResult: { closeRequested: true, processExited: true, listenerState: status },
        });
        const result = await fixture.launch().catch((error: unknown) => error);
        assert.ok(result instanceof Error);
        assert.equal(result.cause, fixture.failure);
        assert.equal(errorDetails(result)?.closeConfirmed, true);
        const close = records.find((record) => record.stage === 'native-close' && record.event === 'end');
        assert.equal(close?.status, status);
        assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
    });
}

test('native Close diagnostics omit missing, private, inherited or accessor listener states', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    let getterReads = 0;
    const accessor = Object.defineProperty({}, 'listenerState', {
        get() {
            getterReads++;
            return 'owned';
        },
    });
    const inherited: Record<string, unknown> = {};
    Object.setPrototypeOf(inherited, { listenerState: 'owned' });
    for (const nativeCloseResult of [
        {},
        { listenerState: '/private/owner' },
        { listenerState: null },
        { listenerState: 42 },
        inherited,
        accessor,
        new Proxy(
            {},
            {
                getOwnPropertyDescriptor() {
                    throw new Error('/private/descriptor');
                },
            },
        ),
    ]) {
        records.length = 0;
        const fixture = readinessFixture({ nativeCloseResult });
        const result = await fixture.launch().catch((error: unknown) => error);
        assert.ok(result instanceof Error);
        assert.equal(result.cause, fixture.failure);
        assert.equal(errorDetails(result)?.closeConfirmed, true);
        const close = records.find((record) => record.stage === 'native-close' && record.event === 'end');
        assert.ok(close);
        assert.equal(Object.hasOwn(close, 'status'), false);
        assert.equal(JSON.stringify(records).includes('/private/'), false);
        assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
    }
    assert.equal(getterReads, 0);
});

test('disabled native Close diagnostics do not inspect listener state descriptors', async () => {
    let inspections = 0;
    const nativeCloseResult = new Proxy(
        { closeRequested: true, processExited: true, listenerState: 'owned' },
        {
            getOwnPropertyDescriptor(target, key) {
                inspections++;
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        },
    );
    const fixture = readinessFixture({ nativeCloseResult });
    const result = await fixture.launch().catch((error: unknown) => error);
    assert.ok(result instanceof Error);
    assert.equal(result.cause, fixture.failure);
    assert.equal(errorDetails(result)?.closeConfirmed, true);
    assert.equal(inspections, 0);
    assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
});

test('verified listener with unanswered HTTP still fails and pending Linux sampling cannot block normal Close', async (t) => {
    let finishRead: (result: BoundedLinuxRead) => void = () => {};
    let expire: () => void = () => {};
    let reads = 0;
    const samples: string[] = [];
    const sampler = createLinuxStartupWaitSampler((record) => samples.push(`${record.trigger}:${record.outcome}`), {
        enabled: true,
        platform: 'linux',
        now: () => 0,
        setTimer(job) {
            expire = job;
            return 1;
        },
        clearTimer() {},
        read: async () => {
            reads++;
            return new Promise((resolve) => {
                finishRead = resolve;
            });
        },
    });
    t.after(subscribeFixtureDiagnostics((event) => sampler.observe(event)));
    const fixture = readinessFixture({ listeners: true });
    fixture.failure.code = 'ETIMEDOUT';
    fixture.failure.message = 'Controlled HTTP response timeout';
    fixture.beforeSnapshot(() => {
        emitFixtureEvent('native-file', 'decision', {
            command: 'proc-stat',
            pid: 42,
            valid: true,
            rootStartTicks: 900,
            rootProcessState: 'disk-sleep',
        });
    });
    const result: unknown = await runFixtureObservation(
        {
            entryId: '11111111-1111-4111-8111-111111111111',
            connectionId: '22222222-2222-4222-8222-222222222222',
            sessionId: '33333333-3333-4333-8333-333333333333',
        },
        () => fixture.launch().catch((error: unknown) => error),
    );
    assert.ok(result instanceof Error);
    assert.equal(result.cause, fixture.failure);
    assert.equal(errorDetails(result)?.closeConfirmed, true);
    assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
    assert.equal(reads, 1);
    assert.deepEqual(samples, ['first-owned-listener:skipped', 'rollback-request:skipped']);
    expire();
    finishRead({ bytes: 0, limitation: 'missing' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reads, 1);
    assert.ok(samples.includes('baseline:limited'));
});

for (const listeners of [false, true]) {
    test(`native snapshot distinguishes two unique owned descendants from listener count ${Number(listeners)}`, async (t) => {
        const records: FixtureEvent[] = [];
        t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
        const fixture = readinessFixture({ processIds: [42, 43, 43, 44], listeners });
        await assert.rejects(fixture.launch(), /Controlled endpoint refusal/);
        const snapshot = records.find((record) => record.stage === 'native-snapshot' && record.event === 'end');
        assert.equal(snapshot?.ownedDescendantCount, 2);
        assert.equal(snapshot?.count, Number(listeners));
        assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
    });
}

test('diagnostic descendant validation omits malformed evidence without changing readiness or rollback', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    const fixture = readinessFixture({ processIds: [42, Number.NaN] });
    const result = await fixture.launch().catch((error: unknown) => error);
    assert.ok(result instanceof Error);
    assert.equal(result.cause, fixture.failure);
    assert.equal(errorDetails(result)?.closeConfirmed, true);
    const snapshot = records.find((record) => record.stage === 'native-snapshot' && record.event === 'end');
    assert.ok(snapshot);
    assert.equal(snapshot.ownedDescendantCount, undefined);
    assert.equal(snapshot.count, 0);
    assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
});

test('a failed diagnostic descendant iterator omits its count without changing native ownership checks', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    const processIds = new Proxy([42], {
        get(target, property, receiver) {
            if (property === Symbol.iterator) throw new Error('/private/iterator failure');
            return Reflect.get(target, property, receiver);
        },
    });
    const fixture = readinessFixture({ processIds, listeners: true });
    const result = await fixture.launch().catch((error: unknown) => error);
    assert.ok(result instanceof Error);
    assert.equal(result.cause, fixture.failure);
    assert.equal(errorDetails(result)?.closeConfirmed, true);
    const snapshot = records.find((record) => record.stage === 'native-snapshot' && record.event === 'end');
    assert.ok(snapshot);
    assert.equal(snapshot.ownedDescendantCount, undefined);
    assert.equal(snapshot.count, 1);
    assert.equal(JSON.stringify(records).includes('/private/'), false);
    assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
});

test('failed readiness records retained child state before normal Close changes exit evidence', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    const fixture = readinessFixture();
    fixture.beforeClose(() => {
        const before = records.find((record) => record.stage === 'readiness' && record.phase === 'rollback-request');
        assert.ok(before, 'the retained child snapshot must precede the normal close request');
        assert.equal(before.exitObserved, false);
        assert.equal(before.exitCode, null);
        assert.equal(before.signalCode, null);
        assert.equal(before.monitoringFailed, false);
    });
    const result = await fixture.launch().catch((error: unknown) => error);
    assert.ok(result instanceof Error);
    assert.equal(result.cause, fixture.failure);
    assert.equal(errorDetails(result)?.closeConfirmed, true);
    const before = records.find((record) => record.stage === 'readiness' && record.phase === 'rollback-request');
    assert.equal(before?.exitCode, null);
    assert.equal(fixture.child.exitCode, 0);
    assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
});

test('readiness records an actual signal exit before rollback without requesting a second Close', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    const fixture = readinessFixture();
    fixture.afterAttempt(() => {
        fixture.child.signalCode = 'SIGABRT';
        fixture.child.emit('exit', null, 'SIGABRT');
    });
    await assert.rejects(fixture.launch(), /application exited/);
    const before = records.find((record) => record.stage === 'readiness' && record.phase === 'rollback-request');
    assert.ok(before);
    assert.equal(before.exitObserved, true);
    assert.equal(before.exitCode, null);
    assert.equal(before.signalCode, 'SIGABRT');
    assert.equal(before.monitoringFailed, false);
    assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 0 });
});

test('readiness records monitoring failure as a boolean without exposing its private text', async (t) => {
    const records: FixtureEvent[] = [];
    t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
    const fixture = readinessFixture();
    fixture.afterAttempt(() => {
        Object.defineProperty(fixture.child, 'monitoringFailure', { value: '/private/observer failure' });
    });
    const result = await fixture.launch().catch((error: unknown) => error);
    assert.ok(result instanceof Error);
    assert.equal(result.cause, fixture.failure);
    assert.equal(errorDetails(result)?.closeConfirmed, true);
    const before = records.find((record) => record.stage === 'readiness' && record.phase === 'rollback-request');
    assert.ok(before);
    assert.equal(before.monitoringFailed, true);
    assert.equal(before.exitObserved, false);
    assert.equal(JSON.stringify(records).includes('/private/'), false);
    assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
});

for (const field of ['signalCode', 'exitCode', 'monitoringFailure'] as const) {
    test(`a failed ${field} getter omits only its field while preserving primary readiness failure and normal Close`, async (t) => {
        const records: FixtureEvent[] = [];
        t.after(subscribeFixtureDiagnostics((record) => records.push(record)));
        const fixture = readinessFixture();
        fixture.afterAttempt(() => {
            Object.defineProperty(fixture.child, field, {
                get() {
                    throw new Error('/private/getter failure');
                },
                set() {},
            });
        });
        const result = await fixture.launch().catch((error: unknown) => error);
        assert.ok(result instanceof Error);
        assert.equal(result.cause, fixture.failure);
        assert.equal(errorDetails(result)?.closeConfirmed, true);
        const before = records.find((record) => record.stage === 'readiness' && record.phase === 'rollback-request');
        assert.ok(before);
        assert.equal(Object.hasOwn(before, field === 'monitoringFailure' ? 'monitoringFailed' : field), false);
        assert.equal(before.exitObserved, false);
        if (field !== 'exitCode') assert.equal(before.exitCode, null);
        if (field !== 'signalCode') assert.equal(before.signalCode, null);
        if (field !== 'monitoringFailure') assert.equal(before.monitoringFailed, false);
        assert.equal(JSON.stringify(records).includes('/private/'), false);
        assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
    });
}

test('default readiness performs no diagnostic child getters or descendant iteration', async () => {
    let iterations = 0;
    const processIds = new Proxy([42], {
        get(target, property, receiver) {
            if (property === Symbol.iterator) {
                iterations++;
                throw new Error('diagnostic iteration must be disabled');
            }
            return Reflect.get(target, property, receiver);
        },
    });
    const fixture = readinessFixture({ processIds });
    let getterReads = 0;
    fixture.afterAttempt(() => {
        for (const field of ['signalCode', 'monitoringFailure']) {
            Object.defineProperty(fixture.child, field, {
                get() {
                    getterReads++;
                    throw new Error('diagnostic getter must be disabled');
                },
            });
        }
    });
    const result = await fixture.launch().catch((error: unknown) => error);
    assert.ok(result instanceof Error);
    assert.equal(result.cause, fixture.failure);
    assert.equal(errorDetails(result)?.closeConfirmed, true);
    assert.equal(iterations, 0);
    assert.equal(getterReads, 0);
    assert.deepEqual(fixture.calls(), { snapshots: 1, closes: 1 });
});
