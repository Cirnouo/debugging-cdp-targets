import assert from 'node:assert/strict';
import childProcess, { ChildProcess, type SpawnOptions } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { createTargetHost } from '../src/adapters/target-host.ts';

test('native target launch keeps its GUI visible and detached without a shell or inherited stdio', async (context) => {
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
            launchCommand: `"${process.execPath}" --remote-debugging-port={port}`,
            basePort: 9222,
        });
        assert.equal(target.processId, 42);
        assert.equal(unreferenced, true, 'Keep must allow the gateway to exit independently of the target');
        assert.deepEqual(launches, [
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
        ]);
    } finally {
        nativeSpawn.mock.restore();
        syncBuiltinESMExports();
    }
});
