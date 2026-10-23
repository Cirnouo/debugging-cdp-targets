import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { isRecord } from '../../src/shared/errors.ts';
import { canonicalLockEvidence, type LockDocument, type LockInventory, readLockInventory } from './lock-inventory.ts';

function graph(doc: LockDocument) {
    return canonicalLockEvidence({ importers: doc.importers, packages: doc.packages, snapshots: doc.snapshots });
}
export async function verifyLockManifest(root: string, inventory: LockInventory) {
    const runtime = inventory.documents.filter((doc) => !doc.importers['.']?.packageManagerDependencies);
    const document = runtime[0];
    if (runtime.length !== 1 || !document) throw new Error('Lockfile must have exactly one runtime dependency graph.');
    const manifest: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    if (!isRecord(manifest)) throw new Error('Invalid dependency manifest.');
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
        const expected = manifest[group] ?? {};
        if (!isRecord(expected)) throw new Error('Invalid dependency declarations.');
        const actual = document.importers['.']?.[group] ?? {};
        if (
            Object.keys(expected).length !== Object.keys(actual).length ||
            Object.entries(expected).some(([name, version]) => actual[name]?.specifier !== version)
        )
            throw new Error(`Lockfile importer differs from manifest ${group}.`);
    }
    return document;
}
export async function verifyInstalledTree(root: string, inventory: LockInventory) {
    const runtime = await verifyLockManifest(root, inventory);
    const modules: unknown = parse(await readFile(path.join(root, 'node_modules/.modules.yaml'), 'utf8'));
    if (!isRecord(modules) || !isRecord(modules.included)) throw new Error('Invalid installation metadata.');
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        if (modules.included?.[group] !== true) throw new Error(`Installed tree excluded ${group}.`);
    }
    const installed = readLockInventory(await readFile(path.join(root, 'node_modules/.pnpm/lock.yaml'), 'utf8'));
    const installedDocument = installed.documents[0];
    if (
        installed.documents.length !== 1 ||
        !installedDocument ||
        JSON.stringify(graph(runtime)) !== JSON.stringify(graph(installedDocument))
    )
        throw new Error('Installed dependency graph differs from lockfile.');
}
