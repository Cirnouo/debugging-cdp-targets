import assert from 'node:assert/strict';
import test from 'node:test';
import { readGitPluginSource } from '../src/adapters/git-plugin-source.ts';

const record = {
    schemaVersion: 1 as const,
    version: '0.2.0',
    minimumAppVersion: '0.1.0',
    source: { url: 'https://example.invalid/repo.git', sha: 'a'.repeat(40) },
};

test('Git source verifies catalog before fetching payload and never checks out untrusted files', async () => {
    const calls: string[][] = [];
    await assert.rejects(
        readGitPluginSource(record, 'codex', {
            run: async (args) => {
                calls.push(args);
                return Buffer.from(
                    args.includes('show') ? JSON.stringify({ name: 'debugging-cdp-targets', plugins: [] }) : '',
                );
            },
        }),
        /marketplace/,
    );
    assert.equal(
        calls.some((args) => args.includes('checkout')),
        false,
    );
    assert.equal(calls.filter((args) => args.includes('fetch')).length, 1);
});

test('Git tree rejects symlink/gitlink/path escape before blob reads', async () => {
    for (const tree of [
        `120000 blob ${'b'.repeat(40)}\tplugins/codex/debugging-cdp-targets/linked\0`,
        `160000 commit ${'b'.repeat(40)}\tplugins/codex/debugging-cdp-targets/submodule\0`,
        `100644 blob ${'b'.repeat(40)}\tplugins/codex/debugging-cdp-targets/../escape\0`,
        `100644 blob ${'b'.repeat(40)}\tplugins/codex/debugging-cdp-targets/.in_use/marker\0`,
    ]) {
        await assert.rejects(
            readGitPluginSource(record, 'codex', {
                run: async (args) => {
                    if (args.includes('show'))
                        return Buffer.from(
                            JSON.stringify({
                                name: 'debugging-cdp-targets',
                                plugins: [
                                    {
                                        name: 'debugging-cdp-targets',
                                        source: {
                                            source: 'git-subdir',
                                            ...record.source,
                                            path: args.some((arg) => arg.includes('.claude-plugin'))
                                                ? 'plugins/claude-code/debugging-cdp-targets'
                                                : 'plugins/codex/debugging-cdp-targets',
                                        },
                                    },
                                ],
                            }),
                        );
                    if (args.includes('ls-tree')) return Buffer.from(tree);
                    return Buffer.from('');
                },
            }),
            /source|payload/,
        );
    }
});

test('both remote catalogs must agree with the one record before any payload acquisition', async () => {
    const calls: string[][] = [];
    await assert.rejects(
        readGitPluginSource(record, 'codex', {
            run: async (args) => {
                calls.push(args);
                if (args.includes('show'))
                    return Buffer.from(
                        JSON.stringify({
                            name: 'debugging-cdp-targets',
                            plugins: [
                                {
                                    name: 'debugging-cdp-targets',
                                    source: {
                                        source: 'git-subdir',
                                        ...record.source,
                                        sha: args.some((arg) => arg.includes('.claude-plugin'))
                                            ? 'b'.repeat(40)
                                            : record.source.sha,
                                        path: args.some((arg) => arg.includes('.claude-plugin'))
                                            ? 'plugins/claude-code/debugging-cdp-targets'
                                            : 'plugins/codex/debugging-cdp-targets',
                                    },
                                },
                            ],
                        }),
                    );
                return Buffer.from('');
            },
        }),
        /marketplace-source-moved/,
    );
    assert.equal(calls.filter((args) => args.includes('fetch')).length, 1);
});

test('Git source rejects case aliases and file/directory conflicts at every path prefix', async () => {
    for (const aliases of [
        ['Assets/upper.txt', 'assets/lower.txt'],
        ['nested/Assets/upper.txt', 'nested/assets/lower.txt'],
        ['assets', 'Assets/lower.txt'],
        ['assets/lower.txt', 'assets'],
    ]) {
        const files = new Map([
            ['.codex-plugin/plugin.json', Buffer.from('{"name":"debugging-cdp-targets","version":"0.2.0"}')],
            [
                'mcp.json',
                Buffer.from(
                    '{"mcpServers":{"cdp-targets":{"type":"streamable-http","url":"http://127.0.0.1:27637/mcp"}}}',
                ),
            ],
            ...aliases.map((name): [string, Buffer] => [name, Buffer.from('fixture')]),
        ]);
        const entries = [...files].map(([name, bytes], index) => ({
            name,
            bytes,
            oid: String(index + 1).padStart(40, '0'),
        }));
        await assert.rejects(
            readGitPluginSource(record, 'codex', {
                run: async (args) => {
                    if (args.includes('show'))
                        return Buffer.from(
                            JSON.stringify({
                                name: 'debugging-cdp-targets',
                                plugins: [
                                    {
                                        name: 'debugging-cdp-targets',
                                        source: {
                                            source: 'git-subdir',
                                            ...record.source,
                                            path: args.some((arg) => arg.includes('.claude-plugin'))
                                                ? 'plugins/claude-code/debugging-cdp-targets'
                                                : 'plugins/codex/debugging-cdp-targets',
                                        },
                                    },
                                ],
                            }),
                        );
                    if (args.includes('ls-tree'))
                        return Buffer.from(
                            entries
                                .map(
                                    (entry) =>
                                        `100644 blob ${entry.oid}\tplugins/codex/debugging-cdp-targets/${entry.name}\0`,
                                )
                                .join(''),
                        );
                    if (args.includes('cat-file')) {
                        const entry = entries.find((item) => item.oid === args.at(-1));
                        assert.ok(entry);
                        return entry.bytes;
                    }
                    return Buffer.from('');
                },
            }),
            /invalid-git-source-path/,
        );
    }
});
