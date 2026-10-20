import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as app from '../tooling/build-app.ts';
import { guardAppArchiveExtraction as archiveGuard, storedAppZip as zip } from './fixtures/app-archive.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

test('ZIP source extraction refuses foreign archive identity, escaping paths, aliases and non-regular source entries', {
    skip: process.platform !== 'win32',
}, async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-source-zip-negative-')));
    const root = fileURLToPath(new URL('..', import.meta.url));
    const allowed = new Set<string>();
    const restore = archiveGuard(allowed);
    try {
        const cases = [
            { entries: [{ name: 'leaf', content: 'inert' }], badHash: true },
            { entries: [{ name: 'leaf', content: 'inert' }], badLength: true },
            { entries: [{ name: '../outside', content: 'inert' }] },
            { entries: [{ name: 'a/../inside', content: '' }] },
            { entries: [{ name: '/absolute', content: '' }] },
            { entries: [{ name: 'C:/absolute', content: '' }] },
            { entries: [{ name: 'CON.txt', content: 'inert' }] },
            { entries: [{ name: 'a\\b', content: 'inert' }] },
            { entries: [{ name: 'trailing.', content: 'inert' }] },
            { entries: [{ name: 'alias ', content: '' }] },
            {
                entries: [
                    { name: 'dir/', content: '', mode: 0x4000 },
                    { name: 'DIR', content: '', mode: 0x8000 },
                ],
            },
            {
                entries: [
                    { name: 'a', content: 'a' },
                    { name: 'A', content: 'b' },
                ],
            },
            {
                entries: [
                    { name: 'a', content: 'a' },
                    { name: 'a/child', content: 'b' },
                ],
            },
            { entries: [{ name: 'link', content: 'target', mode: 0o120777 }] },
            { entries: [{ name: 'special', content: '', mode: 0o20600 }] },
        ];
        for (const [index, scenario] of cases.entries()) {
            const archive = path.join(directory, `owned-${index}.zip`);
            const destination = path.join(directory, `out-${index}`);
            const bytes = zip(scenario.entries);
            await writeFile(archive, bytes);
            const expected = {
                platform: 'win32' as const,
                architecture: 'x64' as const,
                bytes: bytes.length + (scenario.badLength ? 1 : 0),
                sha256: scenario.badHash ? '0'.repeat(64) : hash(bytes),
            };
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
                    String(expected.bytes),
                    '-ExpectedSha256',
                    expected.sha256,
                ]),
            );
            await assert.rejects(app.extractAppArchive(root, archive, expected, destination), Error, String(index));
            await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
            assert.ok((await readFile(archive)).equals(bytes));
            // Failure closes the source stream, allowing an ordinary owned-file replacement.
            await writeFile(archive, bytes);
        }
    } finally {
        restore();
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-source-zip-negative-'));
        await rm(directory, { recursive: true });
    }
});

test('ZIP source inventory authenticates the same opened stream and records original bytes and empty directories', {
    skip: process.platform !== 'win32',
}, async () => {
    assert.equal(typeof app.extractAppArchive, 'function', 'authenticated source extraction is required');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-source-zip-')));
    const archive = path.join(directory, 'owned.zip');
    const destination = path.join(directory, 'unpacked');
    const bytes = zip([
        { name: 'electron.exe', content: 'inert EXE\n' },
        { name: 'empty/', content: '' },
        { name: 'nested/file', content: '' },
        { name: 'resources/default_app.asar', content: 'inert default\n' },
    ]);
    const root = fileURLToPath(new URL('..', import.meta.url));
    const expected = {
        platform: 'win32' as const,
        architecture: 'x64' as const,
        bytes: bytes.length,
        sha256: hash(bytes),
    };
    const args = [
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
        expected.sha256,
    ];
    const restore = archiveGuard(new Set([JSON.stringify(args)]));
    try {
        await writeFile(archive, bytes);
        const result = await app.extractAppArchive(root, archive, expected, destination);
        assert.deepEqual(result, [
            { type: 'file', path: 'electron.exe', bytes: 10, sha256: hash('inert EXE\n'), executableBits: null },
            { type: 'directory', path: 'empty', executableBits: null },
            { type: 'directory', path: 'nested', executableBits: null },
            { type: 'file', path: 'nested/file', bytes: 0, sha256: hash(''), executableBits: null },
            { type: 'directory', path: 'resources', executableBits: null },
            {
                type: 'file',
                path: 'resources/default_app.asar',
                bytes: 14,
                sha256: hash('inert default\n'),
                executableBits: null,
            },
        ]);
        assert.equal(await readFile(path.join(destination, 'electron.exe'), 'utf8'), 'inert EXE\n');
        assert.equal(await readFile(path.join(destination, 'resources/default_app.asar'), 'utf8'), 'inert default\n');
        assert.ok((await readFile(archive)).equals(bytes));
    } finally {
        restore();
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-source-zip-'));
        await rm(directory, { recursive: true });
    }
});
