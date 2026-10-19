import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { PlatformAdapter } from '../src/adapters/platform-process.ts';
import { createTargetHost } from '../src/adapters/target-host.ts';
import { prepareLaunchDefinition } from '../src/gateway/targets/model/launch-command.ts';

function fixture({ busy = false, race = false, busyPorts = [] as number[] } = {}) {
    const launched: { port: number; args: string[]; cwd: string | undefined; env: NodeJS.ProcessEnv | undefined }[] =
        [];
    const closed: number[] = [];
    const child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null });
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
            child.emit('exit', 0);
            return true;
        },
    };
    const host = createTargetHost({
        platformAdapter: platform,
        profileAvailable: async () => true,
        probe: async (port) => !busy && !busyPorts.includes(port),
        spawn: async (_exe, args, port, cwd, env) => {
            launched.push({ port, args, cwd, env });
            return child;
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
    await assert.rejects(
        f.host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath }, exactPort: 9227 }),
        /original CDP port/,
    );
    assert.deepEqual(f.launched, []);
    assert.deepEqual(f.closed, []);
});

test('prepared automatic restart selects one free port while preserving opaque numeric arguments and effective env', async () => {
    const f = fixture({ busyPorts: [9227] });
    const launch = {
        executable: process.execPath,
        args: ['--remote-debugging-port={port}', '--literal=9227', '%DCT_SNAPSHOT%'],
    };
    const prepared = prepareLaunchDefinition(
        launch,
        9227,
        { ...process.env, DCT_SNAPSHOT: 'admitted' },
        process.platform === 'win32',
    );
    launch.args[2] = 'mutated';
    const target = await f.host.launch({ isolation: { mode: 'none' }, launch, preparedLaunch: prepared });
    try {
        assert.deepEqual(
            f.launched.map((item) => item.port),
            [9228],
        );
        assert.ok(f.launched[0]?.args.includes('--literal=9227'));
        assert.ok(f.launched[0]?.args.includes('admitted'));
        assert.equal(f.launched[0]?.env?.DCT_SNAPSHOT, 'admitted');
    } finally {
        await f.host.close(target);
    }
});

test('prepared fixed-port restart collision spawns nothing', async () => {
    const f = fixture({ busyPorts: [9227] });
    const launch = { executable: process.execPath, args: ['--remote-debugging-port=9227'] };
    await assert.rejects(
        f.host.launch({
            isolation: { mode: 'none' },
            launch,
            preparedLaunch: prepareLaunchDefinition(launch, 9222, { ...process.env }),
        }),
        /original CDP port/,
    );
    assert.deepEqual(f.launched, []);
    assert.deepEqual(f.closed, []);
});

test('an exact-port race closes only the new process and never moves to another port', async () => {
    const f = fixture({ race: true });
    await assert.rejects(
        f.host.launch({ isolation: { mode: 'none' }, launch: { executable: process.execPath }, exactPort: 9227 }),
        /foreign process/,
    );
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
        isolation: { mode: 'none' },
        launch: { executable: '"%MISSING%"' },
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
