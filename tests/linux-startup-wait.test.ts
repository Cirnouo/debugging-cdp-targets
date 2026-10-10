import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    type BoundedLinuxRead,
    createLinuxStartupWaitSampler,
    type LinuxStartupWaitRecord,
    readLinuxStartupFile,
    validateLinuxStartupWaitRecord,
} from './smoke/linux-startup-wait.ts';

const route = {
    entryId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    pid: 123,
};
const other = {
    ...route,
    connectionId: '44444444-4444-4444-8444-444444444444',
    sessionId: '55555555-5555-4555-8555-555555555555',
    pid: 456,
};
type Route = typeof route;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function stat(pid = 123, start = '900', user = '13', system = '7', major = '5', block = '9') {
    const fields = Array.from({ length: 40 }, () => '0');
    fields[0] = 'D';
    fields[9] = major;
    fields[11] = user;
    fields[12] = system;
    fields[19] = start;
    fields[39] = block;
    return `${pid} (private ) complex ( name) ${fields.join(' ')}\n`;
}
function bounded(text: string): BoundedLinuxRead {
    return { bytes: Buffer.byteLength(text), text };
}
function harness(
    read?: (file: string, signal: AbortSignal) => Promise<BoundedLinuxRead>,
    options: { enabled?: boolean; platform?: NodeJS.Platform } = {},
) {
    let time = 0;
    let nextTimer = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const records: LinuxStartupWaitRecord[] = [];
    const paths: string[] = [];
    const sampler = createLinuxStartupWaitSampler((record) => records.push(record), {
        enabled: options.enabled ?? true,
        platform: options.platform ?? 'linux',
        now: () => time,
        setTimer(callback, delay) {
            const id = ++nextTimer;
            timers.set(id, { at: time + delay, callback });
            return id;
        },
        clearTimer(id) {
            if (typeof id === 'number') timers.delete(id);
        },
        async read(file, signal) {
            paths.push(file);
            if (read) return read(file, signal);
            if (file.endsWith('/stat')) return bounded(stat(Number(file.split('/')[2])));
            if (file.endsWith('/wchan')) return bounded('futex_wait_queue_me\n');
            if (/^\/proc\/\d+\/io$/.test(file)) return bounded('read_bytes: 8192\nwrite_bytes: 4096\n');
            return bounded('some avg10=0.00 avg60=0.10 avg300=1.00 total=1234\n');
        },
    });
    function event(
        stage: string,
        kind: string,
        timestampMs: number,
        fields: Record<string, unknown> = {},
        identity: Route = route,
    ) {
        sampler.observe({
            ...identity,
            stage,
            event: kind,
            outcome: kind === 'begin' ? 'started' : kind === 'end' ? 'succeeded' : 'observed',
            timestampMs,
            durationMs: 0,
            ...fields,
        });
    }
    function snapshot(at: number, state = 'disk-sleep', identity: Route = route, start = 900) {
        event('native-snapshot', 'begin', at, {}, identity);
        event(
            'native-file',
            'decision',
            at + 1,
            {
                command: 'proc-stat',
                valid: true,
                rootStartTicks: start,
                rootProcessState: state,
            },
            identity,
        );
        event('native-snapshot', 'end', at + 2, { valid: true }, identity);
        event('native-snapshot', 'decision', at + 3, { valid: true }, identity);
    }
    return {
        ...sampler,
        event,
        snapshot,
        records,
        paths,
        advance(ms: number) {
            time += ms;
            for (const [id, timer] of timers) {
                if (timer.at <= time) {
                    timers.delete(id);
                    timer.callback();
                }
            }
        },
        timers,
    };
}

test('Linux startup wait sampler is available as a bounded fixture-only observer', async () => {
    const module = await import(new URL('./smoke/linux-startup-wait.ts', import.meta.url).href).catch(() => undefined);
    assert.equal(typeof module?.createLinuxStartupWaitSampler, 'function', 'Missing Linux startup wait sampler.');
    assert.equal(typeof module?.validateLinuxStartupWaitRecord, 'function', 'Missing closed sampler projection.');
});

test('only the same completed and successfully validated snapshot authorizes root reads', async () => {
    const h = harness();
    h.event('native-file', 'decision', 0, { command: 'proc-stat', valid: true, rootStartTicks: 900 });
    h.event('native-snapshot', 'decision', 1, { valid: true });
    h.event('native-snapshot', 'begin', 2);
    h.event('native-file', 'decision', 3, { command: 'proc-stat', valid: true, rootStartTicks: 900 });
    h.event('native-snapshot', 'end', 4, { valid: true });
    assert.equal(h.paths.length, 0, 'END success is still pre-validation evidence');
    h.event('native-snapshot', 'decision', 5, { valid: false });
    h.event('native-snapshot', 'begin', 6);
    h.event('native-snapshot', 'end', 7, { valid: true });
    h.event('native-snapshot', 'decision', 8, { valid: true });
    assert.equal(h.paths.length, 0, 'a previous proc-stat cannot leak into the next frame');
    h.snapshot(10);
    await tick();
    assert.equal(h.records.length, 1);
    assert.equal(h.records[0]?.trigger, 'baseline');
    assert.equal(h.records[0]?.outcome, 'sampled');
    assert.equal(h.records[0]?.wchan, 'futex');
    assert.deepEqual(h.paths, [
        '/proc/123/stat',
        '/proc/123/wchan',
        '/proc/123/io',
        '/proc/pressure/cpu',
        '/proc/pressure/memory',
        '/proc/pressure/io',
        '/proc/123/stat',
    ]);
});

test('nested, duplicate, failed and out-of-order snapshot frames never authorize a read', async () => {
    for (const fault of ['nested', 'duplicate-stat', 'failed-end', 'decision-before-end', 'reverse-time']) {
        const h = harness();
        h.event('native-snapshot', 'begin', 10);
        if (fault === 'nested') h.event('native-snapshot', 'begin', 11);
        h.event('native-file', 'decision', fault === 'reverse-time' ? 9 : 12, {
            command: 'proc-stat',
            valid: true,
            rootStartTicks: 900,
        });
        if (fault === 'duplicate-stat')
            h.event('native-file', 'decision', 13, {
                command: 'proc-stat',
                valid: true,
                rootStartTicks: 900,
            });
        if (fault === 'decision-before-end') h.event('native-snapshot', 'decision', 14, { valid: true });
        h.event('native-snapshot', 'end', 15, {
            valid: true,
            outcome: fault === 'failed-end' ? 'failed' : 'succeeded',
        });
        h.event('native-snapshot', 'decision', 16, { valid: true });
        await tick();
        assert.equal(h.paths.length, 0, fault);
    }
});

test('three overlapping snapshots stay quarantined until every END and validation decision drains', async () => {
    const h = harness();
    h.event('native-snapshot', 'begin', 0); // A
    h.event('native-snapshot', 'begin', 1); // B
    h.event('native-file', 'decision', 2, { command: 'proc-stat', valid: true, rootStartTicks: 900 }); // A
    h.event('native-snapshot', 'end', 3, { valid: true }); // A
    h.event('native-snapshot', 'begin', 4); // C while B remains outstanding
    h.event('native-file', 'decision', 5, { command: 'proc-stat', valid: true, rootStartTicks: 900 }); // B
    h.event('native-snapshot', 'end', 6, { valid: true }); // B
    h.event('native-snapshot', 'decision', 7, { valid: true }); // B
    assert.equal(h.paths.length, 0, 'C BEGIN must not authorize B completion');
    h.event('native-file', 'decision', 8, { command: 'proc-stat', valid: true, rootStartTicks: 900 }); // C
    h.event('native-snapshot', 'end', 9, { valid: true }); // C
    h.event('native-snapshot', 'decision', 10, { valid: true }); // delayed A
    h.event('native-snapshot', 'decision', 11, { valid: true }); // C
    assert.equal(h.paths.length, 0, 'the quarantined candidates stay discarded after drain');
    h.snapshot(20);
    await tick();
    assert.equal(h.records.length, 1);
    assert.equal(h.records[0]?.trigger, 'baseline');
});

test('draining overlapping ENDs does not clear delayed validation debt for the next BEGIN', async () => {
    const h = harness();
    h.event('native-snapshot', 'begin', 0); // A
    h.event('native-snapshot', 'begin', 1); // B
    h.event('native-snapshot', 'end', 2, { valid: true }); // A
    h.event('native-file', 'decision', 3, { command: 'proc-stat', valid: true, rootStartTicks: 900 }); // B
    h.event('native-snapshot', 'end', 4, { valid: true }); // B, native depth is now zero
    h.event('native-snapshot', 'begin', 5); // C, validation debt is still outstanding
    h.event('native-file', 'decision', 6, { command: 'proc-stat', valid: true, rootStartTicks: 900 }); // C
    h.event('native-snapshot', 'end', 7, { valid: true }); // C
    h.event('native-snapshot', 'decision', 8, { valid: true }); // delayed B
    assert.equal(h.paths.length, 0, 'B validation must not authorize C candidate');
    h.event('native-snapshot', 'decision', 9, { valid: true }); // delayed A
    h.event('native-snapshot', 'decision', 10, { valid: true }); // C
    h.snapshot(20);
    await tick();
    assert.equal(h.records.length, 1);
});

test('a missing validation followed by a new BEGIN cannot borrow the later frame candidate', async () => {
    const h = harness();
    h.event('native-snapshot', 'begin', 0); // A
    h.event('native-file', 'decision', 1, { command: 'proc-stat', valid: true, rootStartTicks: 900 });
    h.event('native-snapshot', 'end', 2, { valid: true }); // A
    h.event('native-snapshot', 'begin', 3); // B
    h.event('native-file', 'decision', 4, { command: 'proc-stat', valid: true, rootStartTicks: 900 });
    h.event('native-snapshot', 'end', 5, { valid: true }); // B
    h.event('native-snapshot', 'decision', 6, { valid: true }); // delayed A
    assert.equal(h.paths.length, 0);
    h.event('native-snapshot', 'decision', 7, { valid: true }); // B
    h.snapshot(10);
    await tick();
    assert.equal(h.records.length, 1);
});

test('failed overlapping snapshots add no validation debt and recovery still requires the other decision', async () => {
    const h = harness();
    h.event('native-snapshot', 'begin', 0); // A
    h.event('native-snapshot', 'begin', 1); // B
    h.event('native-snapshot', 'end', 2, { outcome: 'failed' }); // A has no validation decision
    h.event('native-file', 'decision', 3, { command: 'proc-stat', valid: true, rootStartTicks: 900 }); // B
    h.event('native-snapshot', 'end', 4, { valid: true }); // B
    h.event('native-snapshot', 'decision', 5, { valid: true }); // B
    assert.equal(h.paths.length, 0);
    h.snapshot(10);
    await tick();
    assert.equal(h.records.length, 1);
});

test('successful valid:false END retains validation debt until its failed identity decision arrives', async () => {
    const h = harness();
    h.event('native-snapshot', 'begin', 0); // A has no root, but still reaches validation.
    h.event('native-snapshot', 'end', 1, { valid: false });
    h.snapshot(2); // B must remain quarantined while A's validation is delayed.
    assert.equal(h.paths.length, 0);
    h.event('native-snapshot', 'decision', 6, { valid: false }); // delayed A drains the last debt.
    assert.equal(h.paths.length, 0);
    h.snapshot(10);
    await tick();
    assert.equal(h.records.length, 1);
});

test('contradictory failed END with valid metadata retains conservative validation debt', async () => {
    const h = harness();
    h.event('native-snapshot', 'begin', 0); // A
    h.event('native-snapshot', 'begin', 1); // B
    h.event('native-snapshot', 'end', 2, { outcome: 'failed', valid: true }); // contradictory A
    h.event('native-snapshot', 'end', 3, { valid: true }); // B
    h.event('native-snapshot', 'decision', 4, { valid: true }); // B
    h.snapshot(10); // C must not erase A's conservative debt.
    assert.equal(h.paths.length, 0);
    h.event('native-snapshot', 'decision', 14, { valid: false }); // A
    h.snapshot(20);
    await tick();
    assert.equal(h.records.length, 1);
});

test('a pinned root consumes rollback and listener slots without reads during snapshot ambiguity', async () => {
    const h = harness();
    h.snapshot(0);
    await tick();
    h.event('native-snapshot', 'begin', 10);
    h.event('native-snapshot', 'begin', 11);
    h.event('readiness', 'decision', 12, { phase: 'rollback-request' });
    h.event('listener-ownership', 'decision', 13, { reason: 'listener-owned' });
    assert.deepEqual(
        h.records.slice(1).map((record) => [record.trigger, record.outcome, record.limitations]),
        [
            ['rollback-request', 'skipped', ['snapshot-ambiguous']],
            ['first-owned-listener', 'skipped', ['snapshot-ambiguous']],
        ],
    );
    assert.equal(h.paths.length, 7);
});

test('health snapshots without validation stay unknown conservatively until a new session', async () => {
    const h = harness();
    h.snapshot(0);
    await tick();
    h.event('native-snapshot', 'begin', 10);
    h.event('native-file', 'decision', 11, { command: 'proc-stat', valid: true, rootStartTicks: 900 });
    h.event('native-snapshot', 'end', 12, { valid: true }); // Health emits no validation decision.
    h.event('readiness', 'decision', 13, { phase: 'rollback-request' });
    h.event('listener-ownership', 'decision', 14, { reason: 'listener-owned' });
    assert.deepEqual(
        h.records.slice(1).map((record) => record.limitations),
        [['snapshot-unvalidated'], ['snapshot-unvalidated']],
    );
    h.snapshot(200);
    h.snapshot(600);
    h.snapshot(1000);
    h.snapshot(1400);
    await tick();
    assert.equal(h.paths.length, 7, 'later frames cannot pay missing health validation debt');
    const successor = { ...route, sessionId: '77777777-7777-4777-8777-777777777777' };
    h.snapshot(1500, 'sleeping', successor);
    await tick();
    assert.equal(h.records[3]?.sessionId, successor.sessionId);
    assert.equal(h.records[3]?.trigger, 'baseline');
    assert.equal(h.paths.length, 14);
});

test('the four one-shot triggers consume their slots and continuous D needs repeated observations', async () => {
    const h = harness();
    h.snapshot(0);
    await tick();
    h.snapshot(500);
    await tick();
    h.snapshot(1000);
    await tick();
    h.event('listener-ownership', 'decision', 1004, { reason: 'listener-owned' });
    await tick();
    h.event('readiness', 'decision', 1005, { phase: 'rollback-request' });
    await tick();
    h.event('target-close', 'begin', 1006, { phase: 'rollback-request' });
    h.snapshot(1500);
    h.event('listener-ownership', 'decision', 1504, { reason: 'listener-owned' });
    await tick();
    assert.deepEqual(
        h.records.map((record) => record.trigger),
        ['baseline', 'continuous-d', 'first-owned-listener', 'rollback-request'],
    );
    assert.equal(h.paths.length, 28);
    assert.equal(h.timers.size, 0);
});

test('non-D, >500 ms gaps, failed identity and reversed time each reset the D span', async () => {
    for (const fault of ['non-D', 'gap', 'failed-validation', 'failed-end', 'unordered', 'missing-validation']) {
        const h = harness();
        h.snapshot(0);
        await tick();
        h.snapshot(500);
        if (fault === 'non-D') h.snapshot(600, 'sleeping');
        if (fault === 'failed-validation') {
            h.event('native-snapshot', 'begin', 600);
            h.event('native-snapshot', 'decision', 601, { valid: false });
        }
        if (fault === 'failed-end') {
            h.event('native-snapshot', 'begin', 600);
            h.event('native-snapshot', 'end', 601, { outcome: 'failed' });
        }
        if (fault === 'unordered') h.snapshot(400);
        if (fault === 'missing-validation') {
            h.event('native-snapshot', 'begin', 600);
            h.event('native-file', 'decision', 601, { command: 'proc-stat', valid: true, rootStartTicks: 900 });
            h.event('native-snapshot', 'end', 602, { valid: true });
        }
        h.snapshot(fault === 'gap' ? 1001 : 1000);
        await tick();
        assert.deepEqual(
            h.records.map((record) => record.trigger),
            ['baseline'],
            fault,
        );
    }
});

test('parallel routes pin their own identities and owned listeners require validated snapshot evidence', async () => {
    const h = harness();
    h.snapshot(0);
    h.snapshot(0, 'sleeping', other);
    await tick();
    h.event('listener-ownership', 'decision', 4, { reason: 'listener-owned' }, other);
    await tick();
    assert.deepEqual(
        h.records.map((record) => [record.connectionId, record.pid, record.trigger]),
        [
            [route.connectionId, 123, 'baseline'],
            [other.connectionId, 456, 'baseline'],
            [other.connectionId, 456, 'first-owned-listener'],
        ],
    );
    h.event('native-snapshot', 'begin', 5);
    h.event('listener-ownership', 'decision', 6, { reason: 'listener-owned' });
    await tick();
    assert.equal(h.records.length, 4);
    assert.deepEqual(h.records[3]?.limitations, ['snapshot-unvalidated']);
    assert.equal(h.records[3]?.reads, 0);
});

test('busy triggers are recorded and consumed without queueing and rollback observe never awaits I/O', async () => {
    let finish: (value: BoundedLinuxRead) => void = () => {};
    const h = harness(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    h.snapshot(0);
    h.event('listener-ownership', 'decision', 4, { reason: 'listener-owned' });
    const result = h.event('readiness', 'decision', 5, { phase: 'rollback-request' });
    assert.equal(result, undefined);
    assert.deepEqual(
        h.records.map((record) => [record.trigger, record.outcome, record.limitations]),
        [
            ['first-owned-listener', 'skipped', ['busy']],
            ['rollback-request', 'skipped', ['busy']],
        ],
    );
    assert.equal(h.paths.length, 1);
    h.advance(250);
    assert.ok(h.records.some((record) => record.limitations.includes('timeout')));
    finish(bounded(stat()));
    await tick();
    h.event('readiness', 'decision', 6, { phase: 'rollback-request' });
    assert.equal(h.paths.length, 1, 'timed-out reads never continue or replay');
});

test('a restarted session gets a fresh baseline and late old completion publishes only a stale limitation', async () => {
    let release: (value: BoundedLinuxRead) => void = () => {};
    let blocked = true;
    const h = harness(async (file) => {
        if (blocked)
            return new Promise((resolve) => {
                release = resolve;
            });
        return file.endsWith('/stat') ? bounded(stat(123, '901')) : bounded('');
    });
    h.snapshot(0);
    const successor = { ...route, sessionId: '66666666-6666-4666-8666-666666666666' };
    blocked = false;
    h.snapshot(10, 'sleeping', successor, 901);
    await tick();
    release(bounded(stat()));
    await tick();
    const old = h.records.find((record) => record.sessionId === route.sessionId);
    const current = h.records.find((record) => record.sessionId === successor.sessionId);
    assert.equal(old?.outcome, 'stale');
    assert.deepEqual(old?.limitations, ['stale-session']);
    assert.equal(old?.process, undefined);
    assert.equal(current?.trigger, 'baseline');
    h.snapshot(20);
    await tick();
    assert.equal(h.records.length, 2, 'retired sessions cannot replace the successor');
});

test('PID reuse or changed before/after start ticks discards all process metrics', async () => {
    for (const changeAt of [1, 7]) {
        let reads = 0;
        const h = harness(async (file) => {
            reads++;
            if (file.endsWith('/stat')) return bounded(stat(123, reads === changeAt ? '901' : '900'));
            return bounded('PRIVATE_RAW_ADDRESS 0x1234');
        });
        h.snapshot(0);
        await tick();
        assert.equal(h.records[0]?.process, undefined);
        assert.equal(h.records[0]?.wchan, undefined);
        assert.ok(h.records[0]?.limitations.includes('identity-mismatch'));
        assert.equal(h.paths.length, changeAt);
    }
});

test('read failures, overlong results and unknown content are closed limitations without raw data', async () => {
    let index = 0;
    const h = harness(async (file) => {
        index++;
        if (file.endsWith('/stat')) return bounded(stat());
        if (index === 2) return { bytes: 0, limitation: 'permission' };
        if (index === 3) return { bytes: 4096, text: 'PRIVATE'.repeat(1000) };
        if (index === 4) return { bytes: 0, limitation: 'missing' };
        if (index === 5) throw Object.assign(new Error('PRIVATE /home/user'), { code: 'EIO' });
        return bounded('PRIVATE unknown PSI');
    });
    h.snapshot(0);
    await tick();
    const record = h.records[0];
    assert.equal(record?.outcome, 'limited');
    for (const limit of ['permission', 'overlong', 'missing', 'read-failed', 'psi-unknown'] as const)
        assert.ok(record?.limitations.includes(limit), limit);
    assert.equal(record?.process?.readBytes, undefined);
    assert.doesNotMatch(JSON.stringify(h.records), /PRIVATE|home|0x/);
    assert.ok((record?.bytes ?? Infinity) <= 7 * 4096);
});

test('safe proc counter deltas retain tick units and decreasing or malformed counters stay unknown', async () => {
    let statReads = 0;
    const h = harness(async (file) => {
        if (file.endsWith('/stat')) {
            statReads++;
            return bounded(
                stat(123, '900', statReads === 1 ? '10' : '13', statReads === 1 ? '8' : '7', '9007199254740992', '-1'),
            );
        }
        if (file.endsWith('/wchan')) return bounded('arbitrary_private_wait_symbol');
        if (/^\/proc\/\d+\/io$/.test(file)) return bounded('read_bytes: 8192\nwrite_bytes: INVALID\n');
        return bounded(
            'some avg10=0.00 avg60=0.00 avg300=0.00 total=1234\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=50\n',
        );
    });
    h.snapshot(0);
    await tick();
    assert.deepEqual(h.records[0]?.process, { userTicks: 13, userTicksDelta: 3, readBytes: 8192 });
    assert.equal(h.records[0]?.wchan, 'unknown');
    assert.deepEqual(h.records[0]?.systemPsi, {
        scope: 'system',
        cpuSomeTotalUs: 1234,
        cpuFullTotalUs: 50,
        memorySomeTotalUs: 1234,
        memoryFullTotalUs: 50,
        ioSomeTotalUs: 1234,
        ioFullTotalUs: 50,
    });
    assert.ok(h.records[0]?.limitations.includes('counter-unknown'));
});

test('the 250 ms total budget stops continuation even when I/O resolves before the timer callback runs', async () => {
    let h: ReturnType<typeof harness>;
    h = harness(async () => {
        h.advance(251);
        return bounded(stat());
    });
    h.snapshot(0);
    await tick();
    assert.equal(h.paths.length, 1);
    assert.equal(h.records.length, 1);
    assert.deepEqual(h.records[0]?.limitations, ['timeout']);
    assert.equal(h.records[0]?.process, undefined);
});

test('the real bounded file reader caps bytes, conservatively rejects a full buffer and closes failures', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-linux-wait-'));
    try {
        const file = path.join(directory, 'fixed-fixture');
        await writeFile(file, 'PRIVATE'.repeat(2000));
        const result = await readLinuxStartupFile(file, new AbortController().signal);
        assert.deepEqual(result, { bytes: 4096, limitation: 'overlong' });
        await writeFile(file, 'futex_wait_queue_me\n');
        assert.deepEqual(await readLinuxStartupFile(file, new AbortController().signal), {
            bytes: 20,
            text: 'futex_wait_queue_me\n',
        });
        const aborted = new AbortController();
        aborted.abort();
        assert.deepEqual(await readLinuxStartupFile(file, aborted.signal), { bytes: 0, limitation: 'timeout' });
        assert.deepEqual(await readLinuxStartupFile(path.join(directory, 'absent'), new AbortController().signal), {
            bytes: 0,
            limitation: 'missing',
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('default-off and non-Linux observers perform zero reads, timers, clocks and input access', () => {
    for (const options of [{ enabled: false, platform: 'linux' }, { enabled: true, platform: 'darwin' }, {}] as const) {
        let work = 0;
        const sampler = createLinuxStartupWaitSampler(
            () => {
                work++;
            },
            {
                ...options,
                now: () => {
                    work++;
                    return 0;
                },
                read: async () => {
                    work++;
                    return bounded('');
                },
                setTimer: () => {
                    work++;
                    return 1;
                },
                clearTimer: () => {
                    work++;
                },
            },
        );
        sampler.observe(
            new Proxy(
                {},
                {
                    ownKeys() {
                        work++;
                        throw new Error('PRIVATE');
                    },
                },
            ),
        );
        assert.equal(work, 0);
    }
});

test('closed record validation rejects accessors and private extras and freezes detached metrics', async () => {
    const h = harness();
    h.snapshot(0);
    await tick();
    const record = h.records[0];
    assert.ok(record);
    const detached = validateLinuxStartupWaitRecord(record);
    assert.ok(detached);
    assert.notEqual(detached, record);
    assert.ok(Object.isFrozen(detached));
    assert.ok(Object.isFrozen(detached.process));
    assert.ok(Object.isFrozen(detached.systemPsi));
    assert.ok(Object.isFrozen(detached.limitations));
    assert.equal(validateLinuxStartupWaitRecord({ ...record, raw: 'PRIVATE' }), undefined);
    assert.equal(
        validateLinuxStartupWaitRecord({ ...record, process: { userTicks: Number.MAX_SAFE_INTEGER + 1 } }),
        undefined,
    );
    assert.equal(validateLinuxStartupWaitRecord({ ...record, outcome: 'stale', process: { userTicks: 1 } }), undefined);
    let accessed = 0;
    const hostile = Object.defineProperty({ ...record }, 'wchan', {
        enumerable: true,
        get() {
            accessed++;
            return 'futex';
        },
    });
    assert.equal(validateLinuxStartupWaitRecord(hostile), undefined);
    const hostileList = Object.defineProperty(['timeout'], '0', {
        get() {
            accessed++;
            return 'timeout';
        },
    });
    assert.equal(validateLinuxStartupWaitRecord({ ...record, limitations: hostileList }), undefined);
    assert.equal(accessed, 0);
    assert.equal(
        validateLinuxStartupWaitRecord(
            new Proxy(
                {},
                {
                    ownKeys() {
                        throw new Error('PRIVATE');
                    },
                },
            ),
        ),
        undefined,
    );
    assert.equal(validateLinuxStartupWaitRecord({ ...record, [Symbol('PRIVATE')]: 'PRIVATE' }), undefined);
    assert.equal(
        validateLinuxStartupWaitRecord({ ...record, process: { userTicks: 1, [Symbol('PRIVATE')]: 2 } }),
        undefined,
    );
    assert.equal(
        validateLinuxStartupWaitRecord({ ...record, limitations: Object.assign([], { private: 'PRIVATE' }) }),
        undefined,
    );
});

test('failed outcomes and error metadata cannot authorize otherwise valid snapshot fields', async () => {
    for (const part of ['candidate', 'end', 'validation', 'listener']) {
        for (const fault of [{ outcome: 'failed' }, { error: { name: 'Error', code: 'EIO' } }]) {
            const h = harness();
            h.event('native-snapshot', 'begin', 0);
            h.event('native-file', 'decision', 1, {
                command: 'proc-stat',
                valid: true,
                rootStartTicks: 900,
                ...(part === 'candidate' ? fault : {}),
            });
            h.event('native-snapshot', 'end', 2, { valid: true, ...(part === 'end' ? fault : {}) });
            h.event('native-snapshot', 'decision', 3, { valid: true, ...(part === 'validation' ? fault : {}) });
            await tick();
            h.event('listener-ownership', 'decision', 4, {
                reason: 'listener-owned',
                ...(part === 'listener' ? fault : {}),
            });
            await tick();
            assert.equal(h.records.length, part === 'listener' ? 1 : 0, `${part}: ${JSON.stringify(fault)}`);
        }
    }
});

test('decreasing counters across successful samples remain unknown for the pinned root', async () => {
    let generation = 0;
    const h = harness(async (file) => {
        if (file.endsWith('/stat')) return bounded(stat(123, '900', generation === 0 ? '20' : '10'));
        if (/^\/proc\/\d+\/io$/.test(file))
            return bounded(`read_bytes: ${generation === 0 ? '8192' : '4096'}\nwrite_bytes: 2048\n`);
        return bounded(`some avg10=0.00 avg60=0.00 avg300=0.00 total=${generation === 0 ? '1234' : '123'}\n`);
    });
    h.snapshot(0);
    await tick();
    generation = 1;
    h.event('listener-ownership', 'decision', 4, { reason: 'listener-owned' });
    await tick();
    assert.equal(h.records[0]?.process?.userTicks, 20);
    assert.equal(h.records[1]?.process?.userTicks, undefined);
    assert.equal(h.records[1]?.process?.userTicksDelta, undefined);
    assert.equal(h.records[1]?.process?.readBytes, undefined);
    assert.ok(h.records[1]?.limitations.includes('counter-unknown'));
    assert.equal(h.records[1]?.systemPsi, undefined);
    assert.ok(h.records[1]?.limitations.includes('psi-unknown'));
});

test('an unordered listener decision cannot consume the first-owned-listener trigger', async () => {
    const h = harness();
    h.snapshot(0);
    await tick();
    h.event('listener-ownership', 'decision', 2, { reason: 'listener-owned' });
    await tick();
    assert.equal(h.records.length, 1);
    h.snapshot(200);
    h.event('listener-ownership', 'decision', 204, { reason: 'listener-owned' });
    await tick();
    assert.equal(h.records[1]?.trigger, 'first-owned-listener');
});

test('deadline publication quarantines an unfinished filesystem read until its handle is closed', async () => {
    let finishRead: () => void = () => {};
    let closed = 0;
    const h = harness((file, signal) =>
        readLinuxStartupFile(file, signal, async () => ({
            async read(buffer) {
                await new Promise<void>((resolve) => {
                    finishRead = resolve;
                });
                buffer.write(stat());
                return { bytesRead: Buffer.byteLength(stat()) };
            },
            async close() {
                closed++;
            },
        })),
    );
    h.snapshot(0);
    await tick();
    h.advance(250);
    assert.equal(h.records[0]?.outcome, 'limited');
    assert.deepEqual(h.records[0]?.limitations, ['timeout']);
    h.event('readiness', 'decision', 4, { phase: 'rollback-request' });
    assert.deepEqual(h.records[1]?.limitations, ['busy']);
    assert.equal(closed, 0);
    finishRead();
    await tick();
    assert.equal(closed, 1);
    assert.equal(h.paths.length, 1);
    assert.equal(h.records.length, 2);
});

test('the bounded reader closes a handle whose open or read completes after cancellation', async () => {
    for (const stage of ['open', 'read', 'read-reject', 'close-reject']) {
        const controller = new AbortController();
        let closed = 0;
        let reads = 0;
        const result = await readLinuxStartupFile('/fixed-test-only-file', controller.signal, async () => {
            if (stage === 'open') controller.abort();
            return {
                async read(buffer, offset, length, position) {
                    reads++;
                    assert.equal(buffer.byteLength, 4096);
                    assert.deepEqual([offset, length, position], [0, 4096, 0]);
                    if (stage !== 'close-reject') controller.abort();
                    if (stage === 'read-reject') throw new Error('PRIVATE');
                    buffer.write('x');
                    return { bytesRead: 1 };
                },
                async close() {
                    closed++;
                    if (stage === 'close-reject') throw new Error('PRIVATE');
                },
            };
        });
        assert.equal(closed, 1, stage);
        assert.equal(reads, stage === 'open' ? 0 : 1, stage);
        assert.equal(result.text, undefined);
        assert.equal(result.limitation, stage === 'close-reject' ? 'read-failed' : 'timeout');
    }
});

test('sampler completion sink exceptions never become unhandled rejections or block later triggers', async () => {
    let calls = 0;
    const sampler = createLinuxStartupWaitSampler(
        () => {
            calls++;
            throw new Error('PRIVATE');
        },
        {
            enabled: true,
            platform: 'linux',
            read: async (file) => (file.endsWith('/stat') ? bounded(stat()) : bounded('')),
        },
    );
    const event = (stage: string, kind: string, at: number, fields = {}) =>
        sampler.observe({
            ...route,
            stage,
            event: kind,
            timestampMs: at,
            durationMs: 0,
            outcome: kind === 'begin' ? 'started' : kind === 'end' ? 'succeeded' : 'observed',
            ...fields,
        });
    event('native-snapshot', 'begin', 0);
    event('native-file', 'decision', 1, { command: 'proc-stat', valid: true, rootStartTicks: 900 });
    event('native-snapshot', 'end', 2, { valid: true });
    event('native-snapshot', 'decision', 3, { valid: true });
    await tick();
    event('readiness', 'decision', 4, { phase: 'rollback-request' });
    await tick();
    assert.equal(calls, 2);
});

test('a pending rollback diagnostic has no referenced deadline timer that keeps the child alive', () => {
    const moduleUrl = new URL('./smoke/linux-startup-wait.ts', import.meta.url).href;
    const child = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
        import { createLinuxStartupWaitSampler } from ${JSON.stringify(moduleUrl)};
        const sampler = createLinuxStartupWaitSampler(() => {}, {
            enabled: true, platform: 'linux', read: () => new Promise(() => {}),
        });
        const route = ${JSON.stringify(route)};
        function event(stage, event, timestampMs, fields) {
            sampler.observe({ ...route, stage, event, timestampMs, durationMs: 0,
                outcome: event === 'begin' ? 'started' : event === 'end' ? 'succeeded' : 'observed', ...fields });
        }
        event('native-snapshot', 'begin', 0, {});
        event('native-file', 'decision', 1, { command: 'proc-stat', valid: true, rootStartTicks: 900 });
        event('native-snapshot', 'end', 2, { valid: true });
        event('native-snapshot', 'decision', 3, { valid: true });
        event('readiness', 'decision', 4, { phase: 'rollback-request' });
        console.log(JSON.stringify(process.getActiveResourcesInfo()));
    `,
        ],
        { encoding: 'utf8', timeout: 2000 },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.error, undefined);
    const resources: unknown = JSON.parse(child.stdout);
    assert.ok(Array.isArray(resources));
    assert.equal(resources.includes('Timeout'), false, 'only unreferenced deadline timers may remain');
});
