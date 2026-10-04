import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import { compareDistributionTrees, readDistributionTree } from '../../tooling/distribution-audit.ts';
import { createClient, createStdioClient, readMcpTools } from './mcp-client.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const home = await mkdtemp(path.join(os.tmpdir(), 'dct-codex-home-'));
const executable = process.argv[2] ?? 'codex';
const environment = { ...process.env, CODEX_HOME: home };
function codex(args: string[]) {
    const result = spawnSync(executable, args, {
        env: environment,
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
        timeout: 60_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const value: unknown = JSON.parse(result.stdout);
    assert.ok(isRecord(value));
    return value;
}
try {
    const marketplace = codex(['plugin', 'marketplace', 'add', root, '--json']);
    console.log(JSON.stringify({ marketplace }));
    const installed = codex(['plugin', 'add', 'debugging-cdp-targets@debugging-cdp-targets', '--json']);
    console.log(JSON.stringify({ installed }));
    const source = await readDistributionTree(path.join(root, 'plugins/codex/debugging-cdp-targets'));
    assert.equal(typeof installed.installedPath, 'string');
    const installedPath = String(installed.installedPath);
    const payload = await readDistributionTree(installedPath);
    assert.deepEqual(compareDistributionTrees(source, payload), []);
    const config = await readFile(path.join(home, 'config.toml'), 'utf8');
    assert.match(config, /debugging-cdp-targets/);
    const appServer = createStdioClient(executable, ['app-server', '--listen', 'stdio://'], {
        cwd: root,
        env: environment,
    });
    try {
        await appServer.request('initialize', {
            clientInfo: { name: 'isolated-marketplace-smoke', title: null, version: '0.1.0' },
            capabilities: { experimentalApi: true, requestAttestation: false },
        });
        appServer.notify('initialized');
        const status = await appServer.request('mcpServerStatus/list');
        assert.ok(isRecord(status) && Array.isArray(status.data));
        const servers = status.data.filter(
            (server: unknown) => isRecord(server) && server.pluginId === 'debugging-cdp-targets@debugging-cdp-targets',
        );
        assert.equal(servers.length, 1, 'Codex must discover the installed Plugin MCP gateway.');
        const server: unknown = servers[0];
        assert.ok(isRecord(server) && isRecord(server.tools));
        assert.equal(server.name, 'cdp-targets');
        assert.equal(server.toolsError, null);
        for (const tool of ['list_pages', 'dct_connection_status'])
            assert.ok(isRecord(server.tools[tool]), `Codex did not load ${tool}.`);
        assert.ok(!server.tools.dct_watch_target);
        console.log(JSON.stringify({ discoveredServer: server.name, toolCount: Object.keys(server.tools).length }));
    } finally {
        await appServer.close();
    }
    const client = createClient(path.join(installedPath, 'dist/mcp-bootstrap.mjs'));
    try {
        await client.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'isolated-marketplace-smoke', version: '0.1.0' },
        });
        client.notify('notifications/initialized');
        const tools = readMcpTools(await client.request('tools/list'));
        assert.ok(tools.some((entry) => entry.name === 'list_pages'));
        await assert.rejects(() => client.request('tools/call', { name: 'list_pages', arguments: {} }), /routing/);
        const status = await client.request('tools/call', { name: 'dct_connection_status', arguments: {} });
        assert.ok(isRecord(status) && isRecord(status.structuredContent));
        assert.deepEqual(status.structuredContent.connections, []);
    } finally {
        await client.close();
    }
    console.log('Local Marketplace installation and Codex MCP discovery succeeded in an isolated Codex home.');
} finally {
    await rm(home, { recursive: true, maxRetries: 10, retryDelay: 200 });
}
