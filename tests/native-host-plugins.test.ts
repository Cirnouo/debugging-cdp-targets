import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { type NativeCommand, NativeHostPluginAdapter } from '../src/adapters/native-host-plugins.ts';

const own = 'debugging-cdp-targets@debugging-cdp-targets';
const remote = 'https://example.invalid/plugin.git';
const sha = 'a'.repeat(40);

async function fixture(
    host: 'codex' | 'claude',
    inventories: unknown[],
    market: unknown,
    extra: Record<string, unknown> = {},
) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-host-空 & '));
    const cwd = path.join(root, 'neutral');
    await mkdir(cwd);
    const catalog = path.join(root, 'catalog');
    await mkdir(catalog);
    const catalogFile = path.join(
        catalog,
        host === 'codex' ? '.agents/plugins/marketplace.json' : '.claude-plugin/marketplace.json',
    );
    await mkdir(path.dirname(catalogFile), { recursive: true });
    await writeFile(
        catalogFile,
        JSON.stringify({
            name: 'debugging-cdp-targets',
            plugins: [
                {
                    name: 'debugging-cdp-targets',
                    source: {
                        source: 'git-subdir',
                        url: remote,
                        path: `./plugins/${host === 'codex' ? 'codex' : 'claude-code'}/debugging-cdp-targets`,
                        sha,
                    },
                },
            ],
        }),
    );
    const calls: NativeCommand[] = [];
    const adapter = new NativeHostPluginAdapter(
        {
            host,
            executable: path.join(root, 'CLI 空 &.exe'),
            configRoot: root,
            neutralCwd: cwd,
            marketplaceSource: remote,
            environment: { PATH: '/desktop-path', PRIVATE_TOKEN: 'never-display' },
            ...extra,
        },
        {
            resolveExecutable: async (selection) => selection.executable ?? 'missing',
            run: async (command) => {
                calls.push(command);
                const args = command.args.join(' ');
                if (host === 'codex' && args.startsWith('plugin marketplace add '))
                    await writeFile(
                        path.join(root, 'config.toml'),
                        `[marketplaces.debugging-cdp-targets]\nsource_type="git"\nsource="${remote}"\n`,
                    );
                const value =
                    args === '--version'
                        ? host === 'codex'
                            ? 'codex-cli 0.163.0'
                            : '2.1.302 (Claude Code)'
                        : args === 'plugin marketplace list --json'
                          ? typeof market === 'function'
                              ? market(catalog)
                              : (market ??
                                (host === 'codex'
                                    ? {
                                          marketplaces: [
                                              {
                                                  name: 'debugging-cdp-targets',
                                                  root: catalog,
                                                  marketplaceSource: { sourceType: 'git', source: remote },
                                              },
                                          ],
                                      }
                                    : [
                                          {
                                              name: 'debugging-cdp-targets',
                                              source: 'git',
                                              url: remote,
                                              installLocation: catalog,
                                          },
                                      ]))
                          : inventories.shift();
                return { exitCode: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) };
            },
        },
    );
    return { root, catalog, calls, adapter, catalogFile };
}

test('Codex cold inventory has unresolved scope/path; marketplace source is never installedPath', async () => {
    const f = await fixture(
        'codex',
        [
            {
                installed: [
                    {
                        pluginId: own,
                        name: 'debugging-cdp-targets',
                        marketplaceName: 'debugging-cdp-targets',
                        version: '0.2.0',
                        installed: true,
                        enabled: true,
                        source: { source: 'local', path: '/private/source' },
                    },
                ],
                available: [],
            },
        ],
        null,
    );
    try {
        const result = await f.adapter.inspect();
        assert.equal(result.installations[0]?.readOnlyReason, 'existing-unresolved');
        assert.equal(result.installations[0]?.root, undefined);
        assert.equal(
            f.calls.some((call) => call.args.includes('add')),
            false,
        );
        assert.equal(f.calls[0]?.env.CODEX_HOME, f.root);
        assert.equal(f.calls[0]?.cwd, path.join(f.root, 'neutral'));
        assert.equal(f.calls[0]?.windowsHide, true);
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('Claude user root shared by any project/local/managed record and readFromFolder are read-only', async () => {
    const f = await fixture(
        'claude',
        [
            [
                { id: own, scope: 'user', version: '0.2.0', enabled: true, installPath: 'placeholder' },
                { id: own, scope: 'managed', version: '0.2.0', enabled: true, installPath: 'placeholder' },
            ],
        ],
        null,
    );
    try {
        await mkdir(path.join(f.root, 'payload'));
        const inventory = [
            { id: own, scope: 'user', version: '0.2.0', enabled: true, installPath: path.join(f.root, 'payload') },
            { id: own, scope: 'managed', version: '0.2.0', enabled: true, installPath: path.join(f.root, 'payload') },
        ];
        const g = await fixture('claude', [inventory], null);
        try {
            assert.equal((await g.adapter.inspect()).installations[0]?.readOnlyReason, 'shared-installation');
        } finally {
            await rm(g.root, { recursive: true });
        }
        const alias = await fixture('claude', [[inventory[0], { ...inventory[1], readFromFolder: f.root }]], null);
        try {
            assert.equal((await alias.adapter.inspect()).installations[0]?.readOnlyReason, 'shared-installation');
        } finally {
            await rm(alias.root, { recursive: true });
        }
        const h = await fixture('claude', [[{ ...inventory[0], readFromFolder: f.root }]], null);
        try {
            assert.equal((await h.adapter.inspect()).installations[0]?.readOnlyReason, 'in-place-installation');
        } finally {
            await rm(h.root, { recursive: true });
        }
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('Claude own user disablement beats merged enabled and unrelated data stays private', async () => {
    const f = await fixture(
        'claude',
        [
            [
                {
                    id: own,
                    scope: 'user',
                    version: '0.2.0',
                    enabled: true,
                    installPath: '/not-read',
                    mcpServers: { secret: 'private' },
                },
                { id: 'unrelated@other', secret: 'private' },
            ],
        ],
        null,
    );
    try {
        await writeFile(path.join(f.root, 'settings.json'), JSON.stringify({ enabledPlugins: { [own]: false } }));
        const result = await f.adapter.inspect();
        assert.equal(result.installations[0]?.readOnlyReason, 'disabled');
        assert.equal(result.installations.length, 1);
        assert.doesNotMatch(JSON.stringify(result), /private|secret|TOKEN/);
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('native JSON, executable and output failures are bounded visible prerequisites', async () => {
    const f = await fixture('codex', ['invalid json'], null);
    try {
        await assert.rejects(f.adapter.inspect(), /invalid-native-output/);
    } finally {
        await rm(f.root, { recursive: true });
    }
    const g = await fixture('codex', [{ installed: [], available: [] }], { marketplaces: [] });
    try {
        const missing = new NativeHostPluginAdapter(g.adapter.selection, { resolveExecutable: async () => undefined });
        await assert.rejects(missing.inspect(), /cli-missing/);
        const failure = new NativeHostPluginAdapter(g.adapter.selection, {
            resolveExecutable: async () => 'fixture',
            run: async () => ({ exitCode: 1, stdout: 'private/path/token' }),
        });
        await assert.rejects(failure.inspect(), /native-command-failed/);
    } finally {
        await rm(g.root, { recursive: true });
    }
});

test('selected Codex upgrade requires exact structured selector and rejects errors even on exit zero', async () => {
    const f = await fixture('codex', [], { marketplaces: [] });
    try {
        for (const output of [
            {},
            { selectedMarketplaces: ['other'], upgradedRoots: [], errors: [] },
            { selectedMarketplaces: ['debugging-cdp-targets'], upgradedRoots: [], errors: ['private error'] },
            { selectedMarketplaces: ['debugging-cdp-targets'], upgradedRoots: [], errors: 'unsupported' },
        ]) {
            await writeFile(path.join(f.root, 'config.toml'), '');
            const adapter = new NativeHostPluginAdapter(f.adapter.selection, {
                resolveExecutable: async () => 'fixture',
                run: async (command) => {
                    if (command.args.includes('add')) {
                        await writeFile(
                            path.join(f.root, 'config.toml'),
                            `[marketplaces.debugging-cdp-targets]\nsource_type="git"\nsource="${remote}"\n`,
                        );
                        return {
                            exitCode: 0,
                            stdout: JSON.stringify({
                                marketplaceName: 'debugging-cdp-targets',
                                installedRoot: f.catalog,
                                alreadyAdded: false,
                            }),
                        };
                    }
                    assert.deepEqual(command.args, [
                        'plugin',
                        'marketplace',
                        'upgrade',
                        'debugging-cdp-targets',
                        '--json',
                    ]);
                    return { exitCode: 0, stdout: JSON.stringify(output) };
                },
            });
            await adapter.refreshMarketplace(true);
            await assert.rejects(adapter.refreshMarketplace(false), /marketplace-refresh-failed/);
        }
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('Claude mutations accept only matching final JSON and explicitly retain user scope', async () => {
    const f = await fixture('claude', [], []);
    try {
        await writeFile(
            path.join(f.root, 'settings.json'),
            JSON.stringify({
                extraKnownMarketplaces: { 'debugging-cdp-targets': { source: { source: 'git', url: remote } } },
                enabledPlugins: { [own]: true },
            }),
        );
        const adapter = new NativeHostPluginAdapter(f.adapter.selection, {
            resolveExecutable: async () => 'fixture',
            run: async (command) => {
                assert.deepEqual(command.args, ['plugin', 'update', own, '--scope', 'user', '--json']);
                return {
                    exitCode: 0,
                    stdout: `bounded progress\n${JSON.stringify({ command: 'update', outcome: 'ok', pluginId: own, scope: 'user' })}\n`,
                };
            },
        });
        await adapter.installOrUpdate(true, '0.2.0');
        for (const output of [
            'garbage',
            '{}',
            JSON.stringify({ command: 'install', outcome: 'ok', pluginId: own, scope: 'user' }),
            JSON.stringify({ command: 'update', outcome: 'ok', pluginId: own, scope: 'project' }),
        ]) {
            const bad = new NativeHostPluginAdapter(f.adapter.selection, {
                resolveExecutable: async () => 'fixture',
                run: async () => ({ exitCode: 0, stdout: output }),
            });
            await assert.rejects(bad.installOrUpdate(true, '0.2.0'), /native/);
        }
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('timeout, oversized and malformed version output fail without exposing raw details', async () => {
    const f = await fixture('codex', [], { marketplaces: [] });
    try {
        for (const [output, reason] of [
            [{ exitCode: 0, stdout: 'x'.repeat(256 * 1024 + 1) }, 'native-output-too-large'],
            [{ exitCode: 0, stdout: 'private/token', timedOut: true }, 'native-command-timeout'],
            [{ exitCode: 0, stdout: 'codex-cli v0.163.0' }, 'invalid-native-output'],
            [{ exitCode: 0, stdout: 'warning\ncodex-cli 0.163.0' }, 'invalid-native-output'],
        ] as const) {
            const adapter = new NativeHostPluginAdapter(f.adapter.selection, {
                resolveExecutable: async () => 'fixture',
                run: async () => output,
            });
            await assert.rejects(adapter.inspect(), new RegExp(reason));
        }
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('Codex real TOML parsing preserves unrelated edits and refuses hidden ref changes', async () => {
    const outputs: unknown[] = [];
    const f = await fixture('codex', outputs, null);
    try {
        const config = path.join(f.root, 'config.toml');
        await writeFile(config, '');
        outputs.push({ marketplaceName: 'debugging-cdp-targets', installedRoot: f.catalog, alreadyAdded: false });
        await f.adapter.refreshMarketplace(true);
        outputs.push({ installed: [], available: [] });
        assert.equal((await f.adapter.inspect()).marketplace?.readOnlyReason, undefined);
        const safe = await readFile(config, 'utf8');
        await writeFile(config, `${safe}\n[unrelated]\nsecret="never-store"\n`);
        outputs.push({ installed: [], available: [] });
        assert.equal((await f.adapter.inspect()).marketplace?.readOnlyReason, undefined);
        await writeFile(config, `${safe}ref = "pinned"\n`);
        outputs.push({ installed: [], available: [] });
        assert.equal((await f.adapter.inspect()).marketplace?.readOnlyReason, 'pinned-or-ambiguous');
        assert.match(await readFile(config, 'utf8'), /pinned/);
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('Claude commands cannot adopt own configuration drift after a safe native receipt', async () => {
    const f = await fixture('claude', [], []);
    try {
        const settings = (autoUpdate?: boolean) => ({
            extraKnownMarketplaces: {
                'debugging-cdp-targets': {
                    source: { source: 'git', url: remote },
                    ...(autoUpdate === undefined ? {} : { autoUpdate }),
                },
            },
            enabledPlugins: { [own]: true },
        });
        for (const action of ['refresh', 'install'] as const) {
            await writeFile(path.join(f.root, 'settings.json'), JSON.stringify(settings()));
            const calls: string[][] = [];
            const adapter = new NativeHostPluginAdapter(f.adapter.selection, {
                resolveExecutable: async () => 'fixture',
                run: async (command) => {
                    calls.push(command.args);
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify(
                            command.args[1] === 'marketplace'
                                ? { command: 'marketplace-update', outcome: 'ok', marketplace: 'debugging-cdp-targets' }
                                : { command: 'update', outcome: 'ok', pluginId: own, scope: 'user' },
                        ),
                    };
                },
            });
            await adapter.refreshMarketplace(false);
            await writeFile(path.join(f.root, 'settings.json'), JSON.stringify(settings(false)));
            await assert.rejects(
                action === 'refresh' ? adapter.refreshMarketplace(false) : adapter.installOrUpdate(true, '0.2.0'),
                /configuration-changed/,
            );
            assert.equal(calls.length, 1);
            assert.match(await readFile(path.join(f.root, 'settings.json'), 'utf8'), /"autoUpdate":false/);
        }
    } finally {
        await rm(f.root, { recursive: true });
    }
});
