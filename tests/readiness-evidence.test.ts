import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
    type FixtureEvent,
    subscribeFixtureDiagnostics,
    validateFixtureEvent,
} from '../src/adapters/fixture-diagnostics.ts';
import { unixSnapshot } from '../src/adapters/platform-process.ts';
import { createTargetHost } from '../src/adapters/target-host.ts';
import { errorDetails } from '../src/shared/errors.ts';

const event = { stage: 'readiness', event: 'decision', outcome: 'observed', timestampMs: 1, durationMs: 0 };

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

function readinessFixture({ processIds = [42], listeners = false } = {}) {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        exitCode: null as number | null,
        signalCode: null as string | null,
    });
    const failure = Object.assign(new Error('Controlled endpoint refusal'), { code: 'ECONNREFUSED' });
    let clock = 0;
    let beforeClose: (() => void) | undefined;
    let afterAttempt: (() => void) | undefined;
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
            snapshot: async () => {
                snapshotCalls++;
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
    };
}

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
