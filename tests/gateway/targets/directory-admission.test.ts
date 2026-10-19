import assert from 'node:assert/strict';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { createDirectoryRuntimeFixture } from '../../fixtures/connection-directory-runtime.ts';

test('prevalidation rejects missing binding and invalid official options before directory acquisition', async (t) => {
    const f = await createDirectoryRuntimeFixture(t);
    const options = f.dataOptions();
    await assert.rejects(
        f.runtime.controller.start({ ...options, launch: { executable: process.execPath } }),
        /binding|dataDir/i,
    );
    await assert.rejects(f.runtime.controller.start({ ...options, mcpArgs: ['--browserUrl=http://example.com'] }));
    await assert.rejects(lstat(path.join(f.parent, 'profile')), { code: 'ENOENT' });
    assert.equal(f.launches.length, 0);
});

test('cancellation before acquisition leaves no directory evidence or filesystem effects', async (t) => {
    const f = await createDirectoryRuntimeFixture(t);
    const abort = new AbortController();
    const reason = new Error('cancelled before start');
    abort.abort(reason);
    await assert.rejects(
        f.runtime.controller.start(f.dataOptions(), { ...f.context, signal: abort.signal }),
        (error: unknown) => error === reason,
    );
    assert.deepEqual(f.evidence, []);
    assert.deepEqual(await readdir(f.parent), []);
    assert.equal(f.launches.length, 0);
});
