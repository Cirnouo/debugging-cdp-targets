import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFixtureArtifacts, createSmokeFailures, readFixtureProgress } from './smoke/fixture-artifacts.ts';
import { fixtureJobIndex } from './smoke/fixture-ci.ts';

const wait = {
    kind: 'linux-startup-wait',
    entryId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    pid: 123,
    rootStartTicks: 900,
    trigger: 'baseline',
    outcome: 'sampled',
    elapsedMs: 2,
    reads: 7,
    bytes: 500,
    limitations: [],
    wchan: 'futex',
    process: { userTicks: 13, systemTicks: 7, majorFaults: 5, blockIoTicks: 9, readBytes: 8192 },
    systemPsi: { scope: 'system', cpuSomeTotalUs: 1234 },
};

test('wait completion uses the same five artifacts and measured callback without altering primary cleanup failure', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-wait-collector-'));
    try {
        const id = fixtureJobIndex('init', directory);
        assert.equal(typeof id, 'string');
        if (typeof id !== 'string') throw new Error('Expected initialized fixture identity.');
        const parent = createFixtureArtifacts(directory, 'official-server', { collectionId: id });
        let clock = 0;
        const child = createFixtureArtifacts(directory, 'official-server', {
            streamOnly: true,
            collectionId: id,
            now: () => clock,
            append(file, text) {
                clock += 4;
                appendFileSync(file, text);
            },
        });
        child.gateway({ stage: 'spawn', event: 'begin', outcome: 'started', timestampMs: 1, durationMs: 0 });
        child.linuxWait(wait);
        child.linuxWait({ ...wait, raw: 'PRIVATE' });
        child.finishStream();
        const primary = new Error('Controlled original readiness failure.');
        const failures = createSmokeFailures(parent);
        failures.primary(primary);
        const cleanup: string[] = [];
        await failures.cleanup('target-cleanup', async () => {
            cleanup.push('target');
            throw new Error('Controlled cleanup failure.');
        });
        await failures.cleanup('profile-cleanup', async () => {
            cleanup.push('profile');
        });
        assert.throws(
            () => failures.finish(),
            (error: unknown) => error === primary,
        );
        assert.deepEqual(cleanup, ['target', 'profile']);
        const summary = parent.snapshot();
        assert.equal(summary.linuxStartupWait.length, 1);
        assert.equal(summary.secondary.length, 1);
        assert.deepEqual(summary.collectorCost, { kind: 'collector-cost', callbacks: 3, totalMs: 12, maxMs: 4 });
        assert.equal(summary.invalidEvents, 1);
        assert.doesNotMatch(await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'), /PRIVATE/);
        assert.deepEqual((await readdir(directory)).sort(), [
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

test('wait summary stays bounded with explicit omitted evidence while the stream retains safe records', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-wait-collector-'));
    try {
        const collector = createFixtureArtifacts(directory, 'official-server');
        for (let index = 0; index < 9; index++) collector.linuxWait(wait);
        collector.finishStream();
        collector.finish(false);
        const summary = collector.snapshot();
        assert.equal(summary.linuxStartupWait.length, 8);
        assert.equal(summary.linuxStartupWaitOmitted, 1);
        assert.equal(summary.incomplete, true);
        const text = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.equal(text.split('\n').filter((line) => line.includes('"kind":"linux-startup-wait"')).length, 9);
        assert.ok(
            text
                .trim()
                .split('\n')
                .every((line) => Buffer.byteLength(line) <= 4096),
        );
        assert.equal(readFixtureProgress(directory, 'official-server').linuxStartupWaitOmitted, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
