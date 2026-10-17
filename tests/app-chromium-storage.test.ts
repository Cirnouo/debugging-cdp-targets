import assert from 'node:assert/strict';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createAppChromiumStorage } from '../src/adapters/app-chromium-storage.ts';

test('synchronous Chromium storage uses unique existing roots independently for each App process', async () => {
    const first = createAppChromiumStorage();
    const second = createAppChromiumStorage();
    try {
        assert.equal(first instanceof Promise, false);
        assert.notEqual(first.directory, second.directory);
        for (const selected of [first, second]) {
            assert.equal(path.dirname(selected.userData), selected.directory);
            assert.equal(path.dirname(selected.sessionData), selected.directory);
            assert.notEqual(selected.userData, selected.sessionData);
            for (const directory of [selected.directory, selected.userData, selected.sessionData]) {
                assert.equal(lstatSync(directory).isDirectory(), true);
                assert.equal(lstatSync(directory).isSymbolicLink(), false);
            }
        }
        assert.equal(await first.cleanup(), true);
        assert.equal(existsSync(first.directory), false);
        assert.equal(existsSync(second.directory), true);
        assert.equal(await first.cleanup(), true);
    } finally {
        await first.cleanup();
        await second.cleanup();
    }
    assert.equal(existsSync(second.directory), false);
});
