import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPlatformAdapter } from '../src/adapters/platform-process.ts';
import type { ProcessTarget } from '../src/domains/cdp-target.ts';
import { createChromeSmokeHost } from './smoke/chrome-host.ts';
import type { LinuxExternalCloseIo } from './smoke/linux-chrome-external-close.ts';

const stat = `4100 (chrome child ) name) S ${Array(18).fill('0').join(' ')} 12345 ${Array(30).fill('0').join(' ')}\n`;
const target = {
    entryId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    status: 'active' as const,
    processId: 4100,
    port: 19422,
    targetKind: 'chrome' as const,
};

const executablePath = '/opt/google/chrome/chrome';
const originalEndpoint = {
    Browser: 'Chrome/154.0.8037.93',
    webSocketDebuggerUrl: 'ws://127.0.0.1:19422/devtools/browser/original',
};

const diagnostics: unknown[][] = [];
test.beforeEach((t) => {
    diagnostics.length = 0;
    assert.ok('mock' in t);
    t.mock.method(console, 'log', (...values: unknown[]) => {
        diagnostics.push(values);
    });
});

function deferred() {
    let resolve: () => void = () => {
        throw new Error('Deferred is not initialized.');
    };
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function fixtureIo() {
    const state = {
        stat,
        uid: 1000,
        h: '100\n',
        path: executablePath,
        ps: '4100 1 1000 Tue Nov 14 22:15:23 2023 /opt/google/chrome/chrome\n',
        lsof: 'p4100\nn127.0.0.1:19422\n',
        endpoint: originalEndpoint as unknown,
        responseStatus: 200,
        commandCode: 0 as number | null,
        commandStderr: '',
        before: async (_boundary: string) => {},
        after: async (_boundary: string) => {},
    };
    const signals: { pid: number; signal: string }[] = [];
    const productionSignals: number[] = [];
    const calls: string[] = [];
    const io: LinuxExternalCloseIo = {
        async readText(file, _signal) {
            calls.push(file);
            await state.before(file);
            const value = file === '/proc/stat' ? 'btime 1700000000\n' : state.stat;
            await state.after(file);
            return value;
        },
        async readlink(file, _signal) {
            calls.push(file);
            assert.equal(file, '/proc/4100/exe');
            await state.before('readlink');
            const value = state.path;
            await state.after('readlink');
            return value;
        },
        async realpath(file, _signal) {
            calls.push(`realpath:${file}`);
            await state.before('realpath');
            const value = file;
            await state.after('realpath');
            return value;
        },
        async run(command, args, _signal) {
            calls.push(command);
            await state.before(command);
            if (command === 'getconf') assert.deepEqual(args, ['CLK_TCK']);
            else if (command === 'ps') assert.deepEqual(args, ['-ww', '-axo', 'pid=,ppid=,uid=,lstart=,comm=']);
            else {
                assert.equal(command, 'lsof');
                assert.deepEqual(args, ['-nP', '-iTCP:19422', '-sTCP:LISTEN', '-Fpn']);
            }
            const stdout = command === 'ps' ? state.ps : command === 'getconf' ? state.h : state.lsof;
            await state.after(command);
            return { code: state.commandCode, stdout, stderr: state.commandStderr };
        },
        async fetch(url, _signal) {
            calls.push('endpoint');
            assert.equal(url, 'http://127.0.0.1:19422/json/version');
            await state.before('endpoint');
            const value = new Response(JSON.stringify(state.endpoint), { status: state.responseStatus });
            await state.after('endpoint');
            return value;
        },
        currentUser: () => state.uid,
        signal(pid, signal) {
            signals.push({ pid, signal });
        },
    };
    const platform = createPlatformAdapter({
        platform: 'linux',
        requestUnixClose: (pid) => {
            productionSignals.push(pid);
        },
        unix: {
            currentUser: io.currentUser,
            readText: (file) => io.readText(file, new AbortController().signal),
            readlink: (file) => io.readlink(file, new AbortController().signal),
            run: (command, args) => io.run(command, args, new AbortController().signal),
        },
    });
    // Explicit Linux OS simulation on Windows; the host uses the real Linux
    // adapter snapshot and replaces only OS/proc/command/network/signal I/O.
    const host = createChromeSmokeHost({ operatingSystem: 'linux', io });
    return {
        state,
        signals,
        productionSignals,
        calls,
        io,
        platform,
        host,
        inspect: () => host.inspectChromeSmokeTarget(target, executablePath, platform),
        close: (fixture: ProcessTarget, signal?: AbortSignal) =>
            host.requestChromeSmokeClose(fixture, platform, signal),
    };
}

test('verified original Linux inspect-only fixture accepts one external SIGTERM without launch registration', async () => {
    const f = fixtureIo();
    const fixture = await f.inspect();
    assert.equal(diagnostics.length, 1);
    const diagnostic = diagnostics[0];
    assert.ok(diagnostic && diagnostic.length === 1 && typeof diagnostic[0] === 'string');
    const value: unknown = JSON.parse(diagnostic[0]);
    assert.deepEqual(value, {
        chromeSmokeEnvironment: {
            platform: 'linux',
            osRelease: os.release(),
            architecture: process.arch,
            nodeVersion: process.version,
            chromeVersion: '154.0.8037.93',
            executable: executablePath,
            processId: 4100,
            startedAtUtc: '2023-11-14T22:15:23.450Z',
            userOrSessionId: 1000,
            listeners: [{ localAddress: '127.0.0.1', owningProcess: 4100 }],
        },
    });
    assert.equal('child' in fixture, false);
    assert.equal(await f.close(fixture), true);
    assert.deepEqual(f.signals, [{ pid: 4100, signal: 'SIGTERM' }]);
    assert.deepEqual(f.productionSignals, []);
    await assert.rejects(f.close(fixture), /capability/);
    assert.deepEqual(f.signals, [{ pid: 4100, signal: 'SIGTERM' }]);
});

test('production Linux Close rejects original and copied inspect-only objects before and after external stimulus', async () => {
    const f = fixtureIo();
    const fixture = await f.inspect();
    assert.ok(f.platform.requestNormalClose);
    for (const value of [fixture, { ...fixture }])
        await assert.rejects(f.platform.requestNormalClose(value), /no registered launch identity/);
    assert.deepEqual(f.productionSignals, []);
    assert.deepEqual(f.signals, []);
    assert.equal(await f.close(fixture), true);
    await assert.rejects(f.platform.requestNormalClose(fixture), /no registered launch identity/);
    assert.deepEqual(f.productionSignals, []);
});

test('positive safe CLK_TCK values other than 100 use verified evidence without a fixed fallback', async () => {
    const f = fixtureIo();
    f.state.h = '250\n';
    const fixture = await f.inspect();
    assert.equal(await f.close(fixture), true);
    assert.deepEqual(f.signals, [{ pid: 4100, signal: 'SIGTERM' }]);
});

const mutations = [
    ['processId', 4200],
    ['port', 19423],
    ['executablePath', '/another/chrome'],
    ['targetKind', 'generic'],
    ['startedAtUtc', '2023-11-14T22:15:23.451Z'],
] as const;

test('copies, proxy wrappers, other inspectors and every changed bound field send zero signals', async () => {
    for (const mutation of ['copy', 'proxy', 'other-host', ...mutations.map(([field]) => field)]) {
        const f = fixtureIo();
        let fixture = await f.inspect();
        if (mutation === 'copy') fixture = { ...fixture };
        else if (mutation === 'proxy') fixture = new Proxy(fixture, {});
        else if (mutation === 'other-host') {
            await assert.rejects(fixtureIo().close(fixture), /capability/);
            assert.deepEqual(f.signals, []);
            continue;
        } else {
            const value = mutations.find(([field]) => field === mutation);
            assert.ok(value);
            Object.defineProperty(fixture, value[0], { value: value[1] });
        }
        await assert.rejects(f.close(fixture), /capability/);
        assert.deepEqual(f.signals, [], mutation);
    }
});

const changedEvidence: [string, (f: ReturnType<typeof fixtureIo>) => void][] = [
    [
        'inspection command failure',
        (f) => {
            f.state.commandCode = 1;
        },
    ],
    [
        'inspection command incomplete exit',
        (f) => {
            f.state.commandCode = null;
        },
    ],
    [
        'inspection command warning',
        (f) => {
            f.state.commandStderr = 'incomplete evidence\n';
        },
    ],
    [
        'oversized command stderr',
        (f) => {
            f.state.commandStderr = 'x'.repeat(8_193);
        },
    ],
    [
        'unavailable raw read',
        (f) => {
            f.state.before = async () => {
                throw new Error('Read denied.');
            };
        },
    ],
    [
        'incomplete trailing listener descriptor',
        (f) => {
            f.state.lsof += 'f5\n';
        },
    ],
    [
        'H alone changed with unchanged raw q',
        (f) => {
            f.state.h = '200\n';
        },
    ],
    [
        'q is negative',
        (f) => {
            f.state.stat = stat.replace('12345', '-1');
        },
    ],
    [
        'q uses exponential notation',
        (f) => {
            f.state.stat = stat.replace('12345', '1e4');
        },
    ],
    [
        'q exceeds uint64',
        (f) => {
            f.state.stat = stat.replace('12345', '18446744073709551616');
        },
    ],
    [
        'q changed within old 1000-ms tolerance',
        (f) => {
            f.state.stat = stat.replace('12345', '12346');
        },
    ],
    [
        'H changed with equal public timestamp',
        (f) => {
            f.state.stat = stat.replace('12345', '24690');
            f.state.h = '200\n';
        },
    ],
    [
        'numeric UID changed',
        (f) => {
            f.state.ps = f.state.ps.replace('1000', '1001');
            f.state.uid = 1001;
        },
    ],
    [
        'canonical executable changed',
        (f) => {
            f.state.path = '/another/chrome';
        },
    ],
    [
        'root absent',
        (f) => {
            f.state.ps = '';
        },
    ],
    [
        'listener absent',
        (f) => {
            f.state.lsof = '';
        },
    ],
    [
        'malformed listener alongside valid listener',
        (f) => {
            f.state.lsof += 'ninvalid-listener\n';
        },
    ],
    [
        'incomplete listener owner record',
        (f) => {
            f.state.lsof += 'p4200\n';
        },
    ],
    [
        'listener record lacks newline',
        (f) => {
            f.state.lsof = f.state.lsof.trimEnd();
        },
    ],
    [
        'listener reports wrong port',
        (f) => {
            f.state.lsof = 'p4100\nn127.0.0.1:19423\n';
        },
    ],
    [
        'malformed process row alongside root',
        (f) => {
            f.state.ps += 'bad incomplete process row\n';
        },
    ],
    [
        'duplicate root process row',
        (f) => {
            f.state.ps += f.state.ps;
        },
    ],
    [
        'foreign listener owner',
        (f) => {
            f.state.lsof = 'p4200\nn127.0.0.1:19422\n';
        },
    ],
    [
        'nonloopback listener',
        (f) => {
            f.state.lsof = 'p4100\nn0.0.0.0:19422\n';
        },
    ],
    [
        'endpoint changed',
        (f) => {
            f.state.endpoint = {
                ...originalEndpoint,
                webSocketDebuggerUrl: 'ws://127.0.0.1:19422/devtools/browser/replacement',
            };
        },
    ],
    [
        'endpoint missing',
        (f) => {
            f.state.endpoint = {};
        },
    ],
    [
        'page endpoint',
        (f) => {
            f.state.endpoint = {
                ...originalEndpoint,
                webSocketDebuggerUrl: 'ws://127.0.0.1:19422/devtools/page/original',
            };
        },
    ],
    [
        'foreign endpoint',
        (f) => {
            f.state.endpoint = {
                ...originalEndpoint,
                webSocketDebuggerUrl: 'ws://example.com:19422/devtools/browser/original',
            };
        },
    ],
    [
        'wrong endpoint port',
        (f) => {
            f.state.endpoint = {
                ...originalEndpoint,
                webSocketDebuggerUrl: 'ws://127.0.0.1:19423/devtools/browser/original',
            };
        },
    ],
    [
        'wrong product',
        (f) => {
            f.state.endpoint = { ...originalEndpoint, Browser: 'Electron/45.0.0.0' };
        },
    ],
    [
        'HTTP failure',
        (f) => {
            f.state.responseStatus = 503;
        },
    ],
    [
        'oversized endpoint',
        (f) => {
            f.state.endpoint = { ...originalEndpoint, padding: 'x'.repeat(16_384) };
        },
    ],
    [
        'malformed stat',
        (f) => {
            f.state.stat = 'not a stat record\n';
        },
    ],
    [
        'incomplete stat',
        (f) => {
            f.state.stat = '4100 (chrome) S 0 0 0\n';
        },
    ],
    [
        'stat lacks newline',
        (f) => {
            f.state.stat = stat.trimEnd();
        },
    ],
    [
        'duplicate stat',
        (f) => {
            f.state.stat = stat + stat;
        },
    ],
    [
        'wrong PID',
        (f) => {
            f.state.stat = stat.replace('4100', '4200');
        },
    ],
    [
        'oversized stat',
        (f) => {
            f.state.stat = stat.replace('chrome child', 'x'.repeat(16_384));
        },
    ],
    [
        'missing H',
        (f) => {
            f.state.h = '';
        },
    ],
    [
        'zero H',
        (f) => {
            f.state.h = '0\n';
        },
    ],
    [
        'fractional H',
        (f) => {
            f.state.h = '100.5\n';
        },
    ],
    [
        'unsafe H',
        (f) => {
            f.state.h = '9007199254740992\n';
        },
    ],
    [
        'oversized command',
        (f) => {
            f.state.ps = 'x'.repeat(262_145);
        },
    ],
];
for (const [name, mutate] of changedEvidence)
    test(`external Close denies ${name} with zero signals`, async () => {
        const f = fixtureIo();
        const fixture = await f.inspect();
        mutate(f);
        await assert.rejects(f.close(fixture));
        assert.deepEqual(f.signals, []);
        assert.deepEqual(f.productionSignals, []);
    });

test('malformed admission and inconsistent raw brackets never admit a capability', async () => {
    for (const mutation of ['malformed', 'late-q', 'late-H']) {
        const f = fixtureIo();
        if (mutation === 'malformed') f.state.stat = '4100 (chrome) S 0\n';
        else
            f.state.after = async (boundary) => {
                if (boundary === 'endpoint') {
                    if (mutation === 'late-q') f.state.stat = stat.replace('12345', '12346');
                    else f.state.h = '200\n';
                }
            };
        await assert.rejects(f.inspect());
        assert.deepEqual(f.signals, []);
    }
});

for (const boundary of ['/proc/4100/stat', '/proc/stat', 'ps', 'getconf', 'lsof', 'readlink', 'realpath', 'endpoint']) {
    for (const [field, changed] of mutations)
        test(`mutation of ${field} during ${boundary} denies unchanged raw evidence`, async () => {
            const f = fixtureIo();
            const fixture = await f.inspect();
            const entered = deferred();
            const release = deferred();
            let once = false;
            f.state.after = async (name) => {
                if (name === boundary && !once) {
                    once = true;
                    entered.resolve();
                    await release.promise;
                }
            };
            const closing = f.close(fixture);
            await entered.promise;
            Object.defineProperty(fixture, field, { value: changed });
            release.resolve();
            await assert.rejects(closing);
            assert.equal(f.state.stat, stat);
            assert.equal(f.state.h, '100\n');
            assert.deepEqual(f.signals, []);
        });
    test(`cancellation during ${boundary} ignores late success and invalidates capability`, async () => {
        const f = fixtureIo();
        const fixture = await f.inspect();
        const entered = deferred();
        const release = deferred();
        let once = false;
        f.state.after = async (name) => {
            if (name === boundary && !once) {
                once = true;
                entered.resolve();
                await release.promise;
            }
        };
        const controller = new AbortController();
        const closing = f.close(fixture, controller.signal);
        const denied = assert.rejects(closing);
        await entered.promise;
        const callsAtAbort = f.calls.length;
        controller.abort(new Error('Canceled stimulus.'));
        await denied;
        release.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(f.calls.length, callsAtAbort, 'No fallback or retry after cancellation.');
        await assert.rejects(f.close(fixture), /capability/);
        assert.deepEqual(f.signals, []);
    });
    test(`late ${boundary} result is denied if raw q changed during original operation`, async () => {
        const f = fixtureIo();
        const fixture = await f.inspect();
        const entered = deferred();
        const release = deferred();
        let once = false;
        f.state.after = async (name) => {
            if (name === boundary && !once) {
                once = true;
                entered.resolve();
                await release.promise;
            }
        };
        const closing = f.close(fixture);
        await entered.promise;
        f.state.stat = stat.replace('12345', '12346');
        release.resolve();
        await assert.rejects(closing);
        assert.deepEqual(f.signals, []);
    });
}

for (const [field] of mutations)
    test(`accessor for ${field} is rejected without invoking its side-effecting getter`, async () => {
        const f = fixtureIo();
        const fixture = await f.inspect();
        let reads = 0;
        Object.defineProperty(fixture, field, {
            get() {
                reads += 1;
                fixture.processId = 4200;
                return 4100;
            },
        });
        await assert.rejects(f.close(fixture), /capability/);
        assert.equal(reads, 0);
        assert.deepEqual(f.signals, []);
    });

test('missing own fields reject inherited getters without evaluating them', async () => {
    for (const [field] of mutations) {
        const f = fixtureIo();
        const fixture = await f.inspect();
        let reads = 0;
        assert.equal(Reflect.deleteProperty(fixture, field), true);
        Object.setPrototypeOf(
            fixture,
            Object.defineProperty({}, field, {
                get() {
                    reads += 1;
                    return 4100;
                },
            }),
        );
        await assert.rejects(f.close(fixture), /capability/);
        assert.equal(reads, 0);
        assert.deepEqual(f.signals, []);
    }
});

test('accessors installed during endpoint work fail the final descriptor check without invoking getters', async () => {
    for (const [field] of mutations) {
        const f = fixtureIo();
        const fixture = await f.inspect();
        let reads = 0;
        f.state.after = async (boundary) => {
            if (boundary === 'endpoint')
                Object.defineProperty(fixture, field, {
                    get() {
                        reads += 1;
                        fixture.port = 19423;
                        return 4100;
                    },
                });
        };
        await assert.rejects(f.close(fixture));
        assert.equal(reads, 0);
        assert.deepEqual(f.signals, []);
    }
});

test('timed-out I/O cannot later signal or issue a retry', async () => {
    const f = fixtureIo();
    const fixture = await f.inspect();
    const entered = deferred();
    const release = deferred();
    f.state.after = async (boundary) => {
        if (boundary === 'endpoint') {
            entered.resolve();
            await release.promise;
        }
    };
    const denied = assert.rejects(f.close(fixture), /timeout|aborted/i);
    await entered.promise;
    const count = f.calls.length;
    const keepAlive = setTimeout(() => {}, 2_000);
    try {
        await denied;
    } finally {
        clearTimeout(keepAlive);
        release.resolve();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.calls.length, count);
    assert.deepEqual(f.signals, []);
});

test('snapshot timeout cancels nested evidence before a late getconf result can issue lsof', async () => {
    const f = fixtureIo();
    const fixture = await f.inspect();
    const entered = deferred();
    const release = deferred();
    f.state.before = async (boundary) => {
        if (boundary === 'ps') await new Promise((resolve) => setTimeout(resolve, 150));
    };
    f.state.after = async (boundary) => {
        if (boundary === 'getconf') {
            entered.resolve();
            await release.promise;
        }
    };
    const denied = assert.rejects(f.close(fixture), /timeout|aborted/i);
    await entered.promise;
    const callsAtTimeout = f.calls.length;
    const keepAlive = setTimeout(() => {}, 2_000);
    try {
        await denied;
    } finally {
        clearTimeout(keepAlive);
        release.resolve();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.calls.length, callsAtTimeout, 'A timed-out snapshot must not continue into lsof or readlink.');
    assert.deepEqual(f.signals, []);
});

test('concurrent external requests accept only the original pending request', async () => {
    const f = fixtureIo();
    const fixture = await f.inspect();
    const entered = deferred();
    const release = deferred();
    f.state.after = async (boundary) => {
        if (boundary === 'endpoint') {
            entered.resolve();
            await release.promise;
        }
    };
    const closing = f.close(fixture);
    await entered.promise;
    await assert.rejects(f.close(fixture), /capability/);
    release.resolve();
    assert.equal(await closing, true);
    assert.deepEqual(f.signals, [{ pid: 4100, signal: 'SIGTERM' }]);
});

test('active, inactive Keep and retained-target emergency stimuli share the guard', async () => {
    for (const taskActive of [true, false]) {
        const f = fixtureIo();
        const fixture = await f.host.inspectChromeSmokeTarget({ ...target, taskActive }, executablePath, f.platform);
        assert.equal(await f.close(fixture), true);
        assert.deepEqual(f.signals, [{ pid: 4100, signal: 'SIGTERM' }]);
    }
    const f = fixtureIo();
    const retained = await f.inspect();
    f.state.lsof = '';
    let cleanup: unknown;
    try {
        throw new Error('Gateway EOF retained the application.');
    } catch {
    } finally {
        try {
            await f.close(retained);
        } catch (error) {
            cleanup = error;
        }
    }
    assert.ok(cleanup instanceof Error, 'An unavailable emergency stimulus remains an explicit cleanup failure.');
    assert.deepEqual(f.signals, []);
});

test('Windows and macOS delegate acceptance without fabricating exit or waiting', async () => {
    for (const operatingSystem of ['win32', 'darwin'] as const) {
        const host = createChromeSmokeHost({ operatingSystem });
        const fixture: ProcessTarget = {
            processId: 4100,
            port: 19422,
            executablePath,
            targetKind: 'chrome',
            startedAtUtc: '2023-11-14T22:15:23.450Z',
        };
        const seen: ProcessTarget[] = [];
        assert.equal(
            await host.requestChromeSmokeClose(fixture, {
                requestNormalClose: async (value) => {
                    seen.push(value);
                    return { closeRequested: true, processExited: false };
                },
            }),
            true,
        );
        assert.deepEqual(seen, [fixture]);
        assert.equal('child' in fixture, false);
    }
});

test('default proc reader rejects an oversized native file through bounded reads', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dct-close-proc-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'stat');
    await fs.writeFile(file, 'x'.repeat(65_536));
    const originalOpen = fs.open;
    t.mock.method(fs, 'open', async (requested: string, flags: string) => {
        assert.equal(requested, '/proc/4100/stat');
        return originalOpen(file, flags);
    });
    const f = fixtureIo();
    const { readText: _readText, ...io } = f.io;
    const host = createChromeSmokeHost({ operatingSystem: 'linux', io });
    await assert.rejects(host.inspectChromeSmokeTarget(target, executablePath, f.platform), /byte limit/);
    assert.deepEqual(f.signals, []);
    assert.deepEqual(f.calls, [], 'Oversized raw evidence fails before native commands or the endpoint.');
});

for (const condition of ['stdout', 'stderr', 'timeout'] as const)
    test(`default structured command enforces ${condition} limits without late signaling`, async (t) => {
        const f = fixtureIo();
        const { run: _run, ...io } = f.io;
        const originalSpawn = childProcess.spawn;
        const childClosed: Promise<unknown>[] = [];
        t.mock.method(childProcess, 'spawn', (command: string, args: string[], options: childProcess.SpawnOptions) => {
            assert.equal(command, 'ps');
            assert.deepEqual(args, ['-ww', '-axo', 'pid=,ppid=,uid=,lstart=,comm=']);
            assert.equal(options.shell, false);
            const script =
                condition === 'stdout'
                    ? 'process.stdout.write("x".repeat(262145))'
                    : condition === 'stderr'
                      ? 'process.stderr.write("x".repeat(8193))'
                      : 'setInterval(() => {}, 1000)';
            const child = originalSpawn(process.execPath, ['-e', script], options);
            childClosed.push(once(child, 'close'));
            return child;
        });
        const host = createChromeSmokeHost({ operatingSystem: 'linux', io });
        await assert.rejects(
            host.inspectChromeSmokeTarget(target, executablePath, f.platform),
            /byte limit|timeout|aborted/i,
        );
        await Promise.all(childClosed);
        assert.equal(childClosed.length, 1, 'There is no retry command.');
        assert.deepEqual(f.signals, []);
    });

test('bounded endpoint body cancels oversized and pending streams and never accepts late bytes', async () => {
    for (const condition of ['oversized', 'cancel'] as const) {
        const f = fixtureIo();
        const entered = deferred();
        let canceled = false;
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
        const host = createChromeSmokeHost({
            operatingSystem: 'linux',
            io: {
                ...f.io,
                fetch: async () =>
                    new Response(
                        new ReadableStream<Uint8Array>({
                            start(value) {
                                controller = value;
                                entered.resolve();
                                if (condition === 'oversized') value.enqueue(new Uint8Array(16_385));
                            },
                            cancel() {
                                canceled = true;
                            },
                        }),
                    ),
            },
        });
        const cancellation = new AbortController();
        const denied = assert.rejects(
            host.inspectChromeSmokeTarget(target, executablePath, f.platform, cancellation.signal),
        );
        await entered.promise;
        if (condition === 'cancel') cancellation.abort(new Error('Cancel body.'));
        await denied;
        assert.equal(canceled, true);
        assert.ok(controller);
        assert.throws(() => controller?.enqueue(new Uint8Array([123, 125])));
        assert.deepEqual(f.signals, []);
    }
});

test('final descriptor checks and frozen-PID signal run before any queued field mutation', async (t) => {
    const f = fixtureIo();
    const originalDescriptor = Object.getOwnPropertyDescriptor;
    let checks = 0;
    let finalCheck = false;
    let queuedMutation = false;
    const host = createChromeSmokeHost({
        operatingSystem: 'linux',
        io: {
            ...f.io,
            signal: (pid, signal) => {
                assert.equal(finalCheck, true);
                assert.equal(queuedMutation, false, 'No await may split the final descriptor decision from signaling.');
                f.signals.push({ pid, signal });
            },
        },
    });
    const owned = await host.inspectChromeSmokeTarget(target, executablePath, f.platform);
    // Observe the host's original object; never expose or register a capability.
    t.mock.method(Object, 'getOwnPropertyDescriptor', (object: object, field: PropertyKey) => {
        const result = originalDescriptor(object, field);
        if (object === owned && field === 'startedAtUtc' && ++checks === 2) {
            finalCheck = true;
            queueMicrotask(() => {
                queuedMutation = true;
                owned.processId = 4200;
            });
        }
        return result;
    });
    assert.equal(await host.requestChromeSmokeClose(owned, f.platform), true);
    assert.equal(queuedMutation, true);
    assert.deepEqual(f.signals, [{ pid: 4100, signal: 'SIGTERM' }]);
});
