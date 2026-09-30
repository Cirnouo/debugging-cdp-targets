import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDistributionTrees, readDistributionTree } from '../../tooling/distribution-audit.mjs';
import { createClient } from './mcp-client.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const home = await mkdtemp(path.join(os.tmpdir(), 'dct-codex-home-'));
function codex(args) {
    const result = spawnSync('codex', args, {
        env: { ...process.env, CODEX_HOME: home },
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}
try {
    const marketplace = codex(['plugin', 'marketplace', 'add', root, '--json']);
    console.log(JSON.stringify({ marketplace }));
    const installed = codex(['plugin', 'add', 'debugging-cdp-targets@debugging-cdp-targets', '--json']);
    console.log(JSON.stringify({ installed }));
    const source = await readDistributionTree(path.join(root, 'plugins/debugging-cdp-targets'));
    const payload = await readDistributionTree(installed.installedPath);
    assert.deepEqual(compareDistributionTrees(source, payload), []);
    const config = await readFile(path.join(home, 'config.toml'), 'utf8');
    assert.match(config, /debugging-cdp-targets/);
    const client = createClient(path.join(installed.installedPath, 'dist/mcp-bootstrap.mjs'));
    try {
        await client.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'isolated-marketplace-smoke', version: '0.1.0' },
        });
        client.notify('notifications/initialized');
        const tools = await client.request('tools/list');
        assert.ok(tools.tools.some((entry) => entry.name === 'list_pages'));
        const pages = await client.request('tools/call', { name: 'list_pages', arguments: {} });
        assert.equal(pages.isError, true);
    } finally {
        await client.close();
    }
    console.log('Local Marketplace installation succeeded in an isolated Codex home.');
} finally {
    await rm(home, { recursive: true });
}
