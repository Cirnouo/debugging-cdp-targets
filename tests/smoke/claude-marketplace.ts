import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDistributionTrees, readDistributionTree } from '../../tooling/distribution-audit.ts';
import { claudeEnvironment, claudeRequest, claudeSse, record } from './claude-host.ts';
import { claudeCli, claudeHost, sandbox } from './claude-process.ts';
import { createClient, readMcpTools } from './mcp-client.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const executable =
    process.argv[2] ?? (process.platform === 'win32' ? path.join(os.homedir(), '.local/bin/claude.exe') : 'claude');
const { temporary } = await sandbox(root, 'marketplace');
const marketplace = path.join(temporary, 'marketplace');
const source = path.join(marketplace, 'plugins/claude-code/debugging-cdp-targets');
await mkdir(path.join(marketplace, '.claude-plugin'), { recursive: true });
await cp(path.join(root, 'plugins/claude-code/debugging-cdp-targets'), source, { recursive: true });
await cp(path.join(root, '.claude-plugin/marketplace.json'), path.join(marketplace, '.claude-plugin/marketplace.json'));
const requests: unknown[] = [];
const providerRequests: unknown[] = [];
let failure: unknown;
const model = createServer(async (request, response) => {
    try {
        providerRequests.push({ method: request.method, url: request.url, headers: request.headers });
        await writeFile(path.join(temporary, 'provider-requests.json'), JSON.stringify(providerRequests, null, 4));
        if (request.method === 'HEAD' && request.url === '/api/hello') {
            response.end();
            return;
        }
        if (request.method === 'POST' && request.url?.startsWith('/v1/messages/count_tokens')) {
            response.end('{"input_tokens":10}');
            return;
        }
        assert.equal(request.method, 'POST');
        assert.ok(request.url === '/v1/messages' || request.url === '/v1/messages?beta=true');
        assert.equal(request.headers['x-api-key'], 'sk-ant-synthetic-dct-smoke');
        let body = '';
        for await (const chunk of request) body += chunk;
        const value = claudeRequest(body);
        requests.push(value);
        assert.equal(requests.length, 1, 'Discovery must not call target tools or continue.');
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(claudeSse(value.model, requests.length, { type: 'text', text: 'Discovery completed.' }));
    } catch (error) {
        failure = error;
        response.writeHead(500);
        response.end(String(error));
    }
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
const address = model.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}`;
try {
    const commands = [
        ['plugin', 'validate', marketplace],
        ['plugin', 'marketplace', 'add', marketplace],
        ['plugin', 'install', 'debugging-cdp-targets@debugging-cdp-targets', '--json'],
        ['plugin', 'details', 'debugging-cdp-targets@debugging-cdp-targets'],
    ];
    for (const [index, args] of commands.entries()) {
        const stdout = await claudeCli(executable, args, temporary, endpoint);
        await writeFile(path.join(temporary, `cli-${index}.json`), JSON.stringify({ args, stdout }, null, 4));
        if (index === 3) {
            assert.match(stdout, /Skills \(1\)/);
            assert.match(stdout, /Hooks \(4\)/);
            assert.match(stdout, /MCP servers \(1\)/);
            for (const event of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'])
                assert.ok(stdout.includes(event));
        }
    }
    const installed: unknown = JSON.parse(
        await readFile(path.join(temporary, 'config/plugins/installed_plugins.json'), 'utf8'),
    );
    assert.ok(record(installed) && record(installed.plugins));
    const entries = installed.plugins['debugging-cdp-targets@debugging-cdp-targets'];
    assert.ok(
        Array.isArray(entries) &&
            entries.length === 1 &&
            record(entries[0]) &&
            typeof entries[0].installPath === 'string',
    );
    const installedPath = entries[0].installPath;
    const original = await readDistributionTree(source);
    assert.deepEqual(compareDistributionTrees(original, await readDistributionTree(installedPath)), []);
    const host = await claudeHost(
        executable,
        temporary,
        endpoint,
        [],
        'Inspect the installed plugin catalog without starting a target.',
    );
    if (failure) throw failure;
    assert.ok(Array.isArray(host.init.plugins));
    const active = host.init.plugins.find(
        (plugin: unknown) => record(plugin) && plugin.name === 'debugging-cdp-targets',
    );
    assert.ok(record(active) && typeof active.path === 'string');
    assert.deepEqual(compareDistributionTrees(original, await readDistributionTree(active.path)), []);
    assert.ok(Array.isArray(host.init.mcp_servers));
    const server = host.init.mcp_servers.find(
        (item: unknown) => record(item) && item.name === 'plugin:debugging-cdp-targets:cdp-targets',
    );
    assert.ok(record(server) && server.status === 'connected');
    assert.ok(
        Array.isArray(host.init.skills) && host.init.skills.includes('debugging-cdp-targets:debugging-cdp-targets'),
    );
    assert.ok(
        Array.isArray(host.init.slash_commands) &&
            host.init.slash_commands.includes('debugging-cdp-targets:debugging-cdp-targets'),
    );
    assert.ok(Array.isArray(host.init.tools));
    const tools = host.init.tools.filter(
        (name: unknown) =>
            typeof name === 'string' && name.startsWith('mcp__plugin_debugging-cdp-targets_cdp-targets__'),
    );
    assert.equal(tools.length, 73, 'Actual Claude discovery must expose 66 official and seven lifecycle tools.');
    assert.ok(tools.some((name: unknown) => typeof name === 'string' && name.endsWith('__list_pages')));
    assert.ok(!JSON.stringify(tools).includes('dct_watch_target'));
    // Direct MCP verification supplements, and does not replace, the host discovery above.
    const client = createClient(path.join(installedPath, 'dist/mcp-bootstrap.mjs'), {
        cwd: path.join(temporary, 'workspace'),
        env: claudeEnvironment(temporary, endpoint),
    });
    try {
        await client.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'claude-installed-gateway-smoke', version: '0.1.0' },
        });
        client.notify('notifications/initialized');
        assert.equal(readMcpTools(await client.request('tools/list')).length, 73);
        await assert.rejects(() => client.request('tools/call', { name: 'list_pages', arguments: {} }), /routing/);
        const status = await client.request('tools/call', { name: 'dct_connection_status', arguments: {} });
        assert.ok(record(status) && record(status.structuredContent));
        assert.deepEqual(status.structuredContent.connections, []);
    } finally {
        await client.close();
    }
    await writeFile(path.join(temporary, 'requests.json'), JSON.stringify(requests, null, 4));
    console.log(
        JSON.stringify({
            host: 'Claude Code',
            version: host.version,
            temporary,
            installedPath,
            activeSourcePath: active.path,
            toolCount: tools.length,
            skillDiscovered: true,
            directGatewayVerified: true,
        }),
    );
} finally {
    model.closeAllConnections();
    await new Promise<void>((resolve, reject) => model.close((error) => (error ? reject(error) : resolve())));
}
