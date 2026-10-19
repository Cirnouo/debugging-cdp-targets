import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { prepareAppParentExit } from '../src/adapters/app-parent-exit.ts';
import {
    type AppParentHelper,
    type AppParentWatchIO,
    inspectCurrentAppParentIdentity,
    watchAppParentExit,
} from '../src/adapters/app-parent-watch.ts';

const parent = { processId: 503, startedAtUtc: '2026-10-17T06:12:00.0000000Z', executablePath: '/owned/App' };
const ready = { event: 'parent-ready-v1', ...parent };
const absent = { event: 'parent-absent-v1', ...parent, processAbsent: true };
const exited = { event: 'parent-exited-v1', ...parent, processExited: true, waitResult: 0, waitError: 0, exitCode: 37 };

function deferred<T>() {
    return Promise.withResolvers<T>();
}

test('Unix terminal proof has no claimed exit status and Windows preserves a nonzero actual status', async () => {
    for (const [method, terminal] of [
        ['unix-absence', absent],
        ['windows-handle', exited],
    ] as const) {
        const observer = await prepareAppParentExit(parent, async () => ({
            method,
            ready: Promise.resolve(ready),
            exited: Promise.resolve(terminal),
            dispose: async () => {},
        }));
        await observer.ready;
        await observer.exited;
        await observer.dispose();
    }
});

test('crossed methods and any claimed Unix status reject terminal proof', async () => {
    for (const [method, terminal] of [
        ['unix-absence', exited],
        ['windows-handle', absent],
        ['unix-absence', { ...absent, exitCode: 0 }],
        ['unix-absence', { ...absent, waitResult: 0 }],
        ['unix-absence', { ...absent, waitError: 0 }],
        ['unix-absence', { ...absent, processId: 504 }],
        ['windows-handle', { ...exited, exitCode: undefined }],
    ] as const) {
        const observer = await prepareAppParentExit(parent, async () => ({
            method,
            ready: Promise.resolve(ready),
            exited: Promise.resolve(terminal),
            dispose: async () => {},
        }));
        await observer.ready;
        await assert.rejects(observer.exited);
    }
});

test('terminal before readiness and disposed pending observation cannot authorize restart', async () => {
    const waiting = deferred<unknown>();
    const observer = await prepareAppParentExit(parent, async () => ({
        method: 'windows-handle',
        ready: waiting.promise,
        exited: Promise.resolve(exited),
        dispose: async () => {},
    }));
    await assert.rejects(observer.exited);
    waiting.resolve(ready);
    await assert.rejects(observer.ready);
    const pending = await prepareAppParentExit(parent, async () => ({
        method: 'unix-absence',
        ready: new Promise(() => {}),
        exited: new Promise(() => {}),
        dispose: async () => {},
    }));
    await pending.dispose();
    await assert.rejects(pending.ready);
    await assert.rejects(pending.exited);
});

const ownPid = 713;
const linuxParent = { processId: 503, startedAtUtc: '2023-11-14T22:13:20.123000000Z', executablePath: '/owned/App' };

function stat(pid: number, ticks: string, state = 'S') {
    // /proc stat: comm can contain spaces and ')' characters; starttime is field 22.
    return `${pid} (App ) name) ${state} ${pid === ownPid ? 503 : 1} ${'0 '.repeat(17)}${ticks} 0\n`;
}

function linuxIO() {
    const reads: string[] = [];
    const pauses: Array<() => void> = [];
    let stage = 0;
    let birth = '123';
    let state = 'S';
    let uid = '1000';
    let executable = '/owned/App';
    let statError: string | undefined;
    let exeError: string | undefined;
    let selfError = false;
    let parentPid = 503;
    const missing = (code: string) => Object.assign(new Error('controlled native read failure'), { code });
    const io: AppParentWatchIO = {
        platform: 'linux',
        processId: () => ownPid,
        parentProcessId: () => parentPid,
        windowsDirectory: () => undefined,
        account: () => ({ real: 1000, effective: 1000 }),
        readText: async (file) => {
            reads.push(file);
            if (file === '/proc/stat') return 'cpu 0\nbtime 1700000000\n';
            if (file === `/proc/${ownPid}/stat` || file === '/proc/self/stat') {
                if (selfError) throw missing('EACCES');
                return stat(ownPid, '122');
            }
            if (file === `/proc/${ownPid}/status`) return 'Uid:\t1000\t1000\t1000\t1000\n';
            if (file === '/proc/503/stat') {
                if (statError) throw missing(statError);
                return stat(503, birth, state);
            }
            if (file === '/proc/503/status') return `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\n`;
            throw new Error(`Unexpected path: ${file}`);
        },
        readLink: async (file) => {
            reads.push(file);
            assert.equal(file, '/proc/503/exe');
            if (exeError) throw missing(exeError);
            return executable;
        },
        openHelper: () => {
            throw new Error('Linux parent polling must not start a platform helper.');
        },
        clockTicks: async () => '1000',
        pause: async (milliseconds, signal) => {
            assert.equal(milliseconds, 100);
            await new Promise<void>((resolve, reject) => {
                const abort = () => reject(new Error('cancelled pause'));
                signal.addEventListener('abort', abort, { once: true });
                pauses.push(() => {
                    signal.removeEventListener('abort', abort);
                    stage++;
                    resolve();
                });
            });
        },
    };
    return {
        io,
        reads,
        pauses,
        advance: () => {
            const next = pauses.shift();
            assert.ok(next);
            next();
        },
        set: (change: {
            birth?: string;
            state?: string;
            uid?: string;
            executable?: string;
            statError?: string;
            exeError?: string;
            selfError?: boolean;
            parentPid?: number;
        }) => {
            birth = change.birth ?? birth;
            state = change.state ?? state;
            uid = change.uid ?? uid;
            executable = change.executable ?? executable;
            statError = change.statError ?? statError;
            exeError = change.exeError ?? exeError;
            selfError = change.selfError ?? selfError;
            parentPid = change.parentPid ?? parentPid;
        },
        stage: () => stage,
    };
}

async function until(predicate: () => boolean) {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail('Controlled I/O did not reach the expected pending state.');
}

test('Linux capture preserves exact ticks and a narrow live parent becomes absent without an exit status', async () => {
    const fixture = linuxIO();
    const captured = await inspectCurrentAppParentIdentity({
        ...fixture.io,
        processId: () => 503,
        readText: async (file, signal) =>
            file === '/proc/self/stat' ? stat(503, '123') : fixture.io.readText(file, signal),
    });
    assert.deepEqual(captured, linuxParent);
    const source = await watchAppParentExit(linuxParent, fixture.io);
    assert.equal(source.method, 'unix-absence');
    assert.deepEqual(await source.ready, { event: 'parent-ready-v1', ...linuxParent });
    let complete = false;
    void source.exited.then(() => {
        complete = true;
    });
    assert.equal(complete, false);
    fixture.set({ statError: 'ENOENT' });
    fixture.advance();
    assert.deepEqual(await source.exited, { event: 'parent-absent-v1', ...linuxParent, processAbsent: true });
    await source.dispose();
    assert.equal(
        fixture.reads.some((file) => /lsof|net\/|children/.test(file)),
        false,
    );
});

test('Linux ordinary scheduler changes inside exact identity brackets preserve readiness and pending observation', async () => {
    const fixture = linuxIO();
    let parentReads = 0;
    const source = await watchAppParentExit(linuxParent, {
        ...fixture.io,
        readText: async (file, signal) => {
            const value = await fixture.io.readText(file, signal);
            return file === '/proc/503/stat' ? stat(503, '123', ++parentReads % 2 === 1 ? 'S' : 'R') : value;
        },
    });
    const observer = await prepareAppParentExit(linuxParent, async () => source);
    try {
        await observer.ready;
        assert.equal(parentReads, 2);
        let terminal = false;
        void observer.exited.then(() => {
            terminal = true;
        });
        fixture.advance();
        await until(() => fixture.pauses.length === 1);
        assert.equal(parentReads, 4);
        assert.equal(terminal, false);
        fixture.set({ statError: 'ENOENT' });
        fixture.advance();
        await observer.exited;
    } finally {
        await observer.dispose();
    }
});

test('Linux zombie stays pending until positive stat absence; exe absence and query uncertainty refuse', async () => {
    const fixture = linuxIO();
    const source = await watchAppParentExit(linuxParent, fixture.io);
    await source.ready;
    fixture.set({ state: 'Z', exeError: 'ENOENT' });
    fixture.advance();
    await until(() => fixture.pauses.length === 1);
    assert.equal(fixture.stage(), 1);
    fixture.set({ statError: 'ENOENT' });
    fixture.advance();
    await source.exited;
    await source.dispose();
    for (const change of [
        { exeError: 'ENOENT' },
        { statError: 'EACCES' },
        { statError: 'ENOENT', selfError: true },
        { birth: '124' },
        { executable: '/replaced/App' },
        { uid: '1001' },
    ]) {
        const failed = linuxIO();
        const watch = await watchAppParentExit(linuxParent, failed.io);
        await watch.ready;
        failed.set(change);
        failed.advance();
        await assert.rejects(watch.exited);
        await watch.dispose();
    }
});

test('Linux refuses initial absence, foreign account, same-second changed birth and false parent relationship before ready', async () => {
    for (const change of [{ statError: 'ENOENT' }, { uid: '1001' }, { birth: '124' }, { parentPid: 504 }]) {
        const fixture = linuxIO();
        fixture.set(change);
        const watch = await watchAppParentExit(linuxParent, fixture.io);
        await assert.rejects(watch.ready);
        await assert.rejects(watch.exited);
        await watch.dispose();
    }
});

function helperIO(platform: 'win32' | 'darwin') {
    const records: string[] = [];
    const waiters: Array<() => void> = [];
    const completion = deferred<void>();
    const writes: string[] = [];
    let ended = false;
    let inputClosed = false;
    let command: readonly string[] = [];
    const helper: AppParentHelper = {
        lines: (async function* () {
            while (true) {
                const line = records.shift();
                if (line !== undefined) {
                    yield line;
                    continue;
                }
                if (ended) return;
                await new Promise<void>((resolve) => waiters.push(resolve));
            }
        })(),
        closed: completion.promise,
        write: (value) => {
            writes.push(value);
        },
        end: () => {
            inputClosed = true;
        },
    };
    const io: AppParentWatchIO = {
        platform,
        processId: () => ownPid,
        parentProcessId: () => 503,
        windowsDirectory: () => 'C:\\Windows',
        account: () => ({ real: 1000, effective: 1000 }),
        readText: async () => {
            throw new Error('Unexpected proc read.');
        },
        readLink: async () => {
            throw new Error('Unexpected proc link.');
        },
        clockTicks: async () => {
            throw new Error('Unexpected clock command.');
        },
        pause: async () => {
            throw new Error('No poll expected in this helper transcript.');
        },
        openHelper: (file, args) => {
            command = [file, ...args];
            return helper;
        },
    };
    return {
        io,
        writes,
        command: () => command,
        inputClosed: () => inputClosed,
        push: (value: unknown) => {
            records.push(JSON.stringify(value));
            waiters.shift()?.();
        },
        close: (error?: Error) => {
            ended = true;
            waiters.shift()?.();
            if (error) completion.reject(error);
            else completion.resolve();
        },
    };
}

const windowsParent = { ...parent, executablePath: 'C:\\owned\\App.exe' };
const nativeWindows = {
    event: 'parent-native-ready-v1',
    identity: windowsParent,
    accountSid: 'S-1-5-21-1000',
    observerAccountSid: 'S-1-5-21-1000',
    sessionId: 1,
    observerSessionId: 1,
};

test('Windows retained-handle transcript requires exact same account/session identity and preserves nonzero exit', async () => {
    const fixture = helperIO('win32');
    const watch = await watchAppParentExit(windowsParent, fixture.io);
    fixture.push(nativeWindows);
    assert.deepEqual(await watch.ready, { event: 'parent-ready-v1', ...windowsParent });
    fixture.push({ ...exited, ...windowsParent });
    fixture.close();
    assert.deepEqual(await watch.exited, { ...exited, ...windowsParent });
    await watch.dispose();
    assert.ok(fixture.command().includes('-NonInteractive'));
    assert.match(fixture.writes[0] ?? '', /"action":"watch-parent"/);
});

test('Windows foreign SID, session, changed exact birth/path, early EOF and failed helper never prove parent exit', async () => {
    for (const record of [
        { ...nativeWindows, accountSid: 'S-1-5-21-1001' },
        { ...nativeWindows, sessionId: 2 },
        { ...nativeWindows, identity: { ...windowsParent, startedAtUtc: '2026-10-17T06:12:00.0000001Z' } },
        { ...nativeWindows, identity: { ...windowsParent, executablePath: 'C:\\other\\App.exe' } },
        { ...exited, ...windowsParent },
    ]) {
        const fixture = helperIO('win32');
        const watch = await watchAppParentExit(windowsParent, fixture.io);
        fixture.push(record);
        fixture.close();
        await assert.rejects(watch.ready);
        await assert.rejects(watch.exited);
        await watch.dispose();
    }
    const fixture = helperIO('win32');
    const watch = await watchAppParentExit(windowsParent, fixture.io);
    fixture.push(nativeWindows);
    await watch.ready;
    fixture.close(new Error('helper failed'));
    await assert.rejects(watch.exited);
    await assert.rejects(watch.dispose(), /helper failed/);
    for (const directory of [undefined, '', 'relative', '\\Windows', 'C:\\Windows\n']) {
        const invalid = helperIO('win32');
        invalid.close();
        const observer = await watchAppParentExit(windowsParent, { ...invalid.io, windowsDirectory: () => directory });
        await assert.rejects(observer.ready);
        await assert.rejects(observer.exited);
        await observer.dispose();
        assert.deepEqual(invalid.command(), []);
    }
});

test('dispose cancels helper observation and waits actual helper exit without closing the watched parent', async () => {
    const fixture = helperIO('win32');
    const watch = await watchAppParentExit(windowsParent, fixture.io);
    fixture.push(nativeWindows);
    await watch.ready;
    let disposed = false;
    const disposing = watch.dispose().then(() => {
        disposed = true;
    });
    await Promise.resolve();
    assert.equal(disposed, false);
    assert.equal(fixture.inputClosed(), true);
    assert.ok(fixture.writes.includes('{"cancel":true}\n'));
    await assert.rejects(watch.exited);
    fixture.close();
    await disposing;
});

const darwinParent = { ...parent, startedAtUtc: '2023-11-14T22:13:20.123456Z' };
const bsd = {
    size: 136,
    errno: 0,
    processId: 503,
    realUid: 1000,
    effectiveUid: 1000,
    startSeconds: '1700000000',
    startMicroseconds: '123456',
    status: 2,
};
const darwinLive = {
    event: 'parent-native-snapshot-v1',
    before: bsd,
    after: bsd,
    path: { size: 10, errno: 0, value: '/owned/App' },
    authority: { ...bsd, processId: ownPid },
};

test('Darwin candidate capture retains microseconds and exact buffer/errno failures refuse readiness', async () => {
    const capture = helperIO('darwin');
    const capturing = inspectCurrentAppParentIdentity({ ...capture.io, processId: () => 503 });
    capture.push({ ...darwinLive, authority: bsd });
    capture.close();
    assert.deepEqual(await capturing, darwinParent);
    for (const snapshot of [
        { ...darwinLive, before: { size: 0, errno: 3 } },
        { ...darwinLive, before: { size: 0, errno: 1 } },
        { ...darwinLive, before: { size: 0, errno: 0 } },
        { ...darwinLive, before: { ...bsd, size: 135 } },
        { ...darwinLive, before: { ...bsd, errno: 3 } },
        { ...darwinLive, before: { ...bsd, realUid: 1001 } },
        { ...darwinLive, after: { ...bsd, startMicroseconds: '123457' } },
        { ...darwinLive, path: { size: 0, errno: 3, value: '' } },
    ]) {
        const fixture = helperIO('darwin');
        const watch = await watchAppParentExit(darwinParent, fixture.io);
        fixture.push(snapshot);
        fixture.close();
        await assert.rejects(watch.ready);
        await assert.rejects(watch.exited);
        await watch.dispose();
    }
});

test('self capture rejects trailing Windows records rather than accepting an incomplete helper exchange', async () => {
    const fixture = helperIO('win32');
    const capturing = inspectCurrentAppParentIdentity({ ...fixture.io, processId: () => 503 });
    fixture.push(nativeWindows);
    fixture.push({ event: 'extra' });
    fixture.close();
    await assert.rejects(capturing);
});

function darwinPolling() {
    const pauses = linuxIO();
    const snapshots: unknown[] = [darwinLive];
    const io: AppParentWatchIO = {
        ...pauses.io,
        platform: 'darwin',
        openHelper: () => {
            const fixture = helperIO('darwin');
            const snapshot = snapshots.shift();
            assert.ok(snapshot);
            fixture.push(snapshot);
            fixture.close();
            return fixture.io.openHelper('/usr/bin/osascript', []);
        },
    };
    return { io, snapshots, advance: pauses.advance, pauses: pauses.pauses };
}

test('Darwin zombie remains pending and only exact BSD zero/ESRCH plus healthy self query proves absence', async () => {
    const fixture = darwinPolling();
    const watch = await watchAppParentExit(darwinParent, fixture.io);
    await watch.ready;
    fixture.snapshots.push({
        event: 'parent-native-snapshot-v1',
        before: { ...bsd, status: 5 },
        after: { ...bsd, status: 5 },
        authority: darwinLive.authority,
    });
    fixture.advance();
    await until(() => fixture.pauses.length === 1);
    fixture.snapshots.push({
        event: 'parent-native-snapshot-v1',
        before: { size: 0, errno: 3 },
        authority: darwinLive.authority,
    });
    fixture.advance();
    assert.deepEqual(await watch.exited, { event: 'parent-absent-v1', ...darwinParent, processAbsent: true });
    await watch.dispose();
    for (const snapshot of [
        { ...darwinLive, before: { size: 0, errno: 0 } },
        { event: 'parent-native-snapshot-v1', before: { size: 0, errno: 3 }, authority: { size: 0, errno: 3 } },
        { ...darwinLive, after: { ...bsd, effectiveUid: 1001 } },
        {
            ...darwinLive,
            before: { ...bsd, startMicroseconds: '123457' },
            after: { ...bsd, startMicroseconds: '123457' },
        },
        { ...darwinLive, path: { size: 0, errno: 3, value: '' } },
    ]) {
        const failed = darwinPolling();
        const observer = await watchAppParentExit(darwinParent, failed.io);
        await observer.ready;
        failed.snapshots.push(snapshot);
        failed.advance();
        await assert.rejects(observer.exited);
        await observer.dispose();
    }
});

test('setup timeout refuses readiness and waits actual helper exit during disposal', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const fixture = helperIO('win32');
    const watch = await watchAppParentExit(windowsParent, fixture.io);
    context.mock.timers.tick(10000);
    await assert.rejects(watch.ready);
    await assert.rejects(watch.exited);
    const disposing = watch.dispose();
    fixture.close();
    await disposing;
});

test('Darwin a stalled later snapshot is observation failure rather than indefinite exit evidence', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const polling = darwinPolling();
    const blocked = helperIO('darwin');
    let commands = 0;
    const watch = await watchAppParentExit(darwinParent, {
        ...polling.io,
        openHelper: (file, args) =>
            ++commands === 1 ? polling.io.openHelper(file, args) : blocked.io.openHelper(file, args),
    });
    try {
        await watch.ready;
        polling.advance();
        await until(() => commands === 2);
        context.mock.timers.tick(10000);
        const outcome = await Promise.race([
            watch.exited.then(
                () => 'exited',
                () => 'failed',
            ),
            new Promise<string>((resolve) => setImmediate(() => resolve('pending'))),
        ]);
        assert.equal(outcome, 'failed');
    } finally {
        blocked.close();
        await watch.dispose();
    }
});

function candidateSnapshot(change: { size?: number; errno?: number; pathError?: number; zombie?: boolean } = {}) {
    const errorCell = { 0: 99 };
    let calls = 0;
    let pathCalls = 0;
    const bufferObject = (data: Buffer): unknown => ({
        mutableBytes: data,
        bytes: data,
        subdataWithRange: (range: { location: number; length: number }) =>
            bufferObject(data.subarray(range.location, range.location + range.length)),
    });
    const bindings: Record<string, unknown> = {
        dlopen: () => ({}),
        dlerror: () => null,
        __error: () => errorCell,
        proc_pidinfo: (pid: number, flavor: number, arg: number, data: Buffer, size: number) => {
            assert.equal(flavor, 3);
            assert.equal(arg, 1);
            assert.equal(size, 136);
            assert.equal(errorCell[0], 0, 'errno must be cleared immediately before each native call');
            calls++;
            errorCell[0] = pid === 503 ? (change.errno ?? 0) : 0;
            data.writeUInt32LE(change.zombie && pid === 503 ? 5 : 2, 4);
            data.writeUInt32LE(pid, 12);
            data.writeUInt32LE(1000, 20);
            data.writeUInt32LE(1000, 28);
            data.writeBigUInt64LE(1700000000n, 120);
            data.writeBigUInt64LE(123456n, 128);
            return pid === 503 ? (change.size ?? 136) : 136;
        },
        proc_pidpath: (pid: number, data: Buffer, size: number) => {
            pathCalls++;
            assert.equal(pid, 503);
            assert.equal(size, 4096);
            assert.equal(errorCell[0], 0);
            errorCell[0] = change.pathError ?? 0;
            if (change.pathError) return 0;
            data.write('/owned/App');
            return 10;
        },
        memcpy: (output: { 0: number }, data: Buffer, size: number) => {
            assert.equal(size, 4);
            output[0] = data.readUInt32LE();
        },
        NSMutableData: { dataWithLength: (length: number) => bufferObject(Buffer.alloc(length)) },
        NSMakeRange: (location: number, length: number) => ({ location, length }),
        NSUTF8StringEncoding: 4,
        NSString: {
            alloc: {
                initWithBytesLengthEncoding: (data: Buffer, length: number, encoding: number) => {
                    assert.equal(encoding, 4);
                    return { value: data.subarray(0, length).toString('utf8'), isNil: () => false };
                },
            },
        },
    };
    const source = readFileSync(new URL('../src/adapters/macos-parent-identity.jxa', import.meta.url), 'utf8');
    const result: unknown = runInNewContext(`${source}\nrun(['503', '713']);`, {
        ObjC: {
            import: (name: string) => {
                assert.equal(name, 'Foundation');
            },
            bindFunction: () => {},
            unwrap: (value: { value: string }) => value.value,
        },
        $: bindings,
        Ref: () => ({ 0: 0 }),
    });
    assert.equal(typeof result, 'string');
    return { value: JSON.parse(String(result)), calls, pathCalls };
}

test('fixed Darwin candidate reads the pinned native buffers with cleared errno and no Date rounding', () => {
    assert.deepEqual(candidateSnapshot().value, darwinLive);
    const absent = candidateSnapshot({ size: 0, errno: 3 });
    assert.deepEqual(absent.value, {
        event: 'parent-native-snapshot-v1',
        before: { size: 0, errno: 3 },
        authority: darwinLive.authority,
    });
    assert.equal(absent.pathCalls, 0);
    const zombie = candidateSnapshot({ zombie: true });
    assert.equal(zombie.pathCalls, 0);
    assert.equal(zombie.calls, 3);
    assert.deepEqual(zombie.value.before, { ...bsd, status: 5 });
    assert.deepEqual(candidateSnapshot({ size: 135 }).value.before, { size: 135, errno: 0 });
    assert.deepEqual(candidateSnapshot({ pathError: 3 }).value.path, { size: 0, errno: 3, value: '' });
});
