import { createHash } from 'node:crypto';
import path from 'node:path';
import { readRegularFile } from '../../src/adapters/file-evidence.ts';
import { canonicalLockEvidence, type LockInventory } from './lock-inventory.ts';
import type { Fingerprints } from './vulnerability-reviews.ts';

async function hashFiles(root: string, files: string[]) {
    if (!files.length) throw new Error('Empty evidence file set.');
    const hash = createHash('sha256');
    for (const file of [...files].sort()) {
        const absolute = path.resolve(root, file);
        if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Unsafe evidence path: ${file}`);
        const bytes = await readRegularFile(absolute);
        hash.update(`${file}\0${bytes.length}\0`).update(bytes);
    }
    return hash.digest('hex');
}
export async function fingerprintInputs(
    root: string,
    codeFiles: string[],
    configurationFiles: string[],
    inventory: LockInventory,
): Promise<Fingerprints> {
    return {
        code: await hashFiles(root, codeFiles),
        configuration: await hashFiles(root, configurationFiles),
        dependencies: createHash('sha256')
            .update(JSON.stringify(canonicalLockEvidence(inventory.documents)))
            .digest('hex'),
    };
}
