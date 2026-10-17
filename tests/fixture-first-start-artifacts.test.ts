import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateFixtureEvent } from '../src/adapters/fixture-diagnostics.ts';
import {
    createFixtureArtifacts,
    createSmokeFailures,
    fixtureGatewayEnvironment,
    readFixtureProgress,
} from './smoke/fixture-artifacts.ts';
import { fixtureJobIndex, readFixtureIndex, readFixtureSummary } from './smoke/fixture-ci.ts';
import {
    createArmedFixtureWriter,
    createFixtureStreamQuota,
    firstStartControlSlots,
    validateFirstStartWriterCost,
} from './smoke/fixture-stream-quota.ts';
import { captureMetricKeys, validateFirstStartCaptureRecord } from './smoke/linux-first-start-capture-record.ts';

const capture = { kind: 'linux-first-start-capture', slot: 'selection', status: 'armed', atMs: 0 };
const origin = {
    entryId: '11111111-1111-4111-8111-111111111111',
    operationId: '22222222-2222-4222-8222-222222222222',
    requestId: '33333333-3333-4333-8333-333333333333',
};
const operation = {
    kind: 'gateway',
    ...origin,
    action: 'start',
    stage: 'operation',
    event: 'begin',
    outcome: 'started',
    timestampMs: 0,
    durationMs: 0,
};

test('after-finish presentation sees persisted reconstruction once and cannot replace the original Error', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-finish-presentation-'));
    try {
        const artifacts = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const original = new Error('original acceptance failure');
        const order: string[] = [];
        let callbacks = 0;
        let presented: unknown;
        let persisted: unknown;
        const failures = createSmokeFailures(artifacts, (summary) => {
            callbacks++;
            order.push('presentation');
            presented = summary;
            persisted = JSON.parse(fs.readFileSync(path.join(directory, 'official-server.summary.json'), 'utf8'));
            throw new Error('presentation failure');
        });
        failures.primary(original);
        await failures.cleanup('target-cleanup', async () => {
            order.push('target');
            throw new Error('retained target');
        });
        await failures.cleanup('gateway-close', async () => {
            order.push('gateway');
        });
        await failures.cleanup('profile-cleanup', async () => {
            order.push('profile');
        });
        fs.appendFileSync(path.join(directory, 'official-server.events.ndjson'), `${JSON.stringify(capture)}\n`);
        assert.throws(
            () => failures.finish(),
            (error) => error === original,
        );
        assert.deepEqual(persisted, presented);
        assert.deepEqual(presented, artifacts.snapshot());
        assert.equal(artifacts.snapshot().state, 'failed');
        assert.deepEqual(artifacts.snapshot().firstStartCapture, [capture]);
        assert.throws(
            () => failures.finish(),
            (error) => error === original,
        );
        assert.equal(callbacks, 1);
        assert.deepEqual(order, ['target', 'gateway', 'profile', 'presentation']);
        const successful = createSmokeFailures(createFixtureArtifacts(undefined, 'official-server'), () => {
            throw Error('contained');
        });
        assert.doesNotThrow(() => successful.finish());
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('gateway inheritance removes assessment controls case-insensitively while preserving ordinary environment', () => {
    assert.deepEqual(
        fixtureGatewayEnvironment({
            PATH: 'preserved',
            GITHUB_SHA: 'preserved-source',
            NODE_OPTIONS: 'removed',
            DCT_SMOKE_FAILED_FIRST_START_CAPTURE: '1',
            DCT_SMOKE_FIRST_START_CAPTURE_ADMISSION: 'admitted',
            DCT_ASSESSMENT_ENABLED: 'true',
            DCT_ASSESSMENT_STARTUP_STUDY: 'false',
            DCT_ASSESSMENT_READAHEAD_STUDY: 'false',
            DCT_ASSESSMENT_ROUND_ID: 'removed',
            DCT_ASSESSMENT_SOURCE_SHA: 'removed',
            DCT_ASSESSMENT_SOURCE_TREE: 'removed',
            DCT_ASSESSMENT_COLLECTION_ID: 'removed',
            dct_assessment_metadata_token: 'removed',
        }),
        { PATH: 'preserved', GITHUB_SHA: 'preserved-source' },
    );
});

test('a failed finalization leaves presentation absent and preserves an already recorded original Error', (context) => {
    const artifacts = createFixtureArtifacts(undefined, 'official-server');
    const original = new Error('first smoke Error');
    const finalizationError = new Error('finalization unavailable');
    let callbacks = 0;
    const failures = createSmokeFailures(artifacts, () => {
        callbacks++;
    });
    failures.primary(original);
    // The controller must tolerate a failed collaborator without manufacturing a finished snapshot.
    context.mock.method(artifacts, 'finish', () => {
        throw finalizationError;
    });
    assert.throws(
        () => failures.finish(),
        (error) => error === original,
    );
    assert.equal(callbacks, 0);
    assert.equal(artifacts.snapshot().state, 'running');
    const successful = createSmokeFailures(artifacts, () => {
        callbacks++;
    });
    assert.throws(
        () => successful.finish(),
        (error) => error === finalizationError,
    );
    assert.equal(callbacks, 0);
});

test('four charged parent scans preserve observed capture in saved summary', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-preserved-summary-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const route = {
            ...origin,
            action: 'start',
            stage: 'operation-route',
            event: 'decision',
            outcome: 'started',
            timestampMs: 1,
            durationMs: 0,
            connectionId: '44444444-4444-4444-8444-444444444444',
            sessionId: '55555555-5555-4555-8555-555555555555',
        };
        const ids = { ...origin, connectionId: route.connectionId, sessionId: route.sessionId };
        const receipts = [
            { ...capture, ...ids },
            {
                kind: 'linux-first-start-capture',
                slot: 'root-binding',
                status: 'bound',
                atMs: 2,
                ...ids,
                pid: 27,
                rootStartTicks: 123,
            },
            { kind: 'linux-first-start-capture', slot: 'first-start-outcome', status: 'succeeded', atMs: 3, ...ids },
            {
                kind: 'linux-first-start-capture',
                slot: 'retention-decision',
                status: 'discarded',
                atMs: 4,
                ...ids,
                metrics: { discarded: 27 },
            },
            { kind: 'linux-first-start-capture', slot: 'observer-terminal', status: 'complete', atMs: 5, ...ids },
        ];
        for (const receipt of receipts) assert.ok(validateFirstStartCaptureRecord(receipt));
        const { kind: _kind, ...begin } = operation;
        assert.ok(validateFixtureEvent(begin));
        assert.ok(validateFixtureEvent(route));
        child.gateway(begin);
        child.gateway(route);
        child.firstStartCapture(receipts[0]);
        parent.begin('acceptance');
        child.firstStartCapture(receipts[1]);
        child.firstStartCapture(receipts[2]);
        parent.begin('acceptance');
        child.firstStartCapture(receipts[3]);
        child.rejected();
        parent.begin('acceptance');
        child.firstStartCapture(receipts[4]);
        child.finishStream();
        parent.begin('acceptance');
        assert.equal(parent.snapshot().firstStartCaptureWriter?.attempts, 4);
        const raw = (await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        assert.equal(raw.length, 14);
        assert.deepEqual(
            raw.filter((value) => value.kind === capture.kind),
            receipts,
        );
        assert.deepEqual(
            raw.find((value) => value.kind === 'first-start-writer-cost'),
            {
                kind: 'first-start-writer-cost',
                attempts: 6,
                dataAttempts: 5,
                markerAttempts: 1,
                metadataReserved: 36,
                scannedBytes: 162,
                exhausted: false,
                releaseFailed: false,
                writeFailed: false,
                selfReportWriteUnavailable: true,
            },
        );
        parent.finish(false);
        const saved = JSON.parse(await readFile(path.join(directory, 'official-server.summary.json'), 'utf8'));
        assert.deepEqual(saved.firstStartCapture, receipts);
        assert.equal(saved.events, 14);
        assert.equal(saved.gatewayEvents, 2);
        assert.equal(saved.invalidEvents, 1);
        assert.equal(saved.lastOperationId, '22222222-2222-4222-8222-222222222222');
        assert.deepEqual(saved.firstStartCaptureWriterChild, {
            kind: 'first-start-writer-cost',
            attempts: 6,
            dataAttempts: 5,
            markerAttempts: 1,
            metadataReserved: 36,
            scannedBytes: 162,
            exhausted: false,
            releaseFailed: false,
            writeFailed: false,
            selfReportWriteUnavailable: true,
        });
        assert.equal(saved.diagnosticAbsent, false);
        assert.equal(saved.incomplete, true);
        assert.ok(saved.firstStartCaptureLimitations.includes('writer-scan-budget'));
        for (const reason of ['selection-missing', 'outcome-missing', 'terminal-missing'])
            assert.ok(!saved.firstStartCaptureLimitations.includes(reason));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

function probeSummaryReads(context: TestContext, mutate?: () => void) {
    let bytes = 0;
    let changed = false;
    const originalRead = fs.readSync;
    const originalReadFile = fs.readFileSync;
    const mutation = () => {
        if (!changed && mutate) {
            changed = true;
            mutate();
        }
    };
    const read = context.mock.method(fs, 'readSync', (...args: unknown[]) => {
        mutation();
        const count: number = Reflect.apply(originalRead, fs, args);
        bytes += count;
        return count;
    });
    const readFile = context.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
        mutation();
        const value: unknown = Reflect.apply(originalReadFile, fs, args);
        bytes += typeof value === 'string' ? Buffer.byteLength(value) : Buffer.isBuffer(value) ? value.byteLength : 0;
        return value;
    });
    const open = context.mock.method(fs, 'openSync');
    const close = context.mock.method(fs, 'closeSync');
    syncBuiltinESMExports();
    return {
        bytes: () => bytes,
        opens: () => open.mock.callCount(),
        closes: () => close.mock.callCount(),
        restore() {
            for (const spy of [read, readFile, open, close]) spy.mock.restore();
            syncBuiltinESMExports();
        },
    };
}

test('armed ordinary exhaustion preserves a counted reserved capture and marker', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-artifacts-'));
    try {
        const artifacts = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        for (let index = 0; index < 2001; index++) artifacts.begin('acceptance');
        artifacts.firstStartCapture(capture);
        const lines = (await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'))
            .trim()
            .split('\n');
        assert.equal(lines.filter((line) => JSON.parse(line).kind === 'smoke').length, 1900);
        assert.equal(lines.filter((line) => JSON.parse(line).kind === 'truncated').length, 1);
        assert.equal(lines.filter((line) => JSON.parse(line).kind === capture.kind).length, 1);
        assert.equal(artifacts.snapshot().truncated, true);
        const progress = readFixtureProgress(directory, 'official-server', true);
        assert.equal(progress.firstStartCapture.length, 1);
        assert.equal(progress.firstStartCaptureArmed, true);
        assert.equal(progress.incomplete, true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('static category byte boundaries and exact 32 semantic slots never borrow capacity', () => {
    assert.equal(firstStartControlSlots.length, 32);
    assert.equal(new Set(firstStartControlSlots).size, 32);
    const quota = createFixtureStreamQuota();
    for (let index = 0; index < 156; index++) assert.equal(quota.accept({ kind: 'smoke' }, 4096).accepted, true);
    assert.equal(quota.snapshot().counts.ordinary.bytes, 624 * 1024);
    assert.equal(quota.accept({ kind: 'smoke' }, 1).accepted, false);
    for (let index = 0; index < 64; index++) assert.equal(quota.accept(capture, 4096).accepted, true);
    assert.equal(quota.accept(capture, 1).accepted, false);
    assert.equal(quota.accept(operation, 4096).category, 'control');
    assert.equal(quota.accept(operation, 1).accepted, false);
    const close = { ...operation, stage: 'native-close', action: 'stop' };
    assert.equal(quota.accept(close, 4096).accepted, true);
    assert.equal(quota.accept({ ...close, event: 'end', outcome: 'failed' }, 4096).accepted, true);
    assert.equal(quota.accept({ ...close, entryId: '44444444-4444-4444-8444-444444444444' }, 1).accepted, false);
    assert.equal(quota.accept({ ...close, stage: 'native-snapshot' }, 1).accepted, false);
    for (let index = 0; index < 4; index++)
        assert.equal(quota.accept({ kind: 'limitation', reason: 'write-failed' }, 4096).accepted, true);
    assert.equal(quota.accept({ kind: 'truncated' }, 1).accepted, false);
    assert.ok(quota.snapshot().bytes <= 1024 * 1024);
});

test('interleaved owners preserve quotas and charge capture-induced scans to the parent', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-writer-'));
    const file = path.join(directory, 'stream.ndjson');
    try {
        await writeFile(file, '');
        const parent = createArmedFixtureWriter(file, false);
        const child = createArmedFixtureWriter(file, true);
        assert.equal(child.append(operation), true);
        for (let index = 0; index < 10; index++) {
            assert.equal(child.append(capture), true);
            parent.append({ kind: 'smoke', stage: 'acceptance', event: 'begin' });
        }
        assert.equal(parent.snapshot().attempts, 4);
        assert.equal(parent.snapshot().metadataReserved, 24);
        assert.equal(parent.snapshot().exhausted, true);
        assert.equal(child.snapshot().attempts, 10);
        assert.equal(child.snapshot().metadataReserved, 60);
        assert.ok(parent.snapshot().scannedBytes + child.snapshot().scannedBytes <= 2 * 1024 * 1024);
        assert.equal(
            (await readFile(file, 'utf8'))
                .trim()
                .split('\n')
                .filter((line) => JSON.parse(line).kind === capture.kind).length,
            10,
        );
        assert.equal((await stat(file)).size, child.snapshot().bytes);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('write-failed fallbacks use the same counted marker and attempt budgets', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-writer-'));
    const file = path.join(directory, 'stream.ndjson');
    try {
        await writeFile(file, '');
        const writer = createArmedFixtureWriter(file, true, {
            append() {
                throw new Error('PRIVATE');
            },
        });
        for (let index = 0; index < 80; index++) writer.append(capture);
        const state = writer.snapshot();
        assert.equal(state.attempts, 64);
        assert.equal(state.metadataReserved, 384);
        assert.equal(state.counts.marker.events, 4);
        assert.equal(state.events, 4);
        assert.equal(state.writeFailed, true);
        assert.equal(state.selfReportWriteUnavailable, true);
        const stream = await readFile(file, 'utf8');
        assert.doesNotMatch(stream, /PRIVATE/);
        assert.equal(stream.trim().split('\n').length, 4);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('foreign locks are never removed and unlock failure stops future acquisition', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-writer-'));
    const file = path.join(directory, 'stream.ndjson');
    try {
        await writeFile(file, '');
        await mkdir(`${file}.lock`);
        const contended = createArmedFixtureWriter(file, true);
        assert.equal(contended.append(capture), false);
        assert.equal(contended.snapshot().attempts, 1);
        assert.equal((await stat(`${file}.lock`)).isDirectory(), true);
        await rmdir(`${file}.lock`);
        let releases = 0;
        const failed = createArmedFixtureWriter(file, true, {
            release() {
                releases++;
                throw new Error('PRIVATE');
            },
        });
        assert.equal(failed.append(capture), true);
        assert.equal(failed.snapshot().releaseFailed, true);
        const before = failed.snapshot().attempts;
        assert.equal(failed.append(capture), false);
        assert.equal(failed.snapshot().attempts, before);
        assert.equal(releases, 1);
        assert.equal((await stat(`${file}.lock`)).isDirectory(), true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('selected rollback Close and exit wait reserve first events but exclude snapshots and duplicates', () => {
    const quota = createFixtureStreamQuota();
    quota.accept(operation, 200);
    for (let index = 0; index < 1900; index++) quota.accept({ kind: 'smoke' }, 20);
    const close = { ...operation, stage: 'target-close', phase: 'rollback-request', reason: 'rollback' };
    assert.equal(quota.accept(close, 200).accepted, true);
    assert.equal(quota.accept(close, 200).accepted, false);
    assert.equal(quota.accept({ ...close, event: 'end', outcome: 'failed' }, 200).accepted, true);
    const wait = { ...close, stage: 'target-exit-wait', phase: 'rollback-exit' };
    assert.equal(quota.accept(wait, 200).accepted, true);
    assert.equal(quota.accept({ ...wait, event: 'end', outcome: 'succeeded' }, 200).accepted, true);
    assert.equal(quota.accept({ ...wait, stage: 'native-snapshot' }, 200).accepted, false);
});

test('routing identity does not manufacture a verified root-binding control receipt', () => {
    const quota = createFixtureStreamQuota();
    quota.accept(operation, 200);
    const route = {
        ...operation,
        stage: 'operation-route',
        event: 'decision',
        connectionId: '44444444-4444-4444-8444-444444444444',
        sessionId: '55555555-5555-4555-8555-555555555555',
    };
    assert.equal(quota.accept(route, 200).category, 'ordinary');
    assert.ok(!quota.snapshot().controlSlots.includes('root-binding'));
    assert.equal(
        quota.accept(
            { ...route, stage: 'native-close', event: 'begin', sessionId: '66666666-6666-4666-8666-666666666666' },
            200,
        ).category,
        'ordinary',
    );
});

test('newline belongs to each 4096-byte record allowance', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-writer-'));
    const file = path.join(directory, 'stream.ndjson');
    try {
        await writeFile(file, '');
        const writer = createArmedFixtureWriter(file, true);
        const base = { kind: 'smoke', text: '' };
        const exact = { ...base, text: 'x'.repeat(4096 - Buffer.byteLength(`${JSON.stringify(base)}\n`)) };
        assert.equal(writer.append(exact), true);
        assert.equal(writer.append({ ...exact, text: `${exact.text}x` }), false);
        const lines = (await readFile(file, 'utf8')).trim().split('\n');
        assert.equal(Buffer.byteLength(lines[0] ?? '') + 1, 4096);
        assert.equal(lines.length, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('armed missing receipts stay incomplete even when no child marker survived', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-artifacts-'));
    try {
        const artifacts = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        artifacts.finish(false);
        const summary = artifacts.snapshot();
        assert.equal(summary.firstStartCaptureArmed, true);
        assert.equal(summary.incomplete, true);
        assert.ok(summary.firstStartCaptureLimitations.includes('selection-missing'));
        assert.ok(summary.firstStartCaptureLimitations.includes('outcome-missing'));
        assert.ok(summary.firstStartCaptureLimitations.includes('terminal-missing'));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('zero reconstruction allowance performs no stream access and cannot erase armed missing receipts', () => {
    const progress = readFixtureProgress('/unavailable-controlled-fixture', 'official-server', true, 0);
    assert.equal(progress.writeFailed, false);
    assert.equal(progress.incomplete, true);
    assert.equal(progress.scannedBytes, 0);
    assert.ok(progress.firstStartCaptureLimitations.includes('writer-scan-budget'));
    assert.ok(progress.firstStartCaptureLimitations.includes('selection-missing'));
});

test('armed unavailable collection remains explicit without accepting unretained capture', () => {
    const artifacts = createFixtureArtifacts(undefined, 'official-server', { firstStartCapture: true });
    artifacts.firstStartCapture(capture);
    artifacts.finish(false);
    assert.equal(artifacts.snapshot().firstStartCapture.length, 0);
    assert.equal(artifacts.snapshot().incomplete, true);
    assert.ok(artifacts.snapshot().firstStartCaptureLimitations.includes('collection-unavailable'));
});

test('capture is inert by default and rejects hostile records without leaking text', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-artifacts-'));
    try {
        const artifacts = createFixtureArtifacts(directory, 'official-server');
        artifacts.firstStartCapture(capture);
        artifacts.firstStartCapture({ ...capture, path: 'PRIVATE' });
        assert.equal(await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'), '');
        assert.equal(artifacts.snapshot().firstStartCaptureArmed, false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('preload cost receipt is closed, counted, and honest about its own final write', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-artifacts-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        child.firstStartCapture(capture);
        child.finishStream();
        const progress = readFixtureProgress(directory, 'official-server', true);
        assert.equal(progress.firstStartCaptureWriterChild?.attempts, 1);
        assert.equal(progress.firstStartCaptureWriterChild?.metadataReserved, 6);
        assert.equal(progress.firstStartCaptureWriterChild?.selfReportWriteUnavailable, true);
        const lines = (await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'))
            .trim()
            .split('\n');
        assert.equal(lines.filter((line) => JSON.parse(line).kind === 'first-start-writer-cost').length, 1);
        assert.ok(lines.length <= 2000);
        assert.ok(progress.firstStartCaptureLimitations.includes('self-report-write-unavailable'));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('writer receipt rejects private fields, accessors and contradictory reserved-operation counts', () => {
    const cost = {
        kind: 'first-start-writer-cost',
        attempts: 1,
        dataAttempts: 1,
        markerAttempts: 0,
        metadataReserved: 6,
        scannedBytes: 20,
        exhausted: false,
        releaseFailed: false,
        writeFailed: false,
        selfReportWriteUnavailable: true,
    };
    assert.ok(validateFirstStartWriterCost(cost));
    assert.equal(validateFirstStartWriterCost({ ...cost, private: 'PRIVATE' }), undefined);
    assert.equal(validateFirstStartWriterCost({ ...cost, metadataReserved: 5 }), undefined);
    assert.equal(validateFirstStartWriterCost({ ...cost, scannedBytes: 1024 * 1024 + 1 }), undefined);
    let calls = 0;
    const accessor = { ...cost };
    Object.defineProperty(accessor, 'attempts', {
        enumerable: true,
        get() {
            calls++;
            return 1;
        },
    });
    assert.equal(validateFirstStartWriterCost(accessor), undefined);
    assert.equal(calls, 0);
});

test('parent first failure binds the fresh child gateway tail before constructing its receipt', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-attribution-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        parent.begin('acceptance');
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const { kind: _kind, ...start } = operation;
        child.gateway(start);
        child.gateway({ ...start, stage: 'operation-error', event: 'decision', outcome: 'failed' });
        parent.failure('acceptance', new Error('original failure'), true);
        assert.equal(parent.snapshot().primary?.operationId, origin.operationId);
        assert.equal(parent.snapshot().primary?.runtimeStage, 'operation-error');
        const records = (await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        const failure = records.find((value) => value.kind === 'failure');
        assert.equal(failure.operationId, origin.operationId);
        assert.equal(failure.runtimeStage, 'operation-error');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('exhausted writer rejects repeated ordinary events before any filesystem operation', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-stop-'));
    const file = path.join(directory, 'stream.ndjson');
    const spies = [
        context.mock.method(fs, 'mkdirSync'),
        context.mock.method(fs, 'statSync'),
        context.mock.method(fs, 'rmdirSync'),
    ];
    syncBuiltinESMExports();
    try {
        await writeFile(file, '');
        const parent = createArmedFixtureWriter(file, false);
        const child = createArmedFixtureWriter(file, true);
        for (let index = 0; index < 4; index++) {
            child.append(capture);
            assert.equal(parent.append({ kind: 'smoke', stage: 'acceptance', event: 'begin' }), true);
        }
        child.append(capture);
        const before = spies.map((spy) => spy.mock.callCount());
        const original = await readFile(file, 'utf8');
        for (let index = 0; index < 25; index++)
            assert.equal(parent.append({ kind: 'smoke', stage: 'acceptance', event: 'begin' }), false);
        assert.deepEqual(
            spies.map((spy) => spy.mock.callCount()),
            before,
        );
        assert.equal(await readFile(file, 'utf8'), original);
        assert.equal(parent.snapshot().metadataReserved, 24);
        assert.equal(parent.snapshot().exhausted, true);
    } finally {
        for (const spy of spies) spy.mock.restore();
        syncBuiltinESMExports();
        await rm(directory, { recursive: true, force: true });
    }
});

test('CLI presents a legal capture summary over64KiB while oversized job index remains rejected', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-first-start-large-summary-'));
    try {
        fixtureJobIndex('init', directory);
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const metrics = Object.fromEntries(
            captureMetricKeys.map((key) => [key, key === 'rotational' ? 1 : Number.MAX_SAFE_INTEGER]),
        );
        for (let index = 0; index < 54; index++)
            child.firstStartCapture({
                kind: 'linux-first-start-capture',
                slot: 'family',
                family: 'device',
                phase: index % 6,
                scope: 0,
                status: 'complete',
                atMs: index,
                metrics,
            });
        child.finishStream();
        parent.finish(true);
        const summaryFile = path.join(directory, 'official-server.summary.json');
        assert.ok((await stat(summaryFile)).size > 65536);
        assert.ok((await stat(summaryFile)).size < 1024 * 1024);
        const collectionId = parent.snapshot().collectionId;
        assert.ok(collectionId);
        const size = (await stat(summaryFile)).size;
        for (const authority of [true, { collectionId }]) {
            const probe = probeSummaryReads(context);
            try {
                assert.ok(readFixtureSummary(summaryFile, authority));
                assert.equal(probe.bytes(), size);
                assert.equal(probe.opens(), 1);
                assert.equal(probe.closes(), 1);
            } finally {
                probe.restore();
            }
        }
        const present = () =>
            spawnSync(
                process.execPath,
                [fileURLToPath(new URL('./smoke/fixture-ci.ts', import.meta.url)), 'summary', directory, collectionId],
                { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } },
            );
        const result = present();
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Failed first-start capture: retained=54;/);
        assert.doesNotMatch(result.stdout, /official-server: diagnostic file unavailable/);
        const persisted: unknown = JSON.parse(await readFile(summaryFile, 'utf8'));
        assert.ok(persisted && typeof persisted === 'object' && !Array.isArray(persisted));
        await writeFile(summaryFile, `${JSON.stringify({ ...persisted, private: 'PRIVATE_UNVALIDATED_TEXT' })}\n`);
        const privateProjection = present();
        assert.match(privateProjection.stdout, /Failed first-start capture: retained=54;/);
        assert.doesNotMatch(privateProjection.stdout, /PRIVATE_UNVALIDATED_TEXT/);
        await writeFile(summaryFile, JSON.stringify({ ...parent.snapshot(), firstStartCaptureArmed: false }));
        assert.throws(() => readFixtureSummary(summaryFile), /exceeds its bound/);
        await writeFile(summaryFile, JSON.stringify({ ...parent.snapshot(), padding: 'x'.repeat(1024 * 1024) }));
        assert.throws(() => readFixtureSummary(summaryFile), /exceeds its bound/);
        await writeFile(path.join(directory, 'job-index.json'), JSON.stringify({ padding: 'x'.repeat(65536) }));
        assert.throws(() => readFixtureIndex(path.join(directory, 'job-index.json')), /exceeds its bound/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('unarmed oversized summaries are rejected before any body bytes are read', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-summary-default-bound-'));
    const file = path.join(directory, 'summary.json');
    try {
        await writeFile(
            file,
            JSON.stringify({ fixture: 'official-server', firstStartCaptureArmed: false, padding: 'x'.repeat(70000) }),
        );
        const probe = probeSummaryReads(context);
        try {
            assert.throws(() => readFixtureSummary(file), /bound/);
            assert.equal(probe.bytes(), 0);
        } finally {
            probe.restore();
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('closed header rejection never admits a large read for false, duplicate or foreign collection prefix', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-summary-header-bound-'));
    const file = path.join(directory, 'summary.json');
    const prefix = `{"schemaVersion":1,"fixture":"official-server","collectionId":"${origin.requestId}",`;
    try {
        for (const head of [
            `${prefix}"firstStartCaptureArmed":false,`,
            `${prefix}"firstStartCaptureArmed":false,"firstStartCaptureArmed":true,`,
            `${prefix.replace(origin.requestId, origin.operationId)}"firstStartCaptureArmed":true,`,
        ]) {
            await writeFile(file, `${head}"padding":"${'x'.repeat(70000)}"}\n`);
            const probe = probeSummaryReads(context);
            try {
                assert.throws(() => readFixtureSummary(file, { collectionId: origin.requestId }));
                assert.ok(probe.bytes() <= 256);
                assert.equal(probe.opens(), 1);
                assert.equal(probe.closes(), 1);
            } finally {
                probe.restore();
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('later contradictory and duplicate keys are invalid claimed-armed evidence within1MiB', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-summary-claimed-arm-'));
    const file = path.join(directory, 'summary.json');
    try {
        for (const flag of [false, true]) {
            await writeFile(
                file,
                `{"schemaVersion":1,"fixture":"official-server","collectionId":"${origin.requestId}","firstStartCaptureArmed":true,"padding":"${'x'.repeat(70000)}","firstStartCaptureArmed":${flag}}\n`,
            );
            const probe = probeSummaryReads(context);
            try {
                assert.throws(
                    () => readFixtureSummary(file, { collectionId: origin.requestId }),
                    /Invalid claimed-armed/,
                );
                assert.ok(probe.bytes() <= 1024 * 1024);
                assert.equal(probe.opens(), 1);
                assert.equal(probe.closes(), 1);
            } finally {
                probe.restore();
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('growth after summary metadata cannot cause reads outside the selected authority cap', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-summary-growth-'));
    const file = path.join(directory, 'summary.json');
    try {
        for (const armed of [false, true]) {
            await writeFile(
                file,
                JSON.stringify({
                    schemaVersion: 1,
                    fixture: 'official-server',
                    collectionId: origin.requestId,
                    firstStartCaptureArmed: armed,
                    padding: 'x'.repeat(armed ? 70000 : 1000),
                }),
            );
            const probe = probeSummaryReads(context, () => fs.appendFileSync(file, 'x'.repeat(2 * 1024 * 1024)));
            try {
                assert.throws(() => readFixtureSummary(file, armed));
                assert.ok(probe.bytes() <= (armed ? 1024 * 1024 : 65536));
                assert.equal(probe.opens(), 1);
                assert.equal(probe.closes(), 1);
            } finally {
                probe.restore();
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('observed same-size summary edits are rejected by the final handle metadata check', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-summary-edit-'));
    const file = path.join(directory, 'summary.json');
    try {
        const content = JSON.stringify({
            fixture: 'official-server',
            firstStartCaptureArmed: false,
            padding: 'x'.repeat(1000),
        });
        await writeFile(file, content);
        const probe = probeSummaryReads(context, () => {
            fs.writeFileSync(file, content.replace('xxx', 'yyy'));
            const future = new Date(Date.now() + 2000);
            fs.utimesSync(file, future, future);
        });
        try {
            assert.throws(() => readFixtureSummary(file), /changed/);
            assert.ok(probe.bytes() <= 65536);
            assert.equal(probe.opens(), 1);
            assert.equal(probe.closes(), 1);
        } finally {
            probe.restore();
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

function probeStreamIo(context: TestContext, seam?: (operation: string, args: unknown[]) => void) {
    const metadata: string[] = [];
    let inSeam = false;
    function runSeam(operation: string, args: unknown[]) {
        inSeam = true;
        try {
            seam?.(operation, args);
        } finally {
            inSeam = false;
        }
    }
    const reads: { offset: number; requested: number; returned: number }[] = [];
    const names = ['mkdirSync', 'statSync', 'openSync', 'fstatSync', 'closeSync', 'rmdirSync'] as const;
    const spies = names.map((name) => {
        const original = fs[name];
        return context.mock.method(fs, name, (...args: unknown[]) => {
            if (inSeam) return Reflect.apply(original, fs, args);
            metadata.push(name);
            runSeam(name, args);
            return Reflect.apply(original, fs, args);
        });
    });
    const originalRead = fs.readSync;
    const read = context.mock.method(fs, 'readSync', (...args: unknown[]) => {
        runSeam('readSync', args);
        const returned: number = Reflect.apply(originalRead, fs, args);
        reads.push({ offset: Number(args[4]), requested: Number(args[3]), returned });
        return returned;
    });
    syncBuiltinESMExports();
    return {
        metadata,
        reads,
        restore() {
            for (const spy of [...spies, read]) spy.mock.restore();
            syncBuiltinESMExports();
        },
    };
}
const outcomeReceipt = { ...capture, slot: 'first-start-outcome', status: 'succeeded', atMs: 2, ...origin };
const terminalReceipt = { ...capture, slot: 'observer-terminal', status: 'complete', atMs: 3, ...origin };
function sizedOrdinary(bytes: number) {
    const lines: string[] = [];
    while (bytes > 0) {
        const length = Math.min(4096, bytes);
        assert.ok(length >= 28);
        const line = `${JSON.stringify({ kind: 'smoke', text: 'x'.repeat(length - 27) })}\n`;
        assert.equal(Buffer.byteLength(line), length);
        lines.push(line);
        bytes -= length;
    }
    return lines.join('');
}

test('refused final scan preserves only known prefix and performs zero stream I/O', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-known-prefix-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const { kind: _kind, ...begin } = operation;
        child.gateway(begin);
        for (let index = 0; index < 4; index++) {
            child.firstStartCapture(
                index === 1
                    ? { ...capture, slot: 'root-binding', status: 'bound', pid: 27, rootStartTicks: 123 }
                    : capture,
            );
            parent.begin('acceptance');
        }
        child.firstStartCapture(outcomeReceipt);
        child.firstStartCapture(terminalReceipt);
        const probe = probeStreamIo(context);
        try {
            parent.finish(false);
            assert.deepEqual(probe.metadata, []);
            assert.deepEqual(probe.reads, []);
        } finally {
            probe.restore();
        }
        const saved = JSON.parse(await readFile(path.join(directory, 'official-server.summary.json'), 'utf8'));
        assert.equal(saved.events, 9);
        assert.equal(saved.gatewayEvents, 1);
        assert.equal(saved.firstStartCapture.length, 4);
        assert.deepEqual(
            saved.firstStartCapture.map((value: { slot: string }) => value.slot),
            ['selection', 'root-binding', 'selection', 'selection'],
        );
        assert.equal(saved.diagnosticAbsent, false);
        assert.ok(saved.firstStartCaptureLimitations.includes('outcome-missing'));
        assert.ok(saved.firstStartCaptureLimitations.includes('terminal-missing'));
        assert.equal(saved.firstStartCaptureWriter.metadataReserved, 24);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('final acquisition reads only a small suffix after a large paid prefix with six metadata operations', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-suffix-'));
    const file = path.join(directory, 'official-server.events.ndjson');
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        fs.appendFileSync(file, `${sizedOrdinary(600 * 1024) + JSON.stringify(capture)}\n`);
        parent.begin('acceptance');
        const prefixSize = fs.statSync(file).size;
        const suffix = `${JSON.stringify(outcomeReceipt)}\n${JSON.stringify(terminalReceipt)}\n`;
        fs.appendFileSync(file, suffix);
        assert.ok(prefixSize > 1024 * 1024 - (parent.snapshot().firstStartCaptureWriter?.scannedBytes ?? 0));
        const probe = probeStreamIo(context);
        try {
            parent.finish(false);
            assert.deepEqual(probe.metadata, [
                'mkdirSync',
                'statSync',
                'openSync',
                'fstatSync',
                'closeSync',
                'rmdirSync',
            ]);
            assert.deepEqual(probe.reads, [
                { offset: prefixSize, requested: Buffer.byteLength(suffix), returned: Buffer.byteLength(suffix) },
            ]);
        } finally {
            probe.restore();
        }
        assert.deepEqual(
            parent.snapshot().firstStartCapture.map((value) => value.slot),
            ['selection', 'first-start-outcome', 'observer-terminal'],
        );
        assert.equal(parent.snapshot().events, 154);
        assert.equal(parent.snapshot().firstStartCaptureWriter?.attempts, 2);
        assert.ok((parent.snapshot().firstStartCaptureWriter?.scannedBytes ?? Infinity) < 1024 * 1024);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('final scan exact allowance reads once while one byte over and zero allowance leave suffix unread', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-exact-suffix-'));
    try {
        for (const extra of [0, 1, -1]) {
            const file = path.join(directory, `stream-${extra}.ndjson`);
            fs.writeFileSync(file, sizedOrdinary(400 * 1024));
            const seen: unknown[] = [];
            const writer = createArmedFixtureWriter(file, false, { admitted: (value) => seen.push(value) });
            assert.equal(writer.append(capture), true);
            assert.ok(writer.reserveReconstruction());
            // Exercise the existing paid reconstruction accounting with actual returned bytes.
            const remaining = 1024 * 1024 - writer.snapshot().scannedBytes;
            const charged = extra === -1 ? remaining : fs.statSync(file).size;
            const descriptor = fs.openSync(file, 'r');
            let acquired = 0;
            try {
                while (acquired < charged) {
                    const buffer = Buffer.alloc(Math.min(charged - acquired, fs.statSync(file).size));
                    acquired += fs.readSync(descriptor, buffer, 0, buffer.length, 0);
                }
            } finally {
                fs.closeSync(descriptor);
            }
            writer.settleReconstruction(acquired);
            const start = fs.statSync(file).size;
            const allowance = 1024 * 1024 - writer.snapshot().scannedBytes;
            const suffix = extra === -1 ? `${JSON.stringify(outcomeReceipt)}\n` : sizedOrdinary(allowance + extra);
            fs.appendFileSync(file, suffix);
            const probe = probeStreamIo(context);
            try {
                const result = writer.finishObservation();
                assert.equal(result.acquired, extra === 0);
                assert.equal(result.scanBudget, extra !== 0);
                assert.deepEqual(
                    probe.metadata,
                    extra === 0
                        ? ['mkdirSync', 'statSync', 'openSync', 'fstatSync', 'closeSync', 'rmdirSync']
                        : ['mkdirSync', 'statSync', 'rmdirSync'],
                );
                assert.deepEqual(
                    probe.reads,
                    extra === 0 ? [{ offset: start, requested: allowance, returned: allowance }] : [],
                );
                assert.equal(
                    writer.snapshot().scannedBytes,
                    extra === 0 || extra === -1 ? 1024 * 1024 : acquired + 400 * 1024,
                );
                assert.equal(writer.snapshot().attempts, 3);
                assert.equal(writer.snapshot().metadataReserved, 18);
                assert.equal(seen.length, extra === 0 ? 157 : 101);
            } finally {
                probe.restore();
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('failed and throwing short own writes exclude optimistic evidence but keep independent failures', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-own-write-'));
    try {
        for (const short of [false, true]) {
            const target = path.join(directory, String(short));
            const parent = createFixtureArtifacts(target, 'official-server', {
                firstStartCapture: true,
                append: (file, line) => {
                    if (short) fs.appendFileSync(file, line.slice(0, 9));
                    throw new Error('controlled append failure');
                },
            });
            parent.firstStartCapture(capture);
            const { kind: _kind, ...begin } = operation;
            parent.gateway(begin);
            parent.failure('acceptance', new Error('primary'), true);
            parent.failure('gateway-close', new Error('secondary'), false);
            parent.finish(true);
            const saved = parent.snapshot();
            assert.deepEqual(saved.firstStartCapture, []);
            assert.equal(saved.gatewayEvents, 0);
            assert.equal(saved.lastOperationId, null);
            assert.equal(saved.primary?.operationId, null);
            assert.equal(saved.secondary.length, 1);
            assert.equal(saved.writeFailed, true);
            assert.equal(saved.incomplete, true);
            assert.ok((saved.firstStartCaptureWriter?.attempts ?? Infinity) <= 4);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('successful own append survives failed unlock and observer exceptions cannot change admission', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-observer-errors-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const original = fs.rmdirSync;
        const release = context.mock.method(fs, 'rmdirSync', () => {
            throw new Error('unlock');
        });
        syncBuiltinESMExports();
        try {
            parent.firstStartCapture(capture);
        } finally {
            release.mock.restore();
            syncBuiltinESMExports();
        }
        parent.finish(true);
        assert.equal(parent.snapshot().firstStartCapture.length, 1);
        assert.equal(parent.snapshot().events, 1);
        assert.equal(parent.snapshot().writeFailed, true);
        original(path.join(directory, 'official-server.events.ndjson.lock'));
        const file = path.join(directory, 'observer.ndjson');
        fs.writeFileSync(file, '');
        let limited = 0;
        const writer = createArmedFixtureWriter(file, false, {
            admitted: () => {
                throw new Error('observer');
            },
            limited: () => {
                limited++;
                throw new Error('limitation observer');
            },
        });
        assert.equal(writer.append(capture), true);
        assert.equal(writer.snapshot().events, 1);
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).slot, 'selection');
        const result = writer.finishObservation();
        assert.equal(result.incomplete, true);
        assert.equal(result.discontinuity, true);
        assert.equal(limited, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('partial foreign scan fallback never reduces certified ranges twice or repairs quota', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-partial-fallback-'));
    const file = path.join(directory, 'stream.ndjson');
    try {
        const first = `${JSON.stringify(capture)}\n`;
        fs.writeFileSync(file, `${first}{bad}\n`);
        const observed: { start: number; end: number; value: unknown }[] = [];
        const writer = createArmedFixtureWriter(file, false, {
            admitted: (value, start, end) => observed.push({ start, end, value }),
        });
        assert.equal(writer.append({ kind: 'smoke' }), false);
        assert.deepEqual(observed, [{ start: 0, end: Buffer.byteLength(first), value: capture }]);
        assert.equal(writer.snapshot().attempts, 2);
        assert.equal(writer.snapshot().events, 2);
        assert.equal(writer.snapshot().markerAttempts, 1);
        assert.equal(writer.snapshot().scannedBytes, fs.statSync(file).size * 2);
        assert.equal(writer.finishObservation().discontinuity, true);
        assert.equal(observed.length, 1);
        assert.equal(writer.snapshot().events, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('unsafe suffixes never manufacture terminal receipts or lose known prefix', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-unsafe-suffix-'));
    try {
        for (const [name, suffix] of [
            ['json', `{bad}\n${JSON.stringify(terminalReceipt)}\n`],
            ['newline', JSON.stringify(terminalReceipt)],
            ['utf8', Buffer.from([0xff, 10])],
            [
                'oversized',
                JSON.stringify({ kind: 'smoke', text: 'x'.repeat(4096) }) +
                    '\n' +
                    JSON.stringify(terminalReceipt) +
                    '\n',
            ],
            ['quota', `${`${JSON.stringify(capture)}\n`.repeat(64) + JSON.stringify(terminalReceipt)}\n`],
        ] as const) {
            const target = path.join(directory, name);
            const parent = createFixtureArtifacts(target, 'official-server', { firstStartCapture: true });
            parent.firstStartCapture(capture);
            fs.appendFileSync(path.join(target, 'official-server.events.ndjson'), suffix);
            parent.finish(false);
            const saved = parent.snapshot();
            assert.ok(saved.firstStartCapture.length >= 1);
            assert.ok(saved.firstStartCapture.length <= 64);
            assert.ok(!saved.firstStartCapture.some((value) => value.slot === 'observer-terminal'));
            assert.equal(saved.incomplete, true);
            assert.ok(saved.firstStartCaptureLimitations.includes('terminal-missing'));
            assert.ok((saved.firstStartCaptureWriter?.scannedBytes ?? Infinity) <= 1024 * 1024);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('final read failures charge returned bytes and always close and unlock without retry', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-final-read-'));
    try {
        for (const failure of ['throw', 'eof']) {
            const file = path.join(directory, `${failure}.ndjson`);
            fs.writeFileSync(file, '');
            const observed: unknown[] = [];
            const writer = createArmedFixtureWriter(file, false, { admitted: (value) => observed.push(value) });
            writer.append(capture);
            fs.appendFileSync(file, `${JSON.stringify(terminalReceipt)}\n`);
            let calls = 0;
            const probe = probeStreamIo(context, (operation, args) => {
                if (operation !== 'readSync') return;
                calls++;
                if (calls === 2 && failure === 'throw') throw new Error('read failed');
                args[3] = calls === 1 ? 7 : 0;
            });
            try {
                const result = writer.finishObservation();
                assert.equal(result.writeFailed, true);
                assert.equal(result.acquired, false);
                assert.equal(writer.snapshot().scannedBytes, 7);
                assert.deepEqual(observed, [capture]);
                assert.deepEqual(probe.metadata, ['mkdirSync', 'statSync', 'openSync', 'closeSync', 'rmdirSync']);
                assert.equal(calls, 2);
            } finally {
                probe.restore();
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('observable final discontinuities reject suffix before merging with retained facts', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-discontinuity-'));
    try {
        for (const mode of [
            'truncate-before',
            'replace-before',
            'replace-open',
            'truncate-read',
            'change-read',
            'append-read',
        ]) {
            const file = path.join(directory, `${mode}.ndjson`);
            fs.writeFileSync(file, '');
            const observed: unknown[] = [];
            const writer = createArmedFixtureWriter(file, false, { admitted: (value) => observed.push(value) });
            writer.append(capture);
            fs.appendFileSync(file, `${JSON.stringify(terminalReceipt)}\n`);
            const replace = () => {
                fs.renameSync(file, `${file}.prior`);
                fs.writeFileSync(file, `${JSON.stringify(outcomeReceipt)}\n`);
            };
            if (mode === 'truncate-before') fs.truncateSync(file, 0);
            if (mode === 'replace-before') replace();
            let changed = false;
            const probe = probeStreamIo(context, (operation) => {
                if (changed) return;
                if (mode === 'replace-open' && operation === 'openSync') {
                    changed = true;
                    replace();
                }
                if (operation !== 'readSync') return;
                if (mode === 'truncate-read') {
                    changed = true;
                    fs.truncateSync(file, 0);
                }
                if (mode === 'change-read') {
                    changed = true;
                    const future = new Date(Date.now() + 2000);
                    fs.utimesSync(file, future, future);
                }
                if (mode === 'append-read') {
                    changed = true;
                    fs.appendFileSync(file, `${JSON.stringify(outcomeReceipt)}\n`);
                }
            });
            try {
                const result = writer.finishObservation();
                assert.equal(result.acquired, false, mode);
                assert.equal(result.incomplete, true, mode);
                assert.equal(result.discontinuity || result.writeFailed, true, mode);
                assert.deepEqual(observed, [capture], mode);
                assert.ok(probe.metadata.length <= 6, mode);
                assert.equal(probe.metadata.at(-1), 'rmdirSync');
                assert.equal(writer.snapshot().attempts, 2);
            } finally {
                probe.restore();
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('unchanged opened handle cannot authenticate an after-open pathname rebind', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-unobservable-rebind-'));
    const file = path.join(directory, 'stream.ndjson');
    try {
        fs.writeFileSync(file, '');
        const observed: unknown[] = [];
        const writer = createArmedFixtureWriter(file, false, { admitted: (value) => observed.push(value) });
        writer.append(capture);
        fs.appendFileSync(file, `${JSON.stringify(terminalReceipt)}\n`);
        let rebound = false;
        const probe = probeStreamIo(context, (operation) => {
            if (operation === 'readSync' && !rebound) {
                rebound = true;
                fs.renameSync(file, `${file}.opened`);
                fs.writeFileSync(file, `${JSON.stringify(outcomeReceipt)}\n`);
            }
        });
        try {
            // Windows may report a ctime change on rename. Where metadata agrees,
            // only the opened stream is observed; no replacement-path claim follows.
            const result = writer.finishObservation();
            if (result.acquired) assert.deepEqual(observed, [capture, terminalReceipt]);
            else {
                assert.equal(result.discontinuity, true);
                assert.deepEqual(observed, [capture]);
            }
            assert.equal(probe.metadata.length, 6);
            assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).slot, 'first-start-outcome');
        } finally {
            probe.restore();
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('foreign final lock is untouched and later cooperative appends remain outside one final snapshot', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-final-lock-'));
    const file = path.join(directory, 'stream.ndjson');
    try {
        fs.writeFileSync(file, '');
        const observed: unknown[] = [];
        const writer = createArmedFixtureWriter(file, false, { admitted: (value) => observed.push(value) });
        writer.append(capture);
        fs.mkdirSync(`${file}.lock`);
        const probe = probeStreamIo(context);
        try {
            assert.equal(writer.finishObservation().writeFailed, true);
            assert.deepEqual(probe.metadata, ['mkdirSync']);
            assert.deepEqual(probe.reads, []);
        } finally {
            probe.restore();
        }
        assert.equal(fs.existsSync(`${file}.lock`), true);
        fs.rmdirSync(`${file}.lock`);
        const second = createArmedFixtureWriter(file, false, { admitted: (value) => observed.push(value) });
        second.append({ kind: 'smoke' });
        const finalProbe = probeStreamIo(context);
        try {
            assert.equal(second.finishObservation().acquired, true);
            assert.equal(finalProbe.metadata.length, 6);
            assert.deepEqual(finalProbe.reads, []);
        } finally {
            finalProbe.restore();
        }
        fs.appendFileSync(file, `${JSON.stringify(terminalReceipt)}\n`);
        assert.ok(
            !observed.some(
                (value) => value && typeof value === 'object' && 'slot' in value && value.slot === 'observer-terminal',
            ),
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('independent route mutations and foreign terminal preserve literal evidence without creating binding', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-association-'));
    try {
        for (const field of ['entryId', 'operationId', 'requestId', 'connectionId', 'sessionId'] as const) {
            const target = path.join(directory, field);
            const parent = createFixtureArtifacts(target, 'official-server', { firstStartCapture: true });
            const child = createFixtureArtifacts(target, 'official-server', {
                firstStartCapture: true,
                streamOnly: true,
                collectionId: parent.snapshot().collectionId,
            });
            const { kind: _kind, ...begin } = operation;
            const route = {
                ...begin,
                stage: 'operation-route',
                event: 'decision',
                connectionId: '44444444-4444-4444-8444-444444444444',
                sessionId: '55555555-5555-4555-8555-555555555555',
            };
            child.gateway(begin);
            child.gateway(route);
            const mutated = {
                ...route,
                stage: 'native-close',
                event: 'begin',
                [field]: '66666666-6666-4666-8666-666666666666',
            };
            assert.ok(validateFixtureEvent(mutated));
            child.gateway(mutated);
            child.firstStartCapture({ ...capture, ...origin });
            child.firstStartCapture({ ...terminalReceipt, operationId: '66666666-6666-4666-8666-666666666666' });
            parent.finish(false);
            const saved = parent.snapshot();
            assert.equal(saved.gatewayEvents, 3);
            assert.equal(saved.firstStartCapture.length, 2);
            assert.equal(saved.firstStartCapture[1]?.operationId, '66666666-6666-4666-8666-666666666666');
            assert.ok(saved.firstStartCaptureLimitations.includes('outcome-missing'));
            assert.ok(!saved.firstStartCaptureWriter?.controlSlots.includes('root-binding'));
            assert.ok(!saved.firstStartCaptureWriter?.controlSlots.includes('native-close-begin'));
            assert.ok(!saved.firstStartCapture.some((value) => value.slot === 'root-binding'));
            assert.equal(saved.incomplete, true);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('duplicate captures and markers retain order while terminal never clears truncation', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-capture-order-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const file = path.join(directory, 'official-server.events.ndjson');
        fs.appendFileSync(
            file,
            [capture, { kind: 'truncated' }, outcomeReceipt, capture, terminalReceipt, { kind: 'truncated' }]
                .map((value) => `${JSON.stringify(value)}\n`)
                .join(''),
        );
        parent.finish(false);
        assert.deepEqual(
            parent.snapshot().firstStartCapture.map((value) => value.slot),
            ['selection', 'first-start-outcome', 'selection', 'observer-terminal'],
        );
        assert.equal(parent.snapshot().events, 6);
        assert.equal(parent.snapshot().firstStartCaptureWriter?.counts.marker.events, 2);
        assert.equal(parent.snapshot().firstStartCaptureWriter?.counts.capture.events, 4);
        assert.equal(parent.snapshot().truncated, true);
        assert.equal(parent.snapshot().incomplete, true);
        assert.ok(Buffer.byteLength(JSON.stringify(parent.snapshot())) < 1024 * 1024);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('collection mismatch cannot create an admitted projection and failed refresh never uses cached attribution', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-collection-projection-'));
    try {
        fixtureJobIndex('init', directory);
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const before = fs.readFileSync(path.join(directory, 'official-server.summary.json'), 'utf8');
        const foreign = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: origin.requestId,
        });
        foreign.firstStartCapture(capture);
        assert.equal(foreign.snapshot().collectionRejected, true);
        assert.deepEqual(foreign.snapshot().firstStartCapture, []);
        assert.equal(fs.readFileSync(path.join(directory, 'official-server.summary.json'), 'utf8'), before);
        const { kind: _kind, ...begin } = operation;
        parent.gateway(begin);
        assert.equal(parent.snapshot().gatewayEvents, 1);
        fs.mkdirSync(path.join(directory, 'official-server.events.ndjson.lock'));
        parent.failure('acceptance', new Error('primary'), true);
        assert.equal(parent.snapshot().primary?.operationId, null);
        assert.equal(parent.snapshot().primary?.runtimeStage, null);
        fs.rmdirSync(path.join(directory, 'official-server.events.ndjson.lock'));
        parent.finish(true);
        assert.equal(parent.snapshot().gatewayEvents, 1);
        assert.equal(parent.snapshot().diagnosticAbsent, false);
        assert.deepEqual(fs.readdirSync(directory).sort(), [
            'entry-recovery.events.ndjson',
            'entry-recovery.summary.json',
            'job-index.json',
            'official-server.events.ndjson',
            'official-server.summary.json',
        ]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('rejected own records cannot survive as optimistic capture or gateway summary fields', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-own-rejection-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        for (let index = 0; index < 4; index++) parent.firstStartCapture(capture);
        const { kind: _kind, ...begin } = operation;
        parent.gateway(begin);
        parent.firstStartCapture(outcomeReceipt);
        parent.finish(false);
        const saved = parent.snapshot();
        assert.equal(saved.events, 4);
        assert.equal(saved.gatewayEvents, 0);
        assert.equal(saved.lastOperationId, null);
        assert.deepEqual(
            saved.firstStartCapture.map((value) => value.slot),
            ['selection', 'selection', 'selection', 'selection'],
        );
        assert.equal(saved.firstStartCaptureWriter?.dataAttempts, 4);
        assert.equal(saved.firstStartCaptureWriter?.attempts, 4);
        assert.equal(saved.droppedEvents, 2);
        assert.equal(saved.truncated, true);
        assert.ok(saved.firstStartCaptureLimitations.includes('outcome-missing'));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('invalid UTF8 during append limits observation while preserving original writer admission', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-utf8-admission-'));
    const file = path.join(directory, 'stream.ndjson');
    try {
        fs.writeFileSync(
            file,
            Buffer.concat([Buffer.from('{"kind":"smoke","text":"'), Buffer.from([0xff]), Buffer.from('"}\n')]),
        );
        const observed: unknown[] = [];
        const writer = createArmedFixtureWriter(file, false, { admitted: (value) => observed.push(value) });
        assert.equal(writer.append(capture), true);
        assert.equal(writer.snapshot().events, 2);
        assert.deepEqual(observed, []);
        assert.equal(writer.snapshot().attempts, 1);
        assert.equal(writer.finishObservation().incomplete, true);
        assert.equal(writer.snapshot().events, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('final handle failure and final unlock failure retain truth and consume no retry', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-final-metadata-failure-'));
    try {
        for (const failure of ['handle', 'unlock']) {
            const file = path.join(directory, `${failure}.ndjson`);
            fs.writeFileSync(file, '');
            const observed: unknown[] = [];
            let ending = false;
            const writer = createArmedFixtureWriter(file, false, {
                admitted: (value) => observed.push(value),
                release: (lock) => {
                    fs.rmdirSync(lock);
                    if (ending && failure === 'unlock') throw new Error('unlock failed');
                },
            });
            writer.append(capture);
            fs.appendFileSync(file, `${JSON.stringify(terminalReceipt)}\n`);
            ending = true;
            const probe = probeStreamIo(context, (operation) => {
                if (failure === 'handle' && operation === 'fstatSync') throw new Error('handle failed');
            });
            try {
                const result = writer.finishObservation();
                assert.equal(result.writeFailed, true);
                assert.equal(result.incomplete, true);
                assert.equal(result.acquired, failure === 'unlock');
                assert.deepEqual(observed, failure === 'unlock' ? [capture, terminalReceipt] : [capture]);
                assert.deepEqual(probe.metadata, [
                    'mkdirSync',
                    'statSync',
                    'openSync',
                    'fstatSync',
                    'closeSync',
                    'rmdirSync',
                ]);
                assert.equal(writer.snapshot().attempts, 2);
                assert.equal(writer.snapshot().releaseFailed, failure === 'unlock');
            } finally {
                probe.restore();
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('independent root identity values stay literal and route never supplies a root receipt', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-root-literals-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', { firstStartCapture: true });
        const child = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const roots = [
            { ...capture, slot: 'root-binding', status: 'bound', ...origin, pid: 27, rootStartTicks: 123 },
            { ...capture, slot: 'root-binding', status: 'bound', ...origin, pid: 28, rootStartTicks: 123 },
            { ...capture, slot: 'root-binding', status: 'bound', ...origin, pid: 27, rootStartTicks: 124 },
        ];
        for (const root of roots) {
            assert.ok(validateFirstStartCaptureRecord(root));
            child.firstStartCapture(root);
        }
        parent.finish(false);
        assert.deepEqual(parent.snapshot().firstStartCapture, roots);
        assert.equal(parent.snapshot().firstStartCaptureWriter?.counts.capture.events, 3);
        assert.ok(!parent.snapshot().firstStartCaptureWriter?.controlSlots.includes('root-binding'));
        assert.ok(parent.snapshot().firstStartCaptureLimitations.includes('outcome-missing'));
        assert.ok(parent.snapshot().firstStartCaptureLimitations.includes('terminal-missing'));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('independently scanned complete bytes after thrown own append can be retained once', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-independent-fallback-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server', {
            firstStartCapture: true,
            append: (file, line) => {
                fs.appendFileSync(file, line);
                throw new Error('after full write');
            },
        });
        parent.firstStartCapture(capture);
        assert.equal(parent.snapshot().events, 2);
        assert.deepEqual(parent.snapshot().firstStartCapture, [capture]);
        assert.equal(parent.snapshot().firstStartCaptureWriter?.attempts, 2);
        assert.equal(parent.snapshot().firstStartCaptureWriter?.dataAttempts, 1);
        assert.equal(parent.snapshot().firstStartCaptureWriter?.markerAttempts, 1);
        assert.equal(parent.snapshot().firstStartCaptureWriter?.counts.capture.events, 1);
        parent.finish(true);
        assert.equal(parent.snapshot().events, 2);
        assert.deepEqual(parent.snapshot().firstStartCapture, [capture]);
        assert.equal(parent.snapshot().writeFailed, true);
        assert.equal(parent.snapshot().incomplete, true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
