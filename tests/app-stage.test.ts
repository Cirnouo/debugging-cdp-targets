import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { mock, test } from 'node:test';
import { verifyDeploymentPayload } from '../src/adapters/app-delivery.ts';
import { isRecord } from '../src/shared/errors.ts';
import * as app from '../tooling/build-app.ts';
import { guardAppArchiveExtraction as archiveGuard } from './fixtures/app-archive.ts';
import { stageFixture } from './fixtures/app-stage.ts';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('App source composition has literal canonical bytes, includes empty directories and excludes its own manifest', () => {
    assert.equal(typeof app.composeAppPayloadManifest, 'function', 'source composition owner is required');
    const result = app.composeAppPayloadManifest({
        platform: 'win32',
        architecture: 'x64',
        electron: [
            { type: 'file', path: 'LICENSE', bytes: 4, sha256: hash('E-L\n'), executableBits: null },
            { type: 'file', path: 'electron.exe', bytes: 4, sha256: hash('EXE\n'), executableBits: null },
            { type: 'directory', path: 'empty', executableBits: null },
        ],
        node: new Map([
            ['node.exe', Buffer.from('NODE\n')],
            ['LICENSE', Buffer.from('NLICENSE\n')],
        ]),
        app: new Map([
            ['package.json', Buffer.from('APP\n')],
            ['LICENSE', Buffer.from('A\n')],
        ]),
        official: new Map([
            ['package.json', Buffer.from('OFFICIAL\n')],
            ['LICENSE', Buffer.from('OL\n')],
        ]),
    });
    const golden =
        '{"schemaVersion":1,"platform":"win32","architecture":"x64","entries":[' +
        '{"type":"file","path":"LICENSE","bytes":4,"sha256":"' +
        hash('E-L\n') +
        '","executableBits":null},' +
        '{"type":"file","path":"electron.exe","bytes":4,"sha256":"' +
        hash('EXE\n') +
        '","executableBits":null},' +
        '{"type":"directory","path":"empty","executableBits":null},' +
        '{"type":"directory","path":"resources","executableBits":null},' +
        '{"type":"directory","path":"resources/app","executableBits":null},' +
        '{"type":"file","path":"resources/app/LICENSE","bytes":2,"sha256":"' +
        hash('A\n') +
        '","executableBits":null},' +
        '{"type":"file","path":"resources/app/package.json","bytes":4,"sha256":"' +
        hash('APP\n') +
        '","executableBits":null},' +
        '{"type":"directory","path":"resources/node","executableBits":null},' +
        '{"type":"file","path":"resources/node/LICENSE","bytes":9,"sha256":"' +
        hash('NLICENSE\n') +
        '","executableBits":null},' +
        '{"type":"file","path":"resources/node/node.exe","bytes":5,"sha256":"' +
        hash('NODE\n') +
        '","executableBits":null},' +
        '{"type":"directory","path":"resources/official-server","executableBits":null},' +
        '{"type":"file","path":"resources/official-server/LICENSE","bytes":3,"sha256":"' +
        hash('OL\n') +
        '","executableBits":null},' +
        '{"type":"file","path":"resources/official-server/package.json","bytes":9,"sha256":"' +
        hash('OFFICIAL\n') +
        '","executableBits":null}]}\n';
    assert.equal(result.canonicalManifest, golden);
    assert.equal(result.selectedBuildId, hash(golden));
    assert.equal(result.selectedManifestSha256, hash(golden));
    assert.equal(
        result.manifest.entries.some((entry) => entry.path === 'payload-manifest.json'),
        false,
    );
});

test('real stage owner composes pinned source extraction, generated licenses/native closure and complete original official files before full-tree agreement', {
    skip: process.platform !== 'win32',
}, async () => {
    const fixture = await stageFixture();
    try {
        const result = await app.stageDesktopApp(fixture.options);
        assert.equal(result.root, fixture.options.output);
        assert.equal(await readFile(path.join(result.root, 'payload-manifest.json'), 'utf8'), result.canonicalManifest);
        assert.equal(result.selectedBuildId, hash(result.canonicalManifest));
        assert.equal(result.manifest.platform, 'win32');
        assert.equal(result.manifest.architecture, 'x64');
        const names = result.manifest.entries.map((entry) => entry.path);
        for (const name of [
            'empty',
            'resources/default_app.asar',
            'resources/node/LICENSE',
            'resources/app/THIRD-PARTY-NOTICES.txt',
            'resources/app/node_modules/fs-native-extensions/prebuilds/win32-x64/fs-native-extensions.node',
            'resources/official-server/build/src/bin/chrome-devtools-mcp.js',
        ])
            assert.ok(names.includes(name), name);
        assert.equal(
            names.some((name) => name.includes('unused-tool') || name === 'payload-manifest.json'),
            false,
        );
        assert.equal(result.provenance.electron.sha256, fixture.electron.sha256);
        assert.equal(result.provenance.node.sha256, fixture.node.sha256);
        assert.equal(result.provenance.official.version, '1.11.0');
        assert.equal(result.provenance.nativePackages.length, 6);
        assert.ok(result.provenance.generatedInputs.some((entry) => entry.path === 'tooling/build-app.ts'));
        await assert.rejects(app.stageDesktopApp(fixture.options), { code: 'EEXIST' });
        assert.equal(await readFile(path.join(result.root, 'payload-manifest.json'), 'utf8'), result.canonicalManifest);
        assert.equal(await readFile(path.join(result.root, 'electron.exe'), 'utf8'), 'inert Electron\n');
        const selection = { ...result, platform: 'win32' as const, architecture: 'x64' as const };
        assert.equal((await verifyDeploymentPayload(result.root, selection)).selectedBuildId, result.selectedBuildId);
        await assert.rejects(verifyDeploymentPayload(result.root, { ...selection, selectedBuildId: '0'.repeat(64) }));
        await assert.rejects(verifyDeploymentPayload(result.root, { ...selection, architecture: 'arm64' }));
        await writeFile(path.join(result.root, 'http-fixture.mjs'), 'inert research extra');
        await assert.rejects(verifyDeploymentPayload(result.root, selection), /Unexpected/);
        await rm(path.join(result.root, 'http-fixture.mjs'));
        await writeFile(path.join(result.root, 'electron.exe'), 'drift');
        await assert.rejects(verifyDeploymentPayload(result.root, selection), /length|digest/);
        await rm(path.join(result.root, 'electron.exe'));
        await assert.rejects(verifyDeploymentPayload(result.root, selection), /Missing/);
    } finally {
        await fixture.cleanup();
    }
});

test('stage rejects delivered archive evidence from a different source snapshot than the authenticated ZIPs', {
    skip: process.platform !== 'win32',
}, async () => {
    const fixture = await stageFixture();
    try {
        fixture.electron.sha256 = '0'.repeat(64);
        await fixture.changeMetadataAfterInitialRead(fixture.metadata);
        await assert.rejects(app.stageDesktopApp(fixture.options), /archive source evidence changed/);
        await assert.rejects(fs.lstat(fixture.options.output), { code: 'ENOENT' });
    } finally {
        await fixture.cleanup();
    }
});

test('stage snapshots its consumed request before awaits so later option mutation cannot change delivered distribution or selection', {
    skip: process.platform !== 'win32',
}, async () => {
    const fixture = await stageFixture();
    const previousOpen = fs.open;
    const boundary = path.join(
        path.dirname(fixture.options.output),
        'dct-app-stage-controlled/node/node-v24.21.0-win-x64/LICENSE',
    );
    const changed = mock.method(fs, 'open', (...args: Parameters<typeof fs.open>) => {
        const result = Reflect.apply(previousOpen, fs, args);
        if (String(args[0]) === boundary) {
            // The real Node source is already selected and extracted. Change only the
            // caller-owned request before the real generated App owner consumes it.
            Reflect.set(fixture.options, 'platform', 'darwin');
            Reflect.set(fixture.options, 'architecture', 'arm64');
            Reflect.set(fixture.options, 'kind', 'installed');
        }
        return result;
    });
    syncBuiltinESMExports();
    try {
        const stage = await app.stageDesktopApp(fixture.options);
        const distribution: unknown = JSON.parse(
            await readFile(path.join(stage.root, 'resources/app/distribution.json'), 'utf8'),
        );
        assert.deepEqual(distribution, { schemaVersion: 1, kind: 'portable', platform: 'win32', architecture: 'x64' });
        assert.equal(stage.manifest.platform, 'win32');
        assert.equal(stage.manifest.architecture, 'x64');
        assert.equal(stage.provenance.electron.platform, 'win32');
        assert.equal(stage.provenance.node.architecture, 'x64');
    } finally {
        changed.mock.restore();
        syncBuiltinESMExports();
        await fixture.cleanup();
    }
});

test('Electron source cannot occupy generated, Node, official or manifest namespaces', () => {
    for (const name of [
        'resources/app',
        'resources/node/foreign',
        'resources/official-server',
        'payload-manifest.json',
    ])
        assert.throws(
            () =>
                app.composeAppPayloadManifest({
                    platform: 'win32',
                    architecture: 'x64',
                    electron: [{ type: 'directory', path: name, executableBits: null }],
                    app: new Map([['package.json', Buffer.from('{}')]]),
                    node: new Map([['node.exe', Buffer.from('node')]]),
                    official: new Map([['package.json', Buffer.from('{}')]]),
                }),
            Error,
            name,
        );
});

test('stage refuses foreign Node and Electron original-file records even when the complete source ZIP identity agrees', {
    skip: process.platform !== 'win32',
}, async () => {
    for (const kind of ['node', 'electron'] as const) {
        const fixture = await stageFixture();
        try {
            const records = kind === 'node' ? fixture.node.runtimeFiles : fixture.electron.licenses;
            assert.ok(Array.isArray(records) && isRecord(records[0]));
            records[0].sha256 = '0'.repeat(64);
            await writeFile(fixture.fixtureMetadata, JSON.stringify(fixture.metadata));
            await assert.rejects(app.stageDesktopApp(fixture.options), /source disagrees|license evidence/);
            await assert.rejects(fs.lstat(fixture.options.output), { code: 'ENOENT' });
        } finally {
            await fixture.cleanup();
        }
    }
});

test('stage keeps its source-derived selection when actual output and its self-consistent manifest are replaced before final verification', {
    skip: process.platform !== 'win32',
}, async () => {
    const fixture = await stageFixture();
    const originalWrite = fs.writeFile;
    const changed = mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
        await Reflect.apply(originalWrite, fs, args);
        if (String(args[0]) !== path.join(fixture.options.output, 'payload-manifest.json')) return;
        const manifest: unknown = JSON.parse(String(args[1]));
        assert.ok(isRecord(manifest) && Array.isArray(manifest.entries));
        const entry = manifest.entries.find((value: unknown) => isRecord(value) && value.path === 'electron.exe');
        assert.ok(isRecord(entry));
        const foreign = Buffer.from('self-consistent foreign bytes');
        entry.bytes = foreign.length;
        entry.sha256 = hash(foreign);
        await originalWrite(path.join(fixture.options.output, 'electron.exe'), foreign);
        await originalWrite(String(args[0]), `${JSON.stringify(manifest)}\n`);
    });
    syncBuiltinESMExports();
    try {
        await assert.rejects(app.stageDesktopApp(fixture.options), /independent selection/);
        await assert.rejects(fs.lstat(path.join(fixture.options.output, '.deployment')), { code: 'ENOENT' });
    } finally {
        changed.mock.restore();
        syncBuiltinESMExports();
        await fixture.cleanup();
    }
});

test('non-Windows production stages fail closed before any external execution or output creation', async () => {
    const restore = archiveGuard(new Set());
    try {
        for (const platform of ['darwin', 'linux'] as const)
            await assert.rejects(
                app.stageDesktopApp({
                    root: 'unused',
                    kind: 'portable',
                    platform,
                    architecture: 'x64',
                    electronArchive: 'unused',
                    nodeArchive: 'unused',
                    output: 'unused',
                }),
                /other native cells remain pending/,
            );
    } finally {
        restore();
    }
});
