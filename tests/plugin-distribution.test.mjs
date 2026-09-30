import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pluginRoot = path.join(root, 'plugins', 'debugging-cdp-targets');

test('portable plugin registers the official MCP through one stdio bootstrap', async () => {
    const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'plugin.json'), 'utf8'));
    const mcp = JSON.parse(await readFile(path.join(pluginRoot, 'mcp.json'), 'utf8'));
    assert.equal(manifest.name, 'debugging-cdp-targets');
    assert.equal(manifest.version, '0.1.0');
    assert.deepEqual(mcp.mcpServers['chrome-devtools'], {
        type: 'stdio',
        command: 'node',
        args: [`\${PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`],
        cwd: `\${PLUGIN_ROOT}`,
    });
});

test('plugin payload has only manifests, one skill, license, and self-contained runtime', async () => {
    const topLevel = await readdir(pluginRoot);
    assert.deepEqual(topLevel.sort(), ['LICENSE', 'README.md', 'dist', 'mcp.json', 'plugin.json', 'skills']);
    const distribution = await readdir(path.join(pluginRoot, 'dist'));
    assert.deepEqual(distribution.sort(), [
        'README.md',
        'THIRD-PARTY-NOTICES.txt',
        'control.mjs',
        'hide-npm-console.cjs',
        'mcp-bootstrap.mjs',
        'windows-cdp-helper.ps1',
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
    const marketplace = JSON.parse(await readFile(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
    assert.deepEqual(
        marketplace.plugins.map((plugin) => plugin.source.path),
        ['./plugins/debugging-cdp-targets'],
    );
});
