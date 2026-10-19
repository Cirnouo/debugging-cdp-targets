import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectBundledLicenses } from '../../../tooling/licenses/bundled-notices.ts';

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

test('actual-graph license collection rejects altered canonical semver and smol notices or identities', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-canonical-licenses-'));
    try {
        for (const [name, version, license] of [
            ['semver', '7.8.5', 'ISC'],
            ['smol-toml', '1.9.1', 'BSD-3-Clause'],
        ]) {
            assert.ok(name && version && license);
            const directory = path.join(root, 'node_modules', name);
            await mkdir(directory, { recursive: true });
            const original = await readFile(new URL(`../../../node_modules/${name}/LICENSE`, import.meta.url));
            await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version, license }));
            await writeFile(path.join(directory, 'index.js'), '');
            await writeFile(path.join(directory, 'LICENSE'), original);
            const collect = () => collectBundledLicenses([`node_modules/${name}/index.js`], root);
            assert.ok((await collect()).includes(original.toString().trim()));
            await writeFile(path.join(directory, 'LICENSE'), 'altered notice');
            await assert.rejects(collect(), /canonical.*license/i);
            await writeFile(path.join(directory, 'LICENSE'), original);
            await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '0.0.0', license }));
            await assert.rejects(collect(), /canonical.*license/i);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('canonical parser package boundaries reject missing or malformed metadata instead of ancestor notices', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-canonical-boundary-'));
    try {
        await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-owner' }));
        await writeFile(path.join(root, 'LICENSE'), 'unrelated ancestor notice');
        for (const [name, version, license] of [
            ['semver', '7.8.5', 'ISC'],
            ['smol-toml', '1.9.1', 'BSD-3-Clause'],
        ] as const) {
            const directory = path.join(root, 'node_modules', name);
            await mkdir(path.join(directory, 'dist'), { recursive: true });
            await writeFile(path.join(directory, 'dist', 'index.js'), '');
            await writeFile(path.join(directory, 'LICENSE'), 'altered canonical notice');
            const metadata = path.join(directory, 'package.json');
            const collect = () => collectBundledLicenses([`node_modules/${name}/dist/index.js`], root);
            for (const value of [
                undefined,
                'null',
                '[]',
                '{invalid-json',
                JSON.stringify({ version, license }),
                JSON.stringify({ name: 42, version, license }),
                JSON.stringify({ name, license }),
                JSON.stringify({ name, version }),
            ]) {
                await rm(metadata, { force: true });
                if (value !== undefined) await writeFile(metadata, value);
                await assert.rejects(collect(), /canonical.*license|canonical.*metadata/i, `${name}: ${String(value)}`);
            }
            await writeFile(metadata, JSON.stringify({ name, version, license }));
            const original = await readFile(new URL(`../../../node_modules/${name}/LICENSE`, import.meta.url));
            await writeFile(path.join(directory, 'LICENSE'), original);
            await writeFile(path.join(directory, 'dist', 'package.json'), JSON.stringify({ name: 'fixture-decoy' }));
            await writeFile(path.join(directory, 'dist', 'LICENSE'), 'unrelated nested notice');
            const notice = (await collect()).toString();
            assert.ok(notice.includes(`${name} — LICENSE`));
            assert.doesNotMatch(notice, /fixture-owner|fixture-decoy|unrelated/);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

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
        assert.equal(
            notices,
            '@modelcontextprotocol/client — LICENSE\n\nSDK original license\n\nvendor@1.2.3 — LICENSE (vendored)\n\nVendor original license\n',
        );
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

test('bundled notice collection excludes payload and build dependencies from a foreign cwd', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-notices-isolation-')));
    try {
        const owner = new URL('../../../tooling/licenses/bundled-notices.ts', import.meta.url).href;
        const script = [
            "import assert from 'node:assert/strict';",
            "import { registerHooks } from 'node:module';",
            "registerHooks({ resolve(specifier, context, next) { if (specifier === 'yaml' || specifier === 'esbuild' || specifier.startsWith('@babel/') || specifier === 'node:child_process' || specifier === 'child_process') throw new Error('Forbidden ' + specifier); return next(specifier, context); } });",
            'const { collectBundledLicenses } = await import(' + JSON.stringify(owner) + ');',
            'assert.deepEqual(await collectBundledLicenses([]), Buffer.from([10]));',
            "assert.deepEqual(await collectBundledLicenses(['src/not-a-dependency.ts']), Buffer.from([10]));",
        ].join('\n');
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: directory,
            windowsHide: true,
            encoding: 'utf8',
            timeout: 10000,
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, '');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('bundled notices resolve default repository evidence independently of a foreign working directory', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-notices-defaults-')));
    try {
        const owner = new URL('../../../tooling/licenses/bundled-notices.ts', import.meta.url).href;
        const input = 'node_modules/@modelcontextprotocol/client/dist/ajvProvider-97rDpkRx.mjs';
        const absolute = path.join(fileURLToPath(new URL('../../../', import.meta.url)), input);
        const script = [
            "import assert from 'node:assert/strict';",
            'const { collectBundledLicenses } = await import(' + JSON.stringify(owner) + ');',
            'const defaults = await collectBundledLicenses(' + JSON.stringify([input]) + ');',
            'const override = await collectBundledLicenses(' +
                JSON.stringify([absolute]) +
                ', ' +
                JSON.stringify(directory) +
                ');',
            'assert.deepEqual(override, defaults);',
            "assert.ok(defaults.toString().includes('ajv@8.18.0 — LICENSE (vendored)'));",
            "assert.ok(defaults.toString().includes('@modelcontextprotocol/client — LICENSE'));",
        ].join('\n');
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: directory,
            windowsHide: true,
            encoding: 'utf8',
            timeout: 10000,
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, '');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
