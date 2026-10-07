import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    DataDirectoryError,
    type DataDirectoryLease,
    DataDirectoryRegistry,
    isAbsoluteDataDirectory,
} from '../src/adapters/data-directory.ts';

async function fixture(t: import('node:test').TestContext) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-directory-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return realpath(root);
}

test('absolute directory syntax rejects Windows current-drive roots and drive-relative paths', () => {
    for (const value of [
        '/profile',
        '\\profile',
        'C:profile',
        'relative',
        '//host',
        '\\\\host',
        '\\\\?\\C:profile',
        '\\\\?\\UNC\\host',
    ]) {
        assert.equal(isAbsoluteDataDirectory(value, 'win32'), false, value);
    }
    for (const value of [
        'C:/profile',
        'c:\\profile',
        '\\\\host\\share',
        '\\\\?\\C:\\profile',
        '\\\\?\\UNC\\host\\share\\p',
        '\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\',
    ]) {
        assert.equal(isAbsoluteDataDirectory(value, 'win32'), true, value);
    }
    assert.equal(isAbsoluteDataDirectory('/profile', 'linux'), true);
    assert.equal(isAbsoluteDataDirectory('relative', 'darwin'), false);
});

test('POSIX trailing backslash is a path byte rather than an ancestor separator', {
    skip: process.platform === 'win32',
}, async (t) => {
    const root = await fixture(t);
    await mkdir(path.join(root, 'a'));
    await mkdir(path.join(root, 'a\\'));
    const registry = new DataDirectoryRegistry();
    const plain = await registry.acquire({ kind: 'existing', path: path.join(root, 'a') }, 'retain');
    const backslash = await registry.acquire({ kind: 'existing', path: path.join(root, 'a\\') }, 'retain');
    await Promise.all([plain.release(), backslash.release()]);
});

test('random creation cannot replace an outstanding claim even after its original root disappears', async (t) => {
    const root = await fixture(t);
    const selected = path.join(root, 'dct-reused');
    await mkdir(selected);
    const registry = new DataDirectoryRegistry({
        io: {
            createRandom: async () => {
                await rm(selected, { recursive: true });
                await mkdir(selected);
                return selected;
            },
        },
    });
    const original = await registry.acquire({ kind: 'existing', path: selected }, 'retain');
    let recovered: DataDirectoryLease | undefined;
    await assert.rejects(registry.acquire({ kind: 'new', parent: root }, 'retain'), (error: unknown) => {
        assert.ok(error instanceof DataDirectoryError && error.code === 'directory-overlap' && error.lease);
        recovered = error.lease;
        return true;
    });
    assert.ok(recovered);
    await original.release();
    await assert.rejects(registry.acquire({ kind: 'existing', path: selected }, 'retain'), {
        code: 'directory-overlap',
    });
    await recovered.release();
    const next = await registry.acquire({ kind: 'existing', path: selected }, 'retain');
    await next.release();
});

test('existing nonempty acquisition retains hidden entries and release is idempotent', async (t) => {
    const root = await fixture(t);
    await writeFile(path.join(root, '.hidden'), 'prior content');
    const registry = new DataDirectoryRegistry();
    const lease = await registry.acquire({ kind: 'existing', path: root }, 'retain');
    assert.equal(lease.evidence.path, root);
    assert.equal(lease.evidence.nonempty, true);
    assert.equal(lease.evidence.state, 'held');
    await lease.release();
    await lease.release();
    assert.equal(lease.evidence.state, 'retained');
    assert.equal(await readFile(path.join(root, '.hidden'), 'utf8'), 'prior content');
    const successor = await registry.acquire({ kind: 'existing', path: root }, 'retain');
    await lease.release();
    await assert.rejects(registry.acquire({ kind: 'existing', path: root }, 'retain'), { code: 'directory-overlap' });
    await successor.release();
});

test('new selection exclusively creates named or random children under an existing parent', async (t) => {
    const root = await fixture(t);
    const registry = new DataDirectoryRegistry();
    const named = await registry.acquire({ kind: 'new', parent: root, name: '中文 %NAME% {port}' }, 'retain');
    assert.equal(path.basename(named.evidence.path), '中文 %NAME% {port}');
    assert.equal(named.evidence.nonempty, false);
    await named.release();
    await assert.rejects(registry.acquire({ kind: 'new', parent: root, name: '中文 %NAME% {port}' }, 'retain'), {
        code: 'directory-exists',
    });
    const random = await registry.acquire({ kind: 'new', parent: root }, 'delete-on-release');
    assert.match(path.basename(random.evidence.path), /^dct-.+/);
    await random.release();
    assert.equal(random.evidence.state, 'deleted');
    await assert.rejects(lstat(random.evidence.path), { code: 'ENOENT' });
    for (const selection of [
        { kind: 'existing', path: path.join(root, 'missing') } as const,
        { kind: 'new', parent: path.join(root, 'missing') } as const,
    ])
        await assert.rejects(registry.acquire(selection, 'retain'), { code: 'directory-missing' });
    await writeFile(path.join(root, 'file'), 'file');
    await assert.rejects(registry.acquire({ kind: 'existing', path: path.join(root, 'file') }, 'retain'), {
        code: 'directory-not-directory',
    });
});

test('concurrent canonical equal and ancestor claims reject overlap but permit siblings', async (t) => {
    const root = await fixture(t);
    await mkdir(path.join(root, 'a'));
    await mkdir(path.join(root, 'b'));
    const registry = new DataDirectoryRegistry();
    const outcomes = await Promise.allSettled([
        registry.acquire({ kind: 'existing', path: root }, 'retain'),
        registry.acquire({ kind: 'existing', path: path.join(root, 'a') }, 'retain'),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    for (const result of outcomes) if (result.status === 'fulfilled') await result.value.release();
    const a = await registry.acquire({ kind: 'existing', path: path.join(root, 'a') }, 'retain');
    const b = await registry.acquire({ kind: 'existing', path: path.join(root, 'b') }, 'retain');
    await assert.rejects(registry.acquire({ kind: 'existing', path: root }, 'retain'), { code: 'directory-overlap' });
    await assert.rejects(registry.acquire({ kind: 'new', parent: path.join(root, 'a'), name: 'child' }, 'retain'), {
        code: 'directory-overlap',
    });
    await assert.rejects(lstat(path.join(root, 'a', 'child')), { code: 'ENOENT' });
    await Promise.all([a.release(), b.release()]);
});

test('canonical root link cleanup removes prior contents without following internal links or a retargeted selection', async (t) => {
    const root = await fixture(t);
    const selected = path.join(root, 'selected');
    const actual = path.join(root, 'actual');
    const external = path.join(root, 'external');
    await mkdir(actual);
    await mkdir(external);
    await writeFile(path.join(actual, 'prior'), 'prior');
    await writeFile(path.join(external, 'safe'), 'outside');
    await symlink(actual, selected, process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(external, path.join(actual, 'child-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const registry = new DataDirectoryRegistry();
    const lease = await registry.acquire({ kind: 'existing', path: selected }, 'delete-on-release');
    assert.equal(lease.evidence.path, actual);
    await rm(selected);
    await symlink(external, selected, process.platform === 'win32' ? 'junction' : 'dir');
    await lease.release();
    await assert.rejects(lstat(actual), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(external, 'safe'), 'utf8'), 'outside');
});

test('root identity replacement blocks deletion and retains the claim until original root returns', async (t) => {
    const root = await fixture(t);
    const selected = path.join(root, 'selected');
    await mkdir(selected);
    const registry = new DataDirectoryRegistry();
    const lease = await registry.acquire({ kind: 'existing', path: selected }, 'delete-on-release');
    await rename(selected, path.join(root, 'original'));
    await mkdir(selected);
    await writeFile(path.join(selected, 'safe'), 'replacement');
    await assert.rejects(lease.release(), { code: 'directory-identity-changed' });
    assert.equal(lease.evidence.state, 'cleanup-failed');
    assert.equal(await readFile(path.join(selected, 'safe'), 'utf8'), 'replacement');
    await assert.rejects(registry.acquire({ kind: 'existing', path: selected }, 'retain'), {
        code: 'directory-overlap',
    });
    await rm(selected, { recursive: true });
    await rename(path.join(root, 'original'), selected);
    await lease.release();
    assert.equal(lease.evidence.state, 'deleted');
});

test('application writes do not invalidate directory identity and deletion retry coalesces callers', async (t) => {
    const root = await fixture(t);
    let fail = true;
    const registry = new DataDirectoryRegistry({
        io: {
            remove: async (directory) => {
                if (fail) throw Object.assign(new Error('private path must not leak'), { code: 'EACCES' });
                await rm(directory, { recursive: true });
            },
        },
    });
    const lease = await registry.acquire({ kind: 'new', parent: root, name: 'app' }, 'delete-on-release');
    await writeFile(path.join(lease.evidence.path, 'app-data'), 'changed');
    const one = lease.release();
    const two = lease.release();
    assert.equal(one, two);
    await assert.rejects(
        one,
        (error: unknown) =>
            error instanceof DataDirectoryError &&
            error.code === 'directory-cleanup-failed' &&
            !error.message.includes('private'),
    );
    assert.equal(lease.evidence.state, 'cleanup-failed');
    await assert.rejects(registry.acquire({ kind: 'existing', path: lease.evidence.path }, 'retain'), {
        code: 'directory-overlap',
    });
    fail = false;
    await lease.release();
    await lease.release();
    assert.equal(lease.evidence.state, 'deleted');
});

test('creation followed by identity failure preserves the lease and actual path for late resolution', async (t) => {
    const root = await fixture(t);
    const registry = new DataDirectoryRegistry({
        io: {
            inspect: async (directory) => {
                if (directory !== root && path.basename(directory).startsWith('dct-'))
                    throw new Error('inspection failed');
                return lstat(directory, { bigint: true });
            },
        },
    });
    let observedPath: string | undefined;
    await assert.rejects(
        registry.acquire({ kind: 'new', parent: root }, 'delete-on-release', (lease) => {
            observedPath = lease.evidence.path;
        }),
        (error: unknown) => {
            assert.ok(error instanceof DataDirectoryError);
            assert.ok(error.lease);
            assert.equal(error.lease.evidence.path, observedPath);
            assert.equal(error.lease.evidence.state, 'cleanup-failed');
            return true;
        },
    );
    assert.ok(observedPath);
    assert.equal((await lstat(observedPath)).isDirectory(), true);
    await assert.rejects(registry.acquire({ kind: 'existing', path: observedPath }, 'retain'), {
        code: 'directory-overlap',
    });
});

test('post-creation entry inspection failure keeps identity so authorized release can retry', async (t) => {
    const root = await fixture(t);
    const registry = new DataDirectoryRegistry({
        io: {
            entries: async () => {
                throw new Error('read failed');
            },
        },
    });
    let recovered: DataDirectoryLease | undefined;
    await assert.rejects(
        registry.acquire({ kind: 'new', parent: root, name: 'created' }, 'delete-on-release'),
        (error: unknown) => {
            assert.ok(error instanceof DataDirectoryError && error.lease);
            assert.equal(error.lease.evidence.path, path.join(root, 'created'));
            recovered = error.lease;
            return true;
        },
    );
    assert.ok(recovered);
    await recovered.release();
    assert.equal(recovered.evidence.state, 'deleted');
    await assert.rejects(lstat(path.join(root, 'created')), { code: 'ENOENT' });
});

test('release requested by the acquisition observer waits for identity and inspection completion', async (t) => {
    const root = await fixture(t);
    let release: Promise<import('../src/domains/data-isolation.ts').DataDirectoryEvidence> | undefined;
    const registry = new DataDirectoryRegistry();
    const lease = await registry.acquire(
        { kind: 'new', parent: root, name: 'early-release' },
        'delete-on-release',
        (acquired) => {
            release = acquired.release();
            void release.catch(() => undefined);
        },
    );
    assert.ok(release);
    await release;
    assert.equal(lease.evidence.state, 'deleted');
    await assert.rejects(lstat(lease.evidence.path), { code: 'ENOENT' });
});

test('named creation followed by root replacement still exposes evidence and holds its claim', async (t) => {
    const root = await fixture(t);
    const created = path.join(root, 'replaced');
    const registry = new DataDirectoryRegistry({
        io: {
            inspect: async (directory) => {
                if (directory === created) {
                    await rm(created, { recursive: true });
                    await writeFile(created, 'replacement');
                }
                return lstat(directory, { bigint: true });
            },
        },
    });
    let recovered: DataDirectoryLease | undefined;
    await assert.rejects(
        registry.acquire({ kind: 'new', parent: root, name: 'replaced' }, 'delete-on-release'),
        (error: unknown) => {
            assert.ok(error instanceof DataDirectoryError && error.lease);
            recovered = error.lease;
            assert.equal(error.lease.evidence.path, created);
            return true;
        },
    );
    assert.ok(recovered);
    await assert.rejects(registry.acquire({ kind: 'existing', path: created }, 'retain'), {
        code: 'directory-overlap',
    });
    await assert.rejects(recovered.release(), { code: 'directory-identity-changed' });
    assert.equal(await readFile(created, 'utf8'), 'replacement');
});

test('canonical claims respect case semantics, equal root links and separator-delimited ancestors', async (t) => {
    const root = await fixture(t);
    const a = path.join(root, 'a');
    await mkdir(a);
    await mkdir(path.join(root, 'ab'));
    const alias = path.join(root, 'alias');
    await symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const registry = new DataDirectoryRegistry();
    const lease = await registry.acquire({ kind: 'existing', path: a }, 'retain');
    await assert.rejects(registry.acquire({ kind: 'existing', path: alias }, 'retain'), { code: 'directory-overlap' });
    const upperPath = path.join(root, 'A');
    await mkdir(upperPath, { recursive: true });
    const lowerIdentity = await lstat(a, { bigint: true });
    const upperIdentity = await lstat(upperPath, { bigint: true });
    if (lowerIdentity.dev === upperIdentity.dev && lowerIdentity.ino === upperIdentity.ino) {
        await assert.rejects(registry.acquire({ kind: 'existing', path: upperPath }, 'retain'), {
            code: 'directory-overlap',
        });
    } else {
        const uppercase = await registry.acquire({ kind: 'existing', path: upperPath }, 'retain');
        await uppercase.release();
    }
    const sibling = await registry.acquire({ kind: 'existing', path: path.join(root, 'ab') }, 'retain');
    await Promise.all([lease.release(), sibling.release()]);
});

for (const [label, upperCanonical] of [
    ['case-sensitive', '/fixture/A'],
    ['case-insensitive', '/fixture/a'],
] as const) {
    test(`POSIX ${label} canonical evidence controls overlap without platform case folding`, async (t) => {
        const root = await fixture(t);
        const lower = path.join(root, 'lower');
        const upper = path.join(root, 'upper');
        await mkdir(lower);
        await mkdir(upper);
        const canonicalPaths = new Map([
            ['/fixture/a', '/fixture/a'],
            ['/fixture/A', upperCanonical],
        ]);
        const actualPaths = new Map([
            ['/', path.parse(root).root],
            ['/fixture', root],
            ['/fixture/a', lower],
            ['/fixture/A', upper],
        ]);
        const actualPath = (directory: string) => {
            const actual = actualPaths.get(directory);
            assert.ok(actual, 'Only known canonical directories may reach inspection.');
            return actual;
        };
        const registry = new DataDirectoryRegistry({
            platform: 'darwin',
            io: {
                canonical: async (directory) => {
                    const canonical = canonicalPaths.get(directory);
                    assert.ok(canonical, 'Only known requested directories may reach canonicalization.');
                    return canonical;
                },
                inspect: (directory) => lstat(actualPath(directory), { bigint: true }),
                entries: (directory) => readdir(actualPath(directory)),
            },
        });
        const lease = await registry.acquire({ kind: 'existing', path: '/fixture/a' }, 'retain');
        if (upperCanonical === '/fixture/a') {
            await assert.rejects(registry.acquire({ kind: 'existing', path: '/fixture/A' }, 'retain'), {
                code: 'directory-overlap',
            });
        } else {
            const uppercase = await registry.acquire({ kind: 'existing', path: '/fixture/A' }, 'retain');
            assert.equal(uppercase.evidence.path, '/fixture/A');
            await uppercase.release();
        }
        await lease.release();
        const successor = await registry.acquire({ kind: 'existing', path: '/fixture/A' }, 'retain');
        assert.equal(successor.evidence.path, upperCanonical);
        await successor.release();
    });
}

test('invalid selection fails before creating any directory', async (t) => {
    const root = await fixture(t);
    const registry = new DataDirectoryRegistry();
    await assert.rejects(registry.acquire({ kind: 'existing', path: 'relative' }, 'retain'), {
        code: 'directory-invalid',
    });
    await assert.rejects(registry.acquire({ kind: 'new', parent: root, name: '../escape' }, 'retain'), {
        code: 'directory-invalid',
    });
    assert.deepEqual(await readdir(root), []);
});
