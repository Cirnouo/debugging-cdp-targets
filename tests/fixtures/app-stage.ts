import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import * as app from '../../tooling/build-app.ts';
import { guardAppArchiveExtraction as archiveGuard, storedAppZip as zip } from './app-archive.ts';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function stageFixture() {
    const root = fileURLToPath(new URL('../..', import.meta.url));
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
    const originalTemporary = fs.mkdtemp;
    const originalOpen = fs.open;
    const originalStat = fs.lstat;
    const originalRead = fs.readFile;
    let activeMetadata = fixtureMetadata;
    let laterMetadata = '';
    let metadataReads = 0;
    const remap = (name: unknown) => (String(name) === metadataName ? activeMetadata : name);
    fs.open = (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]) === metadataName && ++metadataReads > 1 && laterMetadata) activeMetadata = laterMetadata;
        return Reflect.apply(originalOpen, fs, [remap(args[0]), ...args.slice(1)]);
    };
    fs.lstat = (...args: Parameters<typeof fs.lstat>) =>
        Reflect.apply(originalStat, fs, [remap(args[0]), ...args.slice(1)]);
    Object.defineProperty(fs, 'readFile', {
        value: (...args: Parameters<typeof fs.readFile>) =>
            Reflect.apply(originalRead, fs, [remap(args[0]), ...args.slice(1)]),
    });
    Object.defineProperty(fs, 'mkdtemp', {
        value: async (prefix: string) => {
            if (prefix === path.join(os.tmpdir(), 'dct-app-enrollment-'))
                return originalTemporary(path.join(directory, 'dct-app-enrollment-'));
            if (
                prefix === path.join(os.tmpdir(), 'dct-owned-compiler-') ||
                prefix === path.join(os.tmpdir(), 'dct-deployment-support-')
            )
                return originalTemporary(prefix);
            if (prefix !== path.join(os.tmpdir(), 'dct-app-stage-')) throw new Error('Unexpected temporary owner.');
            await fs.mkdir(scratch);
            return scratch;
        },
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
            fs.open = originalOpen;
            fs.lstat = originalStat;
            fs.readFile = originalRead;
            fs.mkdtemp = originalTemporary;
            syncBuiltinESMExports();
            assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-payload-stage-'));
            await rm(directory, { recursive: true });
        },
    };
}
