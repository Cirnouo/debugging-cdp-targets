import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadAppAdvisoryLock } from '../src/adapters/app-native.ts';
import { parseAppNativeEvidence } from '../src/domains/app-release.ts';
import { isRecord } from '../src/shared/errors.ts';

async function worker(directory: string, retain: (close: () => Promise<void>) => void) {
    const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./fixtures/deployment-lock.ts', import.meta.url)), directory],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    const exited = once(child, 'exit');
    const stopped = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.once('error', () => {
            if (child.pid === undefined) resolve();
        });
    });
    async function close() {
        const results = await Promise.allSettled([
            Promise.resolve().then(() => {
                if (child.connected) child.disconnect();
            }),
            exited.then(([code, signal]) => {
                assert.equal(code, 0, stderr);
                assert.equal(signal, null);
            }),
            stopped,
        ]);
        const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
        if (failures.length > 0) throw new AggregateError(failures, 'Lock fixture cleanup failed.');
    }
    retain(close);
    const ready = await Promise.race([
        once(child, 'message'),
        exited.then(() => {
            throw new Error(`Lock fixture exited: ${stderr}`);
        }),
    ]);
    assert.deepEqual(ready[0], { ready: true });
    let sequence = 0;
    return {
        async command(value: Record<string, unknown>) {
            const id = ++sequence;
            const response = once(child, 'message');
            child.send({ ...value, id });
            const [message] = await Promise.race([
                response,
                exited.then(() => {
                    throw new Error(`Lock fixture exited: ${stderr}`);
                }),
            ]);
            if (!isRecord(message) || message.id !== id) throw new Error('Wrong fixture response.');
            if (typeof message.locked !== 'boolean' && message.released !== true)
                throw new Error('Malformed fixture response.');
            return { locked: message.locked, lease: id };
        },
        close,
    };
}

test('two native processes share read-only use but independently exclude writer and deletion without inode replacement', {
    timeout: 20000,
}, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dct-deployment-lock-'));
    const cleanups: (() => Promise<void>)[] = [];
    const failures: unknown[] = [];
    try {
        await writeFile(path.join(directory, 'operation.lock'), '', { flag: 'wx', mode: 0o600 });
        await writeFile(path.join(directory, 'use.lock'), '', { flag: 'wx', mode: 0o600 });
        const original = await lstat(path.join(directory, 'use.lock'), { bigint: true });
        const first = await worker(directory, (close) => cleanups.push(close));
        const second = await worker(directory, (close) => cleanups.push(close));
        const readerA = await first.command({ type: 'acquire', file: 'use.lock', shared: true });
        const readerB = await second.command({ type: 'acquire', file: 'use.lock', shared: true });
        assert.equal(readerA.locked, true);
        assert.equal(readerB.locked, true);
        const operation = await first.command({ type: 'acquire', file: 'operation.lock', shared: false });
        assert.equal(operation.locked, true);
        assert.equal((await second.command({ type: 'acquire', file: 'operation.lock', shared: false })).locked, false);
        assert.equal((await second.command({ type: 'acquire', file: 'use.lock', shared: false })).locked, false);
        await first.command({ type: 'release', lease: readerA.lease });
        assert.equal((await first.command({ type: 'acquire', file: 'use.lock', shared: false })).locked, false);
        await second.command({ type: 'release', lease: readerB.lease });
        const deletion = await second.command({ type: 'acquire', file: 'use.lock', shared: false });
        assert.equal(deletion.locked, true);
        assert.equal((await first.command({ type: 'acquire', file: 'use.lock', shared: true })).locked, false);
        await second.command({ type: 'release', lease: deletion.lease });
        const newReader = await first.command({ type: 'acquire', file: 'use.lock', shared: true });
        assert.equal(newReader.locked, true);
        await first.command({ type: 'release', lease: newReader.lease });
        await first.command({ type: 'release', lease: operation.lease });
        const nextOperation = await second.command({ type: 'acquire', file: 'operation.lock', shared: false });
        assert.equal(nextOperation.locked, true);
        await second.command({ type: 'release', lease: nextOperation.lease });
        const current = await lstat(path.join(directory, 'use.lock'), { bigint: true });
        assert.equal(current.dev, original.dev);
        assert.equal(current.ino, original.ino);
        assert.equal(await readFile(path.join(directory, 'use.lock'), 'utf8'), '');
    } catch (error) {
        failures.push(error);
    }
    const results = await Promise.allSettled(cleanups.map((close) => close()));
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    try {
        await rm(directory, { recursive: true });
    } catch (error) {
        failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Lock fixture test and cleanup failed.');
});

test('public native adapter rejects malformed lock modes and descriptors', async () => {
    const lock = await loadAppAdvisoryLock(
        parseAppNativeEvidence(
            JSON.parse(await readFile(new URL('../tooling/app-native-release.json', import.meta.url), 'utf8')),
        ),
    );
    assert.throws(() => lock(-1));
    assert.throws(() => lock(1.5));
    const directory = await mkdtemp(path.join(tmpdir(), 'dct-deployment-mode-'));
    const handle = await open(path.join(directory, 'lock'), 'wx', 0o600);
    try {
        assert.throws(() => Reflect.apply(lock, undefined, [handle.fd, { shared: 'yes' }]));
        assert.throws(() => Reflect.apply(lock, undefined, [handle.fd, { shared: true, upgrade: true }]));
        assert.throws(() =>
            Reflect.apply(lock, undefined, [
                handle.fd,
                Object.assign(Object.create({ shared: true }), { wrong: false }),
            ]),
        );
    } finally {
        await handle.close();
        await rm(directory, { recursive: true });
    }
});
