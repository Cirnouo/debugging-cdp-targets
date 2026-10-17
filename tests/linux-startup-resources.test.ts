import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { validateLinuxStartupWaitRecord } from './smoke/linux-startup-wait.ts';

const record = {
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
};

test('closed wait projection accepts optional resource evidence and rejects raw content', () => {
    const resources = { kernel: 'page-wait', storage: 'unavailable', cgroup: 'unavailable' };
    assert.deepEqual(validateLinuxStartupWaitRecord({ ...record, resources })?.resources, resources);
    for (const hostile of [
        { ...resources, stack: 'private' },
        { ...resources, readMs: -1 },
        { ...resources, readMs: Number.MAX_SAFE_INTEGER + 1 },
        Object.defineProperty({ ...resources }, 'readMs', {
            enumerable: true,
            get() {
                throw Error('private');
            },
        }),
    ]) {
        assert.equal(validateLinuxStartupWaitRecord({ ...record, resources: hostile }), undefined);
    }
});

// These literal cases catch substring-based classification and treating a bare page wait as a fault.
test('kernel frames classify exact call paths without exporting raw stack', async () => {
    const module = await import('./smoke/linux-startup-resources.ts');
    for (const [frame, want] of [
        ['filemap_fault', 'filemap-fault'],
        ['filemap_read', 'buffered-read'],
        ['folio_wait_writeback', 'writeback'],
        ['balance_dirty_pages', 'dirty-throttling'],
        ['folio_wait_bit_common', 'page-wait'],
        ['fake_filemap_fault', 'other'],
        ['filemap_fault_extra', 'other'],
    ] as const) {
        assert.equal(module.classifyKernelStack(`[<deadbeef>] ${frame}+0x1/0x20\n`), want);
    }
    assert.equal(module.classifyKernelStack('private arbitrary symbols'), 'unavailable');
});

test('resource I/O binds partition counters to parent queue and visible cgroup limits', async () => {
    const { collectLinuxStartupResources } = await import('./smoke/linux-startup-resources.ts');
    const files: Record<string, string> = {
        '/sys/devices/pci/block/sda/sda1/partition': '1\n',
        '/sys/devices/pci/block/sda/dev': '8:0\n',
        '/sys/devices/pci/block/sda/sda1/stat': '12 0 24 6 7 0 9 8 2 10 11\n',
        '/sys/devices/pci/block/sda/queue/read_ahead_kb': '128\n',
        '/sys/devices/pci/block/sda/queue/rotational': '0\n',
        '/proc/123/cgroup': '0::/tenant/job\n',
        '/proc/self/mountinfo': '29 23 0:28 /tenant /sys/fs/cgroup rw - cgroup2 cgroup rw\n',
        '/sys/fs/cgroup/job/memory.stat': 'workingset_refault_file 22\npgscan 30\npgsteal 25\n',
        '/sys/fs/cgroup/job/memory.events': 'high 2\nmax 1\n',
        '/sys/fs/cgroup/job/cpu.stat': 'nr_throttled 4\nthrottled_usec 80\n',
        '/sys/fs/cgroup/job/memory.high': 'max\n',
        '/sys/fs/cgroup/job/memory.max': '4294967296\n',
        '/sys/fs/cgroup/job/cpu.max': '200000 100000\n',
    };
    const evidence = await collectLinuxStartupResources(
        123,
        new AbortController().signal,
        async (file) => files[file],
        {
            statDevice: async () => 2049n,
            realpath: async () => '/sys/devices/pci/block/sda/sda1',
            stack: async () => ({ bytes: 45, text: '[<deadbeef>] folio_wait_bit_common+0x1/0x20\n' }),
        },
    );
    assert.equal(evidence.storage, 'partition');
    assert.equal(evidence.major, 8);
    assert.equal(evidence.minor, 1);
    assert.equal(evidence.queueMinor, 0);
    assert.equal(evidence.readsCompleted, 12);
    assert.equal(evidence.readAheadKb, 128);
    assert.equal(evidence.fileRefault, 22);
    assert.equal(evidence.memoryMax, 4294967296);
    assert.equal(evidence.cpuQuota, 200000);
    assert.equal(evidence.memoryHighLimit, 'max');
    assert.equal(evidence.cgroup, 'visible-leaf-only');
    assert.doesNotMatch(JSON.stringify(evidence), /tenant|devices|deadbeef|folio/);
});

test('unsafe cgroups, overlay and changed device identity cannot authorize resource attribution', async () => {
    const { collectLinuxStartupResources } = await import('./smoke/linux-startup-resources.ts');
    for (const membership of ['0::/../private\n', '0::/x\n0::/y\n', '1:cpu:/x\n']) {
        const paths: string[] = [];
        const result = await collectLinuxStartupResources(
            123,
            new AbortController().signal,
            async (file) => {
                paths.push(file);
                return file.endsWith('/cgroup') ? membership : '29 23 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n';
            },
            { statDevice: async () => 42n, stack: async () => ({ bytes: 0, limitation: 'permission' }) },
        );
        assert.deepEqual(result, { kernel: 'unavailable', storage: 'unavailable', cgroup: 'unavailable' });
        assert.deepEqual(paths, ['/proc/123/cgroup', '/proc/self/mountinfo']);
    }
});

test('closed resource projection never invokes coercion hooks or admits impossible scope fields', () => {
    let calls = 0;
    const hostile = {
        toString() {
            calls++;
            return 'unavailable';
        },
    };
    assert.equal(
        validateLinuxStartupWaitRecord({
            ...record,
            resources: { kernel: 'other', storage: hostile, cgroup: 'unavailable' },
        }),
        undefined,
    );
    assert.equal(calls, 0);
    assert.equal(
        validateLinuxStartupWaitRecord({
            ...record,
            resources: { kernel: 'other', storage: 'unavailable', cgroup: 'unavailable', major: 8 },
        }),
        undefined,
    );
});

test('changed device identity, malformed sysfs and duplicate cgroup counters stay unavailable', async () => {
    const { collectLinuxStartupResources } = await import('./smoke/linux-startup-resources.ts');
    for (const changed of [true, false]) {
        let devices = 0;
        const evidence = await collectLinuxStartupResources(
            123,
            new AbortController().signal,
            async (file) => {
                if (file.endsWith('/partition')) return undefined;
                if (file.endsWith('/dev')) return '8:0\n';
                if (file.endsWith('/stat') && file.startsWith('/sys/devices'))
                    return changed ? '12 0 24 6 7 0 9 8 2 10 11\n' : '12 0 24 -6 7 0 9 8 2 10 11\n';
                if (file.endsWith('/read_ahead_kb')) return '128\n';
                if (file.endsWith('/rotational')) return '0\n';
                if (file.endsWith('/cgroup')) return '0::/job\n';
                if (file.endsWith('/mountinfo')) return '29 23 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n';
                if (file.endsWith('/memory.stat')) return 'pgscan 3\npgscan 99\n';
                if (file.endsWith('/memory.events')) return 'high 2\nmax 1\n';
                if (file.endsWith('/cpu.stat')) return 'nr_throttled 9007199254740992\n';
                return undefined;
            },
            {
                statDevice: async () => (++devices === 1 ? 2048n : 2049n),
                realpath: async () => '/sys/devices/pci/block/sda',
                stack: async () => ({ bytes: 0, limitation: 'missing' }),
            },
        );
        assert.equal(evidence.storage, 'unavailable');
        assert.equal(evidence.readMs, undefined);
        assert.equal(evidence.memoryCounters, 'unavailable');
        assert.equal(evidence.pgscan, undefined);
        assert.equal(evidence.cpuCounters, 'unavailable');
        assert.equal(evidence.nrThrottled, undefined);
        assert.equal(evidence.memoryMaxLimit, 'unavailable');
    }
});

test('fixed stack helper bounds output and retains ownership until actual helper close after abort', async (t) => {
    const { readPrivilegedKernelStack } = await import('./smoke/linux-startup-resources.ts');
    const child = new childProcess.ChildProcess();
    const stdout = new PassThrough();
    child.stdout = stdout;
    const launches: unknown[][] = [];
    const signals: unknown[] = [];
    child.kill = (signal) => {
        signals.push(signal);
        return true;
    };
    t.mock.method(childProcess, 'spawn', (...args: unknown[]) => {
        launches.push(args);
        return child;
    });
    syncBuiltinESMExports();
    t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
        stdout.destroy();
    });
    assert.deepEqual(await readPrivilegedKernelStack(0, new AbortController().signal), {
        bytes: 0,
        limitation: 'read-failed',
    });
    assert.equal(launches.length, 0);
    const controller = new AbortController();
    let settled = false;
    const pending = readPrivilegedKernelStack(123, controller.signal).then((value) => {
        settled = true;
        return value;
    });
    assert.deepEqual(launches, [
        [
            '/usr/bin/sudo',
            ['-n', '/usr/bin/cat', '/proc/123/stack'],
            { shell: false, stdio: ['ignore', 'pipe', 'ignore'] },
        ],
    ]);
    stdout.write(Buffer.alloc(5000, 'x'));
    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.deepEqual(signals, ['SIGTERM', 'SIGTERM']);
    child.emit('close', null);
    assert.deepEqual(await pending, { bytes: 4096, limitation: 'timeout' });
});

test('opaque compiler-suffixed stack frames do not erase an exact recognized frame', async () => {
    const { classifyKernelStack } = await import('./smoke/linux-startup-resources.ts');
    assert.equal(
        classifyKernelStack(
            '[<00000000>] folio_wait_bit_common+0x1/0x20\n[<00000000>] schedule.isra.3+0x2/0x30\n[<00000000>] filemap_fault+0x3/0x40\n',
        ),
        'filemap-fault',
    );
    assert.equal(classifyKernelStack('[<00000000>] filemap_fault.constprop.2+0x3/0x40\n'), 'other');
});

test('visible io.max projects only the identity-bound parent queue device and preserves max states', async () => {
    const { collectLinuxStartupResources } = await import('./smoke/linux-startup-resources.ts');
    const evidence = await collectLinuxStartupResources(
        123,
        new AbortController().signal,
        async (file) => {
            if (file.endsWith('/partition')) return '1\n';
            if (file.endsWith('/dev')) return '8:0\n';
            if (file.endsWith('/stat') && file.startsWith('/sys/devices')) return '12 0 24 6 7 0 9 8 2 10 11\n';
            if (file.endsWith('/read_ahead_kb')) return '128\n';
            if (file.endsWith('/rotational')) return '0\n';
            if (file.endsWith('/cgroup')) return '0::/job\n';
            if (file.endsWith('/mountinfo')) return '29 23 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n';
            if (file.endsWith('/io.max'))
                return '8:16 rbps=9 wbps=9 riops=9 wiops=9\n8:0 rbps=1048576 wbps=max riops=50 wiops=max\n';
            return undefined;
        },
        {
            statDevice: async () => 2049n,
            realpath: async () => '/sys/devices/pci/block/sda/sda1',
            stack: async () => ({ bytes: 0, limitation: 'permission' }),
        },
    );
    assert.equal(evidence.ioMax, 'configured');
    assert.equal(evidence.ioLimitScope, 'visible-leaf-queue-device');
    assert.equal(evidence.readBps, 1048576);
    assert.equal(evidence.readIops, 50);
    assert.equal(evidence.writeBpsLimit, 'max');
    assert.equal(evidence.writeBps, undefined);
});

test('io.max projection rejects contradictory limit records before serialization', () => {
    const resources = {
        kernel: 'other',
        storage: 'unavailable',
        cgroup: 'visible-leaf-only',
        ioMax: 'unavailable',
        ioLimitScope: 'visible-leaf-queue-device',
        readBps: 100,
        readBpsLimit: 'finite',
    };
    assert.equal(validateLinuxStartupWaitRecord({ ...record, resources }), undefined);
    assert.equal(
        validateLinuxStartupWaitRecord({
            ...record,
            resources: {
                kernel: 'other',
                storage: 'unavailable',
                cgroup: 'visible-leaf-only',
                memoryHighLimit: 'max',
                memoryHigh: 5,
            },
        }),
        undefined,
    );
});

test('io.max malformed, duplicate, absent and unmapped observations have closed distinct outcomes', async () => {
    const { collectLinuxStartupResources } = await import('./smoke/linux-startup-resources.ts');
    for (const [text, dev, want] of [
        [undefined, 2048n, 'unavailable'],
        ['', 2048n, 'no-visible-entry'],
        ['8:16 rbps=max wbps=max riops=max wiops=max\n', 2048n, 'no-visible-entry'],
        ['8:0 rbps=-1 wbps=max riops=max wiops=max\n', 2048n, 'unavailable'],
        ['8:0 rbps=1 rbps=2 riops=max wiops=max\n', 2048n, 'unavailable'],
        ['8:0 rbps=1 wbps=max riops=max wiops=max\n8:0 rbps=2 wbps=max riops=max wiops=max\n', 2048n, 'unavailable'],
        ['8:0 rbps=max wbps=max riops=max wiops=max\n', 42n, 'device-unmapped'],
    ] as const) {
        const evidence = await collectLinuxStartupResources(
            123,
            new AbortController().signal,
            async (file) => {
                if (file.endsWith('/partition')) return undefined;
                if (file.endsWith('/dev')) return '8:0\n';
                if (file.endsWith('/stat') && file.startsWith('/sys/devices')) return '12 0 24 6 7 0 9 8 2 10 11\n';
                if (file.endsWith('/read_ahead_kb')) return '128\n';
                if (file.endsWith('/rotational')) return '0\n';
                if (file.endsWith('/cgroup')) return '0::/job\n';
                if (file.endsWith('/mountinfo')) return '29 23 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n';
                if (file.endsWith('/io.max')) return text;
                return undefined;
            },
            {
                statDevice: async () => dev,
                realpath: async () => '/sys/devices/pci/block/sda',
                stack: async () => ({ bytes: 0, limitation: 'permission' }),
            },
        );
        assert.equal(evidence.ioMax, want);
        assert.equal(evidence.readBps, undefined);
        assert.equal(evidence.ioLimitScope, 'visible-leaf-queue-device');
    }
});

test('absent privileged helper reports a safe missing limitation without raw error content', async (t) => {
    const { readPrivilegedKernelStack } = await import('./smoke/linux-startup-resources.ts');
    const child = new childProcess.ChildProcess();
    const stdout = new PassThrough();
    child.stdout = stdout;
    t.mock.method(childProcess, 'spawn', () => child);
    syncBuiltinESMExports();
    t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
        stdout.destroy();
    });
    const pending = readPrivilegedKernelStack(123, new AbortController().signal);
    child.emit('error', Object.assign(new Error('PRIVATE /personal/path'), { code: 'ENOENT' }));
    child.emit('close', -2);
    assert.deepEqual(await pending, { bytes: 0, limitation: 'missing' });
});

test('malformed or ambiguous mountinfo never authorizes cgroup file reads', async () => {
    const { collectLinuxStartupResources } = await import('./smoke/linux-startup-resources.ts');
    for (const mount of [
        'a b c / /sys/fs/cgroup rw - cgroup2 cgroup rw\n',
        '29 23 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n30 23 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n',
    ]) {
        const paths: string[] = [];
        const result = await collectLinuxStartupResources(
            123,
            new AbortController().signal,
            async (file) => {
                paths.push(file);
                return file.endsWith('/cgroup') ? '0::/job\n' : mount;
            },
            { statDevice: async () => 42n, stack: async () => ({ bytes: 0, limitation: 'permission' }) },
        );
        assert.equal(result.cgroup, 'unavailable');
        assert.deepEqual(paths, ['/proc/123/cgroup', '/proc/self/mountinfo']);
    }
});

// Requested-metric support, rather than successful generic-file parsing, defines availability.
test('requested cgroup counters remain explicitly unavailable when disabled or partial', async () => {
    const { collectLinuxStartupResources } = await import('./smoke/linux-startup-resources.ts');
    for (const fixture of [
        {
            cpu: 'usage_usec 9\nuser_usec 4\nsystem_usec 5\n',
            memory: 'anon 1\n',
            events: 'low 0\n',
            wantCpu: 'unavailable',
            wantMemory: 'unavailable',
            wantNr: undefined,
            wantUs: undefined,
        },
        {
            cpu: 'nr_throttled 2\n',
            memory: 'workingset_refault_file 7\npgscan 8\npgsteal 6\n',
            events: 'high 1\n',
            wantCpu: 'unavailable',
            wantMemory: 'unavailable',
            wantNr: 2,
            wantUs: undefined,
        },
        {
            cpu: 'nr_throttled 2\nthrottled_usec 30\n',
            memory: 'workingset_refault_file 7\npgscan 8\npgsteal 6\n',
            events: 'high 1\nmax 0\n',
            wantCpu: 'available',
            wantMemory: 'available',
            wantNr: 2,
            wantUs: 30,
        },
    ] as const) {
        const evidence = await collectLinuxStartupResources(
            123,
            new AbortController().signal,
            async (file) => {
                if (file === '/proc/123/cgroup') return '0::/job\n';
                if (file === '/proc/self/mountinfo') return '29 23 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n';
                if (file.endsWith('/cpu.stat')) return fixture.cpu;
                if (file.endsWith('/memory.stat')) return fixture.memory;
                if (file.endsWith('/memory.events')) return fixture.events;
                return undefined;
            },
            { statDevice: async () => 42n, stack: async () => ({ bytes: 0, limitation: 'permission' }) },
        );
        assert.equal(evidence.cpuCounters, fixture.wantCpu);
        assert.equal(evidence.memoryCounters, fixture.wantMemory);
        assert.equal(evidence.nrThrottled, fixture.wantNr);
        assert.equal(evidence.throttledUs, fixture.wantUs);
        if (fixture.wantMemory === 'unavailable') assert.equal(evidence.memoryMaxEvents, undefined);
        assert.ok(validateLinuxStartupWaitRecord({ ...record, resources: evidence }));
    }
});

test('closed projection requires availability to agree with the complete requested counter set', () => {
    const base = { kernel: 'other', storage: 'unavailable', cgroup: 'visible-leaf-only' };
    const cpu = { nrThrottled: 0, throttledUs: 0 };
    const memory = { fileRefault: 0, pgscan: 0, pgsteal: 0, memoryHighEvents: 0, memoryMaxEvents: 0 };
    for (const [status, counters] of [
        ['cpuCounters', cpu],
        ['memoryCounters', memory],
    ] as const) {
        assert.ok(
            validateLinuxStartupWaitRecord({ ...record, resources: { ...base, ...counters, [status]: 'available' } }),
        );
        assert.equal(
            validateLinuxStartupWaitRecord({ ...record, resources: { ...base, ...counters, [status]: 'unavailable' } }),
            undefined,
        );
        for (const missing of Object.keys(counters)) {
            const partial = Object.fromEntries(Object.entries(counters).filter(([key]) => key !== missing));
            assert.equal(
                validateLinuxStartupWaitRecord({
                    ...record,
                    resources: { ...base, ...partial, [status]: 'available' },
                }),
                undefined,
            );
            assert.ok(
                validateLinuxStartupWaitRecord({
                    ...record,
                    resources: { ...base, ...partial, [status]: 'unavailable' },
                }),
            );
        }
    }
});

test('closed io.max absence and unmapped states require matching device attribution and scope', () => {
    const base = { kernel: 'other', cgroup: 'visible-leaf-only' };
    const mapped = {
        storage: 'device',
        major: 8,
        minor: 0,
        queueMajor: 8,
        queueMinor: 0,
        readsCompleted: 12,
        sectorsRead: 24,
        readMs: 6,
        writesCompleted: 7,
        writeMs: 8,
        inFlight: 2,
        ioMs: 10,
        weightedIoMs: 11,
        readAheadKb: 128,
        rotational: 0,
    };
    const scope = { ioLimitScope: 'visible-leaf-queue-device' };
    for (const fields of [
        { storage: 'unavailable', ...scope, ioMax: 'no-visible-entry' },
        { ...mapped, ...scope, ioMax: 'device-unmapped' },
        { ...mapped, ioMax: 'no-visible-entry' },
    ])
        assert.equal(validateLinuxStartupWaitRecord({ ...record, resources: { ...base, ...fields } }), undefined);
    assert.ok(
        validateLinuxStartupWaitRecord({
            ...record,
            resources: { ...base, ...mapped, ...scope, ioMax: 'no-visible-entry' },
        }),
    );
    assert.ok(
        validateLinuxStartupWaitRecord({
            ...record,
            resources: { ...base, storage: 'unavailable', ...scope, ioMax: 'device-unmapped' },
        }),
    );
});

test('partial requested counters require explicit unavailable status while complete optional status remains compatible', () => {
    const base = { kernel: 'other', storage: 'unavailable', cgroup: 'visible-leaf-only' };
    assert.equal(validateLinuxStartupWaitRecord({ ...record, resources: { ...base, nrThrottled: 1 } }), undefined);
    assert.equal(validateLinuxStartupWaitRecord({ ...record, resources: { ...base, pgscan: 1 } }), undefined);
    assert.ok(validateLinuxStartupWaitRecord({ ...record, resources: { ...base, nrThrottled: 1, throttledUs: 2 } }));
    assert.ok(validateLinuxStartupWaitRecord({ ...record, resources: base }));
});
