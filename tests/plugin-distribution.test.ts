import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';
import { PLUGIN_HOSTS, SHARED_PACKAGING_ROOT } from '../tooling/host-policy.ts';
import { isSemVer, validateVersionAgreement } from '../tooling/version-policy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const pluginRoot = path.join(root, 'plugins', 'codex', 'debugging-cdp-targets');

async function assertPortableRegistration(repositoryRoot: string) {
    const portableRoot = path.join(repositoryRoot, 'plugins/codex/debugging-cdp-targets');
    const manifest: unknown = JSON.parse(await readFile(path.join(portableRoot, '.codex-plugin/plugin.json'), 'utf8'));
    const mcp: unknown = JSON.parse(await readFile(path.join(portableRoot, 'mcp.json'), 'utf8'));
    assert.ok(isRecord(manifest) && isRecord(mcp) && isRecord(mcp.mcpServers));
    assert.equal(manifest.name, 'debugging-cdp-targets');
    assert.equal(manifest.mcpServers, './mcp.json');
    assert.equal(manifest.hooks, './hooks/hooks.json');
    const packageData: unknown = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
    assert.ok(isRecord(packageData) && isSemVer(packageData.version));
    const skill = await readFile(
        path.join(repositoryRoot, SHARED_PACKAGING_ROOT, 'skills/debugging-cdp-targets/SKILL.md'),
        'utf8',
    );
    const frontmatter: unknown = parseYaml(skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
    assert.ok(isRecord(frontmatter) && isRecord(frontmatter.metadata));
    for (const host of PLUGIN_HOSTS) {
        for (const base of [host.inputRoot, host.payloadRoot]) {
            const peer: unknown = JSON.parse(await readFile(path.join(repositoryRoot, base, host.manifest), 'utf8'));
            assert.ok(isRecord(peer));
            assert.deepEqual(
                validateVersionAgreement(packageData.version, peer.version, frontmatter.metadata.version),
                [],
                `${host.id} plugin version group`,
            );
        }
    }
    assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
    assert.deepEqual(Object.keys(mcp.mcpServers), ['cdp-targets']);
    assert.deepEqual(mcp.mcpServers['cdp-targets'], {
        type: 'stdio',
        command: 'node',
        args: ['dist/mcp-bootstrap.mjs'],
        cwd: '.',
    });
}

test('portable plugin registers one stdio gateway for independent target connections', async () => {
    await assertPortableRegistration(root);
});

test('portable registration accepts independent App version and rejects peer or Skill drift', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-portable-version-')));
    try {
        const files = [
            'plugins/codex/debugging-cdp-targets/mcp.json',
            `${SHARED_PACKAGING_ROOT}/skills/debugging-cdp-targets/SKILL.md`,
            ...PLUGIN_HOSTS.flatMap((host) => [
                `${host.inputRoot}/${host.manifest}`,
                `${host.payloadRoot}/${host.manifest}`,
            ]),
        ];
        for (const file of files) {
            const destination = path.join(directory, file);
            await mkdir(path.dirname(destination), { recursive: true });
            await copyFile(path.join(root, file), destination);
        }
        await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '2.3.4' }));
        await assertPortableRegistration(directory);
        for (const host of PLUGIN_HOSTS) {
            for (const base of [host.inputRoot, host.payloadRoot]) {
                const file = path.join(directory, base, host.manifest);
                const original = await readFile(file, 'utf8');
                await writeFile(file, original.replace('0.1.0', '0.2.0'));
                await assert.rejects(assertPortableRegistration(directory));
                await writeFile(file, original);
            }
        }
        const skill = path.join(directory, SHARED_PACKAGING_ROOT, 'skills/debugging-cdp-targets/SKILL.md');
        await writeFile(skill, (await readFile(skill, 'utf8')).replace('0.1.0', '0.2.0'));
        await assert.rejects(assertPortableRegistration(directory));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('plugin payload has only manifests, artwork, one skill, license, and self-contained runtime', async () => {
    const topLevel = await readdir(pluginRoot);
    assert.deepEqual(topLevel.sort(), [
        '.codex-plugin',
        'LICENSE',
        'README.md',
        'assets',
        'dist',
        'hooks',
        'mcp.json',
        'skills',
    ]);
    const artwork = await readdir(path.join(pluginRoot, 'assets'));
    assert.deepEqual(artwork.sort(), ['README.md', 'icon-dark.png', 'icon.png']);
    const distribution = await readdir(path.join(pluginRoot, 'dist'));
    assert.deepEqual(distribution.sort(), [
        'README.md',
        'THIRD-PARTY-NOTICES.txt',
        'mcp-bootstrap.mjs',
        'official-server',
        'windows-cdp-helper.ps1',
        'windows-native-helper.ps1',
        'windows-native-process.cs',
    ]);
    const skill = await readdir(path.join(pluginRoot, 'skills', 'debugging-cdp-targets'));
    assert.deepEqual(skill.sort(), ['README.md', 'SKILL.md', 'agents', 'references']);
    const references = await readdir(path.join(pluginRoot, 'skills', 'debugging-cdp-targets', 'references'));
    assert.deepEqual(references.sort(), [
        'README.md',
        'question-contract.md',
        'questions.en.md',
        'questions.zh.md',
        'recovery-and-events.md',
        'screenshot-compatibility.md',
        'tool-configuration.md',
    ]);
    const presentation = await readdir(path.join(pluginRoot, 'skills', 'debugging-cdp-targets', 'agents'));
    assert.deepEqual(presentation.sort(), ['README.md', 'openai.yaml']);
});

test('bundled WebSocket code includes its original license', async () => {
    const notice = await readFile(path.join(pluginRoot, 'dist', 'THIRD-PARTY-NOTICES.txt'), 'utf8');
    assert.match(notice, /Copyright.*Einar Otto Stangvik/);
    assert.match(notice, /Permission is hereby granted/);
});

test('repository marketplace points only at the local plugin', async () => {
    const marketplace: unknown = JSON.parse(
        await readFile(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'),
    );
    assert.ok(isRecord(marketplace) && Array.isArray(marketplace.plugins));
    assert.deepEqual(
        marketplace.plugins.map((plugin: unknown) => {
            assert.ok(isRecord(plugin) && isRecord(plugin.source));
            return plugin.source.path;
        }),
        ['./plugins/codex/debugging-cdp-targets'],
    );
});
