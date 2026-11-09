import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
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

const fixedWindows = process.platform === 'win32' && process.arch === 'x64';
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
    skip: !fixedWindows,
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
    skip: !fixedWindows,
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
    skip: !fixedWindows,
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
    skip: !fixedWindows,
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
    skip: !fixedWindows,
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
        for (const platform of ['darwin', 'linux'] as const) {
            const options = {
                root: 'unused',
                kind: 'portable',
                platform: 'win32',
                architecture: 'x64',
                electronArchive: 'unused',
                nodeArchive: 'unused',
                output: 'unused',
            } satisfies Parameters<typeof app.stageDesktopApp>[0];
            assert.equal(Reflect.set(options, 'platform', platform), true);
            assert.equal(Reflect.get(options, 'platform'), platform);
            await assert.rejects(app.stageDesktopApp(options), /other native cells remain pending/);
        }
    } finally {
        restore();
    }
});

test('arm64 staging refuses missing runtime and license evidence before extraction or output', {
    skip: !fixedWindows,
}, async (context) => {
    for (const missing of ['runtime-and-licenses', 'runtime', 'licenses']) {
        await context.test(missing, async () => {
            const fixture = await stageFixture({ compiler: false });
            const restoreGuard = archiveGuard(new Set());
            const effects = { scratch: 0, directories: 0, writes: 0, extraction: 0, dlopen: 0, state: 0 };
            const replacements: { mock: { restore(): void } }[] = [];
            try {
                assert.ok(isRecord(fixture.metadata) && Array.isArray(fixture.metadata.archives));
                const electron = fixture.metadata.archives.find(
                    (entry: unknown) =>
                        isRecord(entry) &&
                        entry.kind === 'electron' &&
                        entry.platform === 'win32' &&
                        entry.architecture === 'arm64',
                );
                const node = fixture.metadata.archives.find(
                    (entry: unknown) =>
                        isRecord(entry) &&
                        entry.kind === 'node' &&
                        entry.platform === 'win32' &&
                        entry.architecture === 'arm64',
                );
                assert.ok(isRecord(electron) && isRecord(node));
                assert.equal(electron.licenses, undefined, 'Retained arm64 Electron source proof remains absent.');
                assert.equal(node.runtimeFiles, undefined, 'Retained arm64 Node source proof remains absent.');
                // Isolate each missing-proof gate using only the fixture's inert owned records.
                // These records never authorize extraction or establish arm64 vendor evidence.
                if (missing === 'runtime') electron.licenses = structuredClone(fixture.electron.licenses);
                if (missing === 'licenses') node.runtimeFiles = structuredClone(fixture.node.runtimeFiles);
                await writeFile(fixture.fixtureMetadata, JSON.stringify(fixture.metadata));
                replacements.push(
                    mock.method(fs, 'mkdtemp', () => {
                        effects.scratch++;
                        throw new Error('Scratch acquisition preceded missing-proof refusal.');
                    }),
                );
                replacements.push(
                    mock.method(fs, 'mkdir', () => {
                        effects.directories++;
                        throw new Error('Output creation preceded missing-proof refusal.');
                    }),
                );
                replacements.push(
                    mock.method(fs, 'writeFile', (...args: Parameters<typeof fs.writeFile>) => {
                        effects.writes++;
                        if (String(args[0]).replaceAll('\\', '/').endsWith('/.deployment/state.json')) effects.state++;
                        throw new Error('Output write preceded missing-proof refusal.');
                    }),
                );
                replacements.push(
                    mock.method(childProcess, 'execFile', () => {
                        effects.extraction++;
                        throw new Error('Extraction preceded missing-proof refusal.');
                    }),
                );
                replacements.push(
                    mock.method(process, 'dlopen', () => {
                        effects.dlopen++;
                        throw new Error('Native load preceded missing-proof refusal.');
                    }),
                );
                syncBuiltinESMExports();
                await assert.rejects(
                    app.stageDesktopApp({ ...fixture.options, architecture: 'arm64' }),
                    /Native extraction evidence is unavailable/,
                );
                assert.deepEqual(effects, {
                    scratch: 0,
                    directories: 0,
                    writes: 0,
                    extraction: 0,
                    dlopen: 0,
                    state: 0,
                });
                await assert.rejects(fs.lstat(fixture.options.output), { code: 'ENOENT' });
                await assert.rejects(fs.lstat(path.join(fixture.options.output, '.deployment/state.json')), {
                    code: 'ENOENT',
                });
            } finally {
                for (const replacement of replacements.reverse()) replacement.mock.restore();
                syncBuiltinESMExports();
                restoreGuard();
                await fixture.cleanup();
            }
        });
    }
});

test('real stage privately binds its produced query into worker code before observers and complete manifest selection', {
    skip: !fixedWindows,
}, async () => {
    const fixture = await stageFixture();
    let observed = false;
    Reflect.set(fixture.options, '__DCT_DEPLOYMENT_QUERY__', { kind: 'bound', sha256: '0'.repeat(64) });
    Reflect.set(fixture.options, 'onInputs', async (names: readonly string[]) => {
        observed = true;
        assert.ok(names.includes('src/adapters/windows-deployment-authority.cs'));
        assert.ok(names.includes('src/adapters/windows-deployment-create.cs'));
    });
    try {
        const stage = await app.stageDesktopApp(fixture.options);
        assert.equal(observed, true);
        const query = await readFile(path.join(stage.root, 'resources/app/windows-deployment-query.exe'));
        const worker = await readFile(path.join(stage.root, 'resources/app/deployment-worker.mjs'), 'utf8');
        const expected = stage.manifest.entries.find(
            (entry) => entry.path === 'resources/app/windows-deployment-query.exe',
        );
        assert.ok(expected?.type === 'file');
        assert.equal(expected.sha256, hash(query));
        assert.ok(worker.includes(hash(query)));
        assert.doesNotMatch(
            worker,
            /DctDeploymentCreateProgram|Framework64|dct-deployment-support-|createFreshDeploymentRoot|copyPayload|createGatewayCore|from ["']electron["']/,
        );
        assert.equal(stage.provenance.deploymentQuery.outputs.length, 2);
        assert.equal(stage.provenance.deploymentQuery.outputs[0]?.sha256, hash(query));
        for (const name of [
            'resources/app/windows-deployment-create.exe',
            'resources/app/windows-deployment-authority.cs',
            'resources/app/windows-deployment-create.cs',
        ])
            assert.equal(
                stage.manifest.entries.some((entry) => entry.path === name),
                false,
            );
    } finally {
        await fixture.cleanup();
    }
});
