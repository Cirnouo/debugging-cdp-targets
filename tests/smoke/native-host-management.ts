import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { JsonHostPluginReceiptStore } from '../../src/adapters/managed-plugin-receipts.ts';
import { NativeHostPluginAdapter, runNativeCommand } from '../../src/adapters/native-host-plugins.ts';
import { patchPluginEndpoint } from '../../src/adapters/verified-plugin-files.ts';
import { HostPluginManager, type HostPluginSummary } from '../../src/application/host-plugin-manager.ts';
import {
    type PluginHost,
    pluginManifestPath,
    pluginMcpPath,
    pluginSourcePath,
    type StablePluginRecord,
} from '../../src/domains/host-management.ts';

const run = promisify(execFile);

/** Opt-in native CLI evidence only. Minimal fixture payloads never claim Task4 App/tool acceptance. */
export async function nativeHostManagementSmoke(codexExecutable: string, claudeExecutable: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-native-host-空 & '));
    const repository = path.join(root, 'source');
    await mkdir(repository);
    const empty = path.join(root, 'empty');
    await mkdir(empty);
    const gitEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    );
    gitEnvironment.GIT_CONFIG_NOSYSTEM = '1';
    gitEnvironment.GIT_CONFIG_GLOBAL = path.join(empty, 'absent');
    gitEnvironment.GIT_TERMINAL_PROMPT = '0';
    const git = async (args: string[]) =>
        (
            await run('git', ['-c', `core.hooksPath=${empty}`, ...args], {
                cwd: repository,
                env: gitEnvironment,
                windowsHide: true,
                encoding: 'utf8',
                timeout: 60_000,
            })
        ).stdout.trim();
    await git(['init', '-b', 'main', `--template=${empty}`]);
    await git(['config', 'user.name', 'Isolated Fixture']);
    await git(['config', 'user.email', 'fixture@example.invalid']);
    await git(['config', 'uploadpack.allowFilter', 'true']);
    await git(['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    await writeFile(path.join(repository, '.gitattributes'), '* text=auto eol=lf\n');
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (!url.pathname.startsWith('/fixture.git/') || url.pathname.includes('..')) {
            response.writeHead(404).end();
            return;
        }
        const child = spawn('git', ['http-backend'], {
            cwd: repository,
            windowsHide: true,
            env: {
                ...gitEnvironment,
                GIT_PROJECT_ROOT: root,
                GIT_HTTP_EXPORT_ALL: '1',
                REQUEST_METHOD: request.method ?? 'GET',
                PATH_INFO: `/source/.git${url.pathname.slice('/fixture.git'.length)}`,
                QUERY_STRING: url.search.slice(1),
                CONTENT_TYPE: request.headers['content-type'] ?? '',
                CONTENT_LENGTH: request.headers['content-length'] ?? '',
            },
        });
        const chunks: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        child.stderr.resume();
        request.pipe(child.stdin);
        child.on('error', () => response.writeHead(500).end());
        child.on('close', () => {
            const bytes = Buffer.concat(chunks);
            const split = bytes.indexOf('\r\n\r\n');
            if (split < 0) {
                response.writeHead(500).end();
                return;
            }
            for (const line of bytes.subarray(0, split).toString().split('\r\n')) {
                const separator = line.indexOf(':');
                if (separator < 1) continue;
                const name = line.slice(0, separator);
                const value = line.slice(separator + 1).trim();
                if (name === 'Status') response.statusCode = Number(value.split(' ')[0]);
                else response.setHeader(name, value);
            }
            response.end(bytes.subarray(split + 4));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture-bind-failed');
    const remote = `http://127.0.0.1:${address.port}/fixture.git`;
    const json = async (file: string, value: unknown) => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(value, null, 4)}\n`);
    };
    const revisions: { version: string; payload: string; catalog: string }[] = [];
    async function publishFixture(version: string): Promise<StablePluginRecord> {
        for (const host of ['codex', 'claude'] as const) {
            const payload = path.join(repository, pluginSourcePath(host));
            await json(path.join(payload, pluginManifestPath(host)), {
                name: 'debugging-cdp-targets',
                version,
                description: 'Isolated native CLI fixture',
            });
            await json(path.join(payload, pluginMcpPath(host)), {
                mcpServers: {
                    'cdp-targets': {
                        type: host === 'codex' ? 'streamable-http' : 'http',
                        url: 'http://127.0.0.1:27637/mcp',
                    },
                },
            });
            await writeFile(path.join(payload, 'README.md'), 'Native host management fixture. No executable tools.\n');
        }
        await git(['add', '.']);
        await git(['commit', '-m', `fixture payload ${version}`]);
        const payload = await git(['rev-parse', 'HEAD']);
        for (const host of ['codex', 'claude'] as const) {
            await json(
                path.join(
                    repository,
                    host === 'codex' ? '.agents/plugins/marketplace.json' : '.claude-plugin/marketplace.json',
                ),
                {
                    name: 'debugging-cdp-targets',
                    ...(host === 'claude' ? { owner: { name: 'Fixture' } } : {}),
                    plugins: [
                        {
                            name: 'debugging-cdp-targets',
                            version,
                            source: {
                                source: 'git-subdir',
                                url: remote,
                                path: `./${pluginSourcePath(host)}`,
                                sha: payload,
                            },
                            ...(host === 'codex'
                                ? {
                                      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
                                      category: 'Developer Tools',
                                  }
                                : {}),
                        },
                    ],
                },
            );
        }
        await git(['add', '.']);
        await git(['commit', '-m', `fixture catalog ${version}`]);
        const catalog = await git(['rev-parse', 'HEAD']);
        const record: StablePluginRecord = {
            schemaVersion: 1,
            version,
            minimumAppVersion: '0.1.0',
            source: { url: remote, sha: payload },
        };
        await json(path.join(root, `stable-${version}.json`), record);
        revisions.push({ version, payload, catalog });
        return record;
    }
    const transcript: { host: PluginHost; args: string[]; stdout: string; exitCode: number | null }[] = [];
    const mutationCount = () =>
        transcript.filter(
            (entry) =>
                entry.args.includes('add') ||
                entry.args.includes('install') ||
                entry.args.includes('upgrade') ||
                entry.args.includes('update'),
        ).length;
    const adapters: NativeHostPluginAdapter[] = [];
    for (const host of ['codex', 'claude'] as const) {
        const home = path.join(root, `${host}-home`);
        await mkdir(home);
        const cwd = path.join(home, 'neutral');
        await mkdir(cwd);
        if (host === 'codex')
            await writeFile(
                path.join(home, 'config.toml'),
                '[mcp_servers.unrelated_fixture]\nurl = "http://127.0.0.1:1/preserved-fixture"\n',
            );
        else await json(path.join(home, 'settings.json'), { env: { DCT_FIXTURE: 'preserved-fixture' } });
        adapters.push(
            new NativeHostPluginAdapter(
                {
                    host,
                    executable: host === 'codex' ? codexExecutable : claudeExecutable,
                    configRoot: home,
                    neutralCwd: cwd,
                    pluginRoot: path.join(home, 'separate-plugins'),
                    marketplaceSource: remote,
                    environment: {
                        ...process.env,
                        HOME: home,
                        USERPROFILE: home,
                        CODEX_HOME: home,
                        CLAUDE_CONFIG_DIR: home,
                        CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(home, 'separate-plugins'),
                    },
                },
                {
                    run: async (command) => {
                        const result = await runNativeCommand(command);
                        transcript.push({ host, args: command.args, stdout: result.stdout, exitCode: result.exitCode });
                        return result;
                    },
                },
            ),
        );
    }
    const receiptDirectory = path.join(root, 'app-metadata');
    await mkdir(receiptDirectory);
    let failCodexUrl = false;
    const manager = new HostPluginManager({
        appVersion: '0.1.0',
        adapters,
        receiptStore: new JsonHostPluginReceiptStore(receiptDirectory),
        patchEndpoint: async (...args) => {
            if (failCodexUrl && args[0] === 'codex') {
                failCodexUrl = false;
                throw new Error('plugin-url-write-failed');
            }
            await patchPluginEndpoint(...args);
        },
    });
    try {
        const first = await publishFixture('0.1.11');
        const installed = await manager.synchronize(first, 'http://127.0.0.1:33333/mcp');
        await json(path.join(root, 'first-results.json'), installed);
        assert.deepEqual(
            installed.map((item) => item.state),
            ['disk-synchronized', 'disk-synchronized'],
        );
        const oldRoots = (await Promise.all(adapters.map((adapter) => adapter.inspect()))).map(
            (inventory) => inventory.installations[0]?.root,
        );
        const second = await publishFixture('0.1.12');
        failCodexUrl = true;
        const replaced = await manager.synchronize(second, 'http://127.0.0.1:44444/mcp');
        await json(path.join(root, 'second-partial-results.json'), replaced);
        assert.deepEqual(
            replaced.map((item) => item.state),
            ['partial-failure', 'disk-synchronized'],
        );
        assert.equal(replaced[0]?.reason, 'plugin-url-write-failed');
        const beforeRecovery = mutationCount();
        const recoveredManager = new HostPluginManager({
            appVersion: '0.1.0',
            adapters: adapters.map(
                (adapter) =>
                    new NativeHostPluginAdapter(adapter.selection, {
                        run: async (command) => {
                            const result = await runNativeCommand(command);
                            transcript.push({
                                host: adapter.selection.host,
                                args: command.args,
                                stdout: result.stdout,
                                exitCode: result.exitCode,
                            });
                            return result;
                        },
                    }),
            ),
            receiptStore: new JsonHostPluginReceiptStore(receiptDirectory),
        });
        const updated = await recoveredManager.synchronize(second, 'http://127.0.0.1:44444/mcp');
        assert.equal(mutationCount(), beforeRecovery);
        await json(path.join(root, 'second-results.json'), updated);
        assert.deepEqual(
            updated.map((item) => item.state),
            ['disk-synchronized', 'disk-synchronized'],
        );
        for (const [index, adapter] of adapters.entries()) {
            const inventory = await adapter.inspect();
            const installation = inventory.installations[0];
            assert.equal(installation?.version, '0.1.12');
            assert.ok(installation.root);
            assert.notEqual(installation.root, oldRoots[index]);
            assert.match(
                await readFile(path.join(installation.root, pluginMcpPath(adapter.selection.host)), 'utf8'),
                /44444/,
            );
            const config = await readFile(
                path.join(
                    adapter.selection.configRoot,
                    adapter.selection.host === 'codex' ? 'config.toml' : 'settings.json',
                ),
                'utf8',
            );
            assert.match(config, /preserved-fixture/);
            assert.equal(inventory.marketplace?.source, remote);
        }
        const count = mutationCount();
        assert.deepEqual(
            (await manager.synchronize({ ...second, minimumAppVersion: '9.0.0' }, 'http://127.0.0.1:44444/mcp')).map(
                (item) => item.candidate,
            ),
            ['app-update-required', 'app-update-required'],
        );
        assert.equal(mutationCount(), count);
        const beforeSync = mutationCount();
        const restartedAdapters = adapters.map(
            (adapter) =>
                new NativeHostPluginAdapter(adapter.selection, {
                    run: async (command) => {
                        const result = await runNativeCommand(command);
                        transcript.push({
                            host: adapter.selection.host,
                            args: command.args,
                            stdout: result.stdout,
                            exitCode: result.exitCode,
                        });
                        return result;
                    },
                }),
        );
        const restartedManager = new HostPluginManager({
            appVersion: '0.1.0',
            adapters: restartedAdapters,
            receiptStore: new JsonHostPluginReceiptStore(receiptDirectory),
        });
        const portOnly = await restartedManager.synchronize(null, 'http://127.0.0.1:55555/mcp');
        assert.deepEqual(
            portOnly.map((item) => [item.state, item.candidate]),
            [
                ['disk-synchronized', 'no-candidate'],
                ['disk-synchronized', 'no-candidate'],
            ],
        );
        assert.equal(mutationCount(), beforeSync);
        const staleCandidate = await restartedManager.synchronize(first, 'http://127.0.0.1:56666/mcp');
        assert.deepEqual(
            staleCandidate.map((item) => [item.state, item.candidate, item.version]),
            [
                ['disk-synchronized', 'newer-installed', '0.1.12'],
                ['disk-synchronized', 'newer-installed', '0.1.12'],
            ],
        );
        assert.equal(mutationCount(), beforeSync);
        for (const adapter of restartedAdapters) {
            const installation = (await adapter.inspect()).installations[0];
            assert.ok(installation?.root);
            assert.match(
                await readFile(path.join(installation.root, pluginMcpPath(adapter.selection.host)), 'utf8'),
                /56666/,
            );
        }
        await json(path.join(root, 'recovery-results.json'), { replaced, updated, staleCandidate });
        await restartedManager.synchronize(null, 'http://127.0.0.1:55555/mcp');

        const codex = adapters[0];
        const claude = adapters[1];
        assert.ok(codex && claude);
        const peerManager = new HostPluginManager({
            appVersion: '0.1.0',
            adapters: [
                new NativeHostPluginAdapter({ ...codex.selection, executable: path.join(root, 'missing-cli.exe') }),
                claude,
            ],
        });
        const independent = await peerManager.synchronize(second, 'http://127.0.0.1:55555/mcp');
        assert.deepEqual(
            independent.map((item) => item.state),
            ['failed', 'disk-synchronized'],
        );
        assert.equal(independent[0]?.reason, 'cli-missing');

        const beforeMoved = mutationCount();
        const moved = await manager.synchronize(
            { ...second, source: { ...second.source, sha: 'a'.repeat(40) } },
            'http://127.0.0.1:55555/mcp',
        );
        assert.deepEqual(
            moved.map((item) => item.state),
            ['failed', 'failed'],
        );
        assert.equal(mutationCount(), beforeMoved);

        const codexConfigPath = path.join(codex.selection.configRoot, 'config.toml');
        const codexConfig = await readFile(codexConfigPath, 'utf8');
        assert.match(codexConfig, /enabled = true/);
        await writeFile(codexConfigPath, codexConfig.replace('enabled = true', 'enabled = false'));
        const claudeSettingsPath = path.join(claude.selection.configRoot, 'settings.json');
        const claudeSettings = await readFile(claudeSettingsPath, 'utf8');
        const disabledSettings: unknown = JSON.parse(claudeSettings);
        if (
            !disabledSettings ||
            typeof disabledSettings !== 'object' ||
            !('enabledPlugins' in disabledSettings) ||
            !disabledSettings.enabledPlugins ||
            typeof disabledSettings.enabledPlugins !== 'object'
        )
            throw new Error('fixture-settings-contract');
        Object.assign(disabledSettings.enabledPlugins, { 'debugging-cdp-targets@debugging-cdp-targets': false });
        await json(claudeSettingsPath, disabledSettings);
        const beforeDisabled = mutationCount();
        const disabled = await manager.synchronize(second, 'http://127.0.0.1:55555/mcp');
        assert.deepEqual(
            disabled.map((item) => [item.state, item.reason]),
            [
                ['read-only', 'disabled'],
                ['read-only', 'disabled'],
            ],
        );
        assert.equal(mutationCount(), beforeDisabled);
        assert.match(await readFile(codexConfigPath, 'utf8'), /enabled = false/);
        await writeFile(codexConfigPath, codexConfig);
        await writeFile(claudeSettingsPath, claudeSettings);

        const codexInventory = await codex.inspect();
        assert.ok(codexInventory.marketplace);
        const catalogPath = path.join(codexInventory.marketplace.root, '.agents/plugins/marketplace.json');
        const catalogBytes = await readFile(catalogPath, 'utf8');
        const unsafeCatalog: unknown = JSON.parse(catalogBytes);
        if (
            !unsafeCatalog ||
            typeof unsafeCatalog !== 'object' ||
            !('plugins' in unsafeCatalog) ||
            !Array.isArray(unsafeCatalog.plugins)
        )
            throw new Error('fixture-catalog-contract');
        unsafeCatalog.plugins.push({
            name: 'unrelated-fixture',
            source: { source: 'local', path: './missing' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Developer Tools',
        });
        await json(catalogPath, unsafeCatalog);
        const unsafe = await new HostPluginManager({ appVersion: '0.1.0', adapters: [codex] }).synchronize(
            second,
            'http://127.0.0.1:55555/mcp',
        );
        assert.equal(unsafe[0]?.reason, 'unrelated-marketplace-entries');
        await writeFile(catalogPath, catalogBytes);

        // An actual native project install reuses the user cache; this must block user URL writes.
        const project = await runNativeCommand({
            executable: claudeExecutable,
            args: ['plugin', 'install', 'debugging-cdp-targets@debugging-cdp-targets', '--scope', 'project', '--json'],
            cwd: claude.selection.neutralCwd,
            env: { ...claude.selection.environment },
            windowsHide: true,
            timeoutMs: 60_000,
            maxOutputBytes: 256 * 1024,
        });
        assert.equal(project.exitCode, 0);
        const shared = await new HostPluginManager({ appVersion: '0.1.0', adapters: [claude] }).synchronize(
            second,
            'http://127.0.0.1:55555/mcp',
        );
        assert.equal(shared[0]?.state, 'read-only');
        assert.equal(shared[0]?.reason, 'shared-installation');
        const pinnedHome = path.join(root, 'codex-pinned-home');
        await mkdir(pinnedHome);
        const pinnedCwd = path.join(pinnedHome, 'neutral');
        await mkdir(pinnedCwd);
        const pinnedSelection = {
            ...codex.selection,
            configRoot: pinnedHome,
            neutralCwd: pinnedCwd,
            environment: {
                ...codex.selection.environment,
                CODEX_HOME: pinnedHome,
                HOME: pinnedHome,
                USERPROFILE: pinnedHome,
            },
        };
        const pinnedAdd = await runNativeCommand({
            executable: codexExecutable,
            args: ['plugin', 'marketplace', 'add', remote, '--ref', 'main', '--json'],
            cwd: pinnedCwd,
            env: { ...pinnedSelection.environment },
            windowsHide: true,
            timeoutMs: 60_000,
            maxOutputBytes: 256 * 1024,
        });
        assert.equal(pinnedAdd.exitCode, 0);
        const pinned = await new HostPluginManager({
            appVersion: '0.1.0',
            adapters: [new NativeHostPluginAdapter(pinnedSelection)],
        }).synchronize(second, 'http://127.0.0.1:55555/mcp');
        assert.equal(pinned[0]?.state, 'read-only');
        assert.equal(pinned[0]?.reason, 'pinned-or-ambiguous');
        assert.match(await readFile(path.join(pinnedHome, 'config.toml'), 'utf8'), /ref = "main"/);
        const codexRun = codex.io.run;
        codex.io.run = async (command) => {
            const result = await codexRun(command);
            if (command.args.includes('upgrade') && result.exitCode === 0) {
                const changed: unknown = JSON.parse(catalogBytes);
                if (
                    !changed ||
                    typeof changed !== 'object' ||
                    !('plugins' in changed) ||
                    !Array.isArray(changed.plugins)
                )
                    throw new Error('fixture-catalog-contract');
                const ownEntry: unknown = changed.plugins[0];
                if (
                    !ownEntry ||
                    typeof ownEntry !== 'object' ||
                    !('source' in ownEntry) ||
                    !ownEntry.source ||
                    typeof ownEntry.source !== 'object'
                )
                    throw new Error('fixture-source-contract');
                Object.assign(ownEntry.source, { sha: 'b'.repeat(40) });
                await json(catalogPath, changed);
            }
            return result;
        };
        let movedAfterRefresh: HostPluginSummary[] = [];
        try {
            // This coordinator has no synchronized-copy checkpoint, but the concrete adapter
            // retains its actual safe native add receipt. Exercise its permitted native refresh.
            const refreshManager = new HostPluginManager({ appVersion: '0.1.0', adapters: [codex] });
            movedAfterRefresh = await refreshManager.synchronize(second, 'http://127.0.0.1:55555/mcp', 'codex');
            assert.equal(movedAfterRefresh[0]?.state, 'partial-failure');
            assert.equal(movedAfterRefresh[0]?.reason, 'marketplace-source-moved');
        } finally {
            codex.io.run = codexRun;
            await writeFile(catalogPath, catalogBytes);
        }
        await json(path.join(root, 'boundary-results.json'), {
            portOnly,
            independent,
            moved,
            disabled,
            unsafe,
            shared,
            pinned,
            movedAfterRefresh,
        });
        await json(path.join(root, 'acceptance.json'), {
            ok: true,
            evidence: 'real native CLI; fixture payloads only; no Task4 App or tool invocation',
            revisions,
            activation: 'reload-pending',
            transcriptSha256: createHash('sha256').update(JSON.stringify(transcript)).digest('hex'),
        });
        return { root, revisions };
    } finally {
        await json(path.join(root, 'native-transcript.private.json'), transcript);
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const codex = process.argv[2];
    const claude = process.argv[3];
    if (!codex || !claude) throw new Error('Pass explicit Codex and Claude native executable paths.');
    const evidence = await nativeHostManagementSmoke(codex, claude);
    console.log(
        JSON.stringify({
            ok: true,
            evidenceRoot: evidence.root,
            evidence: 'native CLI fixture acceptance; activation remains unverified',
        }),
    );
}
