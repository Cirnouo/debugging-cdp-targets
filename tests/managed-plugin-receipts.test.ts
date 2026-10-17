import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    createManagedPluginReceipt,
    JsonHostPluginReceiptStore,
    parseManagedPluginReceipt,
    restoreReceiptFiles,
} from '../src/adapters/managed-plugin-receipts.ts';

test('schema-one receipt survives a new store instance, verifies original bytes and rejects drift', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-managed-receipt-'));
    const payload = path.join(root, 'payload');
    await mkdir(path.join(payload, '.claude-plugin'), { recursive: true });
    const files = new Map([
        ['.claude-plugin/plugin.json', Buffer.from('{"name":"debugging-cdp-targets","version":"0.2.0"}')],
        [
            '.mcp.json',
            Buffer.from(
                '{"private":"私人前缀","mcpServers":{"cdp-targets":{"type":"http","url":"http://127.0.0.1:27637/mcp","headers":{"Authorization":"Bearer never-persist-fixture"}}}}',
            ),
        ],
    ]);
    for (const [name, bytes] of files) await writeFile(path.join(payload, name), bytes);
    const source = 'https://example.invalid/repo.git';
    const receipt = createManagedPluginReceipt(
        'claude',
        { configRoot: root, marketplaceSource: source },
        {
            root: payload,
            version: '0.2.0',
            configuration: JSON.stringify({
                marketplace: { source: 'git', url: source, ref: null, sparse: [], autoUpdate: null },
                enabled: true,
            }),
        },
        {
            schemaVersion: 1,
            version: '0.2.0',
            minimumAppVersion: '0.1.0',
            source: { url: source, sha: 'a'.repeat(40) },
        },
        files,
    );
    try {
        await new JsonHostPluginReceiptStore(root).write('claude', receipt);
        const persisted = await readFile(path.join(root, 'claude-managed-plugin.json'), 'utf8');
        assert.doesNotMatch(persisted, /Authorization|Bearer|never-persist-fixture|mcpSourceBase64/);
        assert.equal(persisted.includes(files.get('.mcp.json')?.toString('base64') ?? ''), false);
        const restored = parseManagedPluginReceipt(await new JsonHostPluginReceiptStore(root).read('claude'));
        assert.deepEqual(restored, receipt);
        assert.deepEqual(await restoreReceiptFiles(restored), files);
        const mcp = files.get('.mcp.json');
        assert.ok(mcp);
        await writeFile(
            path.join(payload, '.mcp.json'),
            mcp.toString('utf8').replace('http://127.0.0.1:27637/mcp', 'http://localhost:3333/mcp'),
        );
        assert.deepEqual(await restoreReceiptFiles(restored), files);
        await assert.rejects(
            restoreReceiptFiles(parseManagedPluginReceipt({ ...receipt, mcpSourceUrlOffset: 0 })),
            /managed-receipt/,
        );
        await writeFile(path.join(payload, '.claude-plugin/plugin.json'), '{"name":"spoofed","version":"0.2.0"}');
        await assert.rejects(restoreReceiptFiles(restored), /managed-receipt/);
        assert.throws(() => parseManagedPluginReceipt({ ...receipt, schemaVersion: 2 }), /managed-receipt/);
        assert.throws(() => parseManagedPluginReceipt({ ...receipt, token: 'never-persist' }), /managed-receipt/);
        assert.throws(
            () =>
                parseManagedPluginReceipt({
                    ...receipt,
                    native: {
                        ...receipt.native,
                        configuration: receipt.native.configuration.replace(
                            '"enabled":true',
                            '"enabled":true,"token":"never-persist"',
                        ),
                    },
                }),
            /managed-receipt/,
        );
        assert.throws(
            () =>
                parseManagedPluginReceipt({
                    ...receipt,
                    files: [{ path: '../escape', size: 0, sha256: 'a'.repeat(64) }],
                }),
            /managed-receipt/,
        );
        const file = path.join(root, 'claude-managed-plugin.json');
        await writeFile(file, '{"schemaVersion":2}');
        await assert.rejects(new JsonHostPluginReceiptStore(root).write('claude', receipt), /managed-receipt/);
        assert.equal(await readFile(file, 'utf8'), '{"schemaVersion":2}');
        await writeFile(file, JSON.stringify(receipt));
        await link(file, path.join(root, 'shared'));
        await assert.rejects(new JsonHostPluginReceiptStore(root).read('claude'), /managed-receipt/);
    } finally {
        await rm(root, { recursive: true });
    }
});
