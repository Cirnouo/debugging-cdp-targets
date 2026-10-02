import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectBundledLicenses, generatePluginFiles } from '../tooling/build-plugin.ts';

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

function sha256(contents: string) {
    return createHash('sha256').update(contents).digest('hex');
}

async function vendorFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-vendor-licenses-'));
    const directory = path.join(root, 'node_modules', '@modelcontextprotocol', 'client');
    await mkdir(path.join(directory, 'dist'), { recursive: true });
    await writeFile(
        path.join(directory, 'package.json'),
        JSON.stringify({ name: '@modelcontextprotocol/client', version: '2.2.0' }),
    );
    await writeFile(path.join(directory, 'LICENSE'), 'SDK original license');
    const contents = 'export const bundledVendor = 1;';
    const map = JSON.stringify({
        version: 3,
        sources: ['../../node_modules/.pnpm/vendor@1.2.3/node_modules/vendor/index.js'],
        sourcesContent: ['export const vendor = 1;'],
        names: [],
        mappings: '',
    });
    const record = {
        name: '@modelcontextprotocol/client',
        version: '2.2.0',
        file: 'dist/included.mjs',
        sha256: sha256(contents),
        mapSha256: sha256(map),
        tarball: 'https://registry.npmjs.org/@modelcontextprotocol/client/-/client-2.2.0.tgz',
        integrity: 'sha512-reviewed',
    };
    const vendor = {
        name: 'vendor',
        version: '1.2.3',
        license: 'MIT',
        licenseFile: 'LICENSE',
        licenseText: 'Vendor original license\n',
        licenseSha256: sha256('Vendor original license\n'),
        tarball: 'https://registry.npmjs.org/vendor/-/vendor-1.2.3.tgz',
        integrity: 'sha512-reviewed',
    };
    const evidence = { schemaVersion: 1, bundles: [record], packages: [vendor] };
    const evidenceFile = path.join(root, 'evidence.json');
    await writeFile(evidenceFile, JSON.stringify(evidence));
    await writeFile(path.join(directory, record.file), contents);
    await writeFile(path.join(directory, `${record.file}.map`), map);
    await writeFile(path.join(directory, 'dist/unused.mjs'), 'export const unused = 1;');
    await writeFile(
        path.join(directory, 'dist/unused.mjs.map'),
        JSON.stringify({
            version: 3,
            sources: ['../../node_modules/.pnpm/unknown@9.0.0/node_modules/unknown/index.js'],
            sourcesContent: ['unknown'],
            names: [],
            mappings: '',
        }),
    );
    return {
        root,
        directory,
        record,
        vendor,
        evidence,
        evidenceFile,
        contents,
        map,
        input: 'node_modules/@modelcontextprotocol/client/dist/included.mjs',
    };
}

test('bundled SDK vendor licenses follow included source maps, deduplicate and exclude unused files', async () => {
    const fixture = await vendorFixture();
    try {
        const notices = (
            await collectBundledLicenses([fixture.input, fixture.input], fixture.root, fixture.evidenceFile)
        ).toString();
        assert.match(notices, /SDK original license/);
        assert.match(notices, /vendor@1.2.3.*LICENSE/);
        assert.equal(notices.match(/Vendor original license/g)?.length, 1);
        assert.doesNotMatch(notices, /unknown@9.0.0/);
    } finally {
        assert.equal(path.dirname(fixture.root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(fixture.root).startsWith('dct-vendor-licenses-'));
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('SDK vendor collection rejects changed code, maps, unknown identities and changed license evidence', async () => {
    const fixture = await vendorFixture();
    try {
        const collect = () => collectBundledLicenses([fixture.input], fixture.root, fixture.evidenceFile);
        await writeFile(path.join(fixture.directory, fixture.record.file), `${fixture.contents} changed`);
        await assert.rejects(collect(), /bundled source fingerprint/);
        await writeFile(path.join(fixture.directory, fixture.record.file), fixture.contents);
        await writeFile(path.join(fixture.directory, `${fixture.record.file}.map`), `${fixture.map} `);
        await assert.rejects(collect(), /source map fingerprint/);
        const unknown = fixture.map.replaceAll('vendor@1.2.3', 'vendor@1.2.4');
        await writeFile(path.join(fixture.directory, `${fixture.record.file}.map`), unknown);
        fixture.record.mapSha256 = sha256(unknown);
        await writeFile(fixture.evidenceFile, JSON.stringify(fixture.evidence));
        await assert.rejects(collect(), /Unreviewed vendored package: vendor@1.2.4/);
        await writeFile(path.join(fixture.directory, `${fixture.record.file}.map`), fixture.map);
        fixture.record.mapSha256 = sha256(fixture.map);
        fixture.vendor.licenseText = 'Changed license';
        await writeFile(fixture.evidenceFile, JSON.stringify(fixture.evidence));
        await assert.rejects(collect(), /vendored license fingerprint/);
        fixture.vendor.licenseText = 'Vendor original license\n';
        await writeFile(fixture.evidenceFile, JSON.stringify(fixture.evidence));
        await rm(path.join(fixture.directory, `${fixture.record.file}.map`));
        await assert.rejects(collect(), /ENOENT/);
    } finally {
        assert.equal(path.dirname(fixture.root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(fixture.root).startsWith('dct-vendor-licenses-'));
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('SDK vendor collection rejects unreviewed bundles and malformed map inventory or review', async () => {
    const fixture = await vendorFixture();
    try {
        const collect = () => collectBundledLicenses([fixture.input], fixture.root, fixture.evidenceFile);
        await assert.rejects(
            collectBundledLicenses(
                ['node_modules/@modelcontextprotocol/client/dist/unused.mjs'],
                fixture.root,
                fixture.evidenceFile,
            ),
            /Unreviewed SDK bundle/,
        );
        const packageFile = path.join(fixture.directory, 'package.json');
        await writeFile(packageFile, JSON.stringify({ name: '@modelcontextprotocol/client', version: '2.2.1' }));
        await assert.rejects(collect(), /Unreviewed SDK bundle/);
        await writeFile(packageFile, JSON.stringify({ name: '@modelcontextprotocol/client', version: '2.2.0' }));
        for (const map of [
            JSON.stringify({ version: 3, sources: [42] }),
            JSON.stringify({ version: 3, sources: ['../../node_modules/vendor/index.js'] }),
            JSON.stringify({
                version: 3,
                sources: ['../../node_modules/.pnpm/wrong@1.2.3/node_modules/vendor/index.js'],
            }),
        ]) {
            await writeFile(path.join(fixture.directory, `${fixture.record.file}.map`), map);
            fixture.record.mapSha256 = sha256(map);
            await writeFile(fixture.evidenceFile, JSON.stringify(fixture.evidence));
            await assert.rejects(collect(), /Malformed vendored source|Unsupported vendored source/);
        }
        await writeFile(fixture.evidenceFile, JSON.stringify({ schemaVersion: 2 }));
        await assert.rejects(collect(), /Malformed vendored license evidence/);
        fixture.evidence.bundles.push(fixture.record);
        await writeFile(fixture.evidenceFile, JSON.stringify(fixture.evidence));
        await assert.rejects(collect(), /Duplicate vendored bundle evidence/);
    } finally {
        assert.equal(path.dirname(fixture.root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(fixture.root).startsWith('dct-vendor-licenses-'));
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('actual Node plugin bundles include all six reviewed SDK vendor notices and exclude unused browser vendor', async () => {
    const files = await generatePluginFiles();
    const notices = files.get('THIRD-PARTY-NOTICES.txt')?.toString();
    assert.ok(notices);
    for (const identity of [
        'ajv@8.18.0',
        'ajv-formats@3.0.1',
        'content-type@1.0.5',
        'fast-deep-equal@3.1.3',
        'fast-uri@3.1.0',
        'json-schema-traverse@1.0.0',
    ]) {
        assert.equal(notices.split(`${identity} — LICENSE (vendored)`).length - 1, 1, identity);
    }
    assert.doesNotMatch(notices, /@cfworker\/json-schema/);
});
