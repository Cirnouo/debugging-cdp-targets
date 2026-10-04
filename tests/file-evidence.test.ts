import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readRegularFile } from '../src/adapters/file-evidence.ts';

test('regular-file evidence rejects a path replaced after metadata inspection', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-file-evidence-'));
    const file = path.join(root, 'input');
    try {
        await writeFile(file, 'original');
        let replaced = false;
        await assert.rejects(
            readRegularFile(file, {
                lstat: async (name) => {
                    const metadata = await lstat(name, { bigint: true });
                    if (!replaced) {
                        replaced = true;
                        await rename(file, path.join(root, 'previous'));
                        await writeFile(file, 'replacement');
                    }
                    return metadata;
                },
            }),
            /changed/,
        );
        assert.equal(replaced, true);
    } finally {
        assert.equal(path.dirname(root), os.tmpdir());
        await rm(root, { recursive: true, force: true });
    }
});

test('regular-file evidence preserves exact bytes and rejects directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-file-evidence-'));
    const bytes = Buffer.from([0, 255, 17, 10]);
    try {
        await writeFile(path.join(root, 'input'), bytes);
        assert.deepEqual(await readRegularFile(path.join(root, 'input')), bytes);
        await mkdir(path.join(root, 'directory'));
        await assert.rejects(readRegularFile(path.join(root, 'directory')));
    } finally {
        assert.equal(path.dirname(root), os.tmpdir());
        await rm(root, { recursive: true, force: true });
    }
});

test('regular-file evidence rejects in-place mutation during inspection', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-file-evidence-'));
    const file = path.join(root, 'input');
    try {
        await writeFile(file, 'original');
        let changed = false;
        await assert.rejects(
            readRegularFile(file, {
                lstat: async (name) => {
                    const metadata = await lstat(name, { bigint: true });
                    if (!changed) {
                        changed = true;
                        await writeFile(file, 'different contents');
                    }
                    return metadata;
                },
            }),
            /changed/,
        );
    } finally {
        assert.equal(path.dirname(root), os.tmpdir());
        await rm(root, { recursive: true, force: true });
    }
});

test('regular-file evidence closes its descriptor after success, inspection failure and read failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-file-evidence-'));
    const file = path.join(root, 'input');
    try {
        await writeFile(file, 'original');
        for (const failure of ['none', 'inspection', 'read']) {
            let closes = 0;
            const result = readRegularFile(file, {
                open: async (name, flags) => {
                    const handle = await open(name, flags);
                    return {
                        stat: () => handle.stat({ bigint: true }),
                        readFile: async () => {
                            if (failure === 'read') throw new Error('read failure');
                            return handle.readFile();
                        },
                        close: async () => {
                            closes++;
                            await handle.close();
                        },
                    };
                },
                lstat: async (name) => {
                    if (failure === 'inspection') throw new Error('inspection failure');
                    return lstat(name, { bigint: true });
                },
            });
            if (failure === 'none') assert.equal((await result).toString(), 'original');
            else await assert.rejects(result, new RegExp(`${failure} failure`));
            assert.equal(closes, 1);
        }
    } finally {
        assert.equal(path.dirname(root), os.tmpdir());
        await rm(root, { recursive: true, force: true });
    }
});
