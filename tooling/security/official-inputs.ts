import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type OfficialReleaseEvidence, parseOfficialReleaseEvidence } from '../../src/shared/official-package.ts';
import { type LockInventory, readLockInventory } from './audit-policy.ts';
import { verifyLockManifest } from './security-evidence.ts';

export interface OfficialInputs {
    release: OfficialReleaseEvidence;
    snapshot: string;
}

export function verifyOfficialLock(
    inventory: LockInventory,
    release: OfficialReleaseEvidence,
    group: 'dependencies' | 'devDependencies',
) {
    const declared = inventory.documents.filter((document) => document.importers['.']?.[group]?.[release.name]);
    const identities = inventory.packages.filter((item) => item.name === release.name);
    if (
        declared.length !== 1 ||
        declared[0]?.importers['.']?.[group]?.[release.name]?.specifier !== release.version ||
        identities.length !== 1 ||
        identities[0]?.version !== release.version ||
        identities[0]?.integrity !== release.integrity
    )
        throw new Error('Official release identity or integrity differs from its frozen lock.');
}

export async function verifyOfficialInputs(root: string): Promise<OfficialInputs> {
    const release = parseOfficialReleaseEvidence(
        JSON.parse(await readFile(path.join(root, 'tooling/official-server-release.json'), 'utf8')),
    );
    const repository = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    await verifyLockManifest(root, repository);
    verifyOfficialLock(repository, release, 'devDependencies');
    const snapshot = await readFile(path.join(root, 'tooling/security/upstream-pnpm-lock.yaml'), 'utf8');
    verifyOfficialLock(readLockInventory(snapshot), release, 'dependencies');
    return { release, snapshot };
}
