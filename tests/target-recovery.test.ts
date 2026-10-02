import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlatformAdapter } from '../src/adapters/platform-process.ts';
import { createTargetHost } from '../src/adapters/target-host.ts';

function fixture({ busy = false, race = false } = {}) {
    const launched: { port: number; args: string[]; cwd: string | undefined }[] = [];
    const closed: number[] = [];
    const platform: PlatformAdapter = {
        reservedRanges: async () => [],
        snapshot: async (pid) => ({
            root: {
                exists: true,
                executablePath: process.execPath,
                startedAtUtc: '2026-10-02T00:00:00Z',
                sessionId: 1,
            },
            currentSessionId: 1,
            processIds: [pid],
            listeners: [{ localAddress: '127.0.0.1', owningProcess: race ? 999 : pid }],
        }),
        validateNewRoot: () => {},
        close: async (target) => {
            closed.push(target.port);
            return true;
        },
    };
    const host = createTargetHost({
        platformAdapter: platform,
        profileAvailable: async () => true,
        probe: async () => !busy,
        spawn: async (_exe, args, port, cwd) => {
            launched.push({ port, args, cwd });
            return { pid: 42, exitCode: null, once: () => {} };
        },
        getVersion: async (port) => ({
            Browser: 'Chrome/153',
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/recovery`,
        }),
        now: () => Date.parse('2026-10-02T00:00:00Z'),
        sleep: async () => {},
    });
    return { host, launched, closed };
}

test('exact-port recovery rejects a busy original port without spawning or advancing', async () => {
    const f = fixture({ busy: true });
    await assert.rejects(f.host.launch({ launchCommand: 'unused', exactPort: 9227 }), /original CDP port/);
    assert.deepEqual(f.launched, []);
    assert.deepEqual(f.closed, []);
});

test('an exact-port race closes only the new process and never moves to another port', async () => {
    const f = fixture({ race: true });
    await assert.rejects(f.host.launch({ launchCommand: `"${process.execPath}"`, exactPort: 9227 }), /foreign process/);
    assert.deepEqual(
        f.launched.map(({ port }) => port),
        [9227],
    );
    assert.deepEqual(f.closed, [9227]);
});

test('recovery keeps argv, cwd and profile even if the original template environment changes', async () => {
    const f = fixture();
    const args = ['--remote-debugging-port=9227', '--user-data-dir=unchanged', '--flag=a b'];
    const result = await f.host.launch({
        launchCommand: '"%MISSING%"',
        exactPort: 9227,
        targetKind: 'chrome',
        launchDefinition: { executablePath: process.execPath, arguments: args, cwd: process.cwd() },
    });
    assert.equal(await f.host.close(result), true);
    assert.equal(result.port, 9227);
    assert.equal(f.launched[0]?.cwd, process.cwd());
    assert.equal(f.launched[0]?.args.filter((value) => value.startsWith('--user-data-dir=')).length, 1);
    assert.equal(f.launched[0]?.args.includes('--user-data-dir=unchanged'), true);
    assert.equal(f.launched[0]?.args.includes('--flag=a b'), true);
});
