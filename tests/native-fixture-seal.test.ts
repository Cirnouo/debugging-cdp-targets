import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateNativeFixtureFiles, verifyNativeFixtureSeal } from '../tooling/native-fixture-seal.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const root = path.resolve('test-owned-stage');
function snapshot() {
    const app = [
        'electron.exe',
        'resources/app/app-bootstrap.mjs',
        'resources/app/app-main.mjs',
        'resources/app/app-preload.cjs',
        'resources/app/app-renderer.js',
        'resources/app/package.json',
        'resources/app/delivery/app-release-inputs.json',
        'resources/app/delivery/app-native-release.json',
        'resources/app/delivery/official-server-release.json',
        'resources/node/node.exe',
        'resources/node/LICENSE',
        'resources/official-server/package.json',
        'resources/official-server/build/src/bin/chrome-devtools-mcp.js',
        'resources/app/node_modules/fs-native-extensions/prebuilds/win32-x64/fs-native-extensions.node',
    ];
    const fixture = [
        'http-fixture.mjs',
        'http-fixture-NOTICES.txt',
        'screenshot-layers-study.mjs',
        'screenshot-timeout-study.mjs',
        'windows-cdp-helper.ps1',
        'windows-native-helper.ps1',
        'windows-native-process.cs',
        'src/adapters/windows-native-process.cs',
        'tests/smoke/windows-window-evidence.ps1',
        'tests/smoke/windows-selected-tab-evidence.ps1',
        'tests/smoke/windows-png-evidence.ps1',
        'tests/fixtures/compile-native-window.ps1',
        'tests/fixtures/native-window.cs',
    ];
    const contents = new Map([...app, ...fixture].map((file) => [file, Buffer.from(`original ${file}`)]));
    const inventory = (files: string[]) =>
        files
            .sort((a, b) => a.localeCompare(b, 'en'))
            .map((file) => ({
                path: file,
                bytes: contents.get(file)?.length ?? 0,
                sha256: hash(contents.get(file) ?? ''),
            }));
    const inputs = [{ path: 'src/interface/app-main.ts', bytes: 4, sha256: hash('code') }];
    const appFiles = inventory(app);
    const files = inventory([...app, ...fixture]);
    return {
        contents,
        receipt: {
            schemaVersion: 1,
            platform: 'win32',
            architecture: 'x64',
            createdAtUtc: '2026-10-17T00:00:00.000Z',
            source: { revision: '1'.repeat(40), dirty: false, inputs, digest: hash(JSON.stringify(inputs)) },
            app: { files: appFiles, digest: hash(JSON.stringify(appFiles)) },
            fixture: { files: inventory(fixture) },
            files,
            inventoryDigest: hash(JSON.stringify(files)),
        },
        io: {
            listFiles: async () => [...contents.keys()],
            readFile: async (file: string) => {
                const relative = path.relative(root, file).replaceAll('\\', '/');
                const bytes = contents.get(relative);
                if (!bytes) throw new Error('Missing fixture bytes.');
                return bytes;
            },
        },
    };
}

test('native fixture seal verifies the complete original stage plus separate fixture identity and explicit source expectations', async () => {
    const f = snapshot();
    assert.deepEqual(
        await verifyNativeFixtureSeal(root, f.receipt, f.io, {
            revision: '1'.repeat(40),
            sourceDigest: f.receipt.source.digest,
        }),
        {
            root,
            inventoryDigest: f.receipt.inventoryDigest,
            nodeExecutable: path.join(root, 'resources/node/node.exe'),
            entry: path.join(root, 'http-fixture.mjs'),
            studyEntries: {
                layers: path.join(root, 'screenshot-layers-study.mjs'),
                timeout: path.join(root, 'screenshot-timeout-study.mjs'),
            },
        },
    );
    await assert.rejects(verifyNativeFixtureSeal(root, f.receipt, f.io, { revision: '2'.repeat(40) }));
    await assert.rejects(verifyNativeFixtureSeal(root, f.receipt, f.io, { sourceDigest: '0'.repeat(64) }));
    f.receipt.source.dirty = true;
    await assert.rejects(verifyNativeFixtureSeal(root, f.receipt, f.io));
    await verifyNativeFixtureSeal(root, f.receipt, f.io, { allowDirty: true });
});

test('each sealed study and native helper leaf is mandatory and byte-verified even after receipt inventories are recomputed', async () => {
    for (const leaf of snapshot().receipt.fixture.files.map((file) => file.path)) {
        const missing = snapshot();
        missing.contents.delete(leaf);
        missing.receipt.fixture.files = missing.receipt.fixture.files.filter((file) => file.path !== leaf);
        missing.receipt.files = missing.receipt.files.filter((file) => file.path !== leaf);
        missing.receipt.inventoryDigest = hash(JSON.stringify(missing.receipt.files));
        await assert.rejects(verifyNativeFixtureSeal(root, missing.receipt, missing.io), leaf);
        const tampered = snapshot();
        tampered.contents.set(leaf, Buffer.from('modified-native-subject'));
        await assert.rejects(verifyNativeFixtureSeal(root, tampered.receipt, tampered.io), leaf);
    }
});

test('native seal rejects missing runtime boundaries, byte drift, extras, links supplied as non-files and forged inventories', async () => {
    for (const mutate of [
        (f: ReturnType<typeof snapshot>) => {
            f.contents.set('resources/node/node.exe', Buffer.from('changed'));
        },
        (f: ReturnType<typeof snapshot>) => {
            f.contents.delete('http-fixture.mjs');
        },
        (f: ReturnType<typeof snapshot>) => {
            f.contents.set('outside.mjs', Buffer.from('extra'));
        },
        (f: ReturnType<typeof snapshot>) => {
            const first = f.receipt.files[0];
            assert.ok(first);
            first.path = '../escape';
        },
        (f: ReturnType<typeof snapshot>) => {
            f.receipt.files.reverse();
        },
        (f: ReturnType<typeof snapshot>) => {
            const first = f.receipt.files[0];
            assert.ok(first);
            f.receipt.files.push(first);
        },
        (f: ReturnType<typeof snapshot>) => {
            const first = f.receipt.source.inputs[0];
            assert.ok(first);
            first.sha256 = '0'.repeat(64);
        },
        (f: ReturnType<typeof snapshot>) => {
            f.receipt.app.files = f.receipt.app.files.filter((file) => file.path !== 'electron.exe');
            f.receipt.app.digest = hash(JSON.stringify(f.receipt.app.files));
            f.receipt.files = f.receipt.files.filter((file) => file.path !== 'electron.exe');
            f.receipt.inventoryDigest = hash(JSON.stringify(f.receipt.files));
            f.contents.delete('electron.exe');
        },
    ]) {
        const f = snapshot();
        mutate(f);
        await assert.rejects(verifyNativeFixtureSeal(root, f.receipt, f.io));
    }
});

test('real research bundles consume only the sealed subjects and unchanged native closure without builder runtime imports', async () => {
    const repository = fileURLToPath(new URL('..', import.meta.url));
    const built = await generateNativeFixtureFiles(repository);
    assert.deepEqual(
        [...built.files.keys()].sort(),
        snapshot()
            .receipt.fixture.files.map((file) => file.path)
            .sort(),
    );
    assert.ok(built.inputs.includes('tests/smoke/screenshot-layers-study.ts'));
    assert.ok(built.inputs.includes('tests/smoke/screenshot-timeout-study.ts'));
    assert.ok(built.inputs.includes('src/adapters/target-host.ts'));
    assert.ok(built.inputs.includes('tooling/native-fixture-verification.ts'));
    assert.equal(
        built.inputs.some((file) =>
            /(?:tooling\/(?:build-app|native-fixture-seal)|node_modules\/.*esbuild)/.test(file),
        ),
        false,
    );
    assert.ok(built.externalImports.every(isBuiltin), JSON.stringify(built.externalImports));
    for (const [file, bytes] of built.files) {
        if (/\.(?:ps1|cs)$/.test(file)) {
            const original = file.includes('/') ? file : `src/adapters/${file}`;
            assert.ok(built.inputs.includes(original), original);
            assert.deepEqual(bytes, await readFile(path.join(repository, original)), file);
        }
    }
    assert.ok(built.files.get('http-fixture-NOTICES.txt')?.includes(Buffer.from('@modelcontextprotocol/client')));
});
