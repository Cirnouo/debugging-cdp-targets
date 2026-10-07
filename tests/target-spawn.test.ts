import assert from 'node:assert/strict';
import childProcess, { ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { createTargetHost, spawnPortableApplication } from '../src/adapters/target-host.ts';

test('portable direct launch keeps its GUI visible and detached without a shell or inherited stdio', async (context) => {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 42 });
    let unreferenced = false;
    context.mock.method(child, 'unref', () => {
        unreferenced = true;
    });
    const launches: { executable: string; arguments: readonly string[]; options: SpawnOptions }[] = [];
    const nativeSpawn = context.mock.method(
        childProcess,
        'spawn',
        (executable: string, arguments_: readonly string[], options: SpawnOptions) => {
            launches.push({ executable, arguments: arguments_, options });
            queueMicrotask(() => child.emit('spawn'));
            return child;
        },
    );
    syncBuiltinESMExports();
    try {
        const host = createTargetHost({
            spawn: spawnPortableApplication,
            platformAdapter: {
                reservedRanges: async () => [],
                snapshot: async () => ({
                    root: {
                        exists: true,
                        executablePath: process.execPath,
                        sessionId: 1,
                        startedAtUtc: '2026-09-30T00:00:00Z',
                    },
                    processIds: [42],
                    currentSessionId: 1,
                    listeners: [{ localAddress: '127.0.0.1', owningProcess: 42 }],
                }),
                validateNewRoot: () => {},
                close: async () => true,
            },
            probe: async () => true,
            getVersion: async () => ({
                Browser: 'Chrome/154.0.8037.93',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/visible-target',
            }),
        });
        const target = await host.launch({
            isolation: { mode: 'none' },
            launch: {
                executable: process.execPath,
                args: ['--remote-debugging-port={port}'],
                env: { DCT_TEST_LAUNCH_VALUE: 'a b 中文' },
            },
            basePort: 9222,
        });
        assert.equal(target.processId, 42);
        assert.equal(unreferenced, true, 'Keep must allow the gateway to exit independently of the target');
        assert.equal(launches[0]?.options.env?.DCT_TEST_LAUNCH_VALUE, 'a b 中文');
        assert.deepEqual(
            launches.map(({ options, ...rest }) => {
                const { env, ...processOptions } = options;
                assert.ok(env);
                return { ...rest, options: processOptions };
            }),
            [
                {
                    executable: process.execPath,
                    arguments: ['--remote-debugging-port=9222'],
                    options: {
                        cwd: path.dirname(process.execPath),
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: false,
                        shell: false,
                    },
                },
            ],
        );
    } finally {
        nativeSpawn.mock.restore();
        syncBuiltinESMExports();
    }
});

test('permission waiting does not consume CDP startup time and pre-cancelled launches create no application', async () => {
    let clock = Date.parse('2026-10-04T00:00:00Z');
    const abort = new AbortController();
    const closed: number[] = [];
    const child = Object.assign(new EventEmitter(), { pid: 101, exitCode: null });
    const host = createTargetHost({
        now: () => clock,
        probe: async () => true,
        spawn: async () => {
            clock += 90_000;
            return child;
        },
        platformAdapter: {
            reservedRanges: async () => [],
            snapshot: async () => ({
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    startedAtUtc: new Date(clock).toISOString(),
                    sessionId: 1,
                },
                currentSessionId: 1,
                processIds: [101],
                listeners: [{ localAddress: '127.0.0.1', owningProcess: 101 }],
            }),
            validateNewRoot: () => {},
            close: async (target) => {
                closed.push(target.processId);
                child.emit('exit', 0);
                return true;
            },
        },
        getVersion: async () => ({
            Browser: 'Chrome/154',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/ready',
        }),
    });
    const active = await host.launch(
        { isolation: { mode: 'none' }, launch: { executable: process.execPath } },
        { signal: abort.signal },
    );
    assert.equal(active.processId, 101);
    assert.deepEqual(closed, []);

    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
        host.launch(
            { isolation: { mode: 'none' }, launch: { executable: process.execPath } },
            { signal: cancelled.signal },
        ),
        /abort/i,
    );
    assert.deepEqual(closed, []);
});

test('cancellation racing with endpoint readiness closes the newly created application', async () => {
    const abort = new AbortController();
    const closed: number[] = [];
    const child = Object.assign(new EventEmitter(), { pid: 102, exitCode: null });
    const host = createTargetHost({
        probe: async () => true,
        spawn: async () => child,
        platformAdapter: {
            reservedRanges: async () => [],
            snapshot: async () => ({
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    startedAtUtc: new Date().toISOString(),
                    sessionId: 1,
                },
                currentSessionId: 1,
                processIds: [102],
                listeners: [{ localAddress: '127.0.0.1', owningProcess: 102 }],
            }),
            validateNewRoot: () => {},
            close: async (target) => {
                closed.push(target.processId);
                child.emit('exit', 0);
                return true;
            },
        },
        getVersion: async () => {
            abort.abort();
            return { Browser: 'Chrome/154', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/ready' };
        },
    });
    await assert.rejects(
        host.launch(
            { isolation: { mode: 'none' }, launch: { executable: process.execPath } },
            { signal: abort.signal },
        ),
        /abort/i,
    );
    assert.deepEqual(closed, [102]);
});
