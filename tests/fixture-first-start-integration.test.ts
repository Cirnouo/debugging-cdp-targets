import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    captureTick,
    createFirstStartHarness,
    drainFirstStart,
    fakeFirstStartIo,
} from './fixtures/first-start-capture-fake.ts';
import { createFixtureArtifacts, readFixtureProgress } from './smoke/fixture-artifacts.ts';

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
        const h = createFirstStartHarness(
            {
                async open(file, flags) {
                    if (file === '/proc/123/cgroup') return new Promise(() => {});
                    return fake.open(file, flags);
                },
            },
            (record) => child.firstStartCapture(record),
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
        await captureTick();
        h.advance(4000);
        await captureTick();
        h.event('readiness', 'end', { phase: 'waiting-cdp' });
        await drainFirstStart(h);
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
        assert.deepEqual(progress.firstStartCapture, h.records);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
