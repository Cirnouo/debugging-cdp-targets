import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    assembleCodexPayload,
    collectBundledLicenses,
    generateHostPayloads,
    generatePluginFiles,
    syncPluginFiles,
} from '../tooling/build-plugin.ts';

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
            const original = await readFile(new URL(`../node_modules/${name}/LICENSE`, import.meta.url));
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

test('build synchronization preserves nested paths and check mode never changes stale, missing or extra outputs', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-output-')));
    try {
        const files = new Map([
            ['gateway.mjs', Buffer.from('gateway')],
            ['official-server/a/same.js', Buffer.from('a')],
            ['official-server/b/same.js', Buffer.from('b')],
        ]);
        await syncPluginFiles(files, root);
        assert.equal((await readFile(path.join(root, 'official-server/a/same.js'))).toString(), 'a');
        assert.equal((await readFile(path.join(root, 'official-server/b/same.js'))).toString(), 'b');
        await syncPluginFiles(files, root, { check: true });
        await writeFile(path.join(root, 'gateway.mjs'), 'stale');
        await assert.rejects(syncPluginFiles(files, root, { check: true }), /Stale/);
        assert.equal((await readFile(path.join(root, 'gateway.mjs'))).toString(), 'stale');
        await rm(path.join(root, 'gateway.mjs'));
        await assert.rejects(syncPluginFiles(files, root, { check: true }), /Missing/);
        await writeFile(path.join(root, 'secret'), 'preserve');
        await assert.rejects(syncPluginFiles(files, root), /Unexpected/);
        assert.equal((await readFile(path.join(root, 'secret'))).toString(), 'preserve');
        await rm(path.join(root, 'secret'));
        await writeFile(path.join(root, 'hide-npm-console.cjs'), 'obsolete');
        await assert.rejects(syncPluginFiles(files, root, { check: true }), /Unexpected/);
        await syncPluginFiles(files, root);
        await assert.rejects(readFile(path.join(root, 'hide-npm-console.cjs')), /ENOENT/);
        await assert.rejects(syncPluginFiles(new Map([['../escape', Buffer.from('x')]]), root), /Unsafe/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Plugin generation assembles canonical packaging inputs and root license into the complete Codex payload', async () => {
    const files = await generatePluginFiles();
    const mappings = [
        ['LICENSE', '../LICENSE'],
        ['README.md', '../packaging/codex/plugin-README.md'],
        ['.codex-plugin/plugin.json', '../packaging/codex/.codex-plugin/plugin.json'],
        ['mcp.json', '../packaging/codex/mcp.json'],
        ['skills/debugging-cdp-targets/SKILL.md', '../packaging/shared/skills/debugging-cdp-targets/SKILL.md'],
        ...[
            'README.md',
            'question-contract.md',
            'questions.zh.md',
            'questions.en.md',
            'tool-configuration.md',
            'screenshot-compatibility.md',
            'recovery-and-events.md',
        ].map((file) => [
            `skills/debugging-cdp-targets/references/${file}`,
            `../packaging/shared/skills/debugging-cdp-targets/references/${file}`,
        ]),
    ];
    for (const [destination, input] of mappings) {
        assert.ok(destination && input);
        const bytes = files.get(destination);
        assert.ok(bytes, destination);
        assert.ok(bytes.equals(await readFile(new URL(input, import.meta.url))), destination);
    }
    assert.ok([...files.keys()].every((file) => !file.startsWith('dist/') && !file.startsWith('hooks/')));
});

test('payload assembly rejects unexpected host inputs that could compete with shared sources', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-packaging-')));
    try {
        await cp(new URL('../packaging', import.meta.url), path.join(root, 'packaging'), { recursive: true });
        await cp(new URL('../LICENSE', import.meta.url), path.join(root, 'LICENSE'));
        for (const file of ['LICENSE', 'dist/README.md', 'skills/debugging-cdp-targets/SKILL.md']) {
            const competing = path.join(root, 'packaging/codex', file);
            await mkdir(path.dirname(competing), { recursive: true });
            await writeFile(competing, 'competing bytes');
            await assert.rejects(assembleCodexPayload(root), /Unexpected packaging input/);
            await rm(competing);
            if (file.startsWith('dist/')) await rmdir(path.dirname(competing));
            if (file.startsWith('skills/')) await rm(path.join(root, 'packaging/codex/skills'), { recursive: true });
        }
        for (const file of [
            'README.md',
            'question-contract.md',
            'questions.zh.md',
            'questions.en.md',
            'tool-configuration.md',
            'screenshot-compatibility.md',
            'recovery-and-events.md',
        ]) {
            const reference = path.join(root, 'packaging/shared/skills/debugging-cdp-targets/references', file);
            const original = await readFile(reference);
            await rm(reference);
            await assert.rejects(assembleCodexPayload(root), /Missing Plugin file/);
            await writeFile(`${reference}.renamed`, original);
            await assert.rejects(assembleCodexPayload(root), /Unexpected Plugin file/);
            await rm(`${reference}.renamed`);
            await writeFile(reference, original);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('payload assembly rejects a linked canonical input root', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-packaging-link-')));
    try {
        await mkdir(path.join(root, 'packaging'));
        await cp(new URL('../packaging/shared', import.meta.url), path.join(root, 'packaging/shared'), {
            recursive: true,
        });
        await cp(new URL('../LICENSE', import.meta.url), path.join(root, 'LICENSE'));
        await symlink(path.resolve('packaging/codex'), path.join(root, 'packaging/codex'), 'junction');
        await assert.rejects(assembleCodexPayload(root), /Packaging input.*linked/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('payload assembly maps host user documentation without shipping source directory documentation', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-packaging-docs-')));
    try {
        await cp(new URL('../packaging', import.meta.url), path.join(root, 'packaging'), { recursive: true });
        await cp(new URL('../LICENSE', import.meta.url), path.join(root, 'LICENSE'));
        await writeFile(path.join(root, 'packaging/codex/README.md'), '# Maintained inputs\n');
        await writeFile(path.join(root, 'packaging/codex/plugin-README.md'), '# Installed plugin\n');
        const files = await assembleCodexPayload(root);
        assert.equal(files.get('README.md')?.toString(), '# Installed plugin\n');
        assert.equal(files.has('plugin-README.md'), false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('host build accepts independent App version and rejects maintained plugin drift', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-version-build-')));
    try {
        await cp(new URL('../packaging', import.meta.url), path.join(root, 'packaging'), { recursive: true });
        await cp(new URL('../LICENSE', import.meta.url), path.join(root, 'LICENSE'));
        await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.3.4' }));
        assert.equal((await generateHostPayloads(root)).size, 2);
        const manifest = path.join(root, 'packaging/claude-code/.claude-plugin/plugin.json');
        const original = await readFile(manifest, 'utf8');
        const data = JSON.parse(original);
        await writeFile(manifest, JSON.stringify({ ...data, version: '0.2.0' }));
        await assert.rejects(generateHostPayloads(root), /version/i);
        await writeFile(manifest, original);
        const skill = path.join(root, 'packaging/shared/skills/debugging-cdp-targets/SKILL.md');
        await writeFile(skill, (await readFile(skill, 'utf8')).replace(/version:.*0\.1\.0.*/, 'version: 0.2.0'));
        await assert.rejects(generateHostPayloads(root), /version/i);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
