import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildServerArguments } from '../src/adapters/official-server.ts';
import { isRecord } from '../src/shared/errors.ts';
import {
    assembleClaudeCodePayload,
    generateHostPayloads,
    generateRuntimeFiles,
    syncPluginFiles,
} from '../tooling/build-plugin.ts';
import {
    auditDistribution,
    readDistributionTree,
    validateHooks,
    validateHostManifest,
    validateMarketplace,
    validateMcpEntries,
} from '../tooling/distribution-audit.ts';
import { CLAUDE_CODE_HOST, CODEX_HOST, PLUGIN_HOSTS } from '../tooling/host-policy.ts';
import { requiredPayloadFiles, validatePayloadFileInventory } from '../tooling/payload-policy.ts';
import { createClient, createStdioClient, readMcpTools } from './smoke/mcp-client.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Codex requires explicit Skill discovery while Claude retains default discovery', async () => {
    for (const host of PLUGIN_HOSTS) {
        const manifest: unknown = JSON.parse(await readFile(path.join(root, host.inputRoot, host.manifest), 'utf8'));
        assert.ok(isRecord(manifest));
        if (host === CODEX_HOST) {
            assert.deepEqual(validateHostManifest({ ...manifest, skills: './skills/' }, host), []);
            const missing = { ...manifest };
            delete missing.skills;
            assert.ok(validateHostManifest(missing, host).length);
            for (const skills of [null, [], {}, 1, '', './skills', '../skills/', './other/'])
                assert.ok(validateHostManifest({ ...manifest, skills }, host).length);
        } else {
            assert.ok(validateHostManifest({ ...manifest, skills: './skills/' }, host).length);
        }
    }
});

test('Codex independently inventories its presentation overlay and Claude rejects it', () => {
    const overlay = [
        'skills/debugging-cdp-targets/agents/README.md',
        'skills/debugging-cdp-targets/agents/openai.yaml',
    ];
    const codex = requiredPayloadFiles(CODEX_HOST);
    assert.deepEqual(codex.filter((file) => file.includes('/agents/')).sort(), overlay);
    for (const file of overlay) {
        assert.ok(
            validatePayloadFileInventory(
                codex.filter((entry) => entry !== file),
                CODEX_HOST,
            ).length,
        );
        assert.ok(
            validatePayloadFileInventory([...requiredPayloadFiles(CLAUDE_CODE_HOST), file], CLAUDE_CODE_HOST).length,
        );
    }
});

test('peer hosts own explicit independent inventories and reject cross-host and malformed entries', () => {
    assert.deepEqual(
        PLUGIN_HOSTS.map((host) => host.id),
        ['codex', 'claude-code'],
    );
    for (const host of PLUGIN_HOSTS) {
        const files = requiredPayloadFiles(host);
        assert.deepEqual(
            files.filter((file) => file.startsWith('assets/')).sort(),
            host === CODEX_HOST
                ? ['assets/README.md', 'assets/icon-dark.png', 'assets/icon.png']
                : ['assets/README.md', 'assets/icon.png'],
        );
        assert.deepEqual(validatePayloadFileInventory(files, host), []);
        for (const invalid of [
            files.slice(1),
            [...files, files[0] ?? ''],
            [...files, '../escape'],
            [...files, 'extra'],
        ])
            assert.ok(validatePayloadFileInventory(invalid, host).length);
        assert.ok(
            validatePayloadFileInventory(
                requiredPayloadFiles(host === CODEX_HOST ? CLAUDE_CODE_HOST : CODEX_HOST),
                host,
            ).length,
        );
    }
});

test('Codex inventory rejects stale light artwork instead of replacing its universal base', () => {
    const files = requiredPayloadFiles(CODEX_HOST);
    assert.ok(validatePayloadFileInventory([...files, 'assets/icon-light.png'], CODEX_HOST).length);
    assert.ok(
        validatePayloadFileInventory(
            files.map((file) => (file === 'assets/icon.png' ? 'assets/icon-light.png' : file)),
            CODEX_HOST,
        ).length,
    );
});

test('host metadata rejects wrong argv, discovery fields, hooks and marketplace routing', async () => {
    for (const host of PLUGIN_HOSTS) {
        const read = async (file: string): Promise<unknown> =>
            JSON.parse(await readFile(path.join(root, host.inputRoot, file), 'utf8'));
        const manifest = await read(host.manifest);
        const mcp = await read(host.mcp);
        const hooks = await read(host.hooks);
        const marketplace: unknown = JSON.parse(await readFile(path.join(root, host.marketplace), 'utf8'));
        assert.deepEqual(validateHostManifest(manifest, host), []);
        assert.deepEqual(validateMcpEntries(mcp, host), []);
        assert.deepEqual(validateHooks(hooks, host), []);
        assert.deepEqual(validateMarketplace(marketplace, host), []);
        const other = host === CODEX_HOST ? CLAUDE_CODE_HOST : CODEX_HOST;
        assert.ok(validateHostManifest(manifest, other).length);
        assert.ok(validateMcpEntries(mcp, other).length);
        assert.ok(validateHooks(hooks, other).length);
        assert.ok(validateMarketplace(marketplace, other).length);
        for (const invalid of [null, [], {}, { hooks: {} }, { hooks: { Stop: [] } }])
            assert.ok(validateHooks(invalid, host).length);
        for (const invalid of [
            null,
            [],
            {},
            { plugins: [] },
            { plugins: [{ name: 'debugging-cdp-targets', source: '../escape' }] },
        ])
            assert.ok(validateMarketplace(invalid, host).length);
    }
});

test('host manifests accept explicit project links and host display metadata', async () => {
    for (const host of PLUGIN_HOSTS) {
        const manifest: unknown = JSON.parse(await readFile(path.join(root, host.inputRoot, host.manifest), 'utf8'));
        assert.ok(isRecord(manifest));
        const metadata = { ...manifest, homepage: 'https://github.com/Cirnouo/debugging-cdp-targets' };
        if (host === CODEX_HOST) {
            assert.ok(isRecord(manifest.interface));
            assert.deepEqual(
                validateHostManifest({
                    ...metadata,
                    interface: {
                        ...manifest.interface,
                        websiteURL: 'https://github.com/Cirnouo/debugging-cdp-targets',
                        longDescription:
                            'Launch a new local Chrome browser or another verified CDP-capable application with the isolation option you choose. Use the official Chrome DevTools tools to capture screenshots, diagnose console and network issues, and inspect performance. Choose Close or Keep when the task ends.',
                    },
                }),
                [],
            );
        } else {
            assert.deepEqual(validateHostManifest({ ...metadata, displayName: 'Debugging CDP Targets' }, host), []);
        }
    }
});

test('host manifests reject missing, malformed or wrong project homepages', async () => {
    for (const host of PLUGIN_HOSTS) {
        const manifest: unknown = JSON.parse(await readFile(path.join(root, host.inputRoot, host.manifest), 'utf8'));
        assert.ok(isRecord(manifest));
        const missing = { ...manifest };
        delete missing.homepage;
        assert.ok(validateHostManifest(missing, host).length, `${host.id}: missing homepage`);
        for (const homepage of [undefined, null, 1, {}, [], '', 'https://example.com'])
            assert.ok(validateHostManifest({ ...manifest, homepage }, host).length, `${host.id}: ${homepage}`);
    }
});

test('Codex rejects missing, malformed or wrong website and long description metadata', async () => {
    const manifest: unknown = JSON.parse(
        await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
    );
    assert.ok(isRecord(manifest) && isRecord(manifest.interface));
    for (const key of ['websiteURL', 'longDescription']) {
        const missing = { ...manifest.interface };
        delete missing[key];
        assert.ok(validateHostManifest({ ...manifest, interface: missing }).length, `missing ${key}`);
        for (const value of [undefined, null, 1, {}, [], '', 'https://example.com', 'Other description'])
            assert.ok(
                validateHostManifest({ ...manifest, interface: { ...manifest.interface, [key]: value } }).length,
                key,
            );
    }
});

test('Claude rejects missing, malformed or wrong display names and Codex website fields', async () => {
    const manifest: unknown = JSON.parse(
        await readFile(path.join(root, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest), 'utf8'),
    );
    assert.ok(isRecord(manifest));
    const missing = { ...manifest };
    delete missing.displayName;
    assert.ok(validateHostManifest(missing, CLAUDE_CODE_HOST).length, 'missing displayName');
    for (const displayName of [undefined, null, 1, {}, [], '', 'Other display name'])
        assert.ok(validateHostManifest({ ...manifest, displayName }, CLAUDE_CODE_HOST).length);
    assert.ok(
        validateHostManifest(
            { ...manifest, websiteURL: 'https://github.com/Cirnouo/debugging-cdp-targets' },
            CLAUDE_CODE_HOST,
        ).length,
    );
});

test('Codex accepts three distinct single-line starter prompts within the runtime code point boundary', async () => {
    const manifest: unknown = JSON.parse(
        await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
    );
    assert.ok(isRecord(manifest) && isRecord(manifest.interface));
    for (const prompts of [
        ['Capture a screenshot.', 'Inspect failed requests.', 'Profile a page load.'],
        ['x'.repeat(128), 'Inspect failed requests.', 'Profile a page load.'],
        ['😀'.repeat(128), 'Inspect failed requests.', 'Profile a page load.'],
    ]) {
        assert.deepEqual(
            validateHostManifest({ ...manifest, interface: { ...manifest.interface, defaultPrompt: prompts } }),
            [],
        );
    }
});

test('Codex rejects missing or malformed starter prompts while Claude rejects Codex-only fields', async () => {
    const manifest: unknown = JSON.parse(
        await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
    );
    const claude: unknown = JSON.parse(
        await readFile(path.join(root, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest), 'utf8'),
    );
    assert.ok(isRecord(manifest) && isRecord(manifest.interface) && isRecord(claude));
    const missing = { ...manifest.interface };
    delete missing.defaultPrompt;
    assert.ok(validateHostManifest({ ...manifest, interface: missing }).length, 'missing field');
    const invalid: [string, unknown][] = [
        ['null', null],
        ['object', {}],
        ['string', 'Capture a screenshot.'],
        ['empty list', []],
        ['one prompt', ['Capture a screenshot.']],
        ['two prompts', ['Capture a screenshot.', 'Inspect failed requests.']],
        ['four prompts', ['One', 'Two', 'Three', 'Four']],
        ['non-string', ['One', 'Two', 3]],
        ['empty', ['One', 'Two', '']],
        ['whitespace', ['One', 'Two', '   ']],
        ['duplicate', ['One', 'One', 'Three']],
        ['trimmed duplicate', ['One', ' One ', 'Three']],
        ['line feed', ['One', 'Two', 'Three\nFour']],
        ['carriage return', ['One', 'Two', 'Three\rFour']],
        ['tab', ['One', 'Two', 'Three\tFour']],
        ['null byte', ['One', 'Two', 'Three\u0000Four']],
        ['delete control', ['One', 'Two', 'Three\u007fFour']],
        ['next-line control', ['One', 'Two', 'Three\u0085Four']],
        ['line separator', ['One', 'Two', 'Three\u2028Four']],
        ['paragraph separator', ['One', 'Two', 'Three\u2029Four']],
        ['129 ASCII code points', ['One', 'Two', 'x'.repeat(129)]],
        ['129 non-BMP code points', ['One', 'Two', '😀'.repeat(129)]],
    ];
    for (const [name, prompts] of invalid)
        assert.ok(
            validateHostManifest({ ...manifest, interface: { ...manifest.interface, defaultPrompt: prompts } }).length,
            name,
        );
    assert.ok(validateHostManifest({ ...claude, defaultPrompt: ['One', 'Two', 'Three'] }, CLAUDE_CODE_HOST).length);
    assert.ok(
        validateHostManifest({ ...claude, interface: { defaultPrompt: ['One', 'Two', 'Three'] } }, CLAUDE_CODE_HOST)
            .length,
    );
});

test('one runtime produces complete peer payloads with identical shared bytes', async () => {
    const outputs = await generateHostPayloads();
    assert.deepEqual([...outputs.keys()], ['codex', 'claude-code']);
    const codex = outputs.get('codex');
    const claude = outputs.get('claude-code');
    assert.ok(codex && claude);
    for (const [file, bytes] of codex) {
        if (file === 'LICENSE' || file.startsWith('dist/')) assert.ok(claude.get(file)?.equals(bytes), file);
    }
    const sharedSkills = await readDistributionTree(path.join(root, 'packaging/shared/skills'));
    for (const [file, bytes] of sharedSkills) {
        assert.ok(codex.get(`skills/${file}`)?.equals(bytes), `codex: ${file}`);
        assert.ok(claude.get(`skills/${file}`)?.equals(bytes), `claude-code: ${file}`);
    }
    assert.equal(
        claude.get('README.md')?.toString(),
        await readFile(path.join(root, 'packaging/claude-code/plugin-README.md'), 'utf8'),
    );
    assert.ok(claude.has('.mcp.json'));
    assert.equal(claude.has('mcp.json'), false);
    const maintained: unknown = JSON.parse(
        await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
    );
    const generated: unknown = JSON.parse(codex.get(CODEX_HOST.manifest)?.toString() ?? '{}');
    assert.ok(isRecord(maintained) && isRecord(maintained.interface));
    assert.ok(isRecord(generated) && isRecord(generated.interface));
    assert.ok(Array.isArray(generated.interface.defaultPrompt));
    assert.equal(generated.interface.defaultPrompt.length, 3);
    assert.deepEqual(generated.interface.defaultPrompt, maintained.interface.defaultPrompt);
});

test('Claude assembly rejects competing, missing, linked and escaped inputs without repairing outputs', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-peer-input-')));
    try {
        await cp(path.join(root, 'packaging'), path.join(fixture, 'packaging'), { recursive: true });
        await cp(path.join(root, 'LICENSE'), path.join(fixture, 'LICENSE'));
        await cp(path.join(root, 'package.json'), path.join(fixture, 'package.json'));
        const runtime = await generateRuntimeFiles();
        const payload = await assembleClaudeCodePayload(runtime, fixture);
        for (const file of ['LICENSE', 'dist/README.md', 'skills/competing/SKILL.md']) {
            const competing = path.join(fixture, CLAUDE_CODE_HOST.inputRoot, file);
            await mkdir(path.dirname(competing), { recursive: true });
            await writeFile(competing, 'competing');
            await assert.rejects(assembleClaudeCodePayload(runtime, fixture), /Unexpected packaging input/);
            await rm(
                file.includes('/')
                    ? path.join(fixture, CLAUDE_CODE_HOST.inputRoot, file.split('/')[0] ?? '')
                    : competing,
                { recursive: true },
            );
        }
        const manifest = path.join(fixture, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest);
        await rm(manifest);
        await assert.rejects(assembleClaudeCodePayload(runtime, fixture), /Missing packaging input/);
        await symlink(path.join(root, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest), manifest);
        await assert.rejects(assembleClaudeCodePayload(runtime, fixture), /symlink|linked/);
        await rm(manifest);
        await cp(path.join(root, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest), manifest);
        const manifestBytes = await readFile(manifest);
        await writeFile(manifest, manifestBytes.toString().replace('0.1.0', '0.1.1'));
        await assert.rejects(generateHostPayloads(fixture), /version/i);
        await writeFile(manifest, manifestBytes);
        const mcp = path.join(fixture, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.mcp);
        const mcpBytes = await readFile(mcp);
        await writeFile(mcp, mcpBytes.toString().replace(`\${CLAUDE_PLUGIN_ROOT}/`, '../'));
        await assert.rejects(assembleClaudeCodePayload(runtime, fixture), /gateway|MCP/);
        await writeFile(mcp, mcpBytes);
        runtime.set('README.md', Buffer.from('competing'));
        await assert.rejects(assembleClaudeCodePayload(runtime, fixture), /Duplicate packaging path/);
        runtime.delete('README.md');
        runtime.set('../escape', Buffer.from('escape'));
        await assert.rejects(assembleClaudeCodePayload(runtime, fixture), /Unexpected|Unsafe/);
        const destination = path.join(fixture, 'output');
        await mkdir(destination);
        await syncPluginFiles(payload, destination);
        await writeFile(path.join(destination, '.mcp.json'), 'stale');
        await assert.rejects(syncPluginFiles(payload, destination, { check: true }), /Stale/);
        assert.equal(await readFile(path.join(destination, '.mcp.json'), 'utf8'), 'stale');
        await rm(path.join(destination, '.mcp.json'));
        await assert.rejects(syncPluginFiles(payload, destination, { check: true }), /Missing/);
        await assert.rejects(readFile(path.join(destination, '.mcp.json')), /ENOENT/);
        await writeFile(path.join(destination, 'extra'), 'preserve');
        await assert.rejects(syncPluginFiles(payload, destination, { check: true }), /Unexpected/);
        assert.equal(await readFile(path.join(destination, 'extra'), 'utf8'), 'preserve');
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('distribution audit rejects either peer metadata, license or official resource drift', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-peer-audit-')));
    try {
        for (const file of ['plugins', 'packaging', '.agents', '.claude-plugin', 'package.json', 'LICENSE'])
            await cp(path.join(root, file), path.join(fixture, file), { recursive: true });
        assert.deepEqual(await auditDistribution(fixture), []);
        for (const host of PLUGIN_HOSTS) {
            for (const file of [host.manifest, 'LICENSE', 'dist/official-server/README.md']) {
                const target = path.join(fixture, host.payloadRoot, file);
                const original = await readFile(target);
                await writeFile(
                    target,
                    file === host.manifest ? original.toString().replace('0.1.0', '0.1.1') : 'drift',
                );
                assert.ok((await auditDistribution(fixture)).length, `${host.id}/${file}`);
                await writeFile(target, original);
            }
            const marketplace = path.join(fixture, host.marketplace);
            const original = await readFile(marketplace);
            await rm(marketplace);
            await symlink(path.join(root, host.marketplace), marketplace);
            assert.ok(
                (await auditDistribution(fixture)).some((error) => /link|identity/i.test(error)),
                host.marketplace,
            );
            await rm(marketplace);
            await writeFile(marketplace, original);
            const manifest = path.join(fixture, host.payloadRoot, host.manifest);
            const manifestBytes = await readFile(manifest);
            await writeFile(manifest, manifestBytes.toString().replace('{', '{"name":"shadow",'));
            assert.ok((await auditDistribution(fixture)).some((error) => /unique|duplicate/i.test(error)));
            await writeFile(manifest, manifestBytes);
        }
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('physical inventory rejects linked roots and linked parent directories', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-peer-link-')));
    try {
        const original = path.join(fixture, 'original');
        await mkdir(path.join(original, 'nested'), { recursive: true });
        await writeFile(path.join(original, 'nested', 'file'), 'bytes');
        const link = path.join(fixture, 'link');
        await symlink(original, link, 'junction');
        await assert.rejects(readDistributionTree(link), /link/);
        await assert.rejects(readDistributionTree(path.join(link, 'nested')), /link/);
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('each copied peer initializes official and gateway catalogs from arbitrary cwd without repository dependencies', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-peer-protocol-')));
    try {
        const home = path.join(fixture, 'home');
        const cwd = path.join(fixture, 'unrelated');
        await mkdir(home);
        await mkdir(cwd);
        const environment = {
            ...process.env,
            PATH: '',
            NODE_PATH: '',
            NODE_OPTIONS: '',
            HOME: home,
            USERPROFILE: home,
            LOCALAPPDATA: home,
            APPDATA: home,
            XDG_CONFIG_HOME: home,
            XDG_CACHE_HOME: home,
            TEMP: home,
            TMP: home,
            DCT_EXTENSIONS: 'true',
            DCT_USAGE_STATISTICS: 'false',
            DCT_PERFORMANCE_CRUX: 'false',
        };
        for (const host of PLUGIN_HOSTS) {
            const plugin = path.join(fixture, host.id);
            await cp(path.join(root, host.payloadRoot), plugin, { recursive: true });
            const official = createStdioClient(
                process.execPath,
                [
                    path.join(plugin, 'dist/official-server/build/src/bin/chrome-devtools-mcp.js'),
                    ...buildServerArguments('http://127.0.0.1:1', environment),
                ],
                { cwd, env: { ...environment, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' } },
            );
            const gateway = createClient(path.join(plugin, 'dist/mcp-bootstrap.mjs'), { cwd, env: environment });
            try {
                for (const client of [official, gateway]) {
                    await client.request('initialize', {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: { name: 'peer-distribution-test', version: '0.1.0' },
                    });
                    client.notify('notifications/initialized');
                }
                const officialNames = readMcpTools(await official.request('tools/list')).map((tool) => tool.name);
                const gatewayNames = readMcpTools(await gateway.request('tools/list')).map((tool) => tool.name);
                const lifecycle = [
                    'dct_connection_status',
                    'dct_connection_start',
                    'dct_connection_restart',
                    'dct_connection_stop',
                    'dct_connection_end_task',
                    'dct_operation_wait',
                    'dct_operation_cancel',
                ];
                assert.deepEqual(gatewayNames.filter((name) => name.startsWith('dct_')).sort(), lifecycle.sort());
                assert.ok(officialNames.includes('list_pages') && officialNames.includes('evaluate_script'));
                for (const name of officialNames) assert.ok(gatewayNames.includes(name), name);
                const catalog: unknown = JSON.parse(
                    await readFile(path.join(root, 'tooling/official-tool-catalog.json'), 'utf8'),
                );
                assert.ok(isRecord(catalog) && Array.isArray(catalog.tools));
                const reviewedNames = catalog.tools.map((tool: unknown) => {
                    assert.ok(isRecord(tool) && typeof tool.name === 'string');
                    return tool.name;
                });
                assert.deepEqual(gatewayNames.filter((name) => !name.startsWith('dct_')).sort(), reviewedNames.sort());
                const status = await gateway.request('tools/call', { name: 'dct_connection_status', arguments: {} });
                assert.ok(isRecord(status) && isRecord(status.structuredContent));
                assert.deepEqual(status.structuredContent.connections, []);
                await assert.rejects(gateway.request('tools/call', { name: 'list_pages', arguments: {} }), /routing/);
            } finally {
                await gateway.close();
                await official.close();
                assert.equal(gateway.child.exitCode, 0);
                assert.equal(gateway.child.signalCode, null);
                assert.equal(official.child.exitCode, 0);
                assert.equal(official.child.signalCode, null);
            }
        }
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});
