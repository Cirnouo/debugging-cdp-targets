import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFixtureArtifacts, readFixtureProgress } from './smoke/fixture-artifacts.ts';
import { fixtureJobIndex, readFixtureIndex, readFixtureSummary } from './smoke/fixture-ci.ts';
import {
    createArmedFixtureWriter,
    createFixtureStreamQuota,
    firstStartControlSlots,
    validateFirstStartWriterCost,
} from './smoke/fixture-stream-quota.ts';
import { captureMetricKeys } from './smoke/linux-first-start-capture-record.ts';

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
    const read = context.mock.method(fs, 'readSync', (...args: Parameters<typeof fs.readSync>) => {
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
