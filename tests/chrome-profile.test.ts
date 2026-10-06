import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyChromePreset, createTargetHost } from '../src/adapters/target-host.ts';

function fixture(available: boolean | (() => Promise<boolean>) = true) {
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

test('Chrome defaults to stable chrome-profile and preserves an explicit separate directory argument', () => {
    const home = process.platform === 'win32' ? process.env.USERPROFILE : os.homedir();
    assert.ok(home);
    assert.ok(
        applyChromePreset([]).includes(
            `--user-data-dir=${path.join(home, '.cache', 'chrome-devtools-mcp', 'chrome-profile')}`,
        ),
    );
    const args = ['--user-data-dir', 'chosen profile'];
    assert.deepEqual(applyChromePreset(args).slice(0, 2), args);
    for (const invalid of [['--user-data-dir'], ['--user-data-dir='], ['--user-data-dir=a', '--user-data-dir=b']])
        assert.throws(() => applyChromePreset(invalid), /profile|user-data-dir/i);
});

test('Chrome launch disables updater scheduling and preserves the switch during exact recovery', async () => {
    const f = fixture();
    const directory = path.join(os.tmpdir(), 'dct-updater-preset-fixture');
    try {
        const target = await f.launch(directory);
        assert.equal(f.launchedArguments[0]?.filter((value) => value === '--disable-updater-scheduler').length, 1);
        assert.ok(target.launchDefinition);
        assert.equal(await f.host.close(target), true);
        await f.host.launch({
            targetKind: 'chrome',
            launch: { executable: '' },
            exactPort: target.port,
            launchDefinition: target.launchDefinition,
        });
        assert.deepEqual(f.launchedArguments[1], f.launchedArguments[0]);
    } finally {
        f.finish();
    }
});

test('Chrome preset preserves an explicit updater scheduler switch without mutating caller arguments', () => {
    const arguments_ = ['--user-data-dir', 'chosen profile', '--disable-updater-scheduler'];
    const result = applyChromePreset(arguments_);
    assert.equal(result.filter((value) => value === '--disable-updater-scheduler').length, 1);
    assert.deepEqual(arguments_, ['--user-data-dir', 'chosen profile', '--disable-updater-scheduler']);
    assert.deepEqual(applyChromePreset(result), result);
});

test('Windows Chrome spawns the fixed screenshot feature and preserves exact recovery argv', {
    skip: process.platform !== 'win32',
}, async () => {
    const f = fixture();
    const directory = path.join(os.tmpdir(), 'dct-screenshot-preset-fixture');
    const launch = {
        executable: process.execPath,
        args: [
            `--user-data-dir=${directory}`,
            '--remote-debugging-port={port}',
            '--enable-features=Other:param/value',
            '--disable-features=Unrelated',
            '--label=中文',
        ],
    };
    try {
        const target = await f.host.launch({ targetKind: 'chrome', launch });
        assert.ok(f.launchedArguments[0]?.includes('--enable-features=Other:param/value,CDPScreenshotNewSurface'));
        assert.ok(f.launchedArguments[0]?.includes('--disable-features=Unrelated'));
        assert.ok(f.launchedArguments[0]?.includes('--label=中文'));
        assert.equal(launch.args[2], '--enable-features=Other:param/value');
        assert.ok(target.launchDefinition);
        await f.host.close(target);
        await f.host.launch({
            targetKind: 'chrome',
            launch: { executable: '' },
            exactPort: target.port,
            launchDefinition: target.launchDefinition,
        });
        assert.deepEqual(f.launchedArguments[1], f.launchedArguments[0]);
    } finally {
        f.finish();
    }
});

test('Windows Chrome feature conflicts fail before profile acquisition and spawn and release the claimed port', {
    skip: process.platform !== 'win32',
}, async () => {
    const f = fixture();
    const directory = path.join(os.tmpdir(), 'dct-screenshot-conflict-fixture');
    try {
        await assert.rejects(
            f.host.launch({
                targetKind: 'chrome',
                basePort: 20222,
                launch: {
                    executable: process.execPath,
                    args: [`--user-data-dir=${directory}`, '--disable-features=CDPScreenshotNewSurface'],
                },
            }),
            /CDPScreenshotNewSurface.*(disable|conflict)/i,
        );
        assert.deepEqual(f.inspected, []);
        assert.deepEqual(f.launchedArguments, []);
        const target = await f.host.launch({
            targetKind: 'chrome',
            basePort: 20222,
            launch: { executable: process.execPath, args: [`--user-data-dir=${directory}`] },
        });
        assert.equal(target.port, 20222, 'The rejected launch leaked its transient port claim.');
        assert.equal(f.inspected.length, 1);
        await f.host.close(target);
    } finally {
        f.finish();
    }
});

test('generic CDP launch preserves caller feature choices without applying the Chrome preset', async () => {
    const f = fixture();
    const args = ['--remote-debugging-port={port}', '--disable-features=CDPScreenshotNewSurface', '--label=中文'];
    try {
        const target = await f.host.launch({
            targetKind: 'generic-cdp',
            basePort: 20222,
            launch: { executable: process.execPath, args },
        });
        assert.deepEqual(f.launchedArguments[0], [
            '--remote-debugging-port=20222',
            '--disable-features=CDPScreenshotNewSurface',
            '--label=中文',
        ]);
        assert.deepEqual(f.inspected, []);
        await f.host.close(target);
    } finally {
        f.finish();
    }
});

test('occupied profile is rejected before spawn, without substituting a temporary directory', async () => {
    const f = fixture(false);
    try {
        await assert.rejects(f.launch(), /profile.*(occupied|unverifiable)/i);
        assert.equal(f.children.length, 0);
        assert.match(f.inspected[0] ?? '', /chrome-profile$/);
    } finally {
        f.finish();
    }
});

test('independent hosts reserve profiles across concurrent launches and release them on exit', async () => {
    const first = fixture();
    const second = fixture();
    const directory = path.join(os.tmpdir(), 'dct-profile-claim-fixture');
    try {
        await first.launch(directory);
        await assert.rejects(second.launch(directory), /profile.*occupied/i);
        await second.launch(`${directory}-other`);
        first.finish();
        await second.launch(directory);
        assert.equal(second.children.length, 2);
    } finally {
        first.finish();
        second.finish();
    }
});

test('normal Close releases a profile claim and failed occupancy checks do not retain claims', async () => {
    const f = fixture();
    const occupied = fixture(false);
    const directory = path.join(os.tmpdir(), 'dct-profile-close-fixture');
    try {
        await assert.rejects(occupied.launch(directory), /profile/);
        const target = await f.launch(directory);
        assert.equal(await f.host.close(target), true);
        await f.launch(directory);
    } finally {
        f.finish();
        occupied.finish();
    }
});

test('cancellation after profile availability resolves releases the late acquired profile without spawning', async () => {
    const abort = new AbortController();
    const first = fixture(async () => {
        queueMicrotask(() => queueMicrotask(() => abort.abort(new Error('Profile acquisition cancelled.'))));
        return true;
    });
    const second = fixture();
    const directory = path.join(os.tmpdir(), 'dct-profile-late-cancel-fixture');
    try {
        await assert.rejects(first.launch(directory, abort.signal), /cancelled/);
        assert.equal(first.children.length, 0);
        const next = await second.launch(directory);
        assert.equal(second.children.length, 1, 'The cancelled acquisition must release its eventual claim.');
        await second.host.close(next);
    } finally {
        first.finish();
        second.finish();
    }
});

test('old repeated profile release cannot release a newer owner', async () => {
    const { reserveProfile } = await import('../src/adapters/chrome-profile.ts');
    const directory = path.join(os.tmpdir(), 'dct-profile-generation-fixture');
    const oldRelease = await reserveProfile(directory, async () => true);
    oldRelease();
    const newRelease = await reserveProfile(directory, async () => true);
    try {
        oldRelease();
        await assert.rejects(
            reserveProfile(directory, async () => true),
            /occupied/,
        );
    } finally {
        newRelease();
    }
});

test('a live Chrome profile remains reserved when cleanup is requested without actual exit', async () => {
    const first = fixture();
    const second = fixture();
    const directory = path.join(os.tmpdir(), 'dct-profile-live-release-fixture');
    try {
        const target = await first.launch(directory);
        target.releaseProfile?.();
        await assert.rejects(second.launch(directory), /profile.*occupied/i);
        first.finish();
        const replacement = await second.launch(directory);
        assert.equal(await second.host.close(replacement), true);
    } finally {
        first.finish();
        second.finish();
    }
});

test('unverifiable profile reports an actionable directory error and releases the reservation', async () => {
    const { reserveProfile } = await import('../src/adapters/chrome-profile.ts');
    const directory = path.join(os.tmpdir(), 'dct-profile-unverifiable-fixture');
    await assert.rejects(
        reserveProfile(directory, async () => {
            throw new Error('permission denied');
        }),
        /unverifiable.*--user-data-dir/,
    );
    const release = await reserveProfile(directory, async () => true);
    release();
});
