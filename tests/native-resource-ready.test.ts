import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../src/shared/errors.ts';
import { waitForResourceFile } from './fixtures/native-resource-cleanup.ts';
import { publishNativeResourcePid } from './fixtures/native-resource-ready.ts';

for (const role of ['root', 'middle', 'late'] as const) {
    test(`actual ${role} producer publishes no PID-ready pathname before complete write and close`, {
        timeout: 10_000,
    }, async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-resources-'));
        const abort = new AbortController();
        let release = () => {};
        let finished: Promise<[number | null, NodeJS.Signals | null]> | undefined;
        let reading: Promise<string> | undefined;
        try {
            await Promise.all(
                ['root-release', 'launch-late', 'finish'].map((name) =>
                    writeFile(path.join(directory, name), 'ordinary test release'),
                ),
            );
            if (role === 'root') await writeFile(path.join(directory, 'middle-ready'), '1234');
            if (role === 'middle') await writeFile(path.join(directory, 'late-ready'), '1234');
            const final = path.join(directory, `${role}-ready`);
            let reads = 0;
            reading = waitForResourceFile(directory, `${role}-ready`, abort.signal).then(() => {
                reads++;
                return readFile(final, 'utf8');
            });
            void reading.catch(() => {});
            const child = spawn(
                process.execPath,
                [
                    '--import',
                    new URL('./fixtures/native-resource-ready-preload.ts', import.meta.url).href,
                    fileURLToPath(new URL('./fixtures/native-resource-child.ts', import.meta.url)),
                    role,
                    directory,
                ],
                { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
            );
            let released = false;
            release = () => {
                if (!released) {
                    released = true;
                    child.stdin.end('release complete PID write\n');
                }
            };
            finished = new Promise((resolve, reject) => {
                child.once('close', (code, signal) => resolve([code, signal]));
                child.once('error', reject);
            });
            void finished.catch(() => {});
            let stderr = '';
            child.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
            });
            const [chunk] = await once(child.stdout, 'data');
            assert.ok(Buffer.isBuffer(chunk));
            const receipt: unknown = JSON.parse(chunk.toString().trim());
            assert.ok(isRecord(receipt) && receipt.event === 'opened-before-write' && typeof receipt.name === 'string');
            assert.equal(
                await readFile(path.join(directory, receipt.name), 'utf8'),
                '',
                'Gate holds a real open file before any PID bytes are written.',
            );
            const absent = await access(final).then(
                () => false,
                (error: unknown) => {
                    assert.ok(isRecord(error) && error.code === 'ENOENT');
                    return true;
                },
            );
            const prematurelyRead = absent ? undefined : await reading;
            assert.equal(
                absent,
                true,
                `PID-ready was visible while write held; one-shot consumer observed ${JSON.stringify(prematurelyRead)}.`,
            );
            assert.equal(reads, 0, 'Real readiness watcher/reader must remain pending.');
            release();
            assert.equal(await reading, String(child.pid));
            assert.equal(reads, 1, 'The unchanged consumer reads PID exactly once; no retry.');
            const [code, signal] = await finished;
            assert.equal(code, 0, stderr);
            assert.equal(signal, null);
            assert.ok(!(await readdir(directory)).some((name) => name.startsWith(`.${role}-ready-`)));
        } finally {
            release();
            await finished;
            abort.abort();
            await reading?.catch(() => {});
            await rm(directory, { recursive: true, force: true });
        }
    });
}

for (const operation of ['write', 'rename'] as const) {
    test(`PID-ready ${operation} failure retains the original error and only a private temporary file`, async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-resources-'));
        const primary = new Error(`Controlled ${operation} failure.`);
        let writes = 0;
        let renames = 0;
        try {
            await assert.rejects(
                publishNativeResourcePid(directory, 'late', 1234, {
                    async writeFile(file, data, options) {
                        writes++;
                        await writeFile(file, operation === 'write' ? '' : data, options);
                        if (operation === 'write') throw primary;
                    },
                    async rename(source, destination) {
                        renames++;
                        if (operation === 'rename') throw primary;
                        await rename(source, destination);
                    },
                }),
                (error: unknown) => error === primary,
            );
            await assert.rejects(access(path.join(directory, 'late-ready')), { code: 'ENOENT' });
            const names = await readdir(directory);
            assert.equal(names.length, 1);
            assert.ok(names[0]?.startsWith('.late-ready-'));
            assert.equal(writes, 1);
            assert.equal(renames, operation === 'write' ? 0 : 1);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
}
