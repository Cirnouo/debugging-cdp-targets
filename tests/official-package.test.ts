import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { NPM_REGISTRY, PACKAGE_NAME, PACKAGE_VERSION } from '../src/shared/constants.ts';
import { isRecord } from '../src/shared/errors.ts';
import { readLockInventory } from '../tooling/security/audit-policy.ts';

test('reviewed official release agrees with exact build dependency and isolated lock', async () => {
    const manifest: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.ok(isRecord(manifest) && isRecord(manifest.devDependencies));
    assert.equal(manifest.devDependencies[PACKAGE_NAME], PACKAGE_VERSION);
    const release: unknown = JSON.parse(
        await readFile(new URL('../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release));
    assert.equal(release.name, PACKAGE_NAME);
    assert.equal(release.version, PACKAGE_VERSION);
    assert.equal(release.registry, NPM_REGISTRY);
    assert.equal(release.tarball, `${NPM_REGISTRY}/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`);
    assert.equal(
        release.integrity,
        'sha512-Klw6HWDqHC/XS1JwZldd2r49aUhbUJN9m9Mvcx4SEueIPXtzuQX+QelxAViobv8YUkDZ7HWDrmViR6LeYK0wAw==',
    );
    assert.equal(release.bin, 'build/src/bin/chrome-devtools-mcp.js');
    assert.ok(Array.isArray(release.files) && release.files.length > 0);
    for (const [file, group] of [
        ['../pnpm-lock.yaml', 'devDependencies'],
        ['../tooling/security/upstream-pnpm-lock.yaml', 'dependencies'],
    ] as const) {
        const inventory = readLockInventory(await readFile(new URL(file, import.meta.url), 'utf8'));
        const importer = inventory.documents.find((document) => document.importers['.']?.[group]?.[PACKAGE_NAME]);
        assert.equal(importer?.importers['.']?.[group]?.[PACKAGE_NAME]?.specifier, PACKAGE_VERSION);
        const official = inventory.packages.filter((item) => item.name === PACKAGE_NAME);
        assert.equal(official.length, 1);
        assert.equal(official[0]?.version, release.version);
        assert.equal(official[0]?.integrity, release.integrity);
    }
});
