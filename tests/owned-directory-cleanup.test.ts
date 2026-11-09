import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { errorCode } from '../src/shared/errors.ts';
import { captureOwnedDirectoryCleanup } from './fixtures/owned-directory-cleanup.ts';

async function ownedRoot(t: TestContext) {
    const temporary = await realpath(os.tmpdir());
    const root = await realpath(await mkdtemp(path.join(temporary, 'dct-fixture-cleanup-test-')));
    assert.equal(path.dirname(root), temporary);
    t.after(async () => {
        assert.equal(await realpath(root), root);
        await rm(root, { recursive: true });
    });
    return root;
}

test('owned directory cleanup retries removal after a real transient ENOTEMPTY', async (t) => {
    const root = await ownedRoot(t);
    const directory = path.join(root, 'fixture');
    const child = path.join(directory, 'leftover');
    await mkdir(directory);
    const cleanup = await captureOwnedDirectoryCleanup(directory);
    await writeFile(child, 'owned fixture data');
    let attempts = 0;

    await cleanup(async (target) => {
        assert.equal(target, directory);
        attempts++;
        try {
            await rmdir(target);
        } catch (error) {
            assert.ok(error instanceof Error && 'code' in error);
            assert.equal(error.code, 'ENOTEMPTY');
            await unlink(child);
            throw error;
        }
    });

    assert.equal(attempts, 2);
    await assert.rejects(lstat(directory), { code: 'ENOENT' });
});

test('owned directory cleanup refuses a replacement during backoff', async (t) => {
    const root = await ownedRoot(t);
    const directory = path.join(root, 'fixture');
    const original = path.join(root, 'original');
    const replacement = path.join(root, 'replacement');
    await mkdir(directory);
    const cleanup = await captureOwnedDirectoryCleanup(directory);
    await writeFile(path.join(directory, 'leftover'), 'owned fixture data');
    await mkdir(replacement);
    await writeFile(path.join(replacement, 'marker'), 'replacement data');
    let initialError: unknown;
    let attempts = 0;

    await assert.rejects(
        cleanup(
            async (target) => {
                assert.equal(target, directory);
                attempts++;
                try {
                    await rmdir(target);
                } catch (error) {
                    initialError = error;
                    throw error;
                }
            },
            async (milliseconds) => {
                assert.equal(milliseconds, 10);
                await rename(directory, original);
                await rename(replacement, directory);
            },
        ),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors.length, 2);
            assert.equal(errorCode(initialError), 'ENOTEMPTY');
            assert.equal(error.errors[0], initialError);
            const terminal: unknown = error.errors[1];
            assert.ok(terminal instanceof Error);
            assert.match(terminal.message, /Owned fixture directory identity changed/);
            assert.equal(error.cause, terminal);
            return true;
        },
    );

    assert.equal(attempts, 1);
    assert.equal(await readFile(path.join(directory, 'marker'), 'utf8'), 'replacement data');
    assert.equal(await readFile(path.join(original, 'leftover'), 'utf8'), 'owned fixture data');
});

test('owned directory cleanup preserves every real ENOTEMPTY when the retries run out', async (t) => {
    const root = await ownedRoot(t);
    const directory = path.join(root, 'fixture');
    const child = path.join(directory, 'leftover');
    await mkdir(directory);
    const cleanup = await captureOwnedDirectoryCleanup(directory);
    await writeFile(child, 'owned fixture data');
    const removalErrors: unknown[] = [];
    const delays: number[] = [];

    await assert.rejects(
        cleanup(
            async (target) => {
                assert.equal(target, directory);
                try {
                    await rmdir(target);
                } catch (error) {
                    removalErrors.push(error);
                    throw error;
                }
            },
            async (milliseconds) => {
                delays.push(milliseconds);
            },
        ),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors.length, 3);
            assert.deepEqual(removalErrors.map(errorCode), ['ENOTEMPTY', 'ENOTEMPTY', 'ENOTEMPTY']);
            for (const [index, removalError] of removalErrors.entries()) {
                assert.equal(error.errors[index], removalError);
            }
            assert.equal(error.cause, removalErrors[2]);
            return true;
        },
    );

    assert.deepEqual(delays, [10, 25]);
    assert.equal(await readFile(child, 'utf8'), 'owned fixture data');
});
