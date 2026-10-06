import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../src/shared/errors.ts';
import { isSemVer } from '../tooling/version-policy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const pluginRoot = path.join(root, 'plugins', 'codex', 'debugging-cdp-targets');

test('portable plugin registers one stdio gateway for independent target connections', async () => {
    const manifest: unknown = JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
    const mcp: unknown = JSON.parse(await readFile(path.join(pluginRoot, 'mcp.json'), 'utf8'));
    assert.ok(isRecord(manifest) && isRecord(mcp) && isRecord(mcp.mcpServers));
    assert.equal(manifest.name, 'debugging-cdp-targets');
    assert.equal(manifest.mcpServers, './mcp.json');
    assert.equal(manifest.hooks, './hooks/hooks.json');
    const packageData: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.ok(isRecord(packageData) && isSemVer(packageData.version));
    assert.equal(manifest.version, packageData.version);
    assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
    assert.deepEqual(Object.keys(mcp.mcpServers), ['cdp-targets']);
    assert.deepEqual(mcp.mcpServers['cdp-targets'], {
        type: 'stdio',
        command: 'node',
        args: ['dist/mcp-bootstrap.mjs'],
        cwd: '.',
    });
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
    assert.deepEqual(artwork.sort(), ['README.md', 'icon-dark.png', 'icon-light.png']);
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
    assert.deepEqual(skill.sort(), ['README.md', 'SKILL.md']);
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
