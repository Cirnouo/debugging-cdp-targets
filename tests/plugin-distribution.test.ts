import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseControlArguments } from '../src/interface/control-arguments.ts';
import { isRecord } from '../src/shared/errors.ts';
import { isSemVer } from '../tooling/version-policy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const pluginRoot = path.join(root, 'plugins', 'debugging-cdp-targets');

test('documented lifecycle command templates match each command schema', () => {
    const entry = ['--entry-id', '11111111-1111-4111-8111-111111111111'];
    const session = ['--session-id', '22222222-2222-4222-8222-222222222222'];
    const templates = [
        ['status', ...entry],
        ['start', ...entry, '--target-kind', 'chrome', '--launch-command', 'chrome --remote-debugging-port={port}'],
        ['restart', ...entry, ...session],
        ['end-task', ...entry, ...session],
        ['stop', ...entry, ...session, '--disposition', 'Close'],
        ['stop', ...entry, ...session, '--disposition', 'Keep'],
    ];
    for (const template of templates) assert.equal(parseControlArguments(template).action, template[0]);
    for (const template of [
        ['status', ...entry, ...session],
        ['start', ...entry, ...session, '--launch-command', 'chrome'],
        ['end-task', ...entry, ...session, '--disposition', 'Keep'],
        ['restart', ...entry, ...session, '--disposition', 'Close'],
        ['stop', ...entry, ...session],
    ])
        assert.throws(() => parseControlArguments(template));
});

test('portable plugin registers the official MCP through two reusable stdio entries', async () => {
    const manifest: unknown = JSON.parse(await readFile(path.join(pluginRoot, 'plugin.json'), 'utf8'));
    const mcp: unknown = JSON.parse(await readFile(path.join(pluginRoot, 'mcp.json'), 'utf8'));
    assert.ok(isRecord(manifest) && isRecord(mcp) && isRecord(mcp.mcpServers));
    assert.equal(manifest.name, 'debugging-cdp-targets');
    const packageData: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.ok(isRecord(packageData) && isSemVer(packageData.version));
    assert.equal(manifest.version, packageData.version);
    assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ['cdp-target-1', 'cdp-target-2']);
    for (const slot of ['1', '2'])
        assert.deepEqual(mcp.mcpServers[`cdp-target-${slot}`], {
            type: 'stdio',
            command: 'node',
            args: [`\${PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`, '--slot', slot],
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
    const marketplace: unknown = JSON.parse(
        await readFile(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'),
    );
    assert.ok(isRecord(marketplace) && Array.isArray(marketplace.plugins));
    assert.deepEqual(
        marketplace.plugins.map((plugin: unknown) => {
            assert.ok(isRecord(plugin) && isRecord(plugin.source));
            return plugin.source.path;
        }),
        ['./plugins/debugging-cdp-targets'],
    );
});
