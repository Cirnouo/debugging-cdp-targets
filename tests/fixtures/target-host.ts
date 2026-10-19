import { EventEmitter } from 'node:events';
import { createTargetHost } from '../../src/adapters/target-host.ts';

export function createTargetHostFixture(available: boolean | (() => Promise<boolean>) = true) {
    const children: EventEmitter[] = [];
    const inspected: string[] = [];
    const launchedArguments: string[][] = [];
    const host = createTargetHost({
        profileAvailable:
            typeof available === 'function'
                ? available
                : async (directory) => {
                      inspected.push(directory);
                      return available;
                  },
        platformAdapter: {
            reservedRanges: async () => [],
            validateNewRoot: () => {},
            close: async (target) => {
                children[target.processId - 40]?.emit('exit', 0);
                return true;
            },
            snapshot: async (pid) => ({
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    sessionId: 1,
                },
                currentSessionId: 1,
                processIds: [pid],
                listeners: [{ localAddress: '127.0.0.1', owningProcess: pid }],
            }),
        },
        spawn: async (_executable, arguments_) => {
            launchedArguments.push([...arguments_]);
            const child = Object.assign(new EventEmitter(), { pid: 40 + children.length, exitCode: null });
            children.push(child);
            return child;
        },
        probe: async () => true,
        getVersion: async (port) => ({
            Browser: 'Chrome/153',
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/profile`,
        }),
    });
    const launch = (directory?: string, signal?: AbortSignal) =>
        host.launch(
            {
                isolation: { mode: 'none' },
                targetKind: 'chrome',
                launch: {
                    executable: process.execPath,
                    args: [...(directory ? [`--user-data-dir=${directory}`] : []), '--remote-debugging-port={port}'],
                },
            },
            { ...(signal ? { signal } : {}) },
        );
    return {
        host,
        launch,
        children,
        inspected,
        launchedArguments,
        finish: () => {
            for (const child of children) child.emit('exit');
        },
    };
}
