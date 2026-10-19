import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTargetHostFixture } from '../../fixtures/target-host.ts';

test('Chrome managed binding uses the actual canonical directory and rejects an override before spawn', async (t) => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-chrome-binding-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const f = createTargetHostFixture();
    t.after(() => f.finish());
    const isolation = {
        mode: 'data-dir' as const,
        directory: { kind: 'existing' as const, path: directory },
        cleanup: 'retain' as const,
    };
    const target = await f.host.launch(
        {
            isolation,
            targetKind: 'chrome',
            launch: { executable: process.execPath, args: ['--user-data-dir={dataDir}'] },
        },
        { dataDirectory: directory },
    );
    assert.ok(f.launchedArguments[0]?.includes(`--user-data-dir=${directory}`));
    await f.host.close(target);
    for (const args of [
        ['--user-data-dir=/other', '--data={dataDir}'],
        ['--user-data-dir', '{dataDir}'],
        ['--', '--user-data-dir={dataDir}'],
        ['--user-data-dir={dataDir}', '--user-data-dir=/other'],
    ])
        await assert.rejects(
            f.host.launch(
                { isolation, targetKind: 'chrome', launch: { executable: process.execPath, args } },
                { dataDirectory: directory },
            ),
            /profile|directory|user-data-dir/,
        );
    assert.equal(f.launchedArguments.length, 1);
});

test('occupied profile is rejected before spawn, without substituting a temporary directory', async (t) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-occupied-profile-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const actual = path.join(root, 'actual');
    const alias = path.join(root, 'alias');
    await mkdir(actual);
    await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const f = createTargetHostFixture(false);
    try {
        const directory = path.join(alias, 'profile');
        await assert.rejects(f.launch(directory), /profile.*(occupied|unverifiable)/i);
        assert.equal(f.children.length, 0);
        assert.deepEqual(f.inspected, [path.join(actual, 'profile')]);
        assert.deepEqual(f.launchedArguments, []);
    } finally {
        f.finish();
    }
});

test('independent hosts reserve profiles across concurrent launches and release them on exit', async () => {
    const first = createTargetHostFixture();
    const second = createTargetHostFixture();
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
    const f = createTargetHostFixture();
    const occupied = createTargetHostFixture(false);
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
    const first = createTargetHostFixture(async () => {
        queueMicrotask(() => queueMicrotask(() => abort.abort(new Error('Profile acquisition cancelled.'))));
        return true;
    });
    const second = createTargetHostFixture();
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
    const { reserveProfile } = await import('../../../src/adapters/chrome-profile.ts');
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
    const first = createTargetHostFixture();
    const second = createTargetHostFixture();
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
    const { reserveProfile } = await import('../../../src/adapters/chrome-profile.ts');
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
