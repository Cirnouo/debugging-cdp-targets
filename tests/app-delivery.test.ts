import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyAppArchive, verifyAppReleaseTree } from '../src/adapters/app-delivery.ts';

test('App runtime evidence rejects changed, missing and extra files before executable use', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-app-evidence-')));
    const bytes = Buffer.from('synthetic-runtime-bytes');
    const file = { path: 'node', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    try {
        await writeFile(path.join(directory, 'node'), bytes);
        assert.deepEqual((await verifyAppReleaseTree(directory, [file])).get('node'), bytes);
        await writeFile(path.join(directory, 'node'), 'changed');
        await assert.rejects(verifyAppReleaseTree(directory, [file]), /digest|length/i);
        await writeFile(path.join(directory, 'node'), bytes);
        await writeFile(path.join(directory, 'extra'), 'unexpected');
        await assert.rejects(verifyAppReleaseTree(directory, [file]), /unexpected/i);
        await rm(path.join(directory, 'extra'));
        await rm(path.join(directory, 'node'));
        await assert.rejects(verifyAppReleaseTree(directory, [file]), /missing/i);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('archive checking is read-only and compares independently maintained size and digest', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-app-archive-'));
    const file = path.join(directory, 'archive.zip');
    const bytes = Buffer.from('synthetic-archive-bytes');
    const identity = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    try {
        await writeFile(file, bytes);
        await verifyAppArchive(file, identity);
        await assert.rejects(verifyAppArchive(file, { ...identity, bytes: 1 }));
        await assert.rejects(verifyAppArchive(file, { ...identity, sha256: '0'.repeat(64) }));
        assert.deepEqual(await readFile(file), bytes);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
