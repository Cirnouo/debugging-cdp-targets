import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectBundledLicenses } from '../tooling/build-plugin.ts';

test('bundle notices include transitive package licenses despite nested module metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-licenses-'));
    try {
        for (const name of ['sdk', 'transitive']) {
            const directory = path.join(root, 'node_modules', name);
            await mkdir(path.join(directory, 'dist'), { recursive: true });
            await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name }));
            await writeFile(path.join(directory, 'LICENSE'), `${name} license`);
            await writeFile(path.join(directory, 'dist', 'package.json'), '{"type":"module"}');
            await writeFile(path.join(directory, 'dist', 'index.js'), '');
        }
        const notices = (
            await collectBundledLicenses(
                ['node_modules/sdk/dist/index.js', 'node_modules/transitive/dist/index.js'],
                root,
            )
        ).toString();
        assert.ok(notices.includes('sdk license'));
        assert.ok(notices.includes('transitive license'));
        assert.ok(notices.endsWith('\n') && !notices.endsWith('\n\n'));
        await rm(path.join(root, 'node_modules/transitive/LICENSE'));
        await assert.rejects(collectBundledLicenses(['node_modules/transitive/dist/index.js'], root), /no license/);
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('dct-licenses-'));
        await rm(root, { recursive: true, force: true });
    }
});
