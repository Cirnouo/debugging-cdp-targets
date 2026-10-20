import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../../src/shared/errors.ts';
import { auditDistribution } from '../../../tooling/distribution/audit-plugins.ts';
import { PLUGIN_HOSTS } from '../../../tooling/distribution/host-descriptors.ts';
import { compareDistributionTrees, readDistributionTree } from '../../../tooling/distribution/regular-file-tree.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));

test('physical Plugin inventory rejects unexpected empty directories', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-empty-directory-')));
    try {
        await mkdir(path.join(root, 'extra'));
        await assert.rejects(readDistributionTree(root), /empty|unexpected/i);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('installation comparison reports missing, changed, and extra bytes', () => {
    const source = new Map([
        ['plugin.json', Buffer.from('one')],
        ['mcp.json', Buffer.from('two')],
    ]);
    assert.deepEqual(compareDistributionTrees(source, source), []);
    assert.equal(
        compareDistributionTrees(
            source,
            new Map([
                ['plugin.json', Buffer.from('wrong')],
                ['test.ts', Buffer.from('extra')],
            ]),
        ).length,
        3,
    );
});

test('distribution audit accepts independent App version and rejects stale peer versions', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-version-distribution-')));
    try {
        for (const file of ['packaging', 'plugins', '.agents', '.claude-plugin', 'LICENSE']) {
            await cp(new URL(`../../../${file}`, import.meta.url), path.join(root, file), { recursive: true });
        }
        await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.3.4' }));
        assert.deepEqual(await auditDistribution(root), []);
        for (const host of PLUGIN_HOSTS) {
            const manifest = path.join(root, host.payloadRoot, host.manifest);
            const original = await readFile(manifest, 'utf8');
            const data = JSON.parse(original);
            await writeFile(manifest, JSON.stringify({ ...data, version: '0.2.0' }));
            assert.ok((await auditDistribution(root)).some((error) => /version|Changed/.test(error)));
            await writeFile(manifest, original);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('distribution audit rejects either peer metadata, license or official resource drift', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-peer-audit-')));
    try {
        for (const file of ['plugins', 'packaging', '.agents', '.claude-plugin', 'package.json', 'LICENSE'])
            await cp(path.join(root, file), path.join(fixture, file), { recursive: true });
        assert.deepEqual(await auditDistribution(fixture), []);
        for (const host of PLUGIN_HOSTS) {
            for (const file of [host.manifest, 'LICENSE', host.mcp]) {
                const target = path.join(fixture, host.payloadRoot, file);
                const original = await readFile(target);
                await writeFile(
                    target,
                    file === host.manifest ? original.toString().replace('0.1.0', '0.1.1') : 'drift',
                );
                assert.ok((await auditDistribution(fixture)).length, `${host.id}/${file}`);
                await writeFile(target, original);
            }
            const marketplace = path.join(fixture, host.marketplace);
            const original = await readFile(marketplace);
            await rm(marketplace);
            await symlink(path.join(root, host.marketplace), marketplace);
            assert.ok(
                (await auditDistribution(fixture)).some((error) => /link|identity/i.test(error)),
                host.marketplace,
            );
            await rm(marketplace);
            await writeFile(marketplace, original);
            const manifest = path.join(fixture, host.payloadRoot, host.manifest);
            const manifestBytes = await readFile(manifest);
            await writeFile(manifest, manifestBytes.toString().replace('{', '{"name":"shadow",'));
            assert.ok((await auditDistribution(fixture)).some((error) => /unique|duplicate/i.test(error)));
            await writeFile(manifest, manifestBytes);
        }
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('physical inventory rejects linked roots and linked parent directories', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-peer-link-')));
    try {
        const original = path.join(fixture, 'original');
        await mkdir(path.join(original, 'nested'), { recursive: true });
        await writeFile(path.join(original, 'nested', 'file'), 'bytes');
        const link = path.join(fixture, 'link');
        await symlink(original, link, 'junction');
        await assert.rejects(readDistributionTree(link), /link/);
        await assert.rejects(readDistributionTree(path.join(link, 'nested')), /link/);
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('strict payload trees preserve ordinary bytes before independently refusing linked children', async (context) => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-strict-tree-')));
    try {
        const owned = path.join(temporary, 'payload');
        await mkdir(path.join(owned, 'nested'), { recursive: true });
        await writeFile(path.join(owned, 'nested', 'file'), Buffer.from([0, 1, 255]));
        await writeFile(path.join(owned, 'ordinary'), 'ordinary');
        const files = await readDistributionTree(owned);
        assert.deepEqual([...files.keys()].sort(), ['nested/file', 'ordinary']);
        assert.deepEqual(files.get('nested/file'), Buffer.from([0, 1, 255]));
        assert.deepEqual(files.get('ordinary'), Buffer.from('ordinary'));
        await assert.rejects(readDistributionTree(path.join(owned, 'ordinary')), /Plugin directories must be regular/);
        const outsideFile = path.join(temporary, 'outside-file');
        const outsideDirectory = path.join(temporary, 'outside-directory');
        await writeFile(outsideFile, 'outside bytes');
        await mkdir(outsideDirectory);
        await writeFile(path.join(outsideDirectory, 'outside'), 'outside directory bytes');
        for (const [name, target, type] of [
            ['file-link', outsideFile, 'file'],
            ['directory-link', outsideDirectory, 'junction'],
        ] as const) {
            const link = path.join(owned, name);
            try {
                await symlink(target, link, type);
            } catch (error) {
                if (
                    isRecord(error) &&
                    typeof error.code === 'string' &&
                    ['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)
                ) {
                    context.diagnostic(`SKIP local ${name} capability: ${error.code}`);
                    continue;
                }
                throw error;
            }
            await assert.rejects(readDistributionTree(owned), /Plugin may not contain symlinks/);
            await unlink(link);
        }
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
});
