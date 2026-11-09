import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGIN_HOSTS, PLUGIN_ROOT } from '../../../tooling/distribution/host-descriptors.ts';
import { auditRepository } from '../../../tooling/quality/audit-repository.ts';

test('repository audit accepts the supported Node range and contributor entry point', async (context) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-agents-')));
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        const license = 'Copyright (c) 2026 Cirnouo\n';
        const files = {
            'AGENTS.md': '# Contributor entry point\n',
            'README.md': '# Repository\n',
            LICENSE: license,
            '.gitignore': '.idea/\nnode_modules/\n.env*\n',
            'CHANGELOG.md': '## [Unreleased]\n',
            'package.json': `${JSON.stringify({ version: '2.3.4', engines: { node: '^24.21.0' }, packageManager: 'pnpm@12.4.2' }, null, 4)}\n`,
            'docs/README.md': '# Documentation\n',
            'docs/reference/README.md': '# Reference\n',
            'docs/reference/domain-language.md': '# Domain language\n',
            'plugins/README.md': '# Plugins\n',
            'plugins/codex/README.md': '# Codex\n',
            'packaging/README.md': '# Packaging\n',
            'packaging/codex/README.md': '# Codex inputs\n',
            'packaging/shared/README.md': '# Shared inputs\n',
            [`${PLUGIN_ROOT}/README.md`]: '# Plugin\n',
            [`${PLUGIN_ROOT}/LICENSE`]: license,
            'packaging/codex/.codex-plugin/README.md': '# Manifest\n',
            'packaging/codex/.codex-plugin/plugin.json': `${JSON.stringify({ name: 'debugging-cdp-targets', version: '0.1.0', license: 'MIT' }, null, 4)}\n`,
            'packaging/shared/skills/README.md': '# Skills\n',
            'packaging/shared/skills/debugging-cdp-targets/README.md': '# Instructions\n',
            'packaging/shared/skills/debugging-cdp-targets/SKILL.md':
                '---\nname: debugging-cdp-targets\nlicense: MIT\ndescription: Debug CDP targets.\nmetadata:\n    version: 0.1.0\n---\n',
        };
        const entries = new Map(Object.entries(files));
        for (const host of PLUGIN_HOSTS) {
            entries.set(`plugins/${host.id}/README.md`, '# Host\n');
            entries.set(`${host.inputRoot}/README.md`, '# Host inputs\n');
            entries.set(`${host.payloadRoot}/README.md`, '# Plugin\n');
            entries.set(`${host.payloadRoot}/LICENSE`, license);
            entries.set(`${host.inputRoot}/${path.posix.dirname(host.manifest)}/README.md`, '# Manifest\n');
            entries.set(`${host.payloadRoot}/${path.posix.dirname(host.manifest)}/README.md`, '# Manifest\n');
            const manifest = `${JSON.stringify({ name: 'debugging-cdp-targets', version: '0.1.0', license: 'MIT' }, null, 4)}\n`;
            entries.set(`${host.inputRoot}/${host.manifest}`, manifest);
            entries.set(`${host.payloadRoot}/${host.manifest}`, manifest);
        }
        for (const [file, source] of entries) {
            const target = path.join(root, file);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, source);
        }
        assert.deepEqual(await auditRepository(root), []);
        const glossary = path.join(root, 'docs/reference/domain-language.md');
        const retiredGlossary = path.join(root, 'docs/domain-language.md');
        const glossarySource = await readFile(glossary, 'utf8');
        await context.test('rejects a missing canonical glossary', async () => {
            await rm(glossary);
            assert.ok((await auditRepository(root)).some((error) => /only glossary/.test(error)));
        });
        await context.test('rejects the retired glossary as the only glossary', async () => {
            await writeFile(retiredGlossary, glossarySource);
            assert.ok((await auditRepository(root)).some((error) => /only glossary/.test(error)));
        });
        await context.test('rejects the retired glossary alongside the canonical glossary', async () => {
            await writeFile(glossary, glossarySource);
            assert.ok((await auditRepository(root)).some((error) => /only glossary/.test(error)));
            await rm(retiredGlossary);
        });
        await context.test('rejects CONTEXT.md alongside the canonical glossary', async () => {
            await writeFile(path.join(root, 'CONTEXT.md'), '# Duplicate vocabulary\n');
            assert.ok((await auditRepository(root)).some((error) => /only glossary/.test(error)));
            await rm(path.join(root, 'CONTEXT.md'));
        });
        assert.deepEqual(await auditRepository(root), []);
        for (const host of PLUGIN_HOSTS) {
            for (const base of [host.inputRoot, host.payloadRoot]) {
                const file = path.join(root, base, host.manifest);
                const original = await readFile(file, 'utf8');
                await writeFile(file, original.replace('0.1.0', '0.2.0'));
                assert.ok((await auditRepository(root)).some((error) => /version/i.test(error)));
                await writeFile(file, original);
            }
        }
        const skillFile = path.join(root, 'packaging/shared/skills/debugging-cdp-targets/SKILL.md');
        const originalSkill = await readFile(skillFile, 'utf8');
        await writeFile(skillFile, originalSkill.replace('0.1.0', '0.2.0'));
        assert.ok((await auditRepository(root)).some((error) => /version/i.test(error)));
        await writeFile(skillFile, originalSkill);
        const manifest = { version: '2.3.4', engines: { node: '^24.21.0' }, packageManager: 'pnpm@12.4.2' };
        async function auditManifest(value: unknown) {
            await writeFile(path.join(root, 'package.json'), `${JSON.stringify(value, null, 4)}\n`);
            return auditRepository(root);
        }
        for (const node of ['24.21.0', '^24.12.0', '>=24.21.0', '^25.0.0', undefined]) {
            await context.test(`rejects Node declaration ${node ?? '(absent)'}`, async () => {
                assert.deepEqual(await auditManifest({ ...manifest, engines: { node } }), [
                    'Node supported range drifted: engines.node must be ^24.21.0.',
                ]);
            });
        }
        await context.test('rejects absent Node engines', async () => {
            assert.deepEqual(await auditManifest({ ...manifest, engines: undefined }), [
                'Node supported range drifted: engines.node must be ^24.21.0.',
            ]);
        });
        for (const packageManager of ['pnpm@^12.4.2', 'pnpm@12', 'pnpm@12.4.1', undefined]) {
            await context.test(`rejects pnpm declaration ${packageManager ?? '(absent)'}`, async () => {
                assert.deepEqual(await auditManifest({ ...manifest, packageManager }), [
                    'pnpm pin drifted: packageManager must be pnpm@12.4.2.',
                ]);
            });
        }
        await context.test('reports Node range and pnpm pin drift independently', async () => {
            assert.deepEqual(await auditManifest({ ...manifest, engines: {}, packageManager: 'pnpm@latest' }), [
                'Node supported range drifted: engines.node must be ^24.21.0.',
                'pnpm pin drifted: packageManager must be pnpm@12.4.2.',
            ]);
        });
        assert.deepEqual(await auditManifest(manifest), []);
        const asset = path.join(root, 'packaging/shared/assets');
        await mkdir(asset);
        await writeFile(path.join(asset, 'README.md'), '# Approved icons\n');
        const approved = await readFile(new URL('../../../packaging/shared/assets/icon-light.png', import.meta.url));
        await writeFile(path.join(asset, 'icon-light.png'), approved);
        assert.deepEqual(await auditRepository(root), []);
        await writeFile(path.join(asset, 'unknown.png'), approved);
        assert.ok((await auditRepository(root)).some((error) => /unknown.png/.test(error)));
        await rm(path.join(asset, 'unknown.png'));
        await writeFile(path.join(asset, 'icon-light.png'), approved.subarray(0, 40));
        assert.ok((await auditRepository(root)).some((error) => /PNG|icon/.test(error)));
        await rm(path.join(asset, 'icon-light.png'));
        const outside = path.join(root, 'icon-source.png');
        await writeFile(outside, approved);
        await symlink(outside, path.join(asset, 'icon-light.png'));
        assert.ok((await auditRepository(root)).some((error) => /icon-light.png.*link/.test(error)));
    } finally {
        assert.equal(path.dirname(root), await realpath(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('dct-agents-'));
        await rm(root, { recursive: true, force: true });
    }
});

async function auditGithubDocumentation(files: readonly string[]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-readme-'));
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        for (const file of files) {
            const target = path.join(root, file);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, '');
        }
        // These fixtures isolate directory documentation from unrelated metadata requirements.
        return (await auditRepository(root)).filter((error) => error.startsWith('.github'));
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('dct-readme-'));
        await rm(root, { recursive: true, force: true });
    }
}

test('GitHub directory documentation uses INDEX.md without overriding the root README', async () => {
    assert.deepEqual(
        await auditGithubDocumentation(['README.md', '.github/INDEX.md', '.github/workflows/README.md']),
        [],
    );
});

test('repository audit enforces YAML filenames before generated formatting exemptions', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-yaml-names-')));
    const cases: [string, boolean][] = [
        ['example.yaml', true],
        ['nested/example.yaml', true],
        ['example.yml.md', true],
        ['.github/ISSUE_TEMPLATE/config.yml', true],
        ['example.yml', false],
        ['example.YML', false],
        ['example.YAML', false],
        ['example.YaMl', false],
        ['nested/config.yml', false],
        ['.hidden/legacy.yml', false],
        ['.github/ISSUE_TEMPLATE/nested/config.yml', false],
        ['.github/ISSUE_TEMPLATE/config.YML', false],
    ];
    for (const host of PLUGIN_HOSTS) {
        cases.push(
            [`${host.payloadRoot}/dist/valid.yaml`, true],
            [`${host.payloadRoot}/dist/legacy.yml`, false],
            [`${host.payloadRoot}/dist/upper.YAML`, false],
        );
    }
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        // Test one path at a time: case variants alias on Windows filesystems.
        for (const [file, accepted] of cases) {
            const target = path.join(root, file);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, 'enabled: true\n');
            const errors = await auditRepository(root);
            const diagnostics = errors.filter((error) => error.startsWith(`${file}:`));
            assert.equal(diagnostics.length > 0, !accepted, `${file}: ${diagnostics.join('\n')}`);
            if (!accepted) assert.match(diagnostics.join('\n'), /\.yaml/);
            await rm(target);
        }
    } finally {
        assert.equal(path.dirname(root), await realpath(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('dct-yaml-names-'));
        await rm(root, { recursive: true, force: true });
    }
});

test('thin plugin runtime leftovers receive ordinary repository checks and no upstream exemption', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-retired-repo-')));
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        const file = `${PLUGIN_ROOT}/dist/official-server/unexpected.yml`;
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), 'enabled: true\n');
        const errors = await auditRepository(root);
        assert.ok(errors.some((error) => error.startsWith(`${file}:`) && error.includes('.yaml')));
        assert.ok(errors.some((error) => error.includes('/dist/official-server: add README.md')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('GitHub directory READMEs are rejected even when INDEX.md is present', async () => {
    for (const name of ['README.md', 'readme.md', 'ReadMe.rst', 'README']) {
        const errors = await auditGithubDocumentation(['README.md', '.github/INDEX.md', `.github/${name}`]);
        assert.ok(
            errors.some((error) => error.startsWith(`.github/${name}:`) && error.includes('root README')),
            `${name}: ${errors.join('\n')}`,
        );
    }
});

test('GitHub directory still requires its INDEX.md documentation', async () => {
    const errors = await auditGithubDocumentation(['README.md', '.github/workflows/README.md']);
    assert.ok(errors.some((error) => error.startsWith('.github:') && error.includes('INDEX.md')));
});

test('the GitHub INDEX.md exception does not exempt nested workflow documentation', async () => {
    const errors = await auditGithubDocumentation(['README.md', '.github/INDEX.md', '.github/workflows/INDEX.md']);
    assert.ok(errors.some((error) => error.startsWith('.github/workflows:') && error.includes('README.md')));
});
test('Host payload source requires its local instructions and immediate directory map', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-host-instructions-')));
    const file = 'src/host-plugins/payload-integrity.ts';
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        await mkdir(path.join(root, 'src/host-plugins'), { recursive: true });
        await writeFile(path.join(root, file), 'export const value = 1;\n');
        const before = await auditRepository(root);
        assert.ok(before.includes(`${file}: source directory requires local AGENTS.md.`));
        assert.ok(before.includes('src/host-plugins: add README.md describing immediate contents.'));
        await writeFile(path.join(root, 'src/host-plugins/AGENTS.md'), '# Pure Host payload proof\n');
        await writeFile(path.join(root, 'src/host-plugins/README.md'), '# Host payload proof\n');
        const after = await auditRepository(root);
        assert.ok(!after.some((error) => error.startsWith(`${file}:`)));
        assert.ok(!after.some((error) => error.startsWith('src/host-plugins:')));
    } finally {
        await rm(root, { recursive: true });
    }
});
