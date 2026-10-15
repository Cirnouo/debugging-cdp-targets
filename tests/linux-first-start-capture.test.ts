import assert from 'node:assert/strict';
import test from 'node:test';
import {
    drainFirstStart as drain,
    fakeCaptureStat,
    fakeFirstStartIo,
    createFirstStartHarness as harness,
    captureTick as tick,
} from './fixtures/first-start-capture-fake.ts';
import { createLinuxFirstStartCapture } from './smoke/linux-first-start-capture.ts';
import { createCaptureBudget, readFirstStartFile } from './smoke/linux-first-start-capture-io.ts';
import { validateFirstStartCaptureRecord } from './smoke/linux-first-start-capture-record.ts';

test('failed capture waits for matching native-close END, never any BEGIN', async () => {
    const h = harness();
    h.bind();
    await tick();
    h.event('readiness', 'decision', { phase: 'rollback-request', readinessExitReason: 'budget-exhausted' });
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'begin');
    await tick();
    assert.equal(h.records.length, 0);
    h.event('native-close', 'end', { operationId: '66666666-6666-4666-8666-666666666666' });
    await tick();
    assert.equal(h.records.length, 0);
    h.event('native-close', 'end');
    h.advance(1);
    await tick();
    h.advance(2);
    await tick();
    h.advance(3);
    assert.ok(h.records.some((record) => record.slot === 'first-start-outcome' && record.status === 'failed'));
    assert.ok(h.records.some((record) => record.family === 'process' && record.slot === 'family'));
});

test('closed records reject raw fields and accessors without invoking them', () => {
    const record = { kind: 'linux-first-start-capture', slot: 'selection', status: 'armed', atMs: 0 };
    assert.ok(validateFirstStartCaptureRecord(record));
    assert.equal(validateFirstStartCaptureRecord({ ...record, path: '/private' }), undefined);
    let calls = 0;
    assert.equal(
        validateFirstStartCaptureRecord({
            ...record,
            get bytes() {
                calls++;
                return 1;
            },
        }),
        undefined,
    );
    assert.equal(calls, 0);
});

test('EOF reader continues short seqfile chunks using actual offsets and closes once', async () => {
    const offsets: number[] = [];
    let closes = 0;
    const chunks = [Buffer.from('0::/a\n'), Buffer.from('0::/b\n'), Buffer.alloc(0)];
    const budget = createCaptureBudget(4, 2);
    const result = await readFirstStartFile(
        '/fake',
        () => true,
        budget,
        async () => ({
            async read(buffer, offset, _length, position) {
                offsets.push(position);
                const chunk = chunks.shift() ?? Buffer.alloc(0);
                chunk.copy(buffer, offset);
                return { bytesRead: chunk.length };
            },
            async close() {
                closes++;
            },
        }),
    );
    assert.equal(result.text, '0::/a\n0::/b\n');
    assert.deepEqual(offsets, [0, 6, 12]);
    assert.equal(closes, 1);
    assert.equal(budget.readCalls, 3);
    assert.equal(budget.bytes, 12);
    assert.equal(budget.handles, 0);
});

test('default observer is inert even for hostile inputs', () => {
    const observer = createLinuxFirstStartCapture(() => {
        throw Error('sink');
    });
    observer.observe(
        new Proxy(
            {},
            {
                getPrototypeOf() {
                    throw Error('hostile');
                },
            },
        ),
    );
    observer.finish();
});

test('success receipt explicitly counts completed points and drops details', async () => {
    const h = harness();
    h.bind();
    await tick();
    h.advance(4000);
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp' });
    await drain(h);
    assert.equal(h.records.filter((record) => record.slot === 'family').length, 0);
    const receipt = h.records.find((record) => record.slot === 'retention-decision');
    assert.equal(receipt?.status, 'discarded');
    assert.equal(typeof receipt?.metrics?.completed, 'number');
    assert.equal(typeof receipt?.metrics?.pending, 'number');
    assert.ok((receipt?.metrics?.discarded ?? 0) > 0);
});
test('cgroup finite versus max limits are explicit rather than silently absent', async () => {
    const h = harness();
    h.bind();
    await tick();
    h.advance(4000);
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    const scope = h.records.find(
        (record) => record.slot === 'family' && record.family === 'cgroup' && record.phase === 1 && record.scope === 0,
    );
    assert.equal(scope?.limits?.cpuQuota, 'max');
    assert.equal(scope?.limits?.memoryHigh, 'finite');
    assert.equal(scope?.limits?.selectedReadBps, 'no-device-entry');
});

test('a prior actual spawn consumes the only first-start slot even without readiness', async () => {
    const h = harness();
    h.event('spawn', 'begin');
    h.event('spawn', 'end', { outcome: 'failed' });
    h.event('operation', 'end', { outcome: 'failed' });
    h.bind();
    await tick();
    assert.equal(h.paths.length, 0);
});

test('full buffers and eight non-EOF short reads are rejected and never reopened', async () => {
    for (const mode of ['full', 'chunks'] as const) {
        const budget = createCaptureBudget(1, 0);
        let opens = 0;
        let closes = 0;
        const result = await readFirstStartFile(
            '/fake',
            () => true,
            budget,
            async () => {
                opens++;
                return {
                    async read(buffer, offset, length) {
                        const count = mode === 'full' ? length : 1;
                        buffer.fill(65, offset, offset + count);
                        return { bytesRead: count };
                    },
                    async close() {
                        closes++;
                    },
                };
            },
        );
        assert.equal(result.text, undefined);
        assert.equal(result.status, mode === 'full' ? 'overlong' : 'incomplete');
        assert.equal(budget.bytes, mode === 'full' ? 4096 : 8);
        assert.equal(budget.readCalls, mode === 'full' ? 1 : 8);
        assert.equal(opens, 1);
        assert.equal(closes, 1);
    }
});
test('late open retains its mandatory close reservation without admitting a read', async () => {
    let allowed = true;
    let resolveOpen:
        | ((handle: { read: () => Promise<{ bytesRead: number }>; close: () => Promise<void> }) => void)
        | undefined;
    let reads = 0;
    let closes = 0;
    const budget = createCaptureBudget(1, 0);
    const result = readFirstStartFile(
        '/fake',
        () => allowed,
        budget,
        () =>
            new Promise((resolve) => {
                resolveOpen = resolve;
            }),
    );
    assert.equal(budget.pending, 1);
    allowed = false;
    resolveOpen?.({
        async read() {
            reads++;
            return { bytesRead: 0 };
        },
        async close() {
            closes++;
        },
    });
    assert.equal((await result).status, 'incomplete');
    assert.equal(reads, 0);
    assert.equal(closes, 1);
    assert.equal(budget.completed, 1);
    assert.equal(budget.handles, 0);
});

test('orphan, mismatched and overlapping snapshot evidence cannot authorize any I/O', async () => {
    for (const variant of [
        'orphan-file',
        'orphan-decision',
        'wrong-request',
        'wrong-operation',
        'wrong-session',
        'wrong-connection',
        'overlap',
        'late-decision',
    ] as const) {
        const h = harness();
        h.begin();
        if (variant === 'orphan-file')
            h.event('native-file', 'decision', { command: 'proc-stat', valid: true, rootStartTicks: 900 });
        else if (variant === 'orphan-decision') h.event('native-snapshot', 'decision', { valid: true });
        else if (variant.startsWith('wrong-')) {
            const key =
                variant === 'wrong-request'
                    ? 'requestId'
                    : variant === 'wrong-operation'
                      ? 'operationId'
                      : variant === 'wrong-session'
                        ? 'sessionId'
                        : 'connectionId';
            h.snapshot({ [key]: '66666666-6666-4666-8666-666666666666' });
        } else {
            h.event('native-snapshot', 'begin');
            if (variant === 'overlap') h.event('native-snapshot', 'begin');
            h.event('native-file', 'decision', { command: 'proc-stat', valid: true, rootStartTicks: 900 });
            h.event('native-snapshot', 'end', { valid: true });
            if (variant === 'late-decision') {
                h.event('native-snapshot', 'begin');
                h.event('native-file', 'decision', { command: 'proc-stat', valid: true, rootStartTicks: 900 });
                h.event('native-snapshot', 'end', { valid: true });
            } else h.event('native-snapshot', 'end', { valid: true });
            h.event('native-snapshot', 'decision', { valid: true });
            h.event('native-snapshot', 'decision', { valid: true });
        }
        await tick();
        assert.equal(h.paths.length, 0, variant);
    }
});

test('hung cgroup discovery cannot block device results and retains pending ownership', async () => {
    const fake = fakeFirstStartIo();
    const h = harness({
        async open(file, flags) {
            if (file === '/proc/123/cgroup') return new Promise(() => {});
            return fake.open(file, flags);
        },
    });
    h.bind();
    await tick();
    h.advance(251);
    await tick();
    h.advance(4000);
    await tick();
    h.event('readiness', 'decision', { phase: 'rollback-request', readinessExitReason: 'budget-exhausted' });
    h.event('native-close', 'begin');
    await tick();
    assert.equal(h.records.length, 0);
    h.event('native-close', 'end');
    await drain(h);
    assert.ok(
        h.records.some((record) => record.family === 'device' && record.phase === 1 && record.status === 'complete'),
    );
    assert.ok(h.records.some((record) => record.family === 'cgroup' && record.phase === 1 && record.status === 'busy'));
    const cost = h.records.find((record) => record.slot === 'cost' && record.phase === 7)?.cost?.cgroup;
    assert.equal(cost?.pending, 1);
    assert.equal(cost?.settled, false);
    assert.equal(h.paths.filter((file) => file === '/proc/123/cgroup').length, 1);
});

test('a timed out read or close blocks later family work without blocking other groups', async () => {
    for (const operation of ['read', 'close'] as const) {
        const fake = fakeFirstStartIo();
        let blocked = false;
        let resolvePending: (() => void) | undefined;
        const h = harness({
            async open(file, flags) {
                const handle = await fake.open(file, flags);
                if (file !== '/proc/123/io' || blocked) return handle;
                blocked = true;
                return {
                    async read(buffer, offset, length, position) {
                        if (operation === 'read')
                            await new Promise<void>((resolve) => {
                                resolvePending = resolve;
                            });
                        return handle.read(buffer, offset, length, position);
                    },
                    async close() {
                        if (operation === 'close')
                            await new Promise<void>((resolve) => {
                                resolvePending = resolve;
                            });
                        return handle.close();
                    },
                };
            },
        });
        h.bind();
        await tick();
        h.advance(251);
        await tick();
        h.advance(4000);
        await tick();
        h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
        h.event('native-close', 'end');
        await drain(h);
        assert.ok(
            h.records.some(
                (record) => record.family === 'process' && record.phase === 0 && record.status === 'timeout',
            ),
            operation,
        );
        assert.ok(
            h.records.some((record) => record.family === 'process' && record.phase === 1 && record.status === 'busy'),
            operation,
        );
        assert.ok(
            h.records.some(
                (record) => record.family === 'device' && record.phase === 1 && record.status === 'complete',
            ),
            operation,
        );
        const cost = h.records.find((record) => record.slot === 'cost' && record.phase === 7)?.cost?.process;
        assert.equal(cost?.pending, 1);
        assert.equal(cost?.handles, 1);
        assert.equal(cost?.settled, false);
        const count = h.paths.length;
        const recordCount = h.records.length;
        resolvePending?.();
        await tick();
        assert.equal(h.paths.length, count);
        assert.equal(h.records.length, recordCount);
        assert.equal(cost?.pending, 1, 'cutoff snapshot must remain pending after actual late settlement');
    }
});

test('late slots are skipped without catchup and no new reads follow terminal readiness', async () => {
    const h = harness();
    h.bind();
    await tick();
    const baselineReads = h.paths.length;
    h.advance(4251);
    await tick();
    assert.equal(h.paths.length, baselineReads);
    h.advance(8000);
    await tick();
    assert.ok(h.paths.length > baselineReads);
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    const terminalReads = h.paths.length;
    h.advance(19000);
    await tick();
    assert.equal(h.paths.length, terminalReads);
    h.event('native-close', 'end');
    await drain(h);
    assert.equal(h.records.find((record) => record.slot === 'six-slot-status')?.slots?.[1], 'skipped-late');
    assert.equal(h.records.filter((record) => record.slot === 'family' && record.phase === 1).length, 3);
});

test('namespace change invalidates cgroup alone while independently valid device survives', async () => {
    const fake = fakeFirstStartIo();
    let changed = false;
    const h = harness({
        ...fake,
        async stat(file) {
            if (changed && file === '/proc/123/ns/cgroup') return { dev: 2048n, ino: 2n };
            return fake.stat(file);
        },
    });
    h.bind();
    await tick();
    changed = true;
    h.advance(4000);
    await tick();
    h.advance(8000);
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    assert.ok(
        h.records.some(
            (record) => record.family === 'cgroup' && record.phase === 1 && record.status === 'namespace-invalid',
        ),
    );
    assert.ok(
        h.records.some((record) => record.family === 'cgroup' && record.phase === 2 && record.status === 'unavailable'),
    );
    assert.ok(
        h.records.some((record) => record.family === 'device' && record.phase === 2 && record.status === 'complete'),
    );
});

test('executable/device epoch and monotonic counters never join changed identity', async () => {
    for (const change of ['device', 'counter', 'pid'] as const) {
        let changed = false;
        const fake = fakeFirstStartIo((file, text) =>
            changed && file === '/sys/devices/disk/stat' && change === 'counter'
                ? '1 0 8 1 0 0 0 0 0 1 1\n'
                : changed && file === '/proc/123/stat' && change === 'pid'
                  ? fakeCaptureStat(901)
                  : text,
        );
        const h = harness({
            ...fake,
            async stat(file) {
                return changed && file === '/sys/devices/disk' && change === 'device'
                    ? { dev: 2048n, ino: 2n }
                    : fake.stat(file);
            },
        });
        h.bind();
        await tick();
        h.advance(4000);
        await tick();
        changed = true;
        h.advance(8000);
        await tick();
        h.advance(12000);
        await tick();
        h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
        h.event('native-close', 'end');
        await drain(h);
        const record = h.records.find((item) => item.slot === 'family' && item.family === 'device' && item.phase === 2);
        assert.equal(record?.status, change === 'counter' ? 'counter-invalid' : 'identity-invalid', change);
        assert.equal(record?.metrics, undefined);
        assert.ok(
            h.records.some((item) => item.family === 'device' && item.phase === 3 && item.status === 'unavailable'),
        );
    }
});

test('fixed slots and cumulative cost obey global application I/O caps', async () => {
    const h = harness();
    h.bind();
    await tick();
    for (const time of [4000, 8000, 12000, 16000, 19000]) {
        h.advance(time);
        await tick();
    }
    h.event('readiness', 'decision', { phase: 'rollback-request', readinessExitReason: 'budget-exhausted' });
    h.event('native-close', 'end');
    await drain(h);
    assert.ok(h.records.length <= 54);
    assert.equal(
        new Set(h.records.map((record) => `${record.slot}/${record.phase}/${record.family}/${record.scope}`)).size,
        h.records.length,
    );
    assert.equal(h.records.filter((record) => record.slot === 'cost').length, 8);
    const costs = Object.values(h.records.find((record) => record.slot === 'cost' && record.phase === 7)?.cost ?? {});
    for (const [key, maximum] of [
        ['attempts', 346],
        ['readCalls', 2768],
        ['bytes', 1417216],
        ['metadata', 336],
    ] as const)
        assert.ok(costs.reduce((sum, cost) => sum + cost[key], 0) <= maximum, key);
    assert.ok(h.records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)) + 1, 0) <= 256 * 1024);
    assert.ok(h.records.every((record) => validateFirstStartCaptureRecord(record)));
    assert.equal(JSON.stringify(h.records).includes('/proc/'), false);
});

test('fast independent discovery supplies a baseline device endpoint inside the original 250ms window', async () => {
    const h = harness();
    h.bind();
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    assert.ok(
        h.records.some(
            (record) =>
                record.slot === 'family' &&
                record.family === 'device' &&
                record.phase === 0 &&
                record.status === 'complete' &&
                record.metrics?.readsCompleted === 10,
        ),
    );
});
test('slow discovery never catches up baseline or opens a second baseline deadline', async () => {
    const fake = fakeFirstStartIo();
    let release: (() => void) | undefined;
    let blocked = false;
    const h = harness({
        async realpath(file) {
            if (!blocked && file.startsWith('/sys/dev/block/')) {
                blocked = true;
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            }
            return fake.realpath(file);
        },
    });
    h.bind();
    await tick();
    h.advance(251);
    await tick();
    release?.();
    await tick();
    const count = h.paths.length;
    h.advance(500);
    await tick();
    assert.equal(h.paths.length, count);
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    assert.ok(
        h.records.some(
            (record) =>
                record.slot === 'family' &&
                record.family === 'device' &&
                record.phase === 0 &&
                record.status === 'unavailable',
        ),
    );
    assert.equal(
        h.records.some(
            (record) =>
                record.slot === 'family' &&
                record.family === 'device' &&
                record.phase === 0 &&
                record.status === 'complete',
        ),
        false,
    );
});

test('failed or backwards-timestamp validation cannot bind a completed snapshot', async () => {
    for (const variant of ['failed', 'backwards-file', 'backwards-end'] as const) {
        const h = harness();
        h.begin();
        h.advance(10);
        h.event('native-snapshot', 'begin');
        h.event('native-file', 'decision', {
            command: 'proc-stat',
            valid: true,
            rootStartTicks: 900,
            timestampMs: variant === 'backwards-file' ? 9 : 11,
        });
        h.event('native-snapshot', 'end', { valid: true, timestampMs: variant === 'backwards-end' ? 10 : 12 });
        h.event('native-snapshot', 'decision', {
            valid: true,
            timestampMs: 13,
            ...(variant === 'failed' ? { outcome: 'failed' } : {}),
        });
        await tick();
        assert.equal(h.paths.length, 0, variant);
    }
});
test('a successful actual-exit wait can release a failed cache without a Close END', async () => {
    const h = harness();
    h.bind();
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('target-exit-wait', 'begin');
    await tick();
    assert.equal(h.records.length, 0);
    h.event('target-exit-wait', 'end');
    await drain(h);
    assert.ok(h.records.some((record) => record.slot === 'first-start-outcome' && record.status === 'failed'));
});

test('maximal partition and four-scope sampling fills exactly the frozen 54 slots within every allocation', async () => {
    const fake = fakeFirstStartIo((file, text) =>
        file.endsWith('/cgroup') ? '0::/a/b/c/d/e\n' : file === '/sys/devices/disk/part/dev' ? '8:1\n' : text,
    );
    const h = harness({
        ...fake,
        async stat(file) {
            return file === '/proc/123/exe' ? { dev: 2049n, ino: 1n } : fake.stat(file);
        },
        async realpath(file) {
            return file.startsWith('/sys/dev/block/') ? '/sys/devices/disk/part' : file;
        },
        async open(file, flags) {
            if (file.endsWith('/partition'))
                return {
                    async read(buffer, offset, _length, position) {
                        const data = Buffer.from('1\n').subarray(position);
                        data.copy(buffer, offset);
                        return { bytesRead: data.length };
                    },
                    async close() {},
                };
            return fake.open(file, flags);
        },
    });
    h.bind();
    await tick();
    for (const time of [4000, 8000, 12000, 16000, 19000]) {
        h.advance(time);
        await tick();
    }
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    assert.equal(h.records.length, 54);
    assert.equal(h.records.filter((record) => record.slot === 'family').length, 36);
    assert.ok(
        h.records.some(
            (record) => record.family === 'cgroup' && record.scope === 3 && record.reason === 'depth-capped',
        ),
    );
    for (const record of h.records.filter((record) => record.slot === 'cost' && (record.phase ?? 8) < 6)) {
        assert.equal(record.cost?.device?.attempts, 12);
        assert.equal(record.cost?.device?.metadata, 10);
        assert.equal(record.cost?.cgroup?.attempts, 36);
        assert.equal(record.cost?.cgroup?.metadata, 30);
        assert.ok((record.cost?.process?.attempts ?? 99) <= 8);
        assert.equal(record.cost?.process?.metadata, 2);
    }
});
test('flush batches contain at most eight records and prioritize binding then baseline/latest device', async () => {
    const h = harness();
    h.bind();
    await tick();
    h.advance(19000);
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    for (let index = 0; index < 12; index++) {
        const before = h.records.length;
        h.advance(21000 + index);
        assert.ok(h.records.length - before <= 8);
        await tick();
    }
    const device = h.records.findIndex(
        (record) => record.family === 'device' && record.phase === 5 && record.status === 'complete',
    );
    const process = h.records.findIndex((record) => record.family === 'process');
    assert.ok(device >= 0 && device < process);
    assert.equal(h.records[0]?.slot, 'selection');
});
test('a spawn BEGIN without an actual PID still retains its closed selection receipt after binding', async () => {
    const h = harness();
    h.event('spawn', 'begin', { pid: undefined });
    h.event('spawn', 'decision', { reason: 'acquired' });
    h.event('readiness', 'begin', { phase: 'waiting-cdp' });
    h.snapshot();
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    assert.equal(h.records.find((record) => record.slot === 'selection')?.status, 'armed');
});

test('the six-point receipt cannot claim a hung family completed', async () => {
    const fake = fakeFirstStartIo();
    const h = harness({
        async open(file, flags) {
            return file === '/proc/123/cgroup' ? new Promise(() => {}) : fake.open(file, flags);
        },
    });
    h.bind();
    await tick();
    h.advance(251);
    h.advance(4000);
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    assert.notEqual(h.records.find((record) => record.slot === 'six-slot-status')?.slots?.[1], 'complete');
    assert.equal(h.records.find((record) => record.slot === 'retention-decision')?.metrics?.pending, 1);
});

test('short mountinfo seqfile chunks cannot hide a second cgroup mapping', async () => {
    const fake = fakeFirstStartIo();
    let readCalls = 0;
    const h = harness({
        async open(file, flags) {
            if (!file.endsWith('/mountinfo')) return fake.open(file, flags);
            const chunks = [
                Buffer.from('1 0 0:1 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n'),
                Buffer.from('2 0 0:2 / /other rw - cgroup2 cgroup rw\n'),
                Buffer.alloc(0),
            ];
            return {
                async read(buffer, offset) {
                    readCalls++;
                    const chunk = chunks.shift() ?? Buffer.alloc(0);
                    chunk.copy(buffer, offset);
                    return { bytesRead: chunk.length };
                },
                async close() {},
            };
        },
    });
    h.bind();
    await tick();
    h.advance(4000);
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    assert.equal(readCalls, 3);
    assert.equal(h.records.find((record) => record.slot === 'cgroup-epoch')?.status, 'unavailable');
    assert.ok(
        h.records.some((record) => record.family === 'device' && record.phase === 0 && record.status === 'complete'),
    );
});
test('partition permission failure never becomes a guessed whole-device fallback', async () => {
    const fake = fakeFirstStartIo();
    const h = harness({
        async open(file, flags) {
            if (file.endsWith('/partition')) throw Object.assign(Error(), { code: 'EACCES' });
            return fake.open(file, flags);
        },
    });
    h.bind();
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    const epoch = h.records.find((record) => record.slot === 'device-epoch');
    assert.equal(epoch?.status, 'unavailable');
    assert.equal(epoch?.reason, 'permission');
    assert.equal(
        h.paths.some((file) => file === '/sys/devices/disk/stat'),
        false,
    );
});

test('closed validator rejects fractional counters, contradictory settled costs and invalid endpoint metrics', () => {
    const family = {
        kind: 'linux-first-start-capture',
        slot: 'family',
        status: 'complete',
        atMs: 0,
        phase: 0,
        family: 'device',
        metrics: { readsCompleted: 10 },
    };
    assert.ok(validateFirstStartCaptureRecord(family));
    assert.equal(validateFirstStartCaptureRecord({ ...family, metrics: { readsCompleted: 0.5 } }), undefined);
    assert.equal(
        validateFirstStartCaptureRecord({ ...family, metrics: { sectorsRead: Number.MAX_SAFE_INTEGER + 1 } }),
        undefined,
    );
    for (const status of [
        'timeout',
        'identity-invalid',
        'namespace-invalid',
        'counter-invalid',
        'pending',
        'unavailable',
    ])
        assert.equal(validateFirstStartCaptureRecord({ ...family, status }), undefined, status);
    const cost = {
        attempts: 1,
        opens: 1,
        readCalls: 1,
        closes: 0,
        bytes: 1,
        metadata: 0,
        completed: 0,
        pending: 1,
        handles: 1,
        settled: true,
    };
    assert.equal(
        validateFirstStartCaptureRecord({
            kind: family.kind,
            slot: 'cost',
            status: 'complete',
            atMs: 0,
            phase: 7,
            cost: { device: cost },
        }),
        undefined,
    );
    assert.equal(
        validateFirstStartCaptureRecord({
            ...family,
            family: 'cgroup',
            metrics: { cpuQuota: 1 },
            limits: { cpuQuota: 'max' },
        }),
        undefined,
    );
    assert.equal(
        validateFirstStartCaptureRecord({ ...family, family: 'cgroup', metrics: {}, limits: { cpuQuota: 'finite' } }),
        undefined,
    );
});

test('partition selected and parent endpoints retain distinct complete I/O time counters without more reads', async () => {
    let later = false;
    const fake = fakeFirstStartIo((file, text) =>
        file === '/sys/devices/disk/part/dev'
            ? '8:1\n'
            : file === '/sys/devices/disk/part/stat'
              ? `10 0 80 2 0 0 0 0 0 ${later ? 15 : 10} ${later ? 27 : 20}\n`
              : file === '/sys/devices/disk/stat'
                ? `30 0 240 6 0 0 0 0 0 ${later ? 140 : 100} ${later ? 260 : 200}\n`
                : text,
    );
    const h = harness({
        ...fake,
        async stat(file) {
            return file === '/proc/123/exe' ? { dev: 2049n, ino: 1n } : fake.stat(file);
        },
        async realpath(file) {
            return file.startsWith('/sys/dev/block/') ? '/sys/devices/disk/part' : file;
        },
        async open(file, flags) {
            if (file.endsWith('/partition'))
                return {
                    async read(buffer, offset, _length, position) {
                        const data = Buffer.from('1\n').subarray(position);
                        data.copy(buffer, offset);
                        return { bytesRead: data.length };
                    },
                    async close() {},
                };
            return fake.open(file, flags);
        },
    });
    h.bind();
    await tick();
    later = true;
    h.advance(4000);
    await tick();
    h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
    h.event('native-close', 'end');
    await drain(h);
    const first = h.records.find(
        (record) => record.slot === 'family' && record.family === 'device' && record.phase === 0,
    );
    const last = h.records.find(
        (record) => record.slot === 'family' && record.family === 'device' && record.phase === 1,
    );
    assert.equal(first?.status, 'complete');
    assert.equal(last?.status, 'complete');
    assert.deepEqual(
        [
            first?.metrics?.ioMs,
            first?.metrics?.weightedIoMs,
            first?.metrics?.queueIoMs,
            first?.metrics?.queueWeightedIoMs,
        ],
        [10, 20, 100, 200],
    );
    assert.deepEqual(
        [last?.metrics?.ioMs, last?.metrics?.weightedIoMs, last?.metrics?.queueIoMs, last?.metrics?.queueWeightedIoMs],
        [15, 27, 140, 260],
    );
    for (const phase of [0, 1]) {
        const cost = h.records.find((record) => record.slot === 'cost' && record.phase === phase)?.cost?.device;
        assert.equal(cost?.attempts, 12);
        assert.equal(cost?.metadata, 10);
    }
    assert.equal(h.records.filter((record) => record.slot === 'family' && record.family === 'device').length, 2);
});

test('flush binding and epoch order is fixed across independent discovery completion orders', async () => {
    for (const delayed of ['device', 'cgroup'] as const) {
        const fake = fakeFirstStartIo();
        let release: (() => void) | undefined;
        let blocked = false;
        const h = harness({
            ...fake,
            async realpath(file) {
                if (delayed === 'device' && !blocked && file.startsWith('/sys/dev/block/')) {
                    blocked = true;
                    await new Promise<void>((resolve) => {
                        release = resolve;
                    });
                }
                return fake.realpath(file);
            },
            async open(file, flags) {
                if (delayed === 'cgroup' && !blocked && file === '/proc/123/cgroup') {
                    blocked = true;
                    await new Promise<void>((resolve) => {
                        release = resolve;
                    });
                }
                return fake.open(file, flags);
            },
        });
        h.bind();
        await tick();
        h.advance(10);
        release?.();
        await tick();
        h.advance(4000);
        await tick();
        h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
        h.event('native-close', 'end');
        for (let index = 0; index < 12; index++) {
            const before = h.records.length;
            h.advance(21000 + index);
            assert.ok(h.records.length - before <= 8, delayed);
            await tick();
        }
        assert.deepEqual(
            h.records.slice(0, 5).map((record) => record.slot),
            ['selection', 'root-binding', 'device-epoch', 'cgroup-epoch', 'first-start-outcome'],
            delayed,
        );
        assert.deepEqual(
            h.records.slice(5, 7).map((record) => [record.slot, record.family, record.phase]),
            [
                ['family', 'device', 0],
                ['family', 'device', 1],
            ],
            delayed,
        );
    }
});

test('cost slot status must agree with all family settlement, including a normally pending close', () => {
    const base = { kind: 'linux-first-start-capture', slot: 'cost', atMs: 0, phase: 7 };
    const pending = {
        attempts: 1,
        opens: 1,
        readCalls: 2,
        closes: 1,
        bytes: 1,
        metadata: 0,
        completed: 0,
        pending: 1,
        handles: 1,
        settled: false,
    };
    assert.equal(
        validateFirstStartCaptureRecord({ ...base, status: 'complete', cost: { device: pending } }),
        undefined,
    );
    assert.ok(
        validateFirstStartCaptureRecord({ ...base, status: 'pending', cost: { device: pending } }),
        'an admitted close still holds its handle until actual settlement',
    );
    const settled = { ...pending, completed: 1, pending: 0, handles: 0, settled: true };
    assert.ok(validateFirstStartCaptureRecord({ ...base, status: 'complete', cost: { device: settled } }));
    assert.equal(
        validateFirstStartCaptureRecord({ ...base, status: 'complete', cost: { device: settled, process: pending } }),
        undefined,
    );
    assert.equal(validateFirstStartCaptureRecord({ ...base, status: 'pending', cost: { device: settled } }), undefined);
    assert.equal(validateFirstStartCaptureRecord({ ...base, status: 'partial', cost: { device: pending } }), undefined);
});

test('parent queue time metrics require safe integers and independently reject counter rollback', async () => {
    for (const key of ['queueIoMs', 'queueWeightedIoMs'] as const) {
        const family = {
            kind: 'linux-first-start-capture',
            slot: 'family',
            status: 'complete',
            atMs: 0,
            phase: 0,
            family: 'device',
        };
        assert.ok(validateFirstStartCaptureRecord({ ...family, metrics: { [key]: 100 } }));
        assert.equal(validateFirstStartCaptureRecord({ ...family, metrics: { [key]: 0.5 } }), undefined);
        assert.equal(
            validateFirstStartCaptureRecord({ ...family, metrics: { [key]: Number.MAX_SAFE_INTEGER + 1 } }),
            undefined,
        );
        let decreased = false;
        const fake = fakeFirstStartIo((file, text) =>
            file === '/sys/devices/disk/part/dev'
                ? '8:1\n'
                : file === '/sys/devices/disk/stat'
                  ? `30 0 240 6 0 0 0 0 0 ${decreased && key === 'queueIoMs' ? 99 : 100} ${decreased && key === 'queueWeightedIoMs' ? 199 : 200}\n`
                  : text,
        );
        const h = harness({
            ...fake,
            async stat(file) {
                return file === '/proc/123/exe' ? { dev: 2049n, ino: 1n } : fake.stat(file);
            },
            async realpath(file) {
                return file.startsWith('/sys/dev/block/') ? '/sys/devices/disk/part' : file;
            },
            async open(file, flags) {
                if (file.endsWith('/partition'))
                    return {
                        async read(buffer, offset, _length, position) {
                            const data = Buffer.from('1\n').subarray(position);
                            data.copy(buffer, offset);
                            return { bytesRead: data.length };
                        },
                        async close() {},
                    };
                return fake.open(file, flags);
            },
        });
        h.bind();
        await tick();
        decreased = true;
        h.advance(4000);
        await tick();
        h.event('readiness', 'end', { phase: 'waiting-cdp', outcome: 'failed' });
        h.event('native-close', 'end');
        await drain(h);
        const endpoint = h.records.find(
            (record) => record.slot === 'family' && record.family === 'device' && record.phase === 1,
        );
        assert.equal(endpoint?.status, 'counter-invalid', key);
        assert.equal(endpoint?.metrics, undefined, key);
    }
});
