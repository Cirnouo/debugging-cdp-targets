import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fingerprintInputs } from '../../../tooling/security/fingerprints.ts';
import { verifyInstalledTree } from '../../../tooling/security/installed-tree.ts';
import { readLockInventory } from '../../../tooling/security/lock-inventory.ts';
import { lock, required } from '../../fixtures/security-audit.ts';

test('installed tree evidence includes development and optional dependencies, not just roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-inventory-'));
    try {
        await mkdir(path.join(root, 'node_modules/.pnpm'), { recursive: true });
        await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { ws: '8.22.0' } }));
        const modules = { included: { dependencies: true, devDependencies: true, optionalDependencies: true } };
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await writeFile(path.join(root, 'node_modules/.pnpm/lock.yaml'), required(lock.split('---')[2]));
        await verifyInstalledTree(root, readLockInventory(lock));
        modules.included.devDependencies = false;
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await assert.rejects(verifyInstalledTree(root, readLockInventory(lock)), /installed|included/i);
        modules.included.devDependencies = true;
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await writeFile(
            path.join(root, 'node_modules/.pnpm/lock.yaml'),
            required(lock.split('---')[2]).replaceAll('8.22.0', '8.21.0'),
        );
        await assert.rejects(verifyInstalledTree(root, readLockInventory(lock)), /installed|graph/i);
        const before = await fingerprintInputs(
            root,
            ['package.json'],
            ['node_modules/.modules.yaml'],
            readLockInventory(lock),
        );
        await writeFile(path.join(root, 'package.json'), '{}');
        const after = await fingerprintInputs(
            root,
            ['package.json'],
            ['node_modules/.modules.yaml'],
            readLockInventory(lock),
        );
        assert.notEqual(before.code, after.code);
        assert.equal(before.dependencies, after.dependencies);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
