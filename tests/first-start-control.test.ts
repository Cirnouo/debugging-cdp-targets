import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createFirstStartControlEmitter,
    projectFirstStartAdmission,
    projectFirstStartTerminal,
    qualifyFirstStartTerminal,
} from './smoke/first-start-control.ts';

const ids = {
    entryId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    operationId: '44444444-4444-4444-8444-444444444444',
    requestId: '55555555-5555-4555-8555-555555555555',
};
const collectionId = '66666666-6666-4666-8666-666666666666';
const context = {
    expected: { entryId: ids.entryId, requestId: ids.requestId, collectionId },
    cleanup: { targetClosed: true, gatewayExited: true, profileDeleted: true },
};
function writer() {
    return {
        attempts: 1,
        dataAttempts: 0,
        markerAttempts: 0,
        metadataReserved: 6,
        scannedBytes: 100,
        exhausted: false,
        releaseFailed: false,
        writeFailed: false,
        selfReportWriteUnavailable: true,
    };
}
function record(slot: string, status: string, fields: object = {}) {
    return { kind: 'linux-first-start-capture', slot, status, atMs: 1, ...ids, ...fields };
}
function summary() {
    return {
        schemaVersion: 1,
        fixture: 'official-server',
        state: 'passed',
        collectionId,
        collectionRejected: false,
        platform: 'linux',
        firstStartCaptureArmed: true,
        firstStartCapture: [
            record('selection', 'armed'),
            record('root-binding', 'bound', { pid: 123, rootStartTicks: 200 }),
            record('first-start-outcome', 'succeeded'),
            record('retention-decision', 'discarded', {
                metrics: { discarded: 4, admitted: 1, completed: 1, pending: 1, skipped: 5 },
            }),
            record('six-slot-status', 'complete', {
                slots: ['complete', 'not-admitted', 'not-admitted', 'not-admitted', 'not-admitted', 'not-admitted'],
            }),
            record('limitations', 'no-close-gate', {
                creationObservation: {
                    stats: 'available',
                    sourceAttempts: 1,
                    comparisons: 1,
                    tokens: 1,
                    retained: 1,
                    omitted: 0,
                    capped: false,
                    disabled: false,
                    revoked: true,
                    producerCpu: 'unmeasured',
                },
            }),
            record('writer-state', 'partial', {
                reason: 'incomplete',
                metrics: { sinkCalls: 7, sinkFailed: 0, callbackMs: 1, records: 7, serializedBytes: 200 },
            }),
            record('observer-terminal', 'complete'),
        ],
        firstStartCaptureOmitted: 0,
        firstStartCaptureLimitations: ['self-report-write-unavailable'],
        firstStartCaptureWriter: {
            ...writer(),
            events: 8,
            bytes: 200,
            counts: {
                ordinary: { events: 0, bytes: 0 },
                capture: { events: 8, bytes: 200 },
                control: { events: 0, bytes: 0 },
                marker: { events: 0, bytes: 0 },
            },
            controlSlots: [],
        },
        firstStartCaptureWriterChild: { kind: 'first-start-writer-cost', ...writer() },
        writeFailed: false,
        truncated: false,
        incomplete: true,
        invalidEvents: 0,
        droppedEvents: 0,
        diagnosticAbsent: false,
        events: 8,
        gatewayEvents: 1,
        linuxStartupWaitOmitted: 0,
        readaheadStudyOmitted: 0,
        primary: { error: '/private/TOKEN', stack: '/private/stack' },
    };
}

// A missing selected-origin check, treating incompleteness as failure, or copying
// creation/native timing details would break this consumer-visible receipt.
test('successful discard qualifies with expected self-report limitation and skipped future slots', () => {
    const projected = projectFirstStartTerminal(summary(), context);
    assert.equal(projected.valid, true);
    assert.equal(qualifyFirstStartTerminal(projected), true);
    assert.deepEqual(projected.record.selected, ids);
    assert.equal(projected.record.selection, 'armed');
    assert.equal(projected.record.creationModel, 'unavailable');
    assert.equal(projected.record.nativeReadinessElapsedMs, null);
    assert.deepEqual(projected.record.retention, {
        state: 'discarded',
        counts: { discarded: 4, admitted: 1, completed: 1, pending: 1, skipped: 5 },
    });
    assert.doesNotMatch(projected.line, /TOKEN|private|rootStartTicks|pid|atMs|callbackMs/);
    assert.ok(Buffer.byteLength(projected.line) <= 4096);
});

test('configured capture alone never proves observed selection or qualification', () => {
    const input = summary();
    input.firstStartCapture = [];
    const projected = projectFirstStartTerminal(input, context);
    assert.equal(projected.valid, true);
    assert.equal(projected.record.configured, true);
    assert.equal(projected.record.selection, 'not-observed');
    assert.equal(projected.record.firstOutcome, 'not-observed');
    assert.deepEqual(projected.record.creation, {
        stats: 'unavailable',
        sourceAttempts: null,
        comparisons: null,
        tokens: null,
        retained: null,
        omitted: null,
        capped: null,
        disabled: null,
        revoked: null,
        producerCpu: 'unmeasured',
    });
    assert.equal(qualifyFirstStartTerminal(projected), false);
});

test('duplicate semantic receipts, origin conflict and wrong parent request fail closed', () => {
    const duplicate = summary();
    duplicate.firstStartCapture.push(record('selection', 'armed'));
    const conflict = summary();
    conflict.firstStartCapture.push(record('cost', 'complete', { phase: 7, cost: {}, entryId: collectionId }));
    for (const input of [duplicate, conflict]) {
        const projected = projectFirstStartTerminal(input, context);
        assert.equal(projected.valid, false);
        assert.ok(Buffer.byteLength(projected.line) <= 256);
        assert.equal(qualifyFirstStartTerminal(projected), false);
    }
    assert.equal(
        projectFirstStartTerminal(summary(), {
            ...context,
            expected: { ...context.expected, requestId: collectionId },
        }).valid,
        false,
    );
});

test('unknown, accessors, symbols, nonplain values and oversize input never expose raw content', () => {
    let reads = 0;
    const getter = Object.defineProperty(summary(), 'firstStartCapture', {
        enumerable: true,
        get() {
            reads++;
            return '/private/TOKEN';
        },
    });
    const arrays = summary();
    Object.defineProperty(arrays.firstStartCapture, '0', {
        enumerable: true,
        get() {
            reads++;
            return null;
        },
    });
    for (const input of [
        null,
        {},
        getter,
        arrays,
        { ...summary(), extra: '/private/TOKEN' },
        { ...summary(), [Symbol('secret')]: 'TOKEN' },
        Object.create(summary()),
        { ...summary(), firstStartCapture: Array(65).fill(record('selection', 'armed')) },
    ]) {
        const projected = projectFirstStartTerminal(input, context);
        assert.equal(projected.valid, false);
        assert.ok(Buffer.byteLength(projected.line) <= 256);
        assert.doesNotMatch(projected.line, /TOKEN|private/);
    }
    assert.equal(reads, 0);
});

test('creation arithmetic is validated and unavailable counters remain unknown', () => {
    const input = summary();
    input.firstStartCapture = input.firstStartCapture.filter((item) => item.slot !== 'limitations');
    input.firstStartCapture.push(
        record('limitations', 'no-close-gate', {
            creationObservation: { stats: 'unavailable', retained: 1, omitted: 0, producerCpu: 'unmeasured' },
        }),
    );
    const projected = projectFirstStartTerminal(input, context);
    assert.equal(projected.valid, true);
    assert.deepEqual(projected.record.creation, {
        stats: 'unavailable',
        sourceAttempts: null,
        comparisons: null,
        tokens: null,
        retained: 1,
        omitted: 0,
        capped: null,
        disabled: null,
        revoked: null,
        producerCpu: 'unmeasured',
    });
    assert.equal(qualifyFirstStartTerminal(projected), false);
    input.firstStartCapture.pop();
    input.firstStartCapture.push(
        record('limitations', 'retained', {
            creationObservation: {
                stats: 'available',
                sourceAttempts: 1,
                comparisons: 2,
                tokens: 2,
                retained: 1,
                omitted: 0,
                capped: false,
                disabled: false,
                revoked: true,
                producerCpu: 'unmeasured',
            },
        }),
    );
    assert.equal(projectFirstStartTerminal(input, context).valid, false);
});

test('writer, reduction, lifecycle and collection failures cannot qualify successful startup', () => {
    const cases = [
        { writeFailed: true },
        { truncated: true },
        { invalidEvents: 1 },
        { droppedEvents: 1 },
        { firstStartCaptureOmitted: 1 },
        { collectionRejected: true },
        { state: 'failed' },
        { diagnosticAbsent: true },
        { firstStartCaptureWriter: null },
        { firstStartCaptureLimitations: ['self-report-write-unavailable', 'writer-scan-budget'] },
        { firstStartCaptureWriterChild: { kind: 'first-start-writer-cost', ...writer(), exhausted: true } },
    ];
    for (const change of cases)
        assert.equal(
            qualifyFirstStartTerminal(
                projectFirstStartTerminal(
                    {
                        ...summary(),
                        ...change,
                    },
                    context,
                ),
            ),
            false,
            JSON.stringify(change),
        );
    for (const key of ['targetClosed', 'gatewayExited', 'profileDeleted']) {
        for (const state of [false, null])
            assert.equal(
                qualifyFirstStartTerminal(
                    projectFirstStartTerminal(summary(), {
                        ...context,
                        cleanup: { ...context.cleanup, [key]: state },
                    }),
                ),
                false,
            );
    }
});

test('admission maps only closed results and distinguishes event from verified source SHA', () => {
    for (const admission of ['admitted', 'ineligible', 'unavailable']) {
        const projected = projectFirstStartAdmission(admission);
        assert.equal(projected.valid, true);
        assert.equal(projected.record.result, admission);
    }
    const source = {
        eventSha: 'a'.repeat(40),
        sourceSha: 'b'.repeat(40),
        sourceTree: 'c'.repeat(40),
        roundId: collectionId,
        runId: 123,
        slot: 1,
    };
    const projected = projectFirstStartAdmission('admitted', { source });
    assert.deepEqual(projected.record.source, source);
    assert.equal(projectFirstStartAdmission('/private/TOKEN').valid, false);
    assert.equal(projectFirstStartAdmission('admitted', { source: { ...source, slot: 7 } }).valid, false);
});

test('each phase gets one synchronous write, with partial writes and exceptions contained', () => {
    const lines: string[] = [];
    const emitter = createFirstStartControlEmitter((line) => {
        lines.push(line);
        return Buffer.byteLength(line);
    });
    const admission = projectFirstStartAdmission('admitted');
    const terminal = projectFirstStartTerminal(summary(), context);
    assert.deepEqual(emitter.emit(admission), { attempted: true, writeOk: true });
    assert.deepEqual(emitter.emit(admission), { attempted: false, writeOk: false });
    assert.deepEqual(emitter.emit(terminal), { attempted: true, writeOk: true });
    assert.deepEqual(emitter.emit(terminal), { attempted: false, writeOk: false });
    assert.equal(lines.length, 2);
    assert.ok(lines.reduce((bytes, line) => bytes + Buffer.byteLength(line), 0) <= 8192);
    for (const write of [
        () => 1,
        () => {
            throw Object.assign(Error('/private/TOKEN'), { code: 'EPIPE' });
        },
    ]) {
        const failed = createFirstStartControlEmitter(write);
        assert.deepEqual(failed.emit(terminal), { attempted: true, writeOk: false });
        assert.deepEqual(failed.emit(terminal), { attempted: false, writeOk: false });
        assert.equal(qualifyFirstStartTerminal(terminal), true);
    }
});

test('forged or missing projections never read getters, emit raw strings or qualify', () => {
    let reads = 0;
    const authentic = projectFirstStartTerminal(summary(), context);
    const forged = Object.defineProperties(
        {},
        {
            phase: {
                get() {
                    reads++;
                    return 'terminal';
                },
            },
            line: {
                get() {
                    reads++;
                    return '/private/TOKEN';
                },
            },
            valid: {
                get() {
                    reads++;
                    return true;
                },
            },
        },
    );
    const lines: string[] = [];
    const emitter = createFirstStartControlEmitter((line) => {
        lines.push(line);
        return Buffer.byteLength(line);
    });
    for (const input of [
        undefined,
        null,
        '/private/TOKEN',
        forged,
        { ...authentic },
        new Proxy(authentic, {
            get() {
                reads++;
                throw Error('TOKEN');
            },
        }),
    ]) {
        assert.equal(qualifyFirstStartTerminal(input), false);
        assert.deepEqual(emitter.emit(input), { attempted: false, writeOk: false });
    }
    assert.deepEqual(lines, []);
    assert.equal(reads, 0);
    assert.deepEqual(emitter.emit(authentic), { attempted: true, writeOk: true });
    assert.equal(Object.isFrozen(authentic), true);
    assert.equal(Object.isFrozen(authentic.record), true);
    assert.equal(Object.isFrozen(authentic.record.creation), true);
    assert.equal(Reflect.set(authentic, 'line', 'TOKEN'), false);
});

test('prerequisite and unarmed exits preserve unknown first binding and cleanup facts', () => {
    const input = summary();
    const projected = projectFirstStartTerminal(
        {
            ...input,
            state: 'failed',
            firstStartCaptureArmed: false,
            firstStartCapture: [],
            firstStartCaptureWriter: null,
            firstStartCaptureWriterChild: null,
            firstStartCaptureLimitations: [],
        },
        {},
    );
    assert.equal(projected.valid, true);
    assert.equal(projected.record.selection, 'not-observed');
    assert.equal(projected.record.selected, null);
    assert.equal(projected.record.parentBinding, 'unavailable');
    assert.deepEqual(projected.record.cleanup, { targetClosed: null, gatewayExited: null, profileDeleted: null });
    assert.equal(qualifyFirstStartTerminal(projected), false);
});

test('writer discriminator and retained root lifetime conflicts are invalid, not silently repaired', () => {
    const malformed = { ...summary(), firstStartCaptureWriterChild: { kind: 'TOKEN', ...writer() } };
    assert.equal(projectFirstStartTerminal(malformed, context).valid, false);
    for (const conflict of [{ pid: 124 }, { rootStartTicks: 201 }]) {
        const input = summary();
        input.firstStartCapture.push(record('cost', 'complete', { phase: 7, cost: {}, ...conflict }));
        assert.equal(projectFirstStartTerminal(input, context).valid, false);
    }
});

test('failure retention exposes only its closed discriminator and locked outcome reason', () => {
    const input = summary();
    input.firstStartCapture = input.firstStartCapture.filter(
        (item) => item.slot !== 'first-start-outcome' && item.slot !== 'retention-decision',
    );
    input.firstStartCapture.push(
        record('first-start-outcome', 'failed', { outcomeReason: 'budget-exhausted' }),
        record('retention-decision', 'retained', {
            metrics: { discarded: 0, admitted: 1, completed: 1, pending: 0, skipped: 5 },
        }),
        record('creation-first-comparison', 'identity-invalid', {
            creation: {
                creationNewlyLaunched: true,
                creationToleranceMs: 1000,
                creationSourceStatus: 'missing',
                creationComparisonStatus: 'reached',
                creationBranch: 'new-lower-rejected',
                creationExpectedUtcMs: 1,
                creationObservedUtcMs: -1001,
                creationUpperNowStatus: 'not-evaluated',
            },
        }),
    );
    const projected = projectFirstStartTerminal({ ...input, state: 'failed' }, context);
    assert.equal(projected.valid, true);
    assert.equal(projected.record.firstOutcome, 'failed');
    assert.equal(projected.record.outcomeReason, 'budget-exhausted');
    assert.equal(projected.record.creationModel, 'legacy-scalar');
    assert.equal(qualifyFirstStartTerminal(projected), false);
    assert.doesNotMatch(projected.line, /creationExpectedUtcMs|creationObservedUtcMs|new-lower-rejected/);
});

for (const missing of [
    ['first-start-outcome'],
    ['retention-decision'],
    ['first-start-outcome', 'retention-decision'],
]) {
    test(`creation model stays unavailable without ${missing.join(' and ')} receipt`, () => {
        const input = summary();
        input.firstStartCapture = input.firstStartCapture.filter(
            (item) => item.slot !== 'first-start-outcome' && item.slot !== 'retention-decision',
        );
        if (!missing.includes('first-start-outcome'))
            input.firstStartCapture.push(record('first-start-outcome', 'failed'));
        if (!missing.includes('retention-decision'))
            input.firstStartCapture.push(
                record('retention-decision', 'retained', {
                    metrics: { discarded: 0, admitted: 1, completed: 1, pending: 0, skipped: 5 },
                }),
            );
        input.firstStartCapture.push(
            record('creation-first-comparison', 'identity-invalid', {
                creation: {
                    creationNewlyLaunched: true,
                    creationToleranceMs: 1000,
                    creationSourceStatus: 'missing',
                    creationComparisonStatus: 'reached',
                    creationBranch: 'new-lower-rejected',
                    creationExpectedUtcMs: 1,
                    creationObservedUtcMs: -1001,
                    creationUpperNowStatus: 'not-evaluated',
                },
            }),
        );
        const projected = projectFirstStartTerminal({ ...input, state: 'failed' }, context);
        assert.equal(projected.valid, true);
        assert.equal(
            projected.record.firstOutcome,
            missing.includes('first-start-outcome') ? 'not-observed' : 'failed',
        );
        assert.deepEqual(
            projected.record.retention,
            missing.includes('retention-decision')
                ? {
                      state: 'not-observed',
                      counts: { discarded: null, admitted: null, completed: null, pending: null, skipped: null },
                  }
                : {
                      state: 'retained',
                      counts: { discarded: 0, admitted: 1, completed: 1, pending: 0, skipped: 5 },
                  },
        );
        assert.equal(projected.record.creationModel, 'unavailable');
        assert.equal(qualifyFirstStartTerminal(projected), false);
    });
}

test('invalid receipts write only bounded fallback once and cannot count as successful writes', () => {
    const lines: string[] = [];
    const emitter = createFirstStartControlEmitter((line) => {
        lines.push(line);
        return Buffer.byteLength(line);
    });
    const fallback = projectFirstStartTerminal({ secret: 'TOKEN' }, context);
    assert.deepEqual(emitter.emit(fallback), { attempted: true, writeOk: false });
    assert.deepEqual(emitter.emit(projectFirstStartTerminal(summary(), context)), { attempted: false, writeOk: false });
    assert.equal(lines.length, 1);
    assert.ok(Buffer.byteLength(lines[0] ?? '') <= 256);
    assert.doesNotMatch(lines[0] ?? '', /TOKEN|secret/);
    assert.equal(qualifyFirstStartTerminal(fallback), false);
});

test('root availability and producer flags stay informative under the literal continuation predicate', () => {
    const input = summary();
    input.firstStartCapture = input.firstStartCapture.filter(
        (item) => item.slot !== 'root-binding' && item.slot !== 'limitations',
    );
    input.firstStartCapture.push(
        record('root-binding', 'unavailable'),
        record('limitations', 'no-close-gate', {
            creationObservation: {
                stats: 'available',
                sourceAttempts: 1,
                comparisons: 1,
                tokens: 128,
                retained: 1,
                omitted: 0,
                capped: true,
                disabled: true,
                revoked: false,
                producerCpu: 'unmeasured',
            },
        }),
    );
    const projected = projectFirstStartTerminal(input, context);
    assert.equal(projected.valid, true);
    assert.equal(projected.record.rootBinding, 'unavailable');
    assert.deepEqual(projected.record.creation, {
        stats: 'available',
        sourceAttempts: 1,
        comparisons: 1,
        tokens: 128,
        retained: 1,
        omitted: 0,
        capped: true,
        disabled: true,
        revoked: false,
        producerCpu: 'unmeasured',
    });
    assert.equal(qualifyFirstStartTerminal(projected), true);
});

test('conflicting retained lifetime identities remain invalid when sampler root availability is unknown', () => {
    for (const conflicting of [{ pid: 124 }, { rootStartTicks: 201 }]) {
        const input = summary();
        input.firstStartCapture = input.firstStartCapture.filter((item) => item.slot !== 'root-binding');
        input.firstStartCapture.push(
            record('root-binding', 'unavailable', { pid: 123, rootStartTicks: 200 }),
            record('cost', 'complete', { phase: 7, cost: {}, ...conflicting }),
        );
        assert.equal(projectFirstStartTerminal(input, context).valid, false);
    }
});
