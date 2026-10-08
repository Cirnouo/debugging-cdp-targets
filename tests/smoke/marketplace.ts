import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import { compareDistributionTrees, readDistributionTree } from '../../tooling/distribution-audit.ts';
import { isolateCodexSkills, isolatedCodexEnvironment } from './codex-host.ts';
import { createClient, createStdioClient, readMcpTools } from './mcp-client.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const home = await mkdtemp(path.join(os.tmpdir(), 'dct-codex-home-'));
const executable = process.argv[2] ?? 'codex';
const environment = await isolatedCodexEnvironment(home);
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
    const manifest: unknown = JSON.parse(await readFile(path.join(installedPath, '.codex-plugin/plugin.json'), 'utf8'));
    assert.ok(isRecord(manifest) && isRecord(manifest.interface));
    assert.equal(manifest.homepage, 'https://github.com/Cirnouo/debugging-cdp-targets');
    assert.equal(manifest.repository, 'https://github.com/Cirnouo/debugging-cdp-targets');
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
        const listed = await appServer.request('plugin/list', { cwds: [root] });
        assert.ok(
            isRecord(listed) && Array.isArray(listed.marketplaces) && Array.isArray(listed.marketplaceLoadErrors),
        );
        const selected = listed.marketplaces.find(
            (entry: unknown) => isRecord(entry) && entry.name === 'debugging-cdp-targets',
        );
        assert.ok(isRecord(selected) && typeof selected.path === 'string' && Array.isArray(selected.plugins));
        assert.ok(path.isAbsolute(selected.path));
        assert.ok(
            listed.marketplaceLoadErrors.every(
                (entry: unknown) =>
                    isRecord(entry) &&
                    typeof entry.marketplacePath === 'string' &&
                    typeof entry.message === 'string' &&
                    path.resolve(entry.marketplacePath) !== path.resolve(String(selected.path)),
            ),
            'The selected local marketplace must load without errors.',
        );
        const summary = selected.plugins.find(
            (entry: unknown) => isRecord(entry) && entry.name === 'debugging-cdp-targets',
        );
        assert.ok(isRecord(summary) && typeof summary.id === 'string');
        const pluginId = summary.id;
        assert.equal(pluginId, 'debugging-cdp-targets@debugging-cdp-targets');
        const read = await appServer.request('plugin/read', {
            marketplacePath: selected.path,
            pluginName: 'debugging-cdp-targets',
        });
        assert.ok(isRecord(read) && isRecord(read.plugin));
        const detail = read.plugin;
        assert.equal(detail.marketplaceName, selected.name);
        assert.equal(detail.marketplacePath, selected.path);
        assert.ok(isRecord(detail.summary) && isRecord(detail.summary.interface));
        assert.equal(detail.summary.id, pluginId);
        assert.equal(detail.summary.name, 'debugging-cdp-targets');
        assert.equal(detail.summary.installed, true);
        assert.equal(detail.summary.enabled, true);
        const presentation = detail.summary.interface;
        assert.equal(presentation.displayName, 'Debugging CDP Targets');
        assert.equal(presentation.shortDescription, 'Inspect verified local CDP targets with Chrome DevTools');
        assert.equal(presentation.developerName, 'Cirnouo');
        assert.equal(presentation.category, 'Developer Tools');
        assert.equal(presentation.websiteUrl, 'https://github.com/Cirnouo/debugging-cdp-targets');
        // CLI loading proves preservation, while Desktop rendering remains a manual gate.
        assert.equal(presentation.longDescription, manifest.interface.longDescription);
        assert.deepEqual(presentation.defaultPrompt, manifest.interface.defaultPrompt);
        assert.deepEqual(detail.mcpServers, ['cdp-targets']);
        assert.ok(Array.isArray(detail.hooks));
        assert.deepEqual(
            detail.hooks
                .map((hook: unknown) => {
                    assert.ok(isRecord(hook) && typeof hook.key === 'string' && typeof hook.eventName === 'string');
                    return hook.eventName;
                })
                .sort(),
            ['postToolUse', 'preToolUse', 'stop', 'userPromptSubmit'],
        );
        assert.ok(Array.isArray(detail.skills));
        assert.equal(detail.skills.length, 1);
        const bundled: unknown = detail.skills[0];
        assert.ok(isRecord(bundled) && isRecord(bundled.interface));
        assert.equal(bundled.name, 'debugging-cdp-targets:debugging-cdp-targets');
        assert.equal(bundled.enabled, true);
        assert.equal(bundled.interface.displayName, 'Debugging CDP Targets');
        assert.equal(bundled.interface.shortDescription, 'Debug verified local CDP targets');
        const installedSkillPath = path.join(installedPath, 'skills/debugging-cdp-targets/SKILL.md');
        const isolated = await isolateCodexSkills(appServer, root, pluginId, installedSkillPath);
        const skill = isolated.skills.find((entry) => entry.pluginId === pluginId);
        assert.ok(skill && isRecord(skill.interface));
        assert.equal(skill.name, 'debugging-cdp-targets:debugging-cdp-targets');
        assert.equal(skill.enabled, true);
        assert.equal(skill.scope, 'user');
        assert.equal(typeof skill.path, 'string');
        assert.equal(path.resolve(String(skill.path)), path.resolve(installedSkillPath));
        assert.equal(skill.interface.displayName, 'Debugging CDP Targets');
        assert.equal(skill.interface.shortDescription, 'Debug verified local CDP targets');
        const installedIconPath = path.join(installedPath, 'assets/icon.png');
        const approvedIcon = await readFile(path.join(root, 'packaging/shared/assets/icon.png'));
        for (const field of ['iconSmall', 'iconLarge']) {
            const icon: unknown = skill.interface[field];
            assert.ok(typeof icon === 'string' && path.isAbsolute(icon));
            assert.equal(path.resolve(icon), path.resolve(installedIconPath));
            assert.deepEqual(await readFile(icon), approvedIcon);
        }
        console.log(
            JSON.stringify({
                pluginId,
                metadataDiscovered: true,
                installedSkillInterface: true,
                unrelatedMarketplaceLoadErrors: listed.marketplaceLoadErrors.length,
            }),
        );
        const status = await appServer.request('mcpServerStatus/list');
        assert.ok(isRecord(status) && Array.isArray(status.data));
        const servers = status.data.filter((server: unknown) => isRecord(server) && server.pluginId === pluginId);
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
        assert.equal(appServer.child.exitCode, 0);
        assert.ok(
            appServer.child.stdin.destroyed && appServer.child.stdout.destroyed && appServer.child.stderr.destroyed,
            'App-server close must settle its process and all stdio before temporary cleanup.',
        );
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
        assert.equal(client.child.exitCode, 0);
        assert.ok(
            client.child.stdin.destroyed && client.child.stdout.destroyed && client.child.stderr.destroyed,
            'Gateway close must settle its process and all stdio before temporary cleanup.',
        );
    }
    console.log('Local Marketplace installed bytes, metadata, Skill presentation and Codex MCP discovery succeeded.');
} finally {
    await rm(home, { recursive: true, maxRetries: 10, retryDelay: 200 });
}
