import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    emitFixtureEvent,
    type FixtureSubscription,
    reserveFixtureCreationObservation,
    runFixtureObservation,
    subscribeFixtureDiagnostics,
} from '../src/adapters/fixture-diagnostics.ts';
import { unixSnapshot, validateProcessIdentity } from '../src/adapters/platform-process.ts';
import {
    captureTick,
    createFirstStartHarness,
    drainFirstStart,
    fakeFirstStartIo,
    firstStartRoute,
} from './fixtures/first-start-capture-fake.ts';
import {
    type FirstStartControlProjection,
    projectFirstStartTerminal,
    qualifyFirstStartTerminal,
} from './smoke/first-start-control.ts';
import { createFixtureArtifacts, createSmokeFailures, readFixtureProgress } from './smoke/fixture-artifacts.ts';
import { dispatchFixtureDiagnostic } from './smoke/fixture-preload.ts';

test('actual preload arms only an owned official collection and revokes without dropping Close END', async () => {
    for (const mode of ['armed', 'unarmed', 'entry-recovery', 'research', 'foreign-collection'] as const) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-creation-preload-'));
        try {
            const fixture = mode === 'entry-recovery' ? 'entry-recovery' : 'official-server';
            const parent = createFixtureArtifacts(directory, fixture, { firstStartCapture: mode !== 'unarmed' });
            const collectionId = parent.snapshot().collectionId;
            assert.ok(collectionId);
            const preload = new URL('./smoke/fixture-preload.ts', import.meta.url);
            preload.searchParams.set('directory', directory);
            preload.searchParams.set('fixture', fixture);
            preload.searchParams.set(
                'collectionId',
                mode === 'foreign-collection' ? '66666666-6666-4666-8666-666666666666' : collectionId,
            );
            if (mode !== 'unarmed') preload.searchParams.set('firstStartCapture', '1');
            if (mode === 'research') preload.searchParams.set('readaheadKb', '128');
            const script = `
                Object.defineProperty(process, 'platform', { value: 'linux' });
                const d = await import(${JSON.stringify(new URL('../src/adapters/fixture-diagnostics.ts', import.meta.url).href)});
                await import(${JSON.stringify(preload.href)});
                const route = ${JSON.stringify(firstStartRoute)};
                const enabled = d.fixtureCreationObservationEnabled();
                d.emitFixtureEvent('spawn', 'begin', { ...route, action: 'start', outcome: 'started' });
                d.emitFixtureEvent('spawn', 'decision', { ...route, reason: 'acquired' });
                d.emitFixtureEvent('readiness', 'begin', { ...route, phase: 'waiting-cdp', outcome: 'started' });
                d.runFixtureObservation(route, () => {
                    const frame = d.reserveFixtureCreationObservation(false, undefined, { pid: 123 });
                    if (frame) d.emitFixtureCreationDecision(frame, { ...route, phase: 'process-identity', outcome: 'rejected', creationNewlyLaunched: true, creationToleranceMs: 1000, creationComparisonStatus: 'reached', creationSourceStatus: 'missing', creationUpperNowStatus: 'not-evaluated', creationBranch: 'new-lower-rejected', creationExpectedUtcMs: 1, creationObservedUtcMs: -1001 });
                });
                d.emitFixtureEvent('readiness', 'end', { ...route, phase: 'waiting-cdp', outcome: 'failed' });
                const revoked = !d.fixtureCreationObservationEnabled();
                d.emitFixtureEvent('native-close', 'begin', route);
                d.emitFixtureEvent('native-close', 'end', { ...route, outcome: 'failed' });
                for (let index = 0; index < 15; index++) await new Promise(setImmediate);
                console.log(JSON.stringify({ enabled, revoked }));
            `;
            const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
                encoding: 'utf8',
                timeout: 10000,
            });
            assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
            assert.deepEqual(JSON.parse(result.stdout), { enabled: mode === 'armed', revoked: true });
            const progress = readFixtureProgress(directory, fixture, mode === 'armed');
            assert.equal(
                progress.firstStartCapture.filter((record) => record.creation).length,
                mode === 'armed' ? 1 : 0,
            );
            if (mode === 'armed') {
                assert.equal(progress.invalidEvents, 0);
                assert.ok(progress.firstStartCapture.some((record) => record.slot === 'observer-terminal'));
                const serialized = await readFile(path.join(directory, `${fixture}.events.ndjson`), 'utf8');
                assert.doesNotMatch(serialized, /process-creation-identity/);
                assert.match(serialized, /"stage":"native-close","event":"end"/);
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
});

test('subscribed same-source creation comparison reconstructs once after failed Close with revoked lifecycle still receiving', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-creation-integration-'));
    let subscription: FixtureSubscription | undefined;
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        let legacyCalls = 0;
        const h = createFirstStartHarness({}, (record) => child.firstStartCapture(record), {
            revokeCreationIdentity: () => subscription?.revokeCreationIdentity(),
            creationIdentityStats: () => subscription?.creationIdentityStats(),
        });
        subscription = subscribeFixtureDiagnostics(
            (event) =>
                dispatchFixtureDiagnostic(event, {
                    gateway: (value) => child.gateway(value),
                    firstStart: h,
                    sampler: {
                        observe() {
                            legacyCalls++;
                        },
                    },
                }),
            () => child.rejected(),
            (dispatch) => child.measure(dispatch),
            {
                creationIdentity: { matches: h.matchesCreationOrigin },
            },
        );
        h.begin();
        await runFixtureObservation(firstStartRoute, async () => {
            const evidence = await unixSnapshot(123, 9222, {
                platform: 'linux',
                currentUser: () => 7,
                readlink: async () => '/owned/chrome',
                readText: async (file) =>
                    file === '/proc/stat'
                        ? 'btime 0\n'
                        : `123 (chrome) ${['S', ...Array(18).fill('0'), '201'].join(' ')}`,
                run: async (command) => ({
                    code: 0,
                    stderr: '',
                    stdout:
                        command === 'ps'
                            ? '123 1 7 Thu Oct  8 00:16:40 2026 Chrome\n'
                            : command === 'getconf'
                              ? '100'
                              : '',
                }),
            });
            assert.throws(
                () =>
                    validateProcessIdentity(
                        evidence,
                        {
                            executablePath: '/owned/chrome',
                            startedAtUtc: new Date(4000).toISOString(),
                            targetKind: 'generic-cdp',
                        },
                        { newlyLaunched: true },
                    ),
                /creation time changed/,
            );
            assert.equal(subscription?.creationIdentityStats().comparisons, 1);
            const before = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
            assert.doesNotMatch(before, /process-creation-identity|creation-first-comparison|creationObservedUtcMs/);
            assert.equal(h.paths.length, 0);
            emitFixtureEvent('readiness', 'end', { ...firstStartRoute, phase: 'waiting-cdp', outcome: 'failed' });
            assert.equal(subscription?.creationIdentityStats().revoked, true);
            emitFixtureEvent('native-close', 'begin', firstStartRoute);
            assert.equal(h.records.length, 0);
            emitFixtureEvent('native-close', 'end', { ...firstStartRoute, outcome: 'failed' });
        });
        await drainFirstStart(h);
        child.finishStream();
        const progress = readFixtureProgress(directory, 'official-server', true);
        assert.equal(progress.invalidEvents, 0);
        const creation = progress.firstStartCapture.filter((record) => record.creation);
        assert.equal(creation.length, 1);
        assert.equal(creation[0]?.creation?.creationComputedNumberMs, 2009.9999999999998);
        assert.equal(creation[0]?.creation?.creationObservedUtcMs, 2009);
        assert.equal(creation[0]?.creation?.creationSourceStatus, 'complete');
        assert.equal(BigInt(creation[0]?.creation?.creationObservedUtcMs ?? 0) * 100n - 201000n, -100n);
        assert.deepEqual(
            progress.firstStartCapture.find((record) => record.slot === 'limitations')?.creationObservation,
            {
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
        );
        assert.ok(legacyCalls > 0);
        const serialized = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.equal(serialized.split('\n').filter((line) => line.includes('creationObservedUtcMs')).length, 1);
        assert.doesNotMatch(serialized, /process-creation-identity|\/owned\/chrome/);
        assert.ok(progress.collectorCost && progress.collectorCost.callbacks > 0);
    } finally {
        subscription?.();
        await rm(directory, { recursive: true, force: true });
    }
});

test('producer cap and diagnostic disable survive normal revoke in collector limitation receipts', async () => {
    for (const disabled of [false, true]) {
        let subscription: FixtureSubscription | undefined;
        const h = createFirstStartHarness({}, undefined, {
            revokeCreationIdentity: () => subscription?.revokeCreationIdentity(),
            creationIdentityStats: () => subscription?.creationIdentityStats(),
        });
        subscription = subscribeFixtureDiagnostics((event) => h.observe(event), undefined, undefined, {
            creationIdentity: {
                matches(origin) {
                    if (disabled) throw Error('diagnostic');
                    return h.matchesCreationOrigin(origin);
                },
            },
        });
        try {
            h.begin();
            runFixtureObservation(firstStartRoute, () => {
                for (let index = 0; index < 129; index++)
                    reserveFixtureCreationObservation(true, undefined, { pid: 123 });
                emitFixtureEvent('readiness', 'end', { ...firstStartRoute, phase: 'waiting-cdp', outcome: 'failed' });
                emitFixtureEvent('native-close', 'end', { ...firstStartRoute, outcome: 'failed' });
            });
            await drainFirstStart(h);
            const receipt = h.records.find((record) => record.slot === 'limitations')?.creationObservation;
            assert.equal(receipt?.stats, 'available');
            assert.equal(receipt.sourceAttempts, disabled ? 0 : 128);
            assert.equal(receipt.comparisons, 0);
            assert.equal(receipt.tokens, disabled ? 0 : 128);
            assert.equal(receipt.capped, !disabled);
            assert.equal(receipt.disabled, disabled);
            assert.equal(receipt.revoked, true);
            assert.ok(h.records.some((record) => record.slot === 'observer-terminal'));
        } finally {
            subscription();
        }
    }
});

test('actual observer and shared artifact writer retain failed device evidence only after native Close END', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-integration-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const fake = fakeFirstStartIo();
        let creationRevoked = 0;
        const h = createFirstStartHarness(
            {
                async open(file, flags) {
                    if (file === '/proc/123/cgroup') return new Promise(() => {});
                    return fake.open(file, flags);
                },
            },
            (record) => child.firstStartCapture(record),
            {
                revokeCreationIdentity() {
                    creationRevoked++;
                },
            },
        );
        h.bind();
        await captureTick();
        h.advance(251);
        h.advance(4000);
        await captureTick();
        h.advance(19000);
        await captureTick();
        h.event('readiness', 'decision', { phase: 'rollback-request', readinessExitReason: 'budget-exhausted' });
        h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
        assert.equal(creationRevoked, 1);
        h.event('native-close', 'begin');
        h.finish();
        await captureTick();
        assert.equal(readFixtureProgress(directory, 'official-server', true).firstStartCapture.length, 0);
        const before = h.paths.length;
        h.event('native-close', 'end');
        await drainFirstStart(h);
        const progress = readFixtureProgress(directory, 'official-server', true);
        assert.equal(progress.firstStartCaptureArmed, true);
        assert.equal(progress.invalidEvents, 0);
        assert.ok(
            progress.firstStartCapture.some(
                (record) =>
                    record.slot === 'first-start-outcome' &&
                    record.status === 'failed' &&
                    record.outcomeReason === 'budget-exhausted',
            ),
        );
        assert.ok(
            progress.firstStartCapture.some(
                (record) =>
                    record.slot === 'family' &&
                    record.family === 'device' &&
                    record.phase === 5 &&
                    record.status === 'complete' &&
                    record.metrics?.readsCompleted === 10,
            ),
        );
        assert.ok(
            progress.firstStartCapture.some(
                (record) => record.slot === 'cost' && record.phase === 7 && record.cost?.cgroup?.pending === 1,
            ),
        );
        h.bind();
        h.advance(50000);
        await captureTick();
        assert.equal(h.paths.length, before, 'a later start cannot replace or supplement the first actual start');
        const serialized = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.doesNotMatch(serialized, /\/proc\/|\/sys\/|private name/);
        assert.deepEqual(progress.firstStartCapture, h.records);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('successful selected readiness keeps an intentional discard receipt through parent reconstruction', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-success-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const h = createFirstStartHarness({}, (record) => child.firstStartCapture(record));
        h.bind();
        h.event('process-creation-identity', 'decision', {
            phase: 'process-identity',
            outcome: 'observed',
            creationNewlyLaunched: false,
            creationToleranceMs: 1000,
            creationSourceStatus: 'missing',
            creationComparisonStatus: 'reached',
            creationBranch: 'established-accepted',
            creationExpectedUtcMs: 0,
            creationObservedUtcMs: 0,
            creationUpperNowStatus: 'not-evaluated',
        });
        child.linuxWait({
            kind: 'linux-startup-wait',
            entryId: firstStartRoute.entryId,
            connectionId: firstStartRoute.connectionId,
            sessionId: firstStartRoute.sessionId,
            pid: 123,
            rootStartTicks: 900,
            trigger: 'baseline',
            outcome: 'sampled',
            elapsedMs: 0,
            reads: 1,
            bytes: 10,
            limitations: [],
            process: { readBytes: 20 },
        });
        await captureTick();
        h.advance(4000);
        await captureTick();
        h.event('readiness', 'end', { phase: 'waiting-cdp' });
        await drainFirstStart(h);
        child.finishStream();
        const original = Error('later whole-fixture failure');
        let terminal: FirstStartControlProjection | undefined;
        let finished: unknown;
        const failures = createSmokeFailures(parent, (summary) => {
            finished = summary;
            terminal = projectFirstStartTerminal(summary, {
                expected: {
                    entryId: firstStartRoute.entryId,
                    requestId: firstStartRoute.requestId,
                    collectionId: parent.snapshot().collectionId,
                },
                cleanup: { targetClosed: false, gatewayExited: true, profileDeleted: false },
            });
        });
        failures.primary(original);
        assert.throws(
            () => failures.finish(),
            (error) => error === original,
        );
        assert.deepEqual(
            JSON.parse(await readFile(path.join(directory, 'official-server.summary.json'), 'utf8')),
            finished,
        );
        assert.ok(terminal);
        if (process.platform === 'linux') {
            assert.equal(terminal.valid, true);
            assert.equal(terminal.record.firstOutcome, 'succeeded');
            assert.equal(terminal.record.fixtureOutcome, 'failed');
            assert.deepEqual(terminal.record.cleanup, {
                targetClosed: false,
                gatewayExited: true,
                profileDeleted: false,
            });
        } else {
            assert.equal(terminal.valid, false);
            assert.equal(terminal.record.kind, 'first-start-control-unavailable');
        }
        assert.equal(qualifyFirstStartTerminal(terminal), false);
        const progress = readFixtureProgress(directory, 'official-server', true);
        assert.equal(progress.invalidEvents, 0);
        assert.equal(
            progress.firstStartCapture.some((record) => record.slot === 'family'),
            false,
        );
        const receipt = progress.firstStartCapture.find((record) => record.slot === 'retention-decision');
        assert.equal(receipt?.status, 'discarded');
        assert.ok((receipt?.metrics?.discarded ?? 0) > 0);
        assert.equal(progress.firstStartCapture.filter((record) => record.slot === 'cost').length, 8);
        assert.equal(
            progress.firstStartCapture.some((record) => record.creation),
            false,
        );
        assert.equal(
            progress.firstStartCapture.find((record) => record.slot === 'first-start-outcome')?.status,
            'succeeded',
        );
        assert.equal(progress.linuxStartupWait[0]?.process?.readBytes, 20);
        assert.deepEqual(progress.firstStartCapture, h.records);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
