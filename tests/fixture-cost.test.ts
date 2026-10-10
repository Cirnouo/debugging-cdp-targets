import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { subscribeFixtureDiagnostics } from '../src/adapters/fixture-diagnostics.ts';
import { createFixtureArtifacts, readFixtureProgress, validateCollectorCost } from './smoke/fixture-artifacts.ts';

const event = { stage: 'spawn', event: 'begin', outcome: 'started', timestampMs: 1, durationMs: 0 };

test('subscriber measurement includes first validation and rejection before the collector callback', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-cost-test-'));
    let stop = () => {};
    try {
        let clock = 0;
        const collector = createFixtureArtifacts(directory, 'official-server', { now: () => clock });
        stop = subscribeFixtureDiagnostics(
            (event) => collector.gateway(event),
            () => collector.rejected(),
            (dispatch) => collector.measure(dispatch),
        );
        const hostile = new Proxy(
            { ...event, private: 'PRIVATE' },
            {
                ownKeys(target) {
                    clock += 7;
                    return Reflect.ownKeys(target);
                },
            },
        );
        channel('debugging-cdp-targets.fixture').publish(hostile);
        collector.finishStream();
        const progress = readFixtureProgress(directory, 'official-server');
        assert.equal(progress.collectorCost?.callbacks, 1);
        assert.ok((progress.collectorCost?.totalMs ?? 0) >= 7);
        assert.equal(progress.invalidEvents, 1);
        assert.doesNotMatch(await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'), /PRIVATE/);
    } finally {
        stop();
        await rm(directory, { recursive: true, force: true });
    }
});

test('collector cost includes valid and rejected callbacks exactly once without channel recursion', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-cost-test-'));
    try {
        let clock = 0;
        const collector = createFixtureArtifacts(directory, 'official-server', {
            now: () => clock,
            append: (file, record) => {
                clock += 3;
                appendFileSync(file, record);
            },
        });
        collector.gateway(event);
        collector.gateway({ ...event, message: 'PRIVATE_TOKEN' });
        collector.finishStream();
        const progress = readFixtureProgress(directory, 'official-server');
        assert.deepEqual(progress.collectorCost, {
            kind: 'collector-cost',
            callbacks: 2,
            totalMs: 6,
            maxMs: 3,
        });
        const text = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.equal(text.split('\n').filter((line) => line.includes('"kind":"collector-cost"')).length, 1);
        assert.equal(progress.gatewayEvents, 1);
        assert.equal(progress.invalidEvents, 1);
        assert.doesNotMatch(text, /PRIVATE_TOKEN/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('collector records failed writer cost and keeps the original BEGIN when later writes fail', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-cost-test-'));
    try {
        let clock = 0;
        let writes = 0;
        const collector = createFixtureArtifacts(directory, 'official-server', {
            now: () => clock,
            append: (file, record) => {
                clock += 5;
                if (++writes === 2) throw new Error('PRIVATE_DISK_FAILURE');
                appendFileSync(file, record);
            },
        });
        collector.gateway(event);
        collector.gateway({ ...event, event: 'end', outcome: 'succeeded' });
        collector.finishStream();
        const progress = readFixtureProgress(directory, 'official-server');
        assert.deepEqual(progress.collectorCost, {
            kind: 'collector-cost',
            callbacks: 2,
            totalMs: 10,
            maxMs: 5,
        });
        assert.equal(progress.writeFailed, true);
        const text = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.match(text, /"event":"begin"/);
        assert.doesNotMatch(text, /PRIVATE_DISK_FAILURE/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('disabled collection does not read a clock and invalid clocks never become zero-cost evidence', async () => {
    let disabledClockReads = 0;
    const disabled = createFixtureArtifacts(undefined, 'official-server', {
        now: () => {
            disabledClockReads++;
            throw new Error('Disabled collector measured a callback.');
        },
    });
    disabled.gateway(event);
    disabled.rejected();
    disabled.finishStream();
    assert.equal(disabled.snapshot().collectorCost, null);
    assert.equal(disabledClockReads, 0);

    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-cost-test-'));
    try {
        let clock = 5;
        const collector = createFixtureArtifacts(directory, 'official-server', { now: () => clock-- });
        collector.gateway(event);
        collector.finishStream();
        const progress = readFixtureProgress(directory, 'official-server');
        assert.equal(progress.collectorCost, null);
        const text = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.match(text, /collector-cost-unavailable/);
        assert.match(text, /"event":"begin"/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('cost projection rejects unknown fields, accessors, unsafe counts and inconsistent timings', () => {
    const cost = { kind: 'collector-cost', callbacks: 2, totalMs: 6, maxMs: 3 };
    assert.ok(Object.isFrozen(validateCollectorCost(cost)));
    assert.equal(validateCollectorCost({ ...cost, message: 'PRIVATE' }), undefined);
    assert.equal(validateCollectorCost({ ...cost, callbacks: Number.MAX_SAFE_INTEGER + 1 }), undefined);
    assert.equal(validateCollectorCost({ ...cost, totalMs: Number.POSITIVE_INFINITY }), undefined);
    assert.equal(validateCollectorCost({ ...cost, maxMs: 7 }), undefined);
    assert.equal(validateCollectorCost({ ...cost, callbacks: 0 }), undefined);
    let accessed = false;
    Object.defineProperty(cost, 'totalMs', {
        get() {
            accessed = true;
            return 6;
        },
    });
    assert.equal(validateCollectorCost(cost), undefined);
    assert.equal(accessed, false);
});

test('terminal cost record obeys existing cap and explicitly marks incomplete evidence', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-cost-test-'));
    try {
        const collector = createFixtureArtifacts(directory, 'official-server');
        for (let index = 0; index < 2000; index++) collector.gateway(event);
        collector.finishStream();
        const text = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        const lines = text.trim().split('\n');
        assert.equal(lines.length, 2001);
        assert.equal(lines.at(-1), '{"kind":"truncated"}');
        assert.ok(Buffer.byteLength(text) <= 1_048_576);
        assert.equal(readFixtureProgress(directory, 'official-server').collectorCost, null);
        assert.equal(readFixtureProgress(directory, 'official-server').incomplete, true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
