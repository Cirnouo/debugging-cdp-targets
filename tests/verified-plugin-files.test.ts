import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { patchPluginEndpoint, readPluginTree, verifyPluginFiles } from '../src/adapters/verified-plugin-files.ts';
import type { PluginHost } from '../src/domains/host-management.ts';

async function fixture(host: PluginHost) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-payload-'));
    const manifest = host === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json';
    const mcp = host === 'codex' ? 'mcp.json' : '.mcp.json';
    const files = new Map([
        [manifest, Buffer.from(JSON.stringify({ name: 'debugging-cdp-targets', version: '0.2.0' }))],
        [
            mcp,
            Buffer.from(
                JSON.stringify({
                    mcpServers: {
                        'cdp-targets': {
                            type: host === 'codex' ? 'streamable-http' : 'http',
                            url: 'http://127.0.0.1:27637/mcp',
                            headers: { 'X-Fixture': 'private-header' },
                        },
                        unrelated: { type: 'http', url: 'https://example.invalid' },
                    },
                    extra: { intact: true },
                }),
            ),
        ],
        ['README.md', Buffer.from('fixture\n')],
    ]);
    for (const [name, bytes] of files) {
        await mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await writeFile(path.join(root, name), bytes);
    }
    return { root, files, mcp };
}

for (const host of ['codex', 'claude'] as const) {
    test(`${host} verifies full source bytes, overlays only own URL, and re-reads current overlay`, async () => {
        const f = await fixture(host);
        try {
            await patchPluginEndpoint(host, f.root, '0.2.0', f.files, 'http://127.0.0.1:3333/mcp');
            assert.equal(
                await readFile(path.join(f.root, f.mcp), 'utf8'),
                f.files.get(f.mcp)?.toString('utf8').replace('27637/mcp', '3333/mcp'),
            );
            const after: unknown = JSON.parse(await readFile(path.join(f.root, f.mcp), 'utf8'));
            assert.match(JSON.stringify(after), /private-header/);
            assert.match(JSON.stringify(after), /example.invalid/);
            assert.match(JSON.stringify(after), /3333/);
            await patchPluginEndpoint(host, f.root, '0.2.0', f.files, 'http://127.0.0.1:4444/mcp');
            assert.match(await readFile(path.join(f.root, f.mcp), 'utf8'), /4444/);
            assert.equal(await readFile(path.join(f.root, 'README.md'), 'utf8'), 'fixture\n');
            await writeFile(path.join(f.root, 'README.md'), 'moved source');
            await assert.rejects(
                patchPluginEndpoint(host, f.root, '0.2.0', f.files, 'http://127.0.0.1:5555/mcp'),
                /payload/,
            );
        } finally {
            await rm(f.root, { recursive: true });
        }
    });
}

test('URL overlay preserves duplicate unrelated strings', async () => {
    const f = await fixture('codex');
    try {
        const original = f.files.get(f.mcp)?.toString('utf8');
        assert.ok(original);
        const sameUrl = original.replace('https://example.invalid', 'http://127.0.0.1:27637/mcp');
        f.files.set(f.mcp, Buffer.from(sameUrl));
        await writeFile(path.join(f.root, f.mcp), sameUrl);
        await patchPluginEndpoint('codex', f.root, '0.2.0', f.files, 'http://localhost:3333/mcp');
        assert.equal(
            await readFile(path.join(f.root, f.mcp), 'utf8'),
            sameUrl.replace('http://127.0.0.1:27637/mcp', 'http://localhost:3333/mcp'),
        );
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('MCP formatting drift is outside the one URL byte overlay', async () => {
    const f = await fixture('codex');
    try {
        const drifted = new Map(f.files);
        const current = drifted.get(f.mcp);
        assert.ok(current);
        drifted.set(f.mcp, Buffer.from(`${current.toString('utf8')}\n`));
        assert.throws(() => verifyPluginFiles('codex', '0.2.0', f.files, drifted), /overlay/);
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('source layouts without a bounded unique canonical own URL literal fail before native installation', async () => {
    const f = await fixture('codex');
    try {
        const original = f.files.get(f.mcp)?.toString('utf8');
        assert.ok(original);
        const escaped = new Map(f.files);
        escaped.set(
            f.mcp,
            Buffer.from(original.replace('http://127.0.0.1:27637/mcp', 'http:\\/\\/127.0.0.1:27637/mcp')),
        );
        assert.throws(() => verifyPluginFiles('codex', '0.2.0', escaped, escaped, false), /payload-overlay/);
        const crowded = new Map(f.files);
        crowded.set(
            f.mcp,
            Buffer.from(
                original.replace(
                    '"extra":',
                    `"copies":${JSON.stringify(Array(65).fill('http://127.0.0.1:27637/mcp'))},"extra":`,
                ),
            ),
        );
        assert.throws(() => verifyPluginFiles('codex', '0.2.0', crowded, crowded, false), /payload-overlay/);
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('rejects extra files, hard links, symbolic links and wrong manifests before write', async () => {
    const f = await fixture('claude');
    const external = await mkdtemp(path.join(os.tmpdir(), 'dct-external-'));
    try {
        await writeFile(path.join(f.root, 'extra'), 'extra');
        await assert.rejects(
            patchPluginEndpoint('claude', f.root, '0.2.0', f.files, 'http://localhost:3333/mcp'),
            /payload/,
        );
        await rm(path.join(f.root, 'extra'));
        await mkdir(path.join(f.root, 'empty-spoof'));
        await assert.rejects(readPluginTree(f.root), /layout/);
        await rm(path.join(f.root, 'empty-spoof'), { recursive: true });
        await link(path.join(f.root, 'README.md'), path.join(external, 'linked'));
        await assert.rejects(readPluginTree(f.root), /file/);
        await rm(path.join(external, 'linked'));
        await symlink(external, path.join(f.root, 'linked'), 'junction');
        await assert.rejects(readPluginTree(f.root), /link|directory|payload/);
        await rm(path.join(f.root, 'linked'));
        await assert.rejects(
            patchPluginEndpoint('claude', f.root, '9.0.0', f.files, 'http://localhost:3333/mcp'),
            /manifest/,
        );
        await assert.rejects(
            patchPluginEndpoint('codex', f.root, '0.2.0', f.files, 'http://localhost:3333/mcp'),
            /manifest|layout/,
        );
    } finally {
        await rm(f.root, { recursive: true });
        await rm(external, { recursive: true });
    }
});

test('atomic write and readback failure remain visible with bounded errors', async () => {
    const f = await fixture('codex');
    try {
        await assert.rejects(
            patchPluginEndpoint('codex', f.root, '0.2.0', f.files, 'http://localhost:3333/mcp', {
                rename: async () => {
                    throw new Error('private/path/token');
                },
            }),
            /write-failed/,
        );
        assert.doesNotMatch(await readFile(path.join(f.root, f.mcp), 'utf8'), /3333/);
        await assert.rejects(
            patchPluginEndpoint('codex', f.root, '0.2.0', f.files, 'http://localhost:3333/mcp', {
                afterWrite: async () => {
                    await writeFile(path.join(f.root, f.mcp), 'bad');
                },
            }),
            /readback-failed/,
        );
    } finally {
        await rm(f.root, { recursive: true });
    }
});

test('Claude permits only its researched empty host lease directory and refuses any lease marker', async () => {
    const f = await fixture('claude');
    try {
        await mkdir(path.join(f.root, '.in_use'));
        await patchPluginEndpoint('claude', f.root, '0.2.0', f.files, 'http://localhost:3333/mcp');
        await writeFile(path.join(f.root, '.in_use', 'unreadable-or-live'), 'private-marker');
        await assert.rejects(
            patchPluginEndpoint('claude', f.root, '0.2.0', f.files, 'http://localhost:4444/mcp'),
            /plugin-in-use/,
        );
        assert.doesNotMatch(await readFile(path.join(f.root, f.mcp), 'utf8'), /4444/);
        await rm(path.join(f.root, '.in_use'), { recursive: true });
        await mkdir(path.join(f.root, '.IN_USE'));
        await assert.rejects(
            patchPluginEndpoint('claude', f.root, '0.2.0', f.files, 'http://localhost:4444/mcp'),
            /layout/,
        );
        await rm(path.join(f.root, '.IN_USE'), { recursive: true });
        await mkdir(path.join(f.root, '.in_use'));
        await assert.rejects(
            patchPluginEndpoint('claude', f.root, '0.2.0', f.files, 'http://localhost:4444/mcp', {
                afterWrite: async () => {
                    await writeFile(path.join(f.root, '.in_use', 'late-marker'), 'busy');
                },
            }),
            /readback-failed/,
        );
    } finally {
        await rm(f.root, { recursive: true });
    }
});
