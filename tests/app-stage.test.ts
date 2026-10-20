import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyDeploymentPayload } from '../src/adapters/app-delivery.ts';
import { isRecord } from '../src/shared/errors.ts';
import * as app from '../tooling/build-app.ts';
import { guardAppArchiveExtraction as archiveGuard, storedAppZip as zip } from './fixtures/app-archive.ts';

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

async function stageFixture() {
    const root = fileURLToPath(new URL('..', import.meta.url));
    // Start only the existing trusted build compiler before the strict process guard.
    await app.generateAppFiles({ root, kind: 'portable', platform: 'win32', architecture: 'x64' });
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-payload-stage-')));
    const metadataName = path.join(root, 'tooling/app-release-inputs.json');
    const fixtureMetadata = path.join(directory, 'release.json');
    const electronArchive = path.join(directory, 'electron-owned.zip');
    const nodeArchive = path.join(directory, 'node-owned.zip');
    const output = path.join(directory, 'stage');
    const scratch = path.join(directory, 'dct-app-stage-controlled');
    const electronBytes = zip([
        { name: 'electron.exe', content: 'inert Electron\n' },
        { name: 'LICENSE', content: 'inert Electron license\n' },
        { name: 'LICENSES.chromium.html', content: 'inert Chromium notices\n' },
        { name: 'empty/', content: '' },
        { name: 'resources/default_app.asar', content: 'inert archive\n' },
    ]);
    const nodeBytes = zip([
        { name: 'node-v24.21.0-win-x64/node.exe', content: 'inert Node\n' },
        { name: 'node-v24.21.0-win-x64/LICENSE', content: 'inert Node license\n' },
        { name: 'node-v24.21.0-win-x64/unused-tool', content: 'not delivered\n' },
    ]);
    await writeFile(electronArchive, electronBytes);
    await writeFile(nodeArchive, nodeBytes);
    const metadata: unknown = JSON.parse(await readFile(metadataName, 'utf8'));
    assert.ok(isRecord(metadata) && Array.isArray(metadata.archives));
    const electron = metadata.archives.find(
        (value: unknown) =>
            isRecord(value) && value.kind === 'electron' && value.platform === 'win32' && value.architecture === 'x64',
    );
    const node = metadata.archives.find(
        (value: unknown) =>
            isRecord(value) && value.kind === 'node' && value.platform === 'win32' && value.architecture === 'x64',
    );
    assert.ok(isRecord(electron) && isRecord(node));
    Object.assign(electron, {
        bytes: electronBytes.length,
        sha256: hash(electronBytes),
        licenses: [
            { path: 'LICENSE', bytes: 23, sha256: hash('inert Electron license\n') },
            { path: 'LICENSES.chromium.html', bytes: 23, sha256: hash('inert Chromium notices\n') },
        ],
    });
    Object.assign(node, {
        bytes: nodeBytes.length,
        sha256: hash(nodeBytes),
        runtimeFiles: [
            {
                path: 'node-v24.21.0-win-x64/node.exe',
                destination: 'node.exe',
                bytes: 11,
                sha256: hash('inert Node\n'),
            },
            {
                path: 'node-v24.21.0-win-x64/LICENSE',
                destination: 'LICENSE',
                bytes: 19,
                sha256: hash('inert Node license\n'),
            },
        ],
    });
    await writeFile(fixtureMetadata, JSON.stringify(metadata));
    const originalOpen = fs.open;
    const originalStat = fs.lstat;
    const originalRead = fs.readFile;
    let activeMetadata = fixtureMetadata;
    let laterMetadata = '';
    let metadataReads = 0;
    const remap = (name: unknown) => (String(name) === metadataName ? activeMetadata : name);
    const opened = mock.method(fs, 'open', (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]) === metadataName && ++metadataReads > 1 && laterMetadata) activeMetadata = laterMetadata;
        return Reflect.apply(originalOpen, fs, [remap(args[0]), ...args.slice(1)]);
    });
    const named = mock.method(fs, 'lstat', (...args: Parameters<typeof fs.lstat>) =>
        Reflect.apply(originalStat, fs, [remap(args[0]), ...args.slice(1)]),
    );
    const read = mock.method(fs, 'readFile', (...args: Parameters<typeof fs.readFile>) =>
        Reflect.apply(originalRead, fs, [remap(args[0]), ...args.slice(1)]),
    );
    const temporary = mock.method(fs, 'mkdtemp', async (prefix: string) => {
        assert.equal(prefix, path.join(os.tmpdir(), 'dct-app-stage-'));
        await fs.mkdir(scratch);
        return scratch;
    });
    syncBuiltinESMExports();
    const allowed = new Set<string>();
    for (const [archive, destination, bytes] of [
        [electronArchive, path.join(scratch, 'electron'), electronBytes],
        [nodeArchive, path.join(scratch, 'node'), nodeBytes],
    ] as const)
        allowed.add(
            JSON.stringify([
                'pwsh',
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-File',
                path.join(root, 'tooling/extract-app-zip.ps1'),
                '-Archive',
                archive,
                '-Destination',
                destination,
                '-ExpectedBytes',
                String(bytes.length),
                '-ExpectedSha256',
                hash(bytes),
            ]),
        );
    const restoreGuard = archiveGuard(allowed);
    return {
        options: {
            root,
            kind: 'portable' as const,
            platform: 'win32' as const,
            architecture: 'x64' as const,
            electronArchive,
            nodeArchive,
            output,
        },
        electron,
        node,
        metadata,
        fixtureMetadata,
        async changeMetadataAfterInitialRead(value: unknown) {
            laterMetadata = path.join(directory, 'later-release.json');
            await writeFile(laterMetadata, JSON.stringify(value));
        },
        async cleanup() {
            restoreGuard();
            opened.mock.restore();
            named.mock.restore();
            read.mock.restore();
            temporary.mock.restore();
            syncBuiltinESMExports();
            assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-payload-stage-'));
            await rm(directory, { recursive: true });
        },
    };
}

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
