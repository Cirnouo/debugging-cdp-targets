import assert from 'node:assert/strict';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { DataDirectoryRegistry } from '../../../src/adapters/data-directory.ts';
import { createDirectoryRuntimeFixture, deferred, route, tick } from '../../fixtures/connection-directory-runtime.ts';

for (const action of ['close', 'keep', 'unexpected', 'disconnect'] as const) {
    test(`native descendant resources retain directory after root exit during ${action}`, {
        timeout: 10_000,
    }, async (t) => {
        const resources = deferred();
        t.after(() => resources.resolve());
        const f = await createDirectoryRuntimeFixture(t, { resources: () => resources.promise });
        const active = await f.runtime.controller.start(f.dataOptions(), f.context);
        const held = f.evidence.at(-1);
        assert.ok(held?.mode === 'data-dir');
        let pending: Promise<unknown> | undefined;
        if (action === 'close') pending = f.runtime.controller.stop({ ...route(active), disposition: 'Close' });
        else if (action === 'disconnect') pending = f.runtime.cleanup();
        else {
            if (action === 'keep') await f.runtime.controller.stop({ ...route(active), disposition: 'Keep' });
            f.applications[0]?.exit();
        }
        let completed = false;
        void pending?.then(() => {
            completed = true;
        });
        await tick();
        await tick();
        assert.equal(f.applications[0]?.exitCode, 0);
        const status = f.runtime.controller.status();
        assert.ok('connections' in status);
        assert.deepEqual(status.connections, []);
        assert.ok(f.disposal.includes('route-revoked'));
        assert.ok(f.disposal.includes('upstream'));
        assert.ok(f.disposal.includes('router'));
        assert.ok(f.disposal.includes('target-resources'));
        assert.ok(f.disposal.indexOf('upstream') < f.disposal.indexOf('target-resources'));
        assert.equal(completed, false);
        assert.equal((await lstat(held.path)).isDirectory(), true);
        await assert.rejects(f.directories.acquire({ kind: 'existing', path: held.path }, 'retain'), {
            code: 'directory-overlap',
        });
        resources.resolve();
        await pending;
        await f.waitState('deleted');
        await assert.rejects(lstat(held.path), { code: 'ENOENT' });
    });
}

test('restart waits for old native resource users before creating its successor in the same directory', {
    timeout: 10_000,
}, async (t) => {
    const resources = deferred();
    t.after(() => resources.resolve());
    const f = await createDirectoryRuntimeFixture(t, {
        resources: (index) => (index === 0 ? resources.promise : Promise.resolve()),
    });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    const pending = f.runtime.controller.restart({ ...route(active), scope: 'both' });
    await tick();
    await tick();
    assert.equal(f.applications[0]?.exitCode, 0);
    assert.ok(f.disposal.includes('target-resources'));
    assert.equal(f.launches.length, 1);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    resources.resolve();
    const successor = await pending;
    assert.equal(f.launches.length, 2);
    assert.equal(f.launches[1]?.directory, held.path);
    await f.runtime.controller.stop({ ...route(successor), disposition: 'Close' });
    await f.waitState('deleted');
});

test('late rollback after cancellation holds its native resource claim after actual root exit', {
    timeout: 10_000,
}, async (t) => {
    const creation = deferred();
    const resources = deferred();
    t.after(() => {
        creation.resolve();
        resources.resolve();
    });
    const f = await createDirectoryRuntimeFixture(t, {
        beforeCreation: creation.promise,
        resources: () => resources.promise,
    });
    const abort = new AbortController();
    const pending = f.runtime.controller.start(f.dataOptions(), { ...f.context, signal: abort.signal });
    void pending.catch(() => {});
    await f.waitState('held');
    await f.launchEntered;
    abort.abort(new Error('cancelled permission acquisition'));
    creation.resolve();
    await tick();
    await tick();
    assert.equal(f.applications[0]?.exitCode, 0);
    assert.ok(f.disposal.includes('target-resources'));
    assert.equal(f.state(), 'held');
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    assert.equal((await lstat(held.path)).isDirectory(), true);
    await assert.rejects(f.directories.acquire({ kind: 'existing', path: held.path }, 'retain'), {
        code: 'directory-overlap',
    });
    resources.resolve();
    await assert.rejects(pending, /cancelled permission/);
    await f.waitState('deleted');
});

test('failed native resource observation removes the route and retains the held directory claim', {
    timeout: 10_000,
}, async (t) => {
    let rejectResources: (error: Error) => void = () => {};
    const resources = new Promise<void>((_resolve, reject) => {
        rejectResources = reject;
    });
    const f = await createDirectoryRuntimeFixture(t, { resources: () => resources, expectCleanupFailure: true });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    const pending = f.runtime.controller.stop({ ...route(active), disposition: 'Close' });
    void pending.catch(() => {});
    await tick();
    rejectResources(new Error('Native resources observer unavailable.'));
    await assert.rejects(pending, /observer unavailable/);
    assert.throws(() => f.runtime.controller.status(active.connectionId), /absent|closed/);
    assert.equal(f.state(), 'held');
    assert.equal((await lstat(held.path)).isDirectory(), true);
    await assert.rejects(f.directories.acquire({ kind: 'existing', path: held.path }, 'retain'), {
        code: 'directory-overlap',
    });
    const summary = JSON.stringify(await f.control({ action: 'status' }));
    assert.ok(!summary.includes(held.path));
});

test('cancelled directory inspection holds acquisition until it settles without native launch', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const directories = new DataDirectoryRegistry({
        io: {
            entries: async (directory) => {
                await gate.promise;
                return readdir(directory);
            },
        },
    });
    const f = await createDirectoryRuntimeFixture(t, { directories });
    const abort = new AbortController();
    const reason = new Error('cancelled during directory inspection');
    const pending = f.runtime.controller.start(f.dataOptions(), { ...f.context, signal: abort.signal });
    void pending.catch(() => {});
    await f.waitState('held');
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    abort.abort(reason);
    const closing = f.runtime.cleanup();
    await tick();
    assert.equal((await lstat(held.path)).isDirectory(), true);
    assert.equal(f.launches.length, 0);
    gate.resolve();
    await assert.rejects(pending, (error: unknown) => error === reason);
    await closing;
    assert.equal(f.state(), 'deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('connection isolation is allocated once, held across restart and deleted after final Close', async (t) => {
    const f = await createDirectoryRuntimeFixture(t);
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    assert.equal(held.path, path.join(f.parent, 'profile'));
    assert.equal(f.launches[0]?.directory, held.path);
    await writeFile(path.join(held.path, 'marker'), 'same directory');
    const replacement = await f.runtime.controller.restart({ ...route(active), scope: 'both' });
    assert.equal(f.launches[1]?.directory, held.path);
    assert.equal(await readFile(path.join(held.path, 'marker'), 'utf8'), 'same directory');
    assert.equal(f.state(), 'held');
    await f.runtime.controller.stop({ ...route(replacement), disposition: 'Close' });
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('Keep retains the lease until actual exit applies whole-directory policy', async (t) => {
    const f = await createDirectoryRuntimeFixture(t);
    const selected = path.join(f.parent, 'existing');
    await mkdir(selected);
    await writeFile(path.join(selected, 'prior'), 'pre-existing');
    const active = await f.runtime.controller.start(
        {
            ...f.dataOptions(),
            isolation: {
                mode: 'data-dir',
                directory: { kind: 'existing', path: selected },
                cleanup: 'delete-on-release',
            },
        },
        f.context,
    );
    assert.ok(f.evidence.at(-1)?.mode === 'data-dir');
    await f.runtime.controller.stop({ ...route(active), disposition: 'Keep' });
    assert.equal(await readFile(path.join(selected, 'prior'), 'utf8'), 'pre-existing');
    f.applications[0]?.exit();
    await f.waitState('deleted');
    await assert.rejects(lstat(selected), { code: 'ENOENT' });
    assert.throws(() => f.runtime.controller.status(active.connectionId), /closed|absent/);
});

test('failed restart retains directory until old resources successfully retry without restoring route', async (t) => {
    const f = await createDirectoryRuntimeFixture(t, { failUpstreamClose: true });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    await assert.rejects(f.runtime.controller.restart({ ...route(active), scope: 'both' }), /EACCES/);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    assert.throws(() => f.runtime.controller.status(active.connectionId), /absent|closed/);
    f.allowUpstream();
    await f.runtime.cleanup();
    assert.equal(f.state(), 'deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('failed successor with no live app releases the directory after restart finishes', async (t) => {
    const f = await createDirectoryRuntimeFixture(t, { failLaunch: 2 });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    await assert.rejects(f.runtime.controller.restart({ ...route(active), scope: 'both' }), /Launch failed/);
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('late created app after cancelled acquisition blocks deletion until rollback actual exit', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await createDirectoryRuntimeFixture(t, { beforeCreation: gate.promise, failClose: true });
    const abort = new AbortController();
    const pending = f.runtime.controller.start(f.dataOptions(), { ...f.context, signal: abort.signal });
    void pending.catch(() => {});
    await f.waitState('held');
    await f.launchEntered;
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    abort.abort(new Error('cancelled during permission'));
    assert.equal((await lstat(held.path)).isDirectory(), true);
    gate.resolve();
    await assert.rejects(pending, /did not close/);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    f.applications[0]?.exit();
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('unconfirmed observation and failed Close preserve ownership and directory evidence', async (t) => {
    const f = await createDirectoryRuntimeFixture(t, { failClose: true });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    f.applications[0]?.emit('monitor-error');
    await assert.rejects(f.runtime.controller.stop({ ...route(active), disposition: 'Close' }), /did not close/);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    assert.equal(f.state(), 'held');
    f.allowClose();
    await f.runtime.controller.stop({ ...route(active), disposition: 'Close' });
    await f.waitState('deleted');
});

test('confirmed app exit while host acquisition is pending keeps the lease until launch settles', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await createDirectoryRuntimeFixture(t, { afterCreation: gate.promise });
    const pending = f.runtime.controller.start(f.dataOptions(), f.context);
    void pending.catch(() => {});
    await f.launchEntered;
    await tick();
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    f.applications[0]?.exit();
    await tick();
    assert.equal((await lstat(held.path)).isDirectory(), true);
    gate.resolve();
    await assert.rejects(pending, /exited|retired/);
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('actual successor exit racing restart completion wins final release after the successor hold', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await createDirectoryRuntimeFixture(t, { replacementCreation: gate.promise });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    const pending = f.runtime.controller.restart({ ...route(active), scope: 'both' });
    void pending.catch(() => {});
    while (f.applications.length < 2) await tick();
    f.applications[1]?.exit();
    await tick();
    assert.equal((await lstat(held.path)).isDirectory(), true);
    gate.resolve();
    await assert.rejects(pending, /exited|retired/);
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
    assert.throws(() => f.runtime.controller.status(active.connectionId), /absent|closed/);
});

test('cancelled restart in the successor gap releases only after pending replacement resources settle', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await createDirectoryRuntimeFixture(t, { replacementRouter: gate.promise });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    const abort = new AbortController();
    const reason = new Error('cancelled successor');
    const pending = f.runtime.controller.restart({ ...route(active), scope: 'both' }, { signal: abort.signal });
    void pending.catch(() => {});
    while (f.applications[0]?.exitCode === null) await tick();
    abort.abort(reason);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    gate.resolve();
    await assert.rejects(
        pending,
        (error: unknown) =>
            error === reason || (error instanceof Error && /cancelled|retired|exited/.test(error.message)),
    );
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('directory deletion failure keeps original start evidence for gateway cleanup retry', async (t) => {
    let fail = true;
    const directories = new DataDirectoryRegistry({
        io: {
            remove: async (directory) => {
                if (fail) throw new Error(`private filesystem failure ${directory}`);
                await rm(directory, { recursive: true });
            },
        },
    });
    const f = await createDirectoryRuntimeFixture(t, { directories });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    await assert.rejects(f.runtime.controller.stop({ ...route(active), disposition: 'Close' }), /cleanup/i);
    assert.equal(f.state(), 'cleanup-failed');
    assert.equal((await lstat(held.path)).isDirectory(), true);
    fail = false;
    await f.runtime.cleanup();
    assert.equal(f.state(), 'deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('failed Chrome startup never deletes an externally occupied selected directory', async (t) => {
    let occupied = true;
    const f = await createDirectoryRuntimeFixture(t, { failLaunch: 1, profileAvailable: async () => !occupied });
    const selected = path.join(f.parent, 'external');
    await mkdir(selected);
    await writeFile(path.join(selected, 'prior'), 'external active data');
    await assert.rejects(
        f.runtime.controller.start(
            {
                targetKind: 'chrome',
                launch: { executable: process.execPath, args: ['--user-data-dir={dataDir}'] },
                isolation: {
                    mode: 'data-dir',
                    directory: { kind: 'existing', path: selected },
                    cleanup: 'delete-on-release',
                },
            },
            f.context,
        ),
        /Launch failed/,
    );
    assert.equal(await readFile(path.join(selected, 'prior'), 'utf8'), 'external active data');
    assert.equal(f.state(), 'cleanup-failed');
    occupied = false;
    await f.runtime.cleanup();
    assert.equal(f.state(), 'deleted');
    await assert.rejects(lstat(selected), { code: 'ENOENT' });
});

test('Chrome release rechecks external native profile occupancy after our application exits', async (t) => {
    let occupied = false;
    const f = await createDirectoryRuntimeFixture(t, { profileAvailable: async () => !occupied });
    const active = await f.runtime.controller.start(
        {
            ...f.dataOptions(),
            targetKind: 'chrome',
            launch: { executable: process.execPath, args: ['--user-data-dir={dataDir}'] },
        },
        f.context,
    );
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    occupied = true;
    await assert.rejects(f.runtime.controller.stop({ ...route(active), disposition: 'Close' }), /cleanup/i);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    assert.equal(f.state(), 'cleanup-failed');
    occupied = false;
    await f.runtime.cleanup();
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});
