import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { DataDirectoryError, type DataDirectoryLease, DataDirectoryRegistry } from '../src/adapters/data-directory.ts';

async function fixture(t: TestContext, caseSensitive = false) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-object-claims-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const alpha = path.join(root, 'alpha');
    const sibling = path.join(root, 'sibling');
    await mkdir(alpha);
    await mkdir(path.join(alpha, 'child'));
    await mkdir(sibling);
    const actualPaths = new Map([
        ['/', path.parse(root).root],
        ['/fixture', root],
        ['/fixture/Alpha', alpha],
        ['/fixture/alpha', caseSensitive ? sibling : alpha],
        ['/fixture/Alpha/child', path.join(alpha, 'child')],
        ['/fixture/alpha/child', path.join(alpha, 'child')],
        ['/fixture/sibling', sibling],
    ]);
    const failures = new Set<string>();
    const replacements: { random: string | undefined } = { random: undefined };
    const observation: { afterInspect: ((directory: string) => void) | undefined } = { afterInspect: undefined };
    const creates: string[] = [];
    const removes: string[] = [];
    const actual = (directory: string) => {
        const resolved = actualPaths.get(directory);
        assert.ok(resolved, `Unknown model path: ${directory}`);
        return resolved;
    };
    const registry = new DataDirectoryRegistry({
        platform: 'darwin',
        io: {
            canonical: async (directory) => directory,
            inspect: async (directory) => {
                if (failures.has(directory)) throw new Error('Model identity unavailable.');
                const identity = await lstat(actual(directory), { bigint: true });
                observation.afterInspect?.(directory);
                return identity;
            },
            entries: (directory) => readdir(actual(directory)),
            create: async (directory) => {
                creates.push(directory);
                const child = path.join(actual(path.posix.dirname(directory)), path.posix.basename(directory));
                await mkdir(child);
                actualPaths.set(directory, child);
            },
            createRandom: async (prefix) => {
                creates.push(prefix);
                const child = await mkdtemp(path.join(actual(path.posix.dirname(prefix)), path.posix.basename(prefix)));
                const directory = path.posix.join(path.posix.dirname(prefix), path.basename(child));
                actualPaths.set(directory, replacements.random === undefined ? child : actual(replacements.random));
                return directory;
            },
            remove: async (directory) => {
                removes.push(directory);
                await rm(actual(directory), { recursive: true, force: false });
            },
        },
    });
    return { registry, actualPaths, failures, replacements, observation, creates, removes };
}

test('actual root identity rejects differently spelled aliases without acquiring another lease', async (t) => {
    const { registry } = await fixture(t);
    const held = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'retain');
    await assert.rejects(registry.acquire({ kind: 'existing', path: '/fixture/alpha' }, 'retain'), (error: unknown) => {
        assert.ok(error instanceof DataDirectoryError);
        assert.equal(error.code, 'directory-overlap');
        assert.equal(error.lease, undefined);
        return true;
    });
    await held.release();
    const successor = await registry.acquire({ kind: 'existing', path: '/fixture/alpha' }, 'retain');
    await held.release();
    await assert.rejects(registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'retain'), {
        code: 'directory-overlap',
    });
    await successor.release();
});

test('actual ancestor identities reject both overlap directions across differing root names', async (t) => {
    const { registry } = await fixture(t);
    const parent = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'retain');
    await assert.rejects(registry.acquire({ kind: 'existing', path: '/fixture/alpha/child' }, 'retain'), {
        code: 'directory-overlap',
    });
    await parent.release();
    const child = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha/child' }, 'retain');
    await assert.rejects(registry.acquire({ kind: 'existing', path: '/fixture/alpha' }, 'retain'), {
        code: 'directory-overlap',
    });
    await child.release();
});

test('distinct actual siblings with shared ancestors and different case remain independently claimable', async (t) => {
    const { registry } = await fixture(t, true);
    const alpha = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'retain');
    const sibling = await registry.acquire({ kind: 'existing', path: '/fixture/alpha' }, 'retain');
    await Promise.all([alpha.release(), sibling.release()]);
});

test('held actual parent aliases reject named and random child acquisition before creation', async (t) => {
    const { registry, creates } = await fixture(t);
    const parent = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'retain');
    for (const selection of [
        { kind: 'new', parent: '/fixture/alpha', name: 'new' } as const,
        { kind: 'new', parent: '/fixture/alpha' } as const,
    ]) {
        await assert.rejects(registry.acquire(selection, 'retain'), { code: 'directory-overlap' });
    }
    assert.deepEqual(creates, []);
    await parent.release();
});

test('an unclaimed shared parent permits a new sibling of an existing child claim', async (t) => {
    const { registry, creates } = await fixture(t);
    const child = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha/child' }, 'retain');
    const sibling = await registry.acquire({ kind: 'new', parent: '/fixture/alpha', name: 'new' }, 'retain');
    assert.deepEqual(creates, ['/fixture/alpha/new']);
    await Promise.all([child.release(), sibling.release()]);
});

test('unverifiable held root or ancestor evidence fails conservatively before creating a new child', async (t) => {
    const { registry, failures, creates } = await fixture(t);
    const held = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'retain');
    for (const unavailable of ['/fixture/Alpha', '/fixture']) {
        failures.add(unavailable);
        await assert.rejects(registry.acquire({ kind: 'new', parent: '/fixture/sibling', name: 'new' }, 'retain'), {
            code: 'directory-inspection-failed',
        });
        failures.delete(unavailable);
    }
    assert.deepEqual(creates, []);
    await held.release();
});

test('a changed held root cannot authorize an alias claim or deletion of either object', async (t) => {
    const { registry, actualPaths, removes } = await fixture(t);
    const held = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'delete-on-release');
    const replacement = actualPaths.get('/fixture/sibling');
    assert.ok(replacement);
    actualPaths.set('/fixture/Alpha', replacement);
    await assert.rejects(registry.acquire({ kind: 'existing', path: '/fixture/alpha' }, 'retain'), {
        code: 'directory-inspection-failed',
    });
    await assert.rejects(held.release(), { code: 'directory-identity-changed' });
    assert.deepEqual(removes, []);
    const original = actualPaths.get('/fixture/alpha');
    assert.ok(original);
    actualPaths.set('/fixture/Alpha', original);
    await held.release();
    assert.deepEqual(removes, ['/fixture/Alpha']);
});

test('post-creation physical overlap retains the acquired lease and cannot delete a held object', async (t) => {
    const { registry, replacements, creates, removes } = await fixture(t);
    const held = await registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'retain');
    replacements.random = '/fixture/Alpha';
    let recovered: DataDirectoryLease | undefined;
    await assert.rejects(
        registry.acquire({ kind: 'new', parent: '/fixture' }, 'delete-on-release'),
        (error: unknown) => {
            assert.ok(error instanceof DataDirectoryError);
            assert.equal(error.code, 'directory-overlap');
            assert.ok(error.lease, 'A directory created before later overlap discovery must retain its lease.');
            recovered = error.lease;
            return true;
        },
    );
    assert.equal(creates.length, 1);
    assert.ok(recovered);
    await assert.rejects(recovered.release(), { code: 'directory-overlap' });
    assert.deepEqual(removes, []);
    await held.release();
    await recovered.release();
    assert.deepEqual(removes, [recovered.evidence.path]);
});

test('root replacement while collecting ancestor evidence cannot produce a successful lease', async (t) => {
    const { registry, actualPaths, observation, removes } = await fixture(t);
    const replacement = actualPaths.get('/fixture/sibling');
    assert.ok(replacement);
    observation.afterInspect = (directory) => {
        if (directory === '/fixture') actualPaths.set('/fixture/Alpha', replacement);
    };
    let recovered: DataDirectoryLease | undefined;
    await assert.rejects(
        registry.acquire({ kind: 'existing', path: '/fixture/Alpha' }, 'delete-on-release'),
        (error: unknown) => {
            assert.ok(error instanceof DataDirectoryError);
            assert.equal(error.code, 'directory-inspection-failed');
            assert.ok(error.lease);
            recovered = error.lease;
            return true;
        },
    );
    assert.ok(recovered);
    await assert.rejects(recovered.release(), { code: 'directory-identity-changed' });
    assert.deepEqual(removes, []);
});
