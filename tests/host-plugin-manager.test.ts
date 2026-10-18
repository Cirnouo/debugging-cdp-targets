import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    JsonHostPluginReceiptStore,
    parseManagedPluginReceipt,
    restoreReceiptFiles,
} from '../src/adapters/managed-plugin-receipts.ts';
import type { HostInventory } from '../src/adapters/native-host-plugins.ts';
import {
    overlayPluginEndpoint,
    patchPluginEndpoint,
    pluginMcpEndpointEvidence,
    readPluginTree,
} from '../src/adapters/verified-plugin-files.ts';
import { HostPluginManager } from '../src/application/host-plugin-manager.ts';
import type { PluginHost } from '../src/domains/host-management.ts';

const fixtureRoots: string[] = [];
const retainedFixtureRoots = new Set<string>();
test.afterEach(async () => {
    await Promise.all(
        fixtureRoots
            .splice(0)
            .map((root) =>
                retainedFixtureRoots.has(root)
                    ? undefined
                    : rm(root, { recursive: true, maxRetries: 5, retryDelay: 100 }),
            ),
    );
});

const stable = {
    schemaVersion: 1,
    version: '0.2.0',
    minimumAppVersion: '0.1.0',
    source: { url: 'https://example.invalid/plugin.git', sha: 'a'.repeat(40) },
};
async function harness(
    host: PluginHost,
    initial: HostInventory,
    options: { failRefresh?: boolean; moveAfterRefresh?: boolean; failPatch?: boolean } = {},
) {
    const effects: string[] = [];
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-manager-fixture-')));
    fixtureRoots.push(root);
    const manifest = host === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json';
    const mcp = host === 'codex' ? 'mcp.json' : '.mcp.json';
    const files = new Map([
        [manifest, Buffer.from('{"name":"debugging-cdp-targets","version":"0.2.0"}')],
        [
            mcp,
            Buffer.from(
                JSON.stringify({
                    mcpServers: {
                        'cdp-targets': {
                            type: host === 'codex' ? 'streamable-http' : 'http',
                            url: 'http://127.0.0.1:27637/mcp',
                        },
                    },
                }),
            ),
        ],
    ]);
    await mkdir(path.dirname(path.join(root, manifest)));
    for (const [name, bytes] of files) await writeFile(path.join(root, name), bytes);
    let installed = initial.installations.length > 0;
    let refreshed = false;
    const source = {
        files,
        catalog: {
            name: 'debugging-cdp-targets',
            plugins: [
                {
                    name: 'debugging-cdp-targets',
                    source: {
                        source: 'git-subdir',
                        ...stable.source,
                        path: `plugins/${host === 'codex' ? 'codex' : 'claude-code'}/debugging-cdp-targets`,
                    },
                },
            ],
        },
    };
    const adapter = {
        selection: { host, marketplaceSource: stable.source.url },
        inspect: async () => {
            effects.push('inspect');
            if (!refreshed) return initial;
            return {
                ...initial,
                marketplace: { root: '/catalog', source: stable.source.url },
                catalog: options.moveAfterRefresh ? { ...source.catalog, plugins: [] } : source.catalog,
                installations: installed ? [{ version: '0.2.0', enabled: true, scope: 'user', root }] : [],
            };
        },
        refreshMarketplace: async () => {
            effects.push('refresh');
            if (options.failRefresh) throw new Error('private-path/token');
            refreshed = true;
        },
        installOrUpdate: async () => {
            effects.push('install');
            installed = true;
        },
    };
    const manager = new HostPluginManager({
        appVersion: '0.1.0',
        adapters: [adapter],
        readSource: async () => {
            effects.push('source');
            return source;
        },
        patchEndpoint: async () => {
            effects.push('patch');
            if (options.failPatch) throw new Error('private-path/token');
        },
    });
    return { manager, effects, adapter, source };
}

test('no candidate, corrupt candidate and incompatible latest have no host effects', async () => {
    const f = await harness('codex', { host: 'codex', cliVersion: '0.163.0', installations: [] });
    assert.equal((await f.manager.synchronize(null, 'http://127.0.0.1:3333/mcp'))[0]?.state, 'no-candidate');
    assert.deepEqual(f.effects, []);
    assert.equal(
        (await f.manager.synchronize({ ...stable, minimumAppVersion: '9.0.0' }, 'http://127.0.0.1:3333/mcp'))[0]?.state,
        'app-update-required',
    );
    assert.deepEqual(f.effects, []);
    assert.equal((await f.manager.synchronize({}, 'http://127.0.0.1:3333/mcp'))[0]?.state, 'invalid-record');
    assert.deepEqual(f.effects, []);
});

test('safe install refreshes selected catalog then resolves actual root and leaves activation pending', async () => {
    const f = await harness('claude', { host: 'claude', cliVersion: '2.1.302', installations: [] });
    const result = (await f.manager.synchronize(stable, 'http://127.0.0.1:3333/mcp'))[0];
    assert.equal(result?.state, 'disk-synchronized');
    assert.equal(result?.activation, 'reload-pending');
    assert.deepEqual(f.effects, ['inspect', 'source', 'refresh', 'inspect', 'install', 'inspect', 'patch', 'inspect']);
    assert.doesNotMatch(JSON.stringify(result), /installed|catalog|token/);
    f.effects.length = 0;
    const sync = (await f.manager.synchronize(null, 'http://127.0.0.1:4444/mcp'))[0];
    assert.equal(sync?.state, 'disk-synchronized');
    assert.equal(sync?.candidate, 'no-candidate');
    assert.equal(sync?.activation, 'reload-pending');
    assert.deepEqual(f.effects, ['inspect', 'patch', 'inspect']);
});

test('newer, disabled, pinned, unresolved and unrelated inventory cannot trigger mutation', async () => {
    for (const reason of ['disabled', 'pinned-or-ambiguous', 'existing-unresolved', 'shared-installation']) {
        const f = await harness('codex', {
            host: 'codex',
            cliVersion: '0.163.0',
            installations: [{ version: '0.1.0', enabled: true, scope: 'unknown', readOnlyReason: reason }],
        });
        assert.equal((await f.manager.synchronize(stable, 'http://127.0.0.1:3333/mcp'))[0]?.state, 'read-only');
        assert.deepEqual(f.effects, ['inspect']);
    }
    const f = await harness('codex', {
        host: 'codex',
        cliVersion: '0.163.0',
        readOnlyReason: 'unrelated-marketplace-entries',
        installations: [],
    });
    assert.equal((await f.manager.synchronize(stable, 'http://127.0.0.1:3333/mcp'))[0]?.state, 'read-only');
    const g = await harness('claude', {
        host: 'claude',
        cliVersion: '2.1.302',
        installations: [{ version: '0.3.0', enabled: true, scope: 'user', root: '/own' }],
    });
    const unmanaged = (await g.manager.synchronize(stable, 'http://127.0.0.1:3333/mcp'))[0];
    assert.equal(unmanaged?.state, 'read-only');
    assert.equal(unmanaged?.reason, 'newer-installed-unmanaged');
    assert.deepEqual(g.effects, ['inspect']);
});

test('source movement and partial host failures stop without replay or peer rollback', async () => {
    const moved = await harness(
        'codex',
        { host: 'codex', cliVersion: '0.163.0', installations: [] },
        { moveAfterRefresh: true },
    );
    assert.equal((await moved.manager.synchronize(stable, 'http://127.0.0.1:3333/mcp'))[0]?.state, 'partial-failure');
    assert.equal(moved.effects.includes('install'), false);
    const a = await harness(
        'codex',
        { host: 'codex', cliVersion: '0.163.0', installations: [] },
        { failRefresh: true },
    );
    const b = await harness('claude', { host: 'claude', cliVersion: '2.1.302', installations: [] });
    const manager = new HostPluginManager({
        appVersion: '0.1.0',
        adapters: [a.adapter, b.adapter],
        readSource: async (_record, host) => (host === 'codex' ? a.source : b.source),
        patchEndpoint: async () => {},
    });
    const results = await manager.synchronize(stable, 'http://127.0.0.1:3333/mcp');
    assert.deepEqual(
        results.map((item) => item.state),
        ['partial-failure', 'disk-synchronized'],
    );
    assert.doesNotMatch(JSON.stringify(results), /private-path|token/);
    assert.equal(a.effects.filter((effect) => effect === 'refresh').length, 1);
    a.effects.length = 0;
    const retried = await manager.synchronize(stable, 'http://127.0.0.1:3333/mcp', 'claude');
    assert.equal(retried.length, 1);
    assert.equal(retried[0]?.host, 'claude');
    assert.equal(retried[0]?.state, 'disk-synchronized');
    assert.deepEqual(a.effects, []);
});

test('a retained in-process receipt cannot authorize refresh over changed installed bytes', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-manager-receipt-')));
    const files = new Map([
        ['.claude-plugin/plugin.json', Buffer.from('{"name":"debugging-cdp-targets","version":"0.2.0"}')],
        ['.mcp.json', Buffer.from('{"mcpServers":{"cdp-targets":{"type":"http","url":"http://127.0.0.1:27637/mcp"}}}')],
        ['README.md', Buffer.from('immutable fixture')],
    ]);
    const catalog = {
        name: 'debugging-cdp-targets',
        plugins: [
            {
                name: 'debugging-cdp-targets',
                source: { source: 'git-subdir', ...stable.source, path: 'plugins/claude-code/debugging-cdp-targets' },
            },
        ],
    };
    let installed = false;
    let refreshed = false;
    let mutations = 0;
    const adapter = {
        selection: { host: 'claude' as const, marketplaceSource: stable.source.url },
        inspect: async (): Promise<HostInventory> => ({
            host: 'claude',
            cliVersion: '2.1.302',
            installations: installed ? [{ version: stable.version, enabled: true, scope: 'user', root }] : [],
            ...(refreshed ? { marketplace: { root, source: stable.source.url }, catalog } : {}),
        }),
        refreshMarketplace: async () => {
            mutations++;
            refreshed = true;
        },
        installOrUpdate: async () => {
            mutations++;
            installed = true;
        },
    };
    try {
        await mkdir(path.join(root, '.claude-plugin'));
        for (const [name, bytes] of files) await writeFile(path.join(root, name), bytes);
        const manager = new HostPluginManager({
            appVersion: '0.1.0',
            adapters: [adapter],
            readSource: async () => ({ files, catalog }),
        });
        assert.equal((await manager.synchronize(stable, 'http://127.0.0.1:3333/mcp'))[0]?.state, 'disk-synchronized');
        await writeFile(path.join(root, 'README.md'), 'external change');
        const before = mutations;
        const result = (await manager.synchronize(stable, 'http://127.0.0.1:4444/mcp'))[0];
        assert.equal(result?.state, 'read-only');
        assert.equal(result?.reason, 'managed-receipt-payload-changed');
        assert.equal(mutations, before);
    } finally {
        await rm(root, { recursive: true });
    }
});

async function replacementFixture() {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-manager-replacement-')));
    fixtureRoots.push(root);
    const metadata = path.join(root, 'metadata');
    await mkdir(metadata);
    const record = (version: string) => ({
        ...stable,
        version,
        source: { ...stable.source, sha: (version === '0.2.0' ? 'a' : 'b').repeat(40) },
    });
    const payloads = new Map<string, { root: string; files: Map<string, Buffer> }>();
    for (const version of ['0.2.0', '0.3.0']) {
        const payloadRoot = path.join(root, version);
        await mkdir(path.join(payloadRoot, '.claude-plugin'), { recursive: true });
        const files = new Map([
            ['.claude-plugin/plugin.json', Buffer.from(JSON.stringify({ name: 'debugging-cdp-targets', version }))],
            [
                '.mcp.json',
                Buffer.from('{"mcpServers":{"cdp-targets":{"type":"http","url":"http://127.0.0.1:27637/mcp"}}}'),
            ],
            ['README.md', Buffer.from(`immutable ${version}`)],
        ]);
        for (const [name, bytes] of files) await writeFile(path.join(payloadRoot, name), bytes);
        payloads.set(version, { root: payloadRoot, files });
    }
    const catalog = (version: string) => ({
        name: 'debugging-cdp-targets',
        plugins: [
            {
                name: 'debugging-cdp-targets',
                source: {
                    source: 'git-subdir',
                    ...record(version).source,
                    path: 'plugins/claude-code/debugging-cdp-targets',
                },
            },
        ],
    });
    const configuration = JSON.stringify({
        marketplace: { source: 'git', url: stable.source.url, ref: null, sparse: [], autoUpdate: null },
        enabled: true,
    });
    let current: string | undefined;
    let offered = '0.2.0';
    let refreshed = false;
    let failure: 'none' | 'patch' | 'readback' | 'store-before' | 'store-after' | 'store-write' = 'none';
    const receiptFile = path.join(metadata, 'claude-managed-plugin.json');
    const linkedReceipt = path.join(metadata, 'linked-receipt');
    const writes: { version: string; phase: string; error?: unknown }[] = [];
    const injections: { version: string; phase: string }[] = [];
    const effects = { mutations: 0, patches: 0, sources: 0 };
    const makeManager = () => {
        const store = new JsonHostPluginReceiptStore(metadata);
        return new HostPluginManager({
            appVersion: '0.1.0',
            adapters: [
                {
                    selection: { host: 'claude', configRoot: root, marketplaceSource: stable.source.url },
                    inspect: async (): Promise<HostInventory> => ({
                        host: 'claude',
                        cliVersion: '2.1.302',
                        installations: current
                            ? [{ version: current, enabled: true, scope: 'user', root: path.join(root, current) }]
                            : [],
                        ...(refreshed
                            ? { marketplace: { root, source: stable.source.url }, catalog: catalog(offered) }
                            : {}),
                    }),
                    refreshMarketplace: async () => {
                        effects.mutations++;
                        refreshed = true;
                    },
                    installOrUpdate: async (_installed, version) => {
                        effects.mutations++;
                        if (current && current !== version) {
                            const previous = payloads.get(current);
                            assert.ok(previous);
                            await rm(previous.root, { recursive: true });
                        }
                        current = version;
                    },
                    captureManagedReceipt: async (installedRoot, version) => ({
                        root: installedRoot,
                        version,
                        configuration,
                    }),
                    restoreManagedReceipt: async (receipt) => {
                        assert.equal(receipt.version, current);
                        assert.equal(receipt.root, payloads.get(receipt.version)?.root);
                        assert.equal(receipt.configuration, configuration);
                    },
                },
            ],
            readSource: async (selected) => {
                effects.sources++;
                offered = selected.version;
                const payload = payloads.get(selected.version);
                assert.ok(payload);
                return { files: payload.files, catalog: catalog(selected.version) };
            },
            patchEndpoint: async (...args) => {
                effects.patches++;
                if (failure === 'patch') {
                    injections.push({ version: args[2], phase: failure });
                    throw new Error('plugin-url-write-failed');
                }
                await patchPluginEndpoint(...args);
                if (failure === 'readback') {
                    injections.push({ version: args[2], phase: failure });
                    throw new Error('plugin-url-readback-failed');
                }
            },
            receiptStore: {
                read: (host) => store.read(host),
                write: async (host, receipt) => {
                    const version = receipt.record.version;
                    if (failure === 'store-before') {
                        injections.push({ version, phase: failure });
                        throw new Error('managed-receipt-write-failed');
                    }
                    if (failure === 'store-write') await link(receiptFile, linkedReceipt);
                    writes.push({ version, phase: 'started' });
                    try {
                        await store.write(host, receipt);
                        writes.push({ version, phase: 'completed' });
                        const readback = parseManagedPluginReceipt(
                            await new JsonHostPluginReceiptStore(metadata).read(host),
                        );
                        assert.deepEqual(readback, receipt, 'independent receipt readback must equal the actual write');
                        writes.push({ version, phase: 'read-back' });
                    } catch (error) {
                        writes.push({ version, phase: 'rejected', error });
                        throw error;
                    }
                    if (failure === 'store-after') {
                        injections.push({ version, phase: failure });
                        throw new Error('managed-receipt-write-failed');
                    }
                },
            },
        });
    };
    return {
        makeManager,
        effects,
        record,
        payloads,
        writes,
        injections,
        receiptFile,
        linkedReceipt,
        native: () => ({ root: path.join(root, current ?? ''), version: current, configuration }),
        readReceipt: async () =>
            parseManagedPluginReceipt(await new JsonHostPluginReceiptStore(metadata).read('claude')),
        assertWritten: (version: string) => {
            assert.deepEqual(
                writes.filter((entry) => entry.version === version).map((entry) => entry.phase),
                ['started', 'completed', 'read-back'],
                'actual receipt write and independent readback must complete before recovery',
            );
        },
        assertPayload: async (version: string, endpoint: string) => {
            const payload = payloads.get(version);
            assert.ok(payload);
            assert.equal(await realpath(payload.root), payload.root);
            const actual = await readPluginTree(payload.root, 'claude');
            const expected = new Map(payload.files);
            const original = expected.get('.mcp.json');
            assert.ok(original);
            expected.set('.mcp.json', overlayPluginEndpoint(original, 'claude', endpoint));
            assert.deepEqual(actual, expected, 'installed bytes may differ only by the expected own URL');
            const mcp = actual.get('.mcp.json');
            assert.ok(mcp);
            assert.equal(pluginMcpEndpointEvidence(mcp, 'claude').endpoint, endpoint);
        },
        retainFailure: async (error: unknown) => {
            retainedFixtureRoots.add(root);
            const paths = [receiptFile, linkedReceipt];
            for (const payload of payloads.values())
                for (const name of payload.files.keys()) paths.push(path.join(payload.root, name));
            const files = await Promise.all(
                paths.map(async (file) => {
                    try {
                        const stat = await lstat(file, { bigint: true });
                        assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024n * 1024n);
                        const bytes = await readFile(file);
                        return {
                            file,
                            stat,
                            bytes: bytes.toString('base64'),
                            sha256: createHash('sha256').update(bytes).digest('hex'),
                        };
                    } catch (captureError) {
                        return { file, captureError };
                    }
                }),
            );
            const evidence = {
                root,
                canonical: await realpath(root),
                current,
                offered,
                refreshed,
                failure,
                configuration,
                writes,
                injections,
                effects,
                error,
                files,
            };
            const file = path.join(root, 'failure-evidence.json');
            await writeFile(
                file,
                `${JSON.stringify(evidence, (_key, value) => (value instanceof Error ? { ...value, name: value.name, message: value.message, stack: value.stack, cause: value.cause } : typeof value === 'bigint' ? value.toString() : value), 4)}\n`,
            );
            console.error(`DCT_REPLACEMENT_FAILURE=${file}`);
        },
        fail: (value: typeof failure) => {
            failure = value;
        },
    };
}

test('verified native replacement can retry URL and receipt failures without replaying native updates', async () => {
    for (const failure of ['patch', 'readback', 'store-before', 'store-after'] as const) {
        const f = await replacementFixture();
        const manager = f.makeManager();
        assert.equal(
            (await manager.synchronize(f.record('0.2.0'), 'http://127.0.0.1:3333/mcp'))[0]?.state,
            'disk-synchronized',
        );
        f.fail(failure);
        const failed = (await manager.synchronize(f.record('0.3.0'), 'http://127.0.0.1:4444/mcp'))[0];
        assert.equal(failed?.state, 'partial-failure');
        f.fail('none');
        const mutations = f.effects.mutations;
        if (failure === 'store-before') {
            const lostProof = (await f.makeManager().synchronize(null, 'http://127.0.0.1:5555/mcp'))[0];
            assert.equal(lostProof?.state, 'read-only');
            assert.equal(lostProof?.reason, 'managed-receipt-payload-changed');
            assert.equal(f.effects.mutations, mutations);
        }
        const resumed = (await manager.synchronize(f.record('0.3.0'), 'http://127.0.0.1:5555/mcp'))[0];
        assert.equal(resumed?.state, 'disk-synchronized', `${failure}: ${JSON.stringify(resumed)}`);
        assert.equal(resumed?.activation, 'reload-pending');
        assert.equal(f.effects.mutations, mutations);
        const newRoot = f.payloads.get('0.3.0')?.root;
        assert.ok(newRoot);
        assert.match(await readFile(path.join(newRoot, '.mcp.json'), 'utf8'), /5555/);
    }
});

test('persisted verified replacement survives a new manager after late URL or store readback failure', async (t) => {
    for (const failure of ['patch', 'readback', 'store-after'] as const) {
        const f = await replacementFixture();
        try {
            const assertPersisted = async (version: string, endpoint: string) => {
                const receipt = await f.readReceipt();
                const payload = f.payloads.get(version);
                assert.ok(payload);
                assert.equal(receipt.record.version, version);
                assert.deepEqual(receipt.record, f.record(version));
                assert.deepEqual(receipt.native, f.native());
                assert.equal(receipt.native.root, payload.root);
                assert.deepEqual(await restoreReceiptFiles(receipt), payload.files);
                assert.deepEqual(
                    receipt.files,
                    [...payload.files]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, bytes]) => ({
                            path: name,
                            size: bytes.length,
                            sha256: createHash('sha256').update(bytes).digest('hex'),
                        })),
                );
                await f.assertPayload(version, endpoint);
            };
            const manager = f.makeManager();
            const initial = (await manager.synchronize(f.record('0.2.0'), 'http://127.0.0.1:3333/mcp'))[0];
            assert.equal(initial?.state, 'disk-synchronized', JSON.stringify(initial));
            f.assertWritten('0.2.0');
            await assertPersisted('0.2.0', 'http://127.0.0.1:3333/mcp');
            f.fail(failure);
            const failed = (await manager.synchronize(f.record('0.3.0'), 'http://127.0.0.1:4444/mcp'))[0];
            assert.equal(failed?.state, 'partial-failure', JSON.stringify(failed));
            assert.deepEqual(
                f.injections,
                [{ version: '0.3.0', phase: failure }],
                'the intended injection must be reached',
            );
            f.assertWritten('0.3.0');
            await assertPersisted(
                '0.3.0',
                failure === 'readback' ? 'http://127.0.0.1:4444/mcp' : 'http://127.0.0.1:27637/mcp',
            );
            f.fail('none');
            const mutations = f.effects.mutations;
            const resumed = (await f.makeManager().synchronize(null, 'http://127.0.0.1:5555/mcp'))[0];
            assert.equal(resumed?.state, 'disk-synchronized', `${failure}: ${JSON.stringify(resumed)}`);
            assert.equal(resumed?.version, '0.3.0');
            assert.equal(resumed?.activation, 'reload-pending');
            assert.equal(f.effects.mutations, mutations);
            await assertPersisted('0.3.0', 'http://127.0.0.1:5555/mcp');
            t.diagnostic(`${failure}: actual receipt write/readback, injection and fresh-manager recovery confirmed`);
        } catch (error) {
            try {
                await f.retainFailure(error);
            } catch {
                // Capture is best effort; preserve the original failure below.
            }
            throw error;
        }
    }
    for (const failure of ['store-before', 'store-write'] as const) {
        const f = await replacementFixture();
        try {
            const manager = f.makeManager();
            const initial = (await manager.synchronize(f.record('0.2.0'), 'http://127.0.0.1:3333/mcp'))[0];
            assert.equal(initial?.state, 'disk-synchronized', JSON.stringify(initial));
            f.assertWritten('0.2.0');
            const previous = await readFile(f.receiptFile);
            f.fail(failure);
            const failed = (await manager.synchronize(f.record('0.3.0'), 'http://127.0.0.1:4444/mcp'))[0];
            assert.equal(failed?.state, 'partial-failure');
            assert.equal(failed?.reason, 'managed-receipt-write-failed');
            assert.throws(() => f.assertWritten('0.3.0'), /actual receipt write and independent readback/);
            assert.equal(
                f.injections.some((entry) => entry.phase === 'store-after'),
                false,
            );
            assert.deepEqual(await readFile(f.receiptFile), previous);
            if (failure === 'store-write') {
                assert.equal((await lstat(f.receiptFile)).nlink, 2);
                assert.deepEqual(
                    f.writes.filter((entry) => entry.version === '0.3.0').map((entry) => entry.phase),
                    ['started', 'rejected'],
                );
                const rejected = f.writes.find((entry) => entry.version === '0.3.0' && entry.phase === 'rejected');
                assert.ok(rejected?.error instanceof Error);
                assert.equal(rejected.error.message, 'managed-receipt-write-failed');
                await rm(f.linkedReceipt);
            } else {
                assert.deepEqual(f.injections, [{ version: '0.3.0', phase: 'store-before' }]);
                assert.equal(
                    f.writes.some((entry) => entry.version === '0.3.0'),
                    false,
                );
            }
            assert.equal((await f.readReceipt()).record.version, '0.2.0');
            assert.equal(f.native().version, '0.3.0');
            await f.assertPayload('0.3.0', 'http://127.0.0.1:27637/mcp');
            f.fail('none');
            const mutations = f.effects.mutations;
            const resumed = (await f.makeManager().synchronize(null, 'http://127.0.0.1:5555/mcp'))[0];
            assert.equal(resumed?.state, 'read-only');
            assert.equal(resumed?.reason, 'managed-receipt-payload-changed');
            assert.equal(f.effects.mutations, mutations);
            t.diagnostic(
                `${failure}: incomplete receipt write refused by completion assertion; stale receipt stays read-only`,
            );
        } catch (error) {
            try {
                await f.retainFailure(error);
            } catch {
                // Capture is best effort; preserve the original failure below.
            }
            throw error;
        }
    }
});

test('a stale compatible candidate synchronizes the verified newer copy without source or native effects', async () => {
    const f = await replacementFixture();
    const manager = f.makeManager();
    await manager.synchronize(f.record('0.3.0'), 'http://127.0.0.1:3333/mcp');
    const before = { ...f.effects };
    const result = (await manager.synchronize(f.record('0.2.0'), 'http://127.0.0.1:5555/mcp'))[0];
    assert.equal(result?.state, 'disk-synchronized');
    assert.equal(result?.candidate, 'newer-installed');
    assert.equal(result?.version, '0.3.0');
    assert.equal(result?.activation, 'reload-pending');
    assert.equal(f.effects.mutations, before.mutations);
    assert.equal(f.effects.sources, before.sources);
    const current = f.payloads.get('0.3.0');
    assert.ok(current);
    assert.match(await readFile(path.join(current.root, '.mcp.json'), 'utf8'), /5555/);
});
