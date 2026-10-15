import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createReadaheadLease,
    createReadaheadObserver,
    type ReadaheadIo,
    readaheadExitProof,
    resolveReadaheadIdentity,
    validateReadaheadRecord,
} from './smoke/linux-readahead-study.ts';

function fakeIo() {
    let value = 256;
    let changed = false;
    const writes: number[] = [];
    const io: ReadaheadIo = {
        canonical: async (file) =>
            file === '/chrome'
                ? '/chrome'
                : file === '/sys/dev/block/8:1'
                  ? '/sys/devices/disk/block/sda/sda1'
                  : file === '/sys/dev/block/8:0'
                    ? '/sys/devices/disk/block/sda'
                    : file,
        metadata: async () => ({ dev: 2049n, ino: changed ? 2n : 1n, regular: true }),
        read: async (file) => {
            let text: string;
            if (file.endsWith('/sda1/dev')) text = '8:1\n';
            else if (file.endsWith('/sda/dev')) text = '8:0\n';
            else if (file.endsWith('/partition')) text = '1\n';
            else if (file.endsWith('/read_ahead_kb')) text = `${value}\n`;
            else if (file.endsWith('/rotational')) text = '0\n';
            else if (file.endsWith('/stat')) text = '1 0 8 2 0 0 0 0 0 2 2\n';
            else throw new Error('missing');
            return { bytes: Buffer.byteLength(text), text };
        },
        children: async (file) => (file.endsWith('/sda1') ? ['partition'] : []),
        write: (file, number) => ({
            settled: Promise.resolve().then(() => {
                assert.match(file, /read_ahead_kb$/);
                writes.push(number);
                value = number;
            }),
        }),
        now: () => performance.now(),
    };
    return {
        io,
        writes,
        value: () => value,
        change: () => {
            changed = true;
        },
    };
}

test('canonical executable maps partition to exactly its parent queue; changed inode refuses writes', async () => {
    const fake = fakeIo();
    const identity = await resolveReadaheadIdentity('/chrome', fake.io);
    assert.equal(identity.queueMajor, 8);
    assert.equal(identity.queueMinor, 0);
    const lease = createReadaheadLease('/chrome', 1024, () => {}, fake.io);
    await lease.admit();
    fake.change();
    await assert.rejects(lease.restore(true), /identity/);
    assert.deepEqual(fake.writes, [1024]);
});

const entryId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
test('actual exit proof requires matching start, acquired PID and resource release with intact stream', () => {
    const event = (stage: string, outcome: string, extra: object = {}) => ({
        kind: 'gateway',
        stage,
        event: 'end',
        outcome,
        timestampMs: 1,
        durationMs: 0,
        entryId,
        connectionId,
        sessionId,
        operationId,
        ...extra,
    });
    const events = [
        event('operation', 'started', { action: 'start', requestId, event: 'begin' }),
        event('spawn', 'observed', { event: 'decision', reason: 'acquired', pid: 123 }),
        event('target-exit-wait', 'succeeded', { pid: 123 }),
        event('directory-lease', 'released', {
            phase: 'resource-cleanup',
            sessionId: undefined,
            operationId: undefined,
            originOperationId: operationId,
        }),
    ].map((value) => JSON.parse(JSON.stringify(value)));
    assert.equal(readaheadExitProof(events, { entryId, requestId }, true), true);
    assert.equal(readaheadExitProof(events, { entryId, requestId }, false), false);
    assert.equal(readaheadExitProof(events.slice(0, 3), { entryId, requestId }, true), false);
    assert.equal(
        readaheadExitProof(
            events.map((value, index) => (index === 3 ? { ...value, connectionId: entryId } : value)),
            { entryId, requestId },
            true,
        ),
        false,
    );
    assert.equal(
        readaheadExitProof(
            events.filter((_, index) => index !== 2),
            { entryId, requestId },
            true,
        ),
        true,
    );
    assert.equal(readaheadExitProof([...events, { kind: 'truncated' }], { entryId, requestId }, true), false);
    assert.equal(
        readaheadExitProof(
            [...events, { kind: 'limitation', reason: 'validation-rejected' }],
            { entryId, requestId },
            true,
        ),
        false,
    );
});

test('stacked topology and device disagreement fail admission with zero starts', async () => {
    for (const mode of ['stacked', 'mismatch']) {
        const fake = fakeIo();
        if (mode === 'stacked') fake.io.children = async () => ['other'];
        else {
            const read = fake.io.read;
            fake.io.read = async (file) => (file.endsWith('/sda1/dev') ? { bytes: 4, text: '8:2\n' } : read(file));
        }
        const lease = createReadaheadLease('/chrome', 128, () => {}, fake.io);
        await assert.rejects(lease.admit());
        assert.equal(lease.launches(), 0);
        assert.deepEqual(fake.writes, []);
    }
});

test('partial permission failure retains original restoration responsibility', async () => {
    const fake = fakeIo();
    const write = fake.io.write;
    let calls = 0;
    fake.io.write = (file, value) => {
        const helper = write(file, value);
        return {
            settled: helper.settled.then(() => {
                if (++calls === 1) throw new Error('permission');
            }),
        };
    };
    const lease = createReadaheadLease('/chrome', 128, () => {}, fake.io);
    await assert.rejects(lease.admit(), /permission/);
    await lease.restore(true);
    assert.equal(fake.value(), 256);
});

test('unproven native writer settlement prevents even a zero-launch restore', async () => {
    const fake = fakeIo();
    fake.io.write = () => ({ settled: Promise.reject(new Error('helper failed')), restorationSafe: () => false });
    const lease = createReadaheadLease('/chrome', 128, () => {}, fake.io);
    await assert.rejects(lease.admit());
    assert.equal(lease.launches(), 0);
    await assert.rejects(lease.restore(true), /pending actual writer/);
});

test('changed assigned readback rejects admission and restores only retained original value', async () => {
    const fake = fakeIo();
    const write = fake.io.write;
    fake.io.write = (file, value) => write(file, value === 128 ? 512 : value);
    const lease = createReadaheadLease('/chrome', 128, () => {}, fake.io);
    await assert.rejects(lease.admit(), /readback/);
    await lease.restore(true);
    assert.equal(fake.value(), 256);
    assert.equal(lease.launches(), 0);
});

test('timeout never permits restoration to race a late actual write helper', async () => {
    const fake = fakeIo();
    const write = fake.io.write;
    let release = () => {};
    let first = true;
    fake.io.write = (file, value) => {
        if (!first) return write(file, value);
        first = false;
        return {
            settled: new Promise<void>((resolve) => {
                release = resolve;
            }).then(() => write(file, value).settled),
        };
    };
    const lease = createReadaheadLease('/chrome', 1024, () => {}, fake.io, 5);
    await assert.rejects(lease.admit(), /timeout/);
    const restoration = lease.restore(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(fake.writes, []);
    release();
    await restoration;
    assert.deepEqual(fake.writes, [1024, 256]);
});

test('restoration timeout retains actual writer and independent readback before terminal rejection', async () => {
    let release = () => {};
    const delayed = fakeIo();
    const immediate = delayed.io.write;
    delayed.io.write = (file, value) =>
        value === 256
            ? {
                  settled: new Promise<void>((resolve) => {
                      release = resolve;
                  }).then(() => immediate(file, value).settled),
              }
            : immediate(file, value);
    const observed: unknown[] = [];
    const delayedLease = createReadaheadLease('/chrome', 1024, (record) => observed.push(record), delayed.io, 5);
    await delayedLease.admit();
    let terminal = false;
    const restoration = delayedLease.restore(true).then(
        () => {
            terminal = true;
        },
        () => {
            terminal = true;
        },
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    const premature = terminal;
    release();
    await restoration;
    assert.equal(premature, false, 'terminal rejection must not abandon restoration work');
    assert.equal(delayed.value(), 256);
    assert.deepEqual(delayed.writes, [1024, 256]);
    const last = validateReadaheadRecord(observed.at(-1));
    assert.equal(last?.readAheadKb, 256);
    assert.equal(last?.startCalls, 0);
});

test('initialization deadline bounds canonical/read/metadata results while retaining actual I/O ownership', async () => {
    const { createReadaheadInitialization } = await import('./smoke/linux-readahead-study.ts');
    for (const boundary of ['canonical', 'read', 'metadata'] as const) {
        const fake = fakeIo();
        let release = () => {};
        const hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        if (boundary === 'canonical')
            fake.io.canonical = async (file) => {
                await hold;
                return fakeIo().io.canonical(file);
            };
        if (boundary === 'read')
            fake.io.read = async (file) => {
                await hold;
                return fakeIo().io.read(file);
            };
        if (boundary === 'metadata')
            fake.io.metadata = async (file) => {
                await hold;
                return fakeIo().io.metadata(file);
            };
        const records: unknown[] = [];
        const initialization = createReadaheadInitialization(
            '/chrome',
            128,
            (record) => records.push(record),
            fake.io,
            5,
        );
        assert.equal(await initialization.result, undefined, boundary);
        let settled = false;
        const ownership = initialization.settled().then(() => {
            settled = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(settled, false, boundary);
        release();
        await ownership;
        assert.equal(validateReadaheadRecord(records[0])?.outcome, 'unavailable');
    }
});

test('parent application association times out without delaying Close but restoration retains metadata ownership', async () => {
    const fake = fakeIo();
    let release = () => {};
    const metadata = fake.io.metadata;
    fake.io.metadata = async (file) => {
        if (file.startsWith('/proc/'))
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        return metadata(file);
    };
    const lease = createReadaheadLease('/chrome', 128, () => {}, fake.io, 5);
    await lease.admit();
    try {
        await assert.rejects(
            Promise.race([
                lease.verifyApplication(123),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('unbounded application observation')), 50),
                ),
            ]),
            /timeout/,
        );
    } catch (error) {
        release();
        throw error;
    }
    let restored = false;
    const restoration = lease.restore(true).then(() => {
        restored = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(restored, false);
    release();
    await restoration;
    assert.equal(fake.value(), 256);
});

test('rejected full-buffer reads charge actual bytes before limitation validation', async () => {
    const fake = fakeIo();
    fake.io.read = async () => ({ bytes: 4096, limitation: 'overlong' });
    const records: unknown[] = [];
    const lease = createReadaheadLease('/chrome', 128, (record) => records.push(record), fake.io);
    await assert.rejects(lease.admit());
    const record = validateReadaheadRecord(records[0]);
    assert.equal(record?.bytes, 4096);
    assert.equal(record?.reads, 1);
    assert.equal(record?.cost, 'complete');
    await lease.restore(true);
});

test('late observed bytes are explicitly pending until actual observer cost settles', async () => {
    const fake = fakeIo();
    const identity = await resolveReadaheadIdentity('/chrome', fake.io);
    let release = () => {};
    fake.io.read = async () => {
        await new Promise<void>((resolve) => {
            release = resolve;
        });
        return { bytes: 4096, limitation: 'overlong' };
    };
    const records: unknown[] = [];
    const observer = createReadaheadObserver(identity, (record) => records.push(record), fake.io, 128, 'gateway', 5);
    observer.terminal();
    await new Promise((resolve) => setTimeout(resolve, 15));
    const early = validateReadaheadRecord(records[0]);
    assert.equal(early?.cost, 'pending');
    assert.equal(early?.bytes, undefined, 'pending bytes must not masquerade as zero');
    release();
    await observer.settled();
    const cost = observer.cost();
    assert.equal(cost.bytes, 4096);
    assert.equal(cost.cost, 'complete');
});

test('gateway application observation is bounded while its actual metadata remains owned', async () => {
    const fake = fakeIo();
    const identity = await resolveReadaheadIdentity('/chrome', fake.io);
    let release = () => {};
    const metadata = fake.io.metadata;
    fake.io.metadata = async (file) => {
        await new Promise<void>((resolve) => {
            release = resolve;
        });
        return metadata(file);
    };
    const records: unknown[] = [];
    const observer = createReadaheadObserver(identity, (record) => records.push(record), fake.io, 128, 'gateway', 5);
    observer.observe({
        stage: 'spawn',
        event: 'decision',
        outcome: 'observed',
        reason: 'acquired',
        pid: 123,
        timestampMs: 1,
        durationMs: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const record = validateReadaheadRecord(records[0]);
    assert.equal(record?.phase, 'application');
    assert.equal(record?.outcome, 'unavailable');
    assert.equal(record?.cost, 'pending');
    let settled = false;
    const settlement = observer.settled().then(() => {
        settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    release();
    await settlement;
    assert.equal(observer.cost().cost, 'complete');
});

test('single launch and actual exit/resource barrier: missing proof keeps intervention pending', async () => {
    const fake = fakeIo();
    const records: unknown[] = [];
    const lease = createReadaheadLease('/chrome', 128, (record) => records.push(record), fake.io);
    await lease.admit();
    lease.launch();
    assert.throws(() => lease.launch(), /single/);
    await assert.rejects(lease.restore(false), /pending/);
    assert.equal(fake.value(), 128);
    await lease.restore(true);
    assert.equal(fake.value(), 256);
    assert.ok(records.every((record) => validateReadaheadRecord(record)));
});

test('terminal observer is asynchronous and overlapping cleanup invalidates a clean sample', async () => {
    const fake = fakeIo();
    const identity = await resolveReadaheadIdentity('/chrome', fake.io);
    const records: unknown[] = [];
    let release = () => {};
    const read = fake.io.read;
    fake.io.read = async (file) => {
        if (file.endsWith('/stat'))
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        return read(file);
    };
    const observer = createReadaheadObserver(identity, (record) => records.push(record), fake.io);
    observer.terminal();
    observer.cleanup();
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await observer.settled();
    const record = validateReadaheadRecord(records[0]);
    assert.equal(record?.outcome, 'overlapped');
    assert.ok((record?.endedMs ?? 0) >= (record?.startedMs ?? 0));
});

test('closed projection rejects private text, accessors, symbols and nonfinite counters', () => {
    const base = {
        kind: 'linux-readahead-study',
        phase: 'restore',
        outcome: 'pending',
        clock: 'parent',
        assignedKb: 128,
        startedMs: 1,
        endedMs: 2,
    };
    assert.ok(validateReadaheadRecord(base));
    let calls = 0;
    assert.equal(
        validateReadaheadRecord({
            ...base,
            phase: {
                toString() {
                    calls++;
                    return 'restore';
                },
            },
        }),
        undefined,
    );
    assert.equal(calls, 0);
    for (const record of [
        { ...base, path: '/PRIVATE' },
        { ...base, readsCompleted: Infinity },
        { ...base, startCalls: 2 },
        { ...base, cost: 'unbounded' },
        { ...base, cost: 'pending', bytes: 0 },
        { ...base, cost: 'complete' },
        { ...base, [Symbol()]: 1 },
        Object.defineProperty({ ...base }, 'originalKb', {
            get() {
                throw new Error('private');
            },
            enumerable: true,
        }),
    ])
        assert.equal(validateReadaheadRecord(record), undefined);
});
