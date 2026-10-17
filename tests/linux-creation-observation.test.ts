import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as diagnostics from '../src/adapters/fixture-diagnostics.ts';
import {
    captureFixtureOrigin,
    emitFixtureEvent,
    type FixtureEvent,
    runFixtureObservation,
    runFixtureResource,
    subscribeFixtureDiagnostics,
    validateFixtureEvent,
} from '../src/adapters/fixture-diagnostics.ts';
import { unixSnapshot, validateProcessIdentity } from '../src/adapters/platform-process.ts';
import { isRecord } from '../src/shared/errors.ts';
import { createFirstStartHarness, drainFirstStart, firstStartRoute } from './fixtures/first-start-capture-fake.ts';
import { createFixtureArtifacts } from './smoke/fixture-artifacts.ts';
import { dispatchFixtureDiagnostic } from './smoke/fixture-preload.ts';
import { validateFirstStartCaptureRecord } from './smoke/linux-first-start-capture-record.ts';

const identity = {
    entryId: '11111111-1111-4111-8111-111111111111',
    operationId: '22222222-2222-4222-8222-222222222222',
};
async function snapshot(ticks = 201, boot = 0, clk = 100) {
    return unixSnapshot(42, 9222, {
        platform: 'linux',
        currentUser: () => 7,
        readlink: async () => '/owned/chrome',
        readText: async (file) =>
            file === '/proc/stat'
                ? `btime ${boot}\n`
                : `42 (chrome) ${['S', ...Array(18).fill('0'), String(ticks)].join(' ')}`,
        run: async (command) => ({
            code: 0,
            stderr: '',
            stdout:
                command === 'ps'
                    ? '42 1 7 Thu Oct  8 00:16:40 2026 Chrome\n'
                    : command === 'getconf'
                      ? String(clk)
                      : '',
        }),
    });
}
function target(ms: number) {
    return {
        executablePath: '/owned/chrome',
        startedAtUtc: new Date(ms).toISOString(),
        targetKind: 'generic-cdp' as const,
    };
}

test('armed same-source observation preserves TimeClip and reuse while revoke preserves lifecycle', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            const evidence = await snapshot();
            validateProcessIdentity(evidence, target(2009));
            const event = events.find((event) => event.stage === 'process-creation-identity');
            assert.equal(event?.creationSourceStatus, 'complete');
            assert.equal(event.creationObservedUtcMs, 2009);
            assert.equal(event.creationStartTicks, 201);
            assert.equal(event.creationClkTck, 100);
            assert.equal(event.creationComputedNumberMs, 2009.9999999999998);
            assert.equal(BigInt(event.creationObservedUtcMs) * 100n - 201000n, -100n);
            assert.equal(stop.creationIdentityStats().tokens, 1);
            validateProcessIdentity(evidence, target(2009));
            assert.equal(stop.creationIdentityStats().tokens, 2);
            stop.revokeCreationIdentity();
            validateProcessIdentity(evidence, target(2009));
            emitFixtureEvent('native-close', 'end');
            assert.equal(events.filter((event) => event.stage === 'process-creation-identity').length, 2);
            assert.equal(events.at(-1)?.stage, 'native-close');
        });
    } finally {
        stop();
    }
});

test('ordinary subscriptions never emit creation observation', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event));
    try {
        const evidence = await snapshot();
        validateProcessIdentity(evidence, target(2009));
        assert.equal(
            events.some((event) => event.stage === 'process-creation-identity'),
            false,
        );
    } finally {
        stop();
    }
});

test('copied and mutated roots cannot inherit complete source metadata', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            const evidence = await snapshot();
            validateProcessIdentity({ ...evidence, root: { ...evidence.root } }, target(2009));
            assert.ok(evidence.root.exists);
            evidence.root.startedAtUtc = new Date(2010).toISOString();
            validateProcessIdentity(evidence, target(2010));
            const comparisons = events.filter((event) => event.stage === 'process-creation-identity');
            assert.deepEqual(
                comparisons.map((event) => event.creationSourceStatus),
                ['missing', 'unverifiable'],
            );
            assert.ok(comparisons.every((event) => event.creationStartTicks === undefined));
        });
    } finally {
        stop();
    }
});

test('failed sources exhaust admission even with no comparisons', async () => {
    const stop = subscribeFixtureDiagnostics(() => {}, undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            for (let index = 0; index < 130; index++) await assert.rejects(snapshot(201, 0, 0));
        });
        assert.deepEqual(stop.creationIdentityStats(), {
            sourceAttempts: 128,
            comparisons: 0,
            tokens: 128,
            capped: true,
            disabled: false,
            revoked: false,
        });
    } finally {
        stop();
    }
});

test('creation closed schema rejects inconsistent branches and unknown source groups', () => {
    const base = {
        stage: 'process-creation-identity',
        event: 'decision',
        phase: 'process-identity',
        outcome: 'observed',
        timestampMs: 1,
        durationMs: 0,
        creationNewlyLaunched: false,
        creationToleranceMs: 1000,
        creationComparisonStatus: 'reached',
        creationSourceStatus: 'missing',
        creationUpperNowStatus: 'not-evaluated',
        creationBranch: 'established-accepted',
        creationExpectedUtcMs: -1,
        creationObservedUtcMs: -1,
    };
    assert.ok(validateFixtureEvent(base));
    for (const change of [
        { creationBranch: 'new-accepted' },
        { creationBootSeconds: 0 },
        { creationUpperNowUtcMs: 1 },
        { creationComparisonStatus: 'not-reached' },
        { creationObservedUtcMs: NaN },
        { raw: 'private' },
    ])
        assert.equal(validateFixtureEvent({ ...base, ...change }), undefined);
});

test('closed creation schema enforces the actual comparison and Number expression', () => {
    const base = {
        stage: 'process-creation-identity',
        event: 'decision',
        phase: 'process-identity',
        outcome: 'observed',
        timestampMs: 1,
        durationMs: 0,
        creationNewlyLaunched: false,
        creationToleranceMs: 1000,
        creationComparisonStatus: 'reached',
        creationSourceStatus: 'missing',
        creationUpperNowStatus: 'not-evaluated',
        creationBranch: 'established-accepted',
        creationExpectedUtcMs: 0,
        creationObservedUtcMs: 1001,
    };
    assert.equal(validateFixtureEvent(base), undefined);
    assert.equal(
        validateFixtureEvent({ ...base, outcome: 'rejected', creationBranch: 'established-delta-rejected' })
            ?.creationBranch,
        'established-delta-rejected',
    );
});

test('admission ignores unselected origins and revoked receiver still sees close', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: (origin) => origin.originOperationId === identity.operationId },
    });
    try {
        await runFixtureObservation({ ...identity, operationId: '33333333-3333-4333-8333-333333333333' }, async () => {
            const evidence = await snapshot();
            validateProcessIdentity(evidence, target(2009));
        });
        assert.equal(stop.creationIdentityStats().tokens, 0);
        stop.revokeCreationIdentity();
        assert.equal(stop.creationIdentityStats().revoked, true);
        assert.equal(stop.creationIdentityStats().disabled, false);
    } finally {
        stop();
    }
});

test('comparison preserves exact 1000/1001 boundaries and Date.now short circuit', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    let nowCalls = 0;
    const clock = mock.method(Date, 'now', () => {
        nowCalls++;
        return 2009;
    });
    try {
        await runFixtureObservation(identity, async () => {
            const evidence = await snapshot();
            validateProcessIdentity(evidence, target(3009), { newlyLaunched: true });
            assert.equal(nowCalls, 1);
            assert.throws(
                () => validateProcessIdentity(evidence, target(3010), { newlyLaunched: true }),
                /PID may have been reused/,
            );
            assert.equal(nowCalls, 1);
            validateProcessIdentity(evidence, target(1009));
            assert.throws(() => validateProcessIdentity(evidence, target(1008)), /PID may have been reused/);
            assert.equal(nowCalls, 1);
            assert.deepEqual(
                events
                    .filter((event) => event.stage === 'process-creation-identity')
                    .map((event) => [event.creationBranch, event.creationUpperNowStatus]),
                [
                    ['new-accepted', 'read'],
                    ['new-lower-rejected', 'not-evaluated'],
                    ['established-accepted', 'not-evaluated'],
                    ['established-delta-rejected', 'not-evaluated'],
                ],
            );
        });
    } finally {
        clock.mock.restore();
        stop();
    }
});

test('modern 1007ms lower rejection retains the actual source without reading now', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    const clock = mock.method(Date, 'now', () => {
        throw new Error('lower branch must not read now');
    });
    try {
        await runFixtureObservation(identity, async () => {
            const evidence = await snapshot(201, 1700000000, 100);
            assert.throws(
                () => validateProcessIdentity(evidence, target(1700000003017), { newlyLaunched: true }),
                /PID may have been reused/,
            );
            const event = events.find((event) => event.stage === 'process-creation-identity');
            assert.equal(event?.creationObservedUtcMs, 1700000002010);
            assert.equal(event?.creationExpectedUtcMs, 1700000003017);
            assert.equal(event?.creationBootSeconds, 1700000000);
            assert.equal(event?.creationBranch, 'new-lower-rejected');
        });
    } finally {
        clock.mock.restore();
        stop();
    }
});

test('not-reached identity preserves priority and never parses creation strings', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            const evidence = await snapshot();
            const parse = mock.method(Date, 'parse', () => {
                throw new Error('must not parse');
            });
            try {
                assert.throws(
                    () => validateProcessIdentity(evidence, { ...target(0), executablePath: '/foreign' }),
                    /executable identity changed/,
                );
            } finally {
                parse.mock.restore();
            }
            const event = events.find((event) => event.stage === 'process-creation-identity');
            assert.equal(event?.creationComparisonStatus, 'not-reached');
            assert.equal(event?.creationBranch, undefined);
            assert.equal(event?.creationObservedUtcMs, undefined);
            assert.equal(event?.creationSourceStatus, 'complete');
        });
    } finally {
        stop();
    }
});

test('each added source-clock fault leaves the successful snapshot and comparison intact', async () => {
    for (const failAt of [5, 8, 11, 20, 21, 22]) {
        const events: FixtureEvent[] = [];
        const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
            creationIdentity: { matches: () => true },
        });
        let calls = 0;
        const clock = mock.method(performance, 'now', () => {
            if (++calls === failAt) throw new Error('diagnostic clock');
            return calls;
        });
        try {
            await runFixtureObservation(identity, async () => {
                const evidence = await snapshot();
                assert.ok(evidence.root.exists);
                assert.equal(evidence.root.startedAtUtc, '1970-01-01T00:00:02.009Z');
                validateProcessIdentity(evidence, target(2009));
                const event = events.find((event) => event.stage === 'process-creation-identity');
                assert.equal(event?.creationSourceStatus, 'unverifiable', String(failAt));
                assert.equal(event?.creationBranch, 'established-accepted');
                assert.equal(event?.creationStatReadStartedMs, undefined);
            });
        } finally {
            clock.mock.restore();
            stop();
        }
    }
});

test('source first comparison reuses token 128 but repeats are refused without new clocks', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            for (let index = 0; index < 127; index++) await assert.rejects(snapshot(0, 0, 0));
            const evidence = await snapshot();
            validateProcessIdentity(evidence, target(2009));
            validateProcessIdentity(evidence, target(2009));
            assert.equal(events.filter((event) => event.stage === 'process-creation-identity').length, 1);
            assert.equal(stop.creationIdentityStats().comparisons, 1);
            assert.equal(stop.creationIdentityStats().tokens, 128);
            assert.equal(stop.creationIdentityStats().capped, true);
        });
    } finally {
        stop();
    }
});

test('interleaved snapshots bind each returned object to its own values and origin', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            const [first, second] = await Promise.all([snapshot(201), snapshot(300)]);
            validateProcessIdentity(second, target(3000));
            validateProcessIdentity(first, target(2009));
            await runFixtureObservation({ ...identity, operationId: '33333333-3333-4333-8333-333333333333' }, () =>
                validateProcessIdentity(first, target(2009)),
            );
            assert.deepEqual(
                events
                    .filter((event) => event.stage === 'process-creation-identity')
                    .map((event) => [event.creationSourceStatus, event.creationStartTicks]),
                [
                    ['complete', 300],
                    ['complete', 201],
                    ['unverifiable', undefined],
                ],
            );
        });
    } finally {
        stop();
    }
});

test('native reads retain concurrent launch order and original rejection object', async () => {
    for (const armed of [false, true]) {
        const calls: string[] = [];
        const failure = new Error('original read failure');
        let rejectStat: ((error: Error) => void) | undefined;
        const pending = new Promise<string>((_resolve, reject) => {
            rejectStat = reject;
        });
        const stop = subscribeFixtureDiagnostics(
            () => {},
            undefined,
            undefined,
            armed ? { creationIdentity: { matches: () => true } } : {},
        );
        try {
            const operation = unixSnapshot(42, 9222, {
                platform: 'linux',
                currentUser: () => 7,
                readText: (file) => {
                    calls.push(file);
                    return file === '/proc/stat' ? Promise.resolve('btime 0') : pending;
                },
                run: async (command) => {
                    calls.push(command);
                    return {
                        code: 0,
                        stderr: '',
                        stdout: command === 'ps' ? '42 1 7 Thu Oct  8 00:16:40 2026 Chrome\n' : '100',
                    };
                },
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.deepEqual(calls, ['ps', '/proc/42/stat', '/proc/stat', 'getconf']);
            rejectStat?.(failure);
            await assert.rejects(operation, (error) => error === failure);
            assert.equal(stop.creationIdentityStats().sourceAttempts, armed ? 1 : 0);
        } finally {
            stop();
        }
    }
});

test('ordinary subscriber path adds no creation clock calls', async () => {
    const counts: number[] = [];
    for (const armed of [false, true]) {
        let calls = 0;
        const clock = mock.method(performance, 'now', () => ++calls);
        const stop = subscribeFixtureDiagnostics(
            () => {},
            undefined,
            undefined,
            armed ? { creationIdentity: { matches: () => true } } : {},
        );
        try {
            await snapshot();
            counts.push(calls);
        } finally {
            clock.mock.restore();
            stop();
        }
    }
    assert.equal(counts[0], 25);
    assert.equal(counts[1], 31);
});

test('metadata binding and receiver faults cannot change original results', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics(
        (event) => {
            events.push(event);
            throw new Error('receiver');
        },
        undefined,
        undefined,
        { creationIdentity: { matches: () => true } },
    );
    const originalSet = WeakMap.prototype.set;
    const binding = mock.method(
        WeakMap.prototype,
        'set',
        function (this: WeakMap<object, unknown>, key: object, value: unknown) {
            if ('exists' in key) throw new Error('metadata bind');
            return originalSet.call(this, key, value);
        },
    );
    try {
        const evidence = await snapshot();
        validateProcessIdentity(evidence, target(2009));
        assert.throws(() => validateProcessIdentity(evidence, target(3010)), /PID may have been reused/);
        assert.deepEqual(
            events
                .filter((event) => event.stage === 'process-creation-identity')
                .map((event) => event.creationSourceStatus),
            ['missing', 'missing'],
        );
    } finally {
        binding.mock.restore();
        stop();
    }
});

test('admission fault disables new observation while preserving ordinary delivery', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: {
            matches: () => {
                throw new Error('admission');
            },
        },
    });
    try {
        const evidence = await snapshot();
        validateProcessIdentity(evidence, target(2009));
        emitFixtureEvent('native-close', 'end');
        assert.equal(stop.creationIdentityStats().disabled, true);
        assert.equal(stop.creationIdentityStats().revoked, false);
        assert.equal(stop.creationIdentityStats().tokens, 0);
        assert.equal(events.at(-1)?.stage, 'native-close');
    } finally {
        stop();
    }
});

test('closed schema rejects accessors, symbols, unsafe numbers, invalid prototypes and stage pollution', () => {
    const base = {
        stage: 'process-creation-identity',
        event: 'decision',
        phase: 'process-identity',
        outcome: 'observed',
        timestampMs: 1,
        durationMs: 0,
        creationNewlyLaunched: false,
        creationToleranceMs: 1000,
        creationComparisonStatus: 'reached',
        creationSourceStatus: 'missing',
        creationUpperNowStatus: 'not-evaluated',
        creationBranch: 'established-accepted',
        creationExpectedUtcMs: -1,
        creationObservedUtcMs: -1,
    };
    let reads = 0;
    const accessor = Object.defineProperty({ ...base }, 'creationObservedUtcMs', {
        enumerable: true,
        get() {
            reads++;
            return -1;
        },
    });
    for (const invalid of [
        accessor,
        { ...base, [Symbol('private')]: 0 },
        Object.assign(Object.create({ private: 1 }), base),
        { ...base, creationExpectedUtcMs: Infinity },
        { ...base, creationExpectedUtcMs: 8640000000000001 },
        { ...base, creationExpectedUtcMs: 0.1 },
        { ...base, stage: 'native-snapshot' },
    ])
        assert.equal(validateFixtureEvent(invalid), undefined);
    assert.equal(reads, 0);
});

test('root accessor mutation cannot keep complete metadata', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            const evidence = await snapshot();
            Object.defineProperty(evidence.root, 'startedAtUtc', {
                enumerable: true,
                get: () => '1970-01-01T00:00:02.009Z',
            });
            validateProcessIdentity(evidence, target(2009));
            assert.equal(
                events.find((event) => event.stage === 'process-creation-identity')?.creationSourceStatus,
                'unverifiable',
            );
        });
    } finally {
        stop();
    }
});

test('standalone creation decoder rejects envelope fields and shares event invariants', () => {
    const fields = {
        creationNewlyLaunched: false,
        creationToleranceMs: 1000,
        creationComparisonStatus: 'reached',
        creationSourceStatus: 'missing',
        creationUpperNowStatus: 'not-evaluated',
        creationBranch: 'established-accepted',
        creationExpectedUtcMs: -1,
        creationObservedUtcMs: -1,
    };
    assert.deepEqual(diagnostics.validateCreationIdentityFields(fields), fields);
    assert.equal(diagnostics.validateCreationIdentityFields({ ...fields, creationObservedUtcMs: 1001 }), undefined);
    assert.equal(diagnostics.validateCreationIdentityFields({ ...fields, command: 'getconf' }), undefined);
    assert.equal(
        validateFixtureEvent({
            ...fields,
            stage: 'process-creation-identity',
            event: 'decision',
            phase: 'process-identity',
            outcome: 'observed',
            timestampMs: 1,
            durationMs: 0,
            command: 'getconf',
        }),
        undefined,
    );
});

test('complete source schema rejects incomplete intervals and malformed associated numbers', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        const evidence = await snapshot();
        validateProcessIdentity(evidence, target(2009));
        const event = events.find((event) => event.stage === 'process-creation-identity');
        assert.ok(event);
        for (const change of [
            { creationClkTck: 0 },
            { creationStartTicks: -1 },
            { creationBootSeconds: Number.MAX_SAFE_INTEGER + 1 },
            { creationComputedNumberMs: 2010 },
            { creationStatReadStartedMs: Infinity },
            { creationBootReadEndedMs: -1 },
            { creationClkReadEndedMs: 0 },
        ])
            assert.equal(validateFixtureEvent({ ...event, ...change }), undefined);
        const { creationBootReadStartedMs: _start, ...partial } = event;
        assert.equal(validateFixtureEvent(partial), undefined);
        const { creationExpectedUtcMs: _expected, creationObservedUtcMs: _observed, ...notReached } = event;
        assert.equal(
            validateFixtureEvent({ ...notReached, creationComparisonStatus: 'not-reached', creationBranch: undefined }),
            undefined,
        );
    } finally {
        stop();
    }
});

test('new upper rejection captures only the original now and receiver cannot change its result', async () => {
    const events: FixtureEvent[] = [];
    let calls = 0;
    let now = 1008;
    const wallClock = mock.method(Date, 'now', () => {
        calls++;
        return now;
    });
    const stop = subscribeFixtureDiagnostics(
        (event) => {
            events.push(event);
            if (event.stage === 'process-creation-identity') {
                now = 100000;
                throw new Error('receiver after decision');
            }
        },
        undefined,
        undefined,
        { creationIdentity: { matches: () => true } },
    );
    try {
        const evidence = await snapshot();
        assert.throws(
            () => validateProcessIdentity(evidence, target(2009), { newlyLaunched: true }),
            /PID may have been reused/,
        );
        assert.equal(calls, 1);
        const event = events.find((event) => event.stage === 'process-creation-identity');
        assert.equal(event?.creationUpperNowUtcMs, 1008);
        assert.equal(event?.creationBranch, 'new-upper-rejected');
    } finally {
        wallClock.mock.restore();
        stop();
    }
});

test('invalid original creation inputs are unverifiable without invalid numeric substitution', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        const evidence = await snapshot();
        assert.ok(evidence.root.exists);
        evidence.root.startedAtUtc = 'invalid';
        assert.throws(() => validateProcessIdentity(evidence, target(2009)), /creation time is unverifiable/);
        const event = events.find((event) => event.stage === 'process-creation-identity');
        assert.equal(event?.creationComparisonStatus, 'unverifiable');
        assert.equal(event?.creationBranch, 'creation-unverifiable');
        assert.equal(event?.creationObservedUtcMs, undefined);
        assert.equal(event?.creationExpectedUtcMs, undefined);
        assert.equal(event?.creationBootSeconds, undefined);
    } finally {
        stop();
    }
});

test('lsof or executable-resolution failure consumes source admission without returning a root', async () => {
    for (const failAt of ['lsof', 'readlink']) {
        const failure = new Error(failAt);
        const stop = subscribeFixtureDiagnostics(() => {}, undefined, undefined, {
            creationIdentity: { matches: () => true },
        });
        try {
            const operation = unixSnapshot(42, 9222, {
                platform: 'linux',
                currentUser: () => 7,
                readText: async (file) =>
                    file === '/proc/stat' ? 'btime 0' : `42 (chrome) ${['S', ...Array(18).fill('0'), '201'].join(' ')}`,
                readlink: async () => {
                    throw failure;
                },
                run: async (command) => {
                    if (command === failAt) throw failure;
                    return {
                        code: 0,
                        stderr: '',
                        stdout:
                            command === 'ps'
                                ? '42 1 7 Thu Oct  8 00:16:40 2026 Chrome\n'
                                : command === 'getconf'
                                  ? '100'
                                  : '',
                    };
                },
            });
            await assert.rejects(operation, (error) => error === failure);
            assert.equal(stop.creationIdentityStats().tokens, 1);
            assert.equal(stop.creationIdentityStats().sourceAttempts, 1);
            assert.equal(stop.creationIdentityStats().comparisons, 0);
        } finally {
            stop();
        }
    }
});

test('projection failure cannot replace the original rejected creation error', async () => {
    const stop = subscribeFixtureDiagnostics(() => {}, undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        const evidence = await snapshot();
        const get = mock.method(WeakMap.prototype, 'get', () => {
            throw new Error('projection');
        });
        try {
            assert.throws(() => validateProcessIdentity(evidence, target(3010)), /PID may have been reused/);
        } finally {
            get.mock.restore();
        }
    } finally {
        stop();
    }
});

test('source cap performs no added clocks after failed attempts have exhausted 128 frames', async () => {
    const stop = subscribeFixtureDiagnostics(() => {}, undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        for (let index = 0; index < 128; index++) await assert.rejects(snapshot(0, 0, 0));
        let calls = 0;
        const clock = mock.method(performance, 'now', () => ++calls);
        try {
            await snapshot();
            assert.equal(calls, 25);
        } finally {
            clock.mock.restore();
        }
        const saved = stop.creationIdentityStats();
        stop();
        assert.deepEqual(stop.creationIdentityStats(), { ...saved, revoked: true });
        assert.ok(Object.isFrozen(saved));
    } finally {
        stop();
    }
});

test('resource-scoped source remains complete when readiness compares under its operation scope', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: {
            matches: (origin) => origin.originOperationId === identity.operationId && origin.pid === 42,
        },
    });
    try {
        await runFixtureObservation(identity, async () => {
            const origin = captureFixtureOrigin({ pid: 42, port: 9222 });
            const evidence = await runFixtureResource(origin, () => snapshot());
            validateProcessIdentity(evidence, target(2009));
            const event = events.find((event) => event.stage === 'process-creation-identity');
            assert.equal(event?.creationSourceStatus, 'complete');
            assert.equal(event?.pid, 42);
            assert.equal(event?.originOperationId, identity.operationId);
            assert.equal(stop.creationIdentityStats().tokens, 1);
        });
    } finally {
        stop();
    }
});

test('explicit current PID, port or origin conflicts never inherit source completeness or reuse', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            const evidence = await snapshot();
            for (const conflict of [
                { pid: 43 },
                { port: 9223 },
                { operationId: '33333333-3333-4333-8333-333333333333' },
            ]) {
                await runFixtureObservation({ ...identity, ...conflict }, () =>
                    validateProcessIdentity(evidence, target(2009)),
                );
            }
            validateProcessIdentity(evidence, target(2009));
            const comparisons = events.filter((event) => event.stage === 'process-creation-identity');
            assert.deepEqual(
                comparisons.map((event) => event.creationSourceStatus),
                ['unverifiable', 'unverifiable', 'unverifiable', 'complete'],
            );
            assert.equal(comparisons[0]?.pid, 43);
            assert.equal(comparisons[1]?.port, 9223);
            assert.equal(stop.creationIdentityStats().tokens, 4);
            assert.equal(stop.creationIdentityStats().comparisons, 4);
        });
    } finally {
        stop();
    }
});

test('invalid explicit scope resources cannot recover private fallback while absent and undefined can', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        await runFixtureObservation(identity, async () => {
            const evidence = await snapshot();
            for (const invalid of [
                { pid: 0 },
                { pid: NaN },
                { pid: 1.5 },
                { pid: Number.MAX_SAFE_INTEGER + 1 },
                { port: 65536 },
                { port: -1 },
                { port: 0 },
                { port: 1.5 },
            ]) {
                await runFixtureObservation({ ...identity, ...invalid }, () =>
                    validateProcessIdentity(evidence, target(2009)),
                );
                assert.equal(
                    events.filter((event) => event.stage === 'process-creation-identity').at(-1)?.creationSourceStatus,
                    'unverifiable',
                );
            }
            validateProcessIdentity(evidence, target(2009));
            await runFixtureObservation({ ...identity, pid: undefined, port: undefined }, () =>
                validateProcessIdentity(evidence, target(2009)),
            );
            assert.deepEqual(
                events
                    .filter((event) => event.stage === 'process-creation-identity')
                    .slice(-2)
                    .map((event) => event.creationSourceStatus),
                ['complete', 'complete'],
            );
            assert.equal(stop.creationIdentityStats().tokens, 10);
        });
    } finally {
        stop();
    }
});

test('scope resource accessors are never invoked or correlated as complete', async () => {
    const events: FixtureEvent[] = [];
    let getterCalls = 0;
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        for (const key of ['pid', 'port']) {
            const scope = { ...identity };
            Object.defineProperty(scope, key, {
                enumerable: true,
                get: () => {
                    getterCalls++;
                    return key === 'pid' ? 42 : 9222;
                },
            });
            await runFixtureObservation(scope, async () => {
                assert.equal(Reflect.get(captureFixtureOrigin() ?? {}, key), undefined);
                const evidence = await snapshot();
                validateProcessIdentity(evidence, target(2009));
                assert.throws(() => validateProcessIdentity(evidence, target(3010)), /PID may have been reused/);
            });
        }
        assert.equal(getterCalls, 0);
        assert.ok(
            events
                .filter((event) => event.stage === 'process-creation-identity')
                .every((event) => event.creationSourceStatus === 'unverifiable'),
        );
        assert.equal(events.filter((event) => event.stage === 'process-creation-identity').length, 4);
    } finally {
        stop();
    }
});

test('source admission cannot reserve or measure after matches revokes its request', async () => {
    const events: FixtureEvent[] = [];
    let revoke = () => {};
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: {
            matches: () => {
                revoke();
                return true;
            },
        },
    });
    revoke = stop.revokeCreationIdentity;
    let clocks = 0;
    const clock = mock.method(performance, 'now', () => ++clocks);
    try {
        const evidence = await snapshot();
        assert.equal(clocks, 25);
        validateProcessIdentity(evidence, target(2009));
        assert.equal(stop.creationIdentityStats().tokens, 0);
        assert.equal(stop.creationIdentityStats().sourceAttempts, 0);
        assert.equal(stop.creationIdentityStats().comparisons, 0);
        assert.equal(stop.creationIdentityStats().revoked, true);
        emitFixtureEvent('native-close', 'end');
        assert.equal(events.at(-1)?.stage, 'native-close');
        assert.equal(
            events.some((event) => event.stage === 'process-creation-identity'),
            false,
        );
    } finally {
        clock.mock.restore();
        stop();
    }
});

test('comparison admission cannot reuse or publish after matches revokes its request', async () => {
    const events: FixtureEvent[] = [];
    let admissions = 0;
    let revoke = () => {};
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: {
            matches: () => {
                if (++admissions === 2) revoke();
                return true;
            },
        },
    });
    revoke = stop.revokeCreationIdentity;
    try {
        const evidence = await snapshot();
        validateProcessIdentity(evidence, target(2009));
        assert.equal(stop.creationIdentityStats().tokens, 1);
        assert.equal(stop.creationIdentityStats().comparisons, 0);
        emitFixtureEvent('native-close', 'end');
        assert.equal(events.at(-1)?.stage, 'native-close');
        assert.equal(
            events.some((event) => event.stage === 'process-creation-identity'),
            false,
        );
    } finally {
        stop();
    }
});

test('publication rechecks revocation caused by its current scope resolver before timestamping', async () => {
    const events: FixtureEvent[] = [];
    let admissions = 0;
    let projection = false;
    let revoke = () => {};
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: {
            matches: () => {
                if (++admissions === 2) projection = true;
                return true;
            },
        },
    });
    revoke = stop.revokeCreationIdentity;
    try {
        await runFixtureObservation(
            () => {
                if (projection) revoke();
                return identity;
            },
            async () => {
                const evidence = await snapshot();
                let clocks = 0;
                const clock = mock.method(performance, 'now', () => ++clocks);
                try {
                    validateProcessIdentity(evidence, target(2009));
                    assert.equal(clocks, 0);
                } finally {
                    clock.mock.restore();
                }
                assert.equal(stop.creationIdentityStats().revoked, true);
                assert.equal(
                    events.some((event) => event.stage === 'process-creation-identity'),
                    false,
                );
            },
        );
    } finally {
        stop();
    }
});

test('creation decision outcomes agree with rejection branches and incomplete comparisons', () => {
    const base = {
        stage: 'process-creation-identity',
        event: 'decision',
        phase: 'process-identity',
        outcome: 'observed',
        timestampMs: 1,
        durationMs: 0,
        creationNewlyLaunched: false,
        creationToleranceMs: 1000,
        creationComparisonStatus: 'reached',
        creationSourceStatus: 'missing',
        creationUpperNowStatus: 'not-evaluated',
        creationBranch: 'established-accepted',
        creationExpectedUtcMs: 2009,
        creationObservedUtcMs: 2009,
    };
    for (const outcome of [
        'started',
        'succeeded',
        'failed',
        'cancelled',
        'retained',
        'released',
        'skipped',
        'requested',
    ])
        assert.equal(validateFixtureEvent({ ...base, outcome }), undefined);
    const {
        creationExpectedUtcMs: _expected,
        creationObservedUtcMs: _actual,
        creationBranch: _branch,
        ...withoutComparison
    } = base;
    const rejecting = [
        { ...base, creationNewlyLaunched: true, creationBranch: 'new-lower-rejected', creationExpectedUtcMs: 3010 },
        {
            ...base,
            creationNewlyLaunched: true,
            creationBranch: 'new-upper-rejected',
            creationUpperNowStatus: 'read',
            creationUpperNowUtcMs: 1008,
        },
        { ...base, creationBranch: 'established-delta-rejected', creationExpectedUtcMs: 3010 },
        { ...withoutComparison, creationComparisonStatus: 'not-reached' },
        { ...withoutComparison, creationComparisonStatus: 'unverifiable', creationBranch: 'creation-unverifiable' },
    ];
    for (const event of rejecting) {
        assert.equal(validateFixtureEvent(event), undefined);
        assert.ok(validateFixtureEvent({ ...event, outcome: 'rejected' }));
        const group: Record<string, unknown> = {};
        for (const key of diagnostics.CREATION_IDENTITY_FIELD_KEYS)
            if (Object.hasOwn(event, key)) group[key] = Reflect.get(event, key);
        assert.ok(diagnostics.validateCreationIdentityFields(group));
    }
    for (const outcome of ['observed', 'rejected']) {
        assert.ok(validateFixtureEvent({ ...base, outcome }));
        assert.ok(
            validateFixtureEvent({
                ...base,
                outcome,
                creationNewlyLaunched: true,
                creationBranch: 'new-accepted',
                creationUpperNowStatus: 'read',
                creationUpperNowUtcMs: 2009,
            }),
        );
    }
});

test('later Windows branding failure permits a rejected event with an accepted creation branch', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    assert.ok(platform);
    let nowCalls = 0;
    const clock = mock.method(Date, 'now', () => {
        nowCalls++;
        return 2009;
    });
    try {
        const evidence = await snapshot();
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
        assert.throws(
            () => validateProcessIdentity(evidence, { ...target(2009), targetKind: 'chrome' }, { newlyLaunched: true }),
            /not identified as Google Chrome/,
        );
        const event = events.find((event) => event.stage === 'process-creation-identity');
        assert.equal(event?.outcome, 'rejected');
        assert.equal(event?.creationBranch, 'new-accepted');
        assert.equal(event?.creationUpperNowUtcMs, 2009);
        assert.equal(nowCalls, 1);
    } finally {
        Object.defineProperty(process, 'platform', platform);
        clock.mock.restore();
        stop();
    }
});

type BundledCreationProducer = {
    unixSnapshot: typeof unixSnapshot;
    validateProcessIdentity: typeof validateProcessIdentity;
    runFixtureObservation: typeof runFixtureObservation;
    emitFixtureEvent: typeof emitFixtureEvent;
};
async function bundledCreationProducer() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-creation-bundle-'));
    const root = fileURLToPath(new URL('..', import.meta.url));
    const outfile = path.join(directory, 'producer.mjs');
    await build({
        absWorkingDir: root,
        stdin: {
            contents: `export { unixSnapshot, validateProcessIdentity } from './src/adapters/platform-process.ts'; export { runFixtureObservation, emitFixtureEvent } from './src/adapters/fixture-diagnostics.ts';`,
            resolveDir: root,
            sourcefile: 'creation-producer-entry.ts',
        },
        outfile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        packages: 'bundle',
        legalComments: 'none',
        banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
        logLevel: 'warning',
        metafile: true,
    });
    const imported: unknown = await import(pathToFileURL(outfile).href);
    assert.ok(isRecord(imported));
    assert.deepEqual(Object.keys(imported).sort(), [
        'emitFixtureEvent',
        'runFixtureObservation',
        'unixSnapshot',
        'validateProcessIdentity',
    ]);
    for (const value of Object.values(imported)) assert.equal(typeof value, 'function');
    const producer = imported as BundledCreationProducer;
    return {
        producer,
        directory,
        async cleanup() {
            assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-creation-bundle-'));
            await rm(directory, { recursive: true, force: true });
        },
    };
}
async function bundledSnapshot(producer: BundledCreationProducer, clk = 100, pid = 42) {
    return producer.unixSnapshot(pid, 9222, {
        platform: 'linux',
        currentUser: () => 7,
        readlink: async () => '/owned/chrome',
        readText: async (file) =>
            file === '/proc/stat' ? 'btime 0\n' : `${pid} (chrome) ${['S', ...Array(18).fill('0'), '201'].join(' ')}`,
        run: async (command) => ({
            code: 0,
            stderr: '',
            stdout:
                command === 'ps'
                    ? `${pid} 1 7 Thu Oct  8 00:16:40 2026 Chrome\n`
                    : command === 'getconf'
                      ? String(clk)
                      : '',
        }),
    });
}

test('independently bundled producer stays default-off with an ordinary source subscriber', async () => {
    const b = await bundledCreationProducer();
    const events: FixtureEvent[] = [];
    let rejected = 0;
    const stop = subscribeFixtureDiagnostics(
        (event) => events.push(event),
        () => rejected++,
    );
    let clocks = 0;
    const clock = mock.method(performance, 'now', () => ++clocks);
    try {
        const evidence = await bundledSnapshot(b.producer);
        b.producer.validateProcessIdentity(evidence, target(2009));
        assert.equal(clocks, 25);
        assert.equal(
            events.some((event) => event.stage === 'process-creation-identity'),
            false,
        );
        assert.equal(rejected, 0);
    } finally {
        clock.mock.restore();
        stop();
        await b.cleanup();
    }
});

test('source opt-in controls tree-shaken bundled producer and shared stats revoke lifecycle independently', async () => {
    const b = await bundledCreationProducer();
    const events: FixtureEvent[] = [];
    let rejected = 0;
    const stop = subscribeFixtureDiagnostics(
        (event) => events.push(event),
        () => rejected++,
        undefined,
        { creationIdentity: { matches: (origin) => origin.originOperationId === identity.operationId } },
    );
    try {
        await b.producer.runFixtureObservation(identity, async () => {
            const evidence = await bundledSnapshot(b.producer);
            b.producer.validateProcessIdentity(evidence, target(2009));
            const event = events.find((event) => event.stage === 'process-creation-identity');
            assert.equal(event?.creationSourceStatus, 'complete');
            assert.equal(event?.creationObservedUtcMs, 2009);
            assert.equal(event?.creationComputedNumberMs, 2009.9999999999998);
            assert.equal(stop.creationIdentityStats().tokens, 1);
            b.producer.validateProcessIdentity(evidence, target(2009));
            assert.equal(stop.creationIdentityStats().tokens, 2);
            stop.revokeCreationIdentity();
            b.producer.validateProcessIdentity(evidence, target(2009));
            b.producer.emitFixtureEvent('native-close', 'end');
            assert.equal(events.filter((event) => event.stage === 'process-creation-identity').length, 2);
            assert.equal(events.at(-1)?.stage, 'native-close');
            assert.equal(rejected, 0);
            assert.equal(stop.creationIdentityStats().revoked, true);
        });
    } finally {
        stop();
        assert.ok(Object.isFrozen(stop.creationIdentityStats()));
        await b.cleanup();
    }
});

test('two independent producer bundles share source request cap and retain token128 first comparison', async () => {
    const [a, b] = await Promise.all([bundledCreationProducer(), bundledCreationProducer()]);
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        for (let index = 0; index < 127; index++) await assert.rejects(bundledSnapshot(a.producer, 0));
        const evidence = await bundledSnapshot(b.producer);
        b.producer.validateProcessIdentity(evidence, target(2009));
        b.producer.validateProcessIdentity(evidence, target(2009));
        assert.equal(events.filter((event) => event.stage === 'process-creation-identity').length, 1);
        assert.deepEqual(stop.creationIdentityStats(), {
            sourceAttempts: 128,
            comparisons: 1,
            tokens: 128,
            capped: true,
            disabled: false,
            revoked: false,
        });
        let clocks = 0;
        const clock = mock.method(performance, 'now', () => ++clocks);
        try {
            await bundledSnapshot(a.producer);
            assert.equal(clocks, 25);
        } finally {
            clock.mock.restore();
        }
    } finally {
        stop();
        await a.cleanup();
        await b.cleanup();
    }
});

test('source requests from independent module copies join one process-wide registry', async () => {
    const [a, b] = await Promise.all([bundledCreationProducer(), bundledCreationProducer()]);
    const otherModule: unknown = await import(
        `${pathToFileURL(fileURLToPath(new URL('../src/adapters/fixture-diagnostics.ts', import.meta.url))).href}?creation-copy=${path.basename(b.directory)}`
    );
    assert.ok(isRecord(otherModule));
    assert.equal(typeof otherModule.subscribeFixtureDiagnostics, 'function');
    const otherSubscribe = otherModule.subscribeFixtureDiagnostics as typeof subscribeFixtureDiagnostics;
    const otherIdentity = { ...identity, operationId: '33333333-3333-4333-8333-333333333333' };
    const first = subscribeFixtureDiagnostics(() => {}, undefined, undefined, {
        creationIdentity: { matches: (origin) => origin.originOperationId === identity.operationId },
    });
    const second = otherSubscribe(() => {}, undefined, undefined, {
        creationIdentity: { matches: (origin) => origin.originOperationId === otherIdentity.operationId },
    });
    try {
        await a.producer.runFixtureObservation(identity, async () => {
            const evidence = await bundledSnapshot(a.producer);
            a.producer.validateProcessIdentity(evidence, target(2009));
        });
        await b.producer.runFixtureObservation(otherIdentity, async () => {
            const evidence = await bundledSnapshot(b.producer);
            b.producer.validateProcessIdentity(evidence, target(2009));
        });
        assert.equal(first.creationIdentityStats().comparisons, 1);
        assert.equal(second.creationIdentityStats().comparisons, 1);
        first();
        await b.producer.runFixtureObservation(otherIdentity, async () => {
            const evidence = await bundledSnapshot(b.producer);
            b.producer.validateProcessIdentity(evidence, target(2009));
        });
        assert.equal(second.creationIdentityStats().comparisons, 2);
    } finally {
        first();
        second();
        await a.cleanup();
        await b.cleanup();
    }
});

test('bundled producer faults update source stats without replacing original I/O or decisions', async () => {
    const b = await bundledCreationProducer();
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics(
        (event) => {
            events.push(event);
            if (event.stage === 'process-creation-identity') throw Error('receiver');
        },
        undefined,
        undefined,
        { creationIdentity: { matches: () => true } },
    );
    try {
        const evidence = await bundledSnapshot(b.producer);
        assert.throws(() => b.producer.validateProcessIdentity(evidence, target(3010)), /PID may have been reused/);
        assert.equal(stop.creationIdentityStats().comparisons, 1);
        const iterator = Set.prototype[Symbol.iterator];
        let thrown: unknown;
        try {
            Set.prototype[Symbol.iterator] = () => {
                throw Error('bookkeeping');
            };
            try {
                b.producer.validateProcessIdentity(evidence, target(3010));
            } catch (error) {
                thrown = error;
            }
        } finally {
            Set.prototype[Symbol.iterator] = iterator;
        }
        assert.ok(thrown instanceof Error);
        assert.match(thrown.message, /PID may have been reused/);
        assert.equal(stop.creationIdentityStats().disabled, true);
        assert.equal(events.filter((event) => event.stage === 'process-creation-identity').length, 1);
    } finally {
        stop();
        await b.cleanup();
    }
});

test('bundled identity reject reaches source preload capture and artifact only after original Close gate', async () => {
    const b = await bundledCreationProducer();
    const artifactDirectory = path.join(b.directory, 'capture-artifact');
    const parent = createFixtureArtifacts(artifactDirectory, 'official-server', { firstStartCapture: true });
    const collector = createFixtureArtifacts(artifactDirectory, 'official-server', {
        firstStartCapture: true,
        streamOnly: true,
        collectionId: parent.snapshot().collectionId,
    });
    let revoke = () => {};
    let stats: () => unknown = () => undefined;
    const h = createFirstStartHarness({}, (record) => collector.firstStartCapture(record), {
        revokeCreationIdentity: () => revoke(),
        creationIdentityStats: () => stats(),
    });
    let rejected = 0;
    const stop = subscribeFixtureDiagnostics(
        (event) => dispatchFixtureDiagnostic(event, { gateway: () => {}, firstStart: h }),
        () => rejected++,
        undefined,
        { creationIdentity: { matches: h.matchesCreationOrigin } },
    );
    revoke = stop.revokeCreationIdentity;
    stats = stop.creationIdentityStats;
    try {
        await b.producer.runFixtureObservation({ ...firstStartRoute, action: 'start', port: 9222 }, async () => {
            b.producer.emitFixtureEvent('spawn', 'begin');
            b.producer.emitFixtureEvent('spawn', 'decision', { reason: 'acquired' });
            b.producer.emitFixtureEvent('readiness', 'begin', { phase: 'waiting-cdp' });
            const evidence = await bundledSnapshot(b.producer, 100, 123);
            assert.throws(
                () => b.producer.validateProcessIdentity(evidence, target(3010), { newlyLaunched: true }),
                /PID may have been reused/,
            );
            b.producer.emitFixtureEvent('native-snapshot', 'decision', {
                valid: false,
                reason: 'identity-mismatch',
                outcome: 'rejected',
            });
            b.producer.emitFixtureEvent('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
            assert.equal(h.records.length, 0);
            assert.equal(await readFile(path.join(artifactDirectory, 'official-server.events.ndjson'), 'utf8'), '');
            assert.equal(h.paths.length, 0);
            b.producer.emitFixtureEvent('native-close', 'begin');
            assert.equal(h.records.length, 0);
            b.producer.emitFixtureEvent('native-close', 'end', { outcome: 'failed' });
        });
        await drainFirstStart(h);
        const creations = h.records.filter((record) => record.creation);
        assert.equal(creations.length, 1);
        assert.equal(creations[0]?.creation?.creationSourceStatus, 'complete');
        assert.equal(creations[0]?.creation?.creationBranch, 'new-lower-rejected');
        assert.equal(h.records.find((record) => record.slot === 'limitations')?.creationObservation?.sourceAttempts, 1);
        assert.equal(h.records.find((record) => record.slot === 'limitations')?.creationObservation?.comparisons, 1);
        assert.equal(h.records.find((record) => record.slot === 'limitations')?.creationObservation?.tokens, 1);
        const text = await readFile(path.join(artifactDirectory, 'official-server.events.ndjson'), 'utf8');
        const records = text
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        assert.ok(
            records.some(
                (record) => validateFirstStartCaptureRecord(record)?.creation?.creationSourceStatus === 'complete',
            ),
        );
        assert.ok(h.records.length <= 64);
        assert.doesNotMatch(text, /bookkeepingFailed|requests|matches|responder/);
        assert.equal(rejected, 0);
    } finally {
        stop();
        h.finish();
        await b.cleanup();
    }
});

test('closed registry discovery rejects malformed requests without getters or fixture-stage pollution', async () => {
    const b = await bundledCreationProducer();
    const control = channel('debugging-cdp-targets.fixture.creation-observation-registry');
    const events: FixtureEvent[] = [];
    let rejected = 0;
    let getters = 0;
    const stop = subscribeFixtureDiagnostics(
        (event) => events.push(event),
        () => rejected++,
        undefined,
        { creationIdentity: { matches: () => true } },
    );
    try {
        const accessor = Object.defineProperty({ kind: 'creation-observation-registry' }, 'reply', {
            enumerable: true,
            get() {
                getters++;
                return undefined;
            },
        });
        const readonly = Object.defineProperty({ kind: 'creation-observation-registry' }, 'reply', {
            enumerable: true,
            value: undefined,
            writable: false,
            configurable: true,
        });
        for (const query of [
            accessor,
            readonly,
            { kind: 'creation-observation-registry', reply: undefined, raw: 'private' },
            { kind: 'wrong', reply: undefined },
            Object.assign(Object.create({ inherited: true }), {
                kind: 'creation-observation-registry',
                reply: undefined,
            }),
        ])
            control.publish(query);
        assert.equal(getters, 0);
        assert.equal(stop.creationIdentityStats().disabled, false);
        const evidence = await bundledSnapshot(b.producer);
        b.producer.validateProcessIdentity(evidence, target(2009));
        assert.equal(events.filter((event) => event.stage === 'process-creation-identity').length, 1);
        assert.equal(rejected, 0);
        assert.ok(events.every((event) => !Object.hasOwn(event, 'requests') && !Object.hasOwn(event, 'responder')));
    } finally {
        stop();
        assert.equal(control.hasSubscribers, false);
        await b.cleanup();
    }
});

test('bundled producer diagnostic clock and admission reentrancy retain original outcomes', async () => {
    const b = await bundledCreationProducer();
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    let clocks = 0;
    const clock = mock.method(performance, 'now', () => {
        if (++clocks === 5) throw Error('added timing');
        return clocks;
    });
    try {
        const evidence = await bundledSnapshot(b.producer);
        b.producer.validateProcessIdentity(evidence, target(2009));
        assert.ok(evidence.root.exists);
        assert.equal(evidence.root.startedAtUtc, '1970-01-01T00:00:02.009Z');
        const event = events.find((event) => event.stage === 'process-creation-identity');
        assert.equal(event?.creationSourceStatus, 'unverifiable');
        assert.equal(event?.creationStartTicks, undefined);
        assert.equal(stop.creationIdentityStats().tokens, 1);
    } finally {
        clock.mock.restore();
        stop();
    }
    let revoke = () => {};
    const reentrant = subscribeFixtureDiagnostics(() => {}, undefined, undefined, {
        creationIdentity: {
            matches: () => {
                revoke();
                return true;
            },
        },
    });
    revoke = reentrant.revokeCreationIdentity;
    clocks = 0;
    const baseline = mock.method(performance, 'now', () => ++clocks);
    try {
        const evidence = await bundledSnapshot(b.producer);
        b.producer.validateProcessIdentity(evidence, target(2009));
        assert.equal(clocks, 25);
        assert.equal(reentrant.creationIdentityStats().tokens, 0);
    } finally {
        baseline.mock.restore();
        reentrant();
        await b.cleanup();
    }
});

test('cross-bundle roots do not share private source metadata despite shared observation requests', async () => {
    const [a, b] = await Promise.all([bundledCreationProducer(), bundledCreationProducer()]);
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event), undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        const evidence = await bundledSnapshot(a.producer);
        b.producer.validateProcessIdentity(evidence, target(2009));
        a.producer.validateProcessIdentity(evidence, target(2009));
        assert.deepEqual(
            events
                .filter((event) => event.stage === 'process-creation-identity')
                .map((event) => event.creationSourceStatus),
            ['missing', 'complete'],
        );
        assert.equal(stop.creationIdentityStats().tokens, 2);
        assert.equal(stop.creationIdentityStats().comparisons, 2);
    } finally {
        stop();
        await a.cleanup();
        await b.cleanup();
    }
});

test('unsafe observation bookkeeping preserves the original error and disables future observations', async () => {
    const stop = subscribeFixtureDiagnostics(() => {}, undefined, undefined, {
        creationIdentity: { matches: () => true },
    });
    try {
        const evidence = await snapshot();
        const iterator = Set.prototype[Symbol.iterator];
        let thrown: unknown;
        try {
            Set.prototype[Symbol.iterator] = () => {
                throw new Error('diagnostic bookkeeping');
            };
            try {
                validateProcessIdentity(evidence, target(3010));
            } catch (error) {
                thrown = error;
            }
        } finally {
            Set.prototype[Symbol.iterator] = iterator;
        }
        assert.ok(thrown instanceof Error);
        assert.match(thrown.message, /PID may have been reused/);
        assert.equal(stop.creationIdentityStats().disabled, true);
    } finally {
        stop();
    }
});

/** A conservative closed-grammar bound, deliberately including incompatible optional groups.
 * JSON keys, delimiters and quotes are counted. N is at most sign+25 digits, U20,
 * S16, M/D sign+16 digits. All permitted strings are ASCII and need no escaping.
 * Nonnegative finite Number JSON uses <=17 significant digits: fixed notation is
 * at most24 characters (0.00000 +17 digits); exponent notation is at most23
 * (digit, dot,16 digits,e,sign,3 exponent digits). Thus atMs costs at most24.
 * Every legal tree is a subset of these keys with no larger primitive encoding;
 * including incompatible alternatives makes this an upper bound, not a fixture.
 */
function currentCreationWireBound() {
    const objectBytes = (fields: Record<string, number>) => {
        const entries = Object.entries(fields);
        return (
            2 +
            entries.reduce((total, [key, value]) => total + JSON.stringify(key).length + 1 + value, 0) +
            Math.max(0, entries.length - 1)
        );
    };
    const longest = (...values: string[]) => Math.max(...values.map((value) => JSON.stringify(value).length));
    const N = 28,
        U = 22,
        S = 18,
        M = 17,
        D = 17;
    const interval = objectBytes({ lowerNs: N, upperNs: N });
    const calibration = objectBytes({ beforeUtcMs: M, afterUtcMs: M, uptimeUpperNs: U, offset: interval });
    const facts = objectBytes({
        pre: calibration,
        post: calibration,
        postFailure: objectBytes({
            branch: longest('read-or-abort', 'bracket-or-text-invalid', 'uptime-out-of-range'),
        }),
        raw: objectBytes({ q: S, H: S, bootSeconds: S }),
        requestUtcMs: M,
        decisionUtcMs: M,
        offset: objectBytes({ status: longest('nonempty', 'empty'), lowerNs: N, upperNs: N }),
        birth: objectBytes({
            branch: longest('divide', 'multiply-512', 'multiply-9', 'input-rejected'),
            result: longest('present', 'input-rejected', 'zero-divisor', 'range-rejected', 'empty'),
            readerUpperNs: U,
            interval: objectBytes({ lowerNs: U, upperNs: U }),
        }),
        absolute: interval,
        public: objectBytes({
            branch: longest(
                'invalid-clock',
                'containment-or-order-rejected',
                'point-or-date-range-rejected',
                'date-roundtrip-rejected',
                'accepted',
            ),
            pointMs: N,
        }),
        selectedMs: D,
    });
    const nested = objectBytes({
        model: longest('linux-private-interval-v1'),
        mode: longest('unregistered', 'unselected', 'initial', 'established'),
        decision: longest(
            'no-launch',
            'launch-check-threw',
            'root-proof-rejected',
            'established-changed',
            'established-accepted',
            'boot-missing',
            'post-calibration-threw',
            'post-launch-check-threw',
            'clock-order-rejected',
            'root-proof-changed',
            'decision-clock-rejected',
            'interval-rejected',
            'readiness-check-threw',
            'final-launch-check-threw',
            'concurrent-changed',
            'initial-accepted',
        ),
        timeBasis: longest('source-stat-read-ended'),
        facts,
    });
    const lineWithNewline =
        objectBytes({
            kind: longest('linux-first-start-capture'),
            slot: longest('creation-first-comparison', 'creation-first-rejected'),
            status: longest('complete', 'identity-invalid'),
            atMs: 24,
            entryId: 38,
            connectionId: 38,
            sessionId: 38,
            operationId: 38,
            requestId: 38,
            pid: 16,
            rootStartTicks: 16,
            creation: nested,
        }) + 1;
    return { nested, lineWithNewline };
}
test('derived current grammar bound covers longest operands and actual writer envelope alternatives', async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-current-max-envelope-'));
    try {
        const signed = '-9999999999999999999999999',
            high = '-9999999999999999999999998';
        const unsigned = '18446744073709551615',
            safe = '9007199254740991';
        const interval = { lowerNs: signed, upperNs: high };
        const calibration = {
            beforeUtcMs: Number.MAX_SAFE_INTEGER,
            afterUtcMs: Number.MAX_SAFE_INTEGER,
            uptimeUpperNs: unsigned,
            offset: interval,
        };
        const facts = {
            pre: calibration,
            post: calibration,
            raw: { q: safe, H: safe, bootSeconds: safe },
            requestUtcMs: -Number.MAX_SAFE_INTEGER,
            decisionUtcMs: -Number.MAX_SAFE_INTEGER,
            offset: { status: 'nonempty', ...interval },
            birth: {
                branch: 'multiply-512',
                result: 'present',
                readerUpperNs: unsigned,
                interval: { lowerNs: unsigned, upperNs: unsigned },
            },
            absolute: interval,
            public: { branch: 'accepted', pointMs: '-8640000000000000' },
            selectedMs: -8640000000000000,
        };
        const { selectedMs: _selected, ...candidate } = facts;
        const accepted = {
            model: 'linux-private-interval-v1',
            mode: 'initial',
            decision: 'initial-accepted',
            timeBasis: 'source-stat-read-ended',
            facts,
        };
        const rejected = {
            ...accepted,
            decision: 'interval-rejected',
            facts: { ...candidate, public: { branch: 'point-or-date-range-rejected', pointMs: signed } },
        };
        const calibrationFailed = {
            ...accepted,
            decision: 'post-calibration-threw',
            facts: {
                pre: calibration,
                raw: facts.raw,
                requestUtcMs: facts.requestUtcMs,
                postFailure: { branch: 'bracket-or-text-invalid' },
            },
        };
        const alternatives = [
            { slot: 'creation-first-comparison', status: 'complete', creation: accepted },
            { slot: 'creation-first-comparison', status: 'identity-invalid', creation: rejected },
            { slot: 'creation-first-rejected', status: 'identity-invalid', creation: rejected },
            { slot: 'creation-first-comparison', status: 'identity-invalid', creation: calibrationFailed },
        ];
        const bound = currentCreationWireBound();
        assert.ok(bound.nested <= 3000, 'Every permitted payload is bounded by the closed grammar construction.');
        assert.ok(bound.lineWithNewline <= 4096, 'Every creation receipt envelope is bounded including its newline.');
        const sizes: { decision: string; slot: string; nested: number; lineWithNewline: number }[] = [];
        for (const [index, alternative] of alternatives.entries()) {
            const record = {
                ...firstStartRoute,
                pid: Number.MAX_SAFE_INTEGER,
                rootStartTicks: Number.MAX_SAFE_INTEGER,
                kind: 'linux-first-start-capture',
                atMs: 0.0000012345678901234567,
                ...alternative,
            };
            assert.equal(
                JSON.stringify(record.atMs).length,
                24,
                'The fixture realizes the longest finite-number spelling bound.',
            );
            assert.ok(validateFirstStartCaptureRecord(record));
            const folder = path.join(directory, String(index));
            const parent = createFixtureArtifacts(folder, 'official-server', { firstStartCapture: true });
            const child = createFixtureArtifacts(folder, 'official-server', {
                firstStartCapture: true,
                streamOnly: true,
                collectionId: parent.snapshot().collectionId,
            });
            child.firstStartCapture(record);
            const contents = await readFile(path.join(folder, 'official-server.events.ndjson'), 'utf8');
            const line = contents
                .split('\n')
                .find((line) => line && JSON.parse(line).creation?.model === 'linux-private-interval-v1');
            assert.ok(line, 'The actual writer must admit each complete envelope alternative.');
            const nested = Buffer.byteLength(JSON.stringify(record.creation));
            const lineWithNewline = Buffer.byteLength(`${line}\n`);
            assert.ok(nested <= bound.nested);
            assert.ok(lineWithNewline <= bound.lineWithNewline);
            assert.deepEqual(
                JSON.parse(line),
                record,
                'The written line includes the entire actual envelope; no hidden wrapper is omitted.',
            );
            sizes.push({ decision: record.creation.decision, slot: record.slot, nested, lineWithNewline });
            child.finishStream();
        }
        t.diagnostic(JSON.stringify({ conservativeGrammarBound: bound, measuredWriterAlternatives: sizes }));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
