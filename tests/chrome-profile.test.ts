import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyChromePreset, createTargetHost } from '../src/adapters/target-host.ts';

function fixture(available = true) {
    const children: EventEmitter[] = [];
    const inspected: string[] = [];
    const host = createTargetHost({
        profileAvailable: async (directory) => {
            inspected.push(directory);
            return available;
        },
        platformAdapter: {
            reservedRanges: async () => [],
            validateNewRoot: () => {},
            close: async () => true,
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
        spawn: async () => {
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
    const launch = (directory?: string) =>
        host.launch({
            targetKind: 'chrome',
            launchCommand: `"${process.execPath}" ${directory ? `"--user-data-dir=${directory}"` : ''} --remote-debugging-port={port}`,
        });
    return {
        host,
        launch,
        children,
        inspected,
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
