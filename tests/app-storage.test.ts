import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareAppDataDirectory, selectAppDataDirectory } from '../src/adapters/app-storage.ts';

test('installed and portable data roots are explicit and never merge', () => {
    assert.equal(
        selectAppDataDirectory({ kind: 'installed', userDataDirectory: '/users/one/app-data' }),
        '/users/one/app-data',
    );
    assert.equal(
        selectAppDataDirectory({
            kind: 'portable',
            executablePath: '/opt/dct/debugging-cdp-targets',
            platform: 'linux',
        }),
        '/opt/dct/data',
    );
    assert.equal(
        selectAppDataDirectory({
            kind: 'portable',
            executablePath: '/opt/DCT.app/Contents/MacOS/DCT',
            platform: 'darwin',
        }),
        '/opt/data',
    );
    assert.equal(
        selectAppDataDirectory({ kind: 'portable', executablePath: 'C:\\portable\\DCT.exe', platform: 'win32' }),
        'C:\\portable\\data',
    );
    assert.throws(() => selectAppDataDirectory({ kind: 'installed', userDataDirectory: 'relative' }));
    assert.throws(() =>
        selectAppDataDirectory({ kind: 'portable', executablePath: '/not-a-bundle/DCT', platform: 'darwin' }),
    );
});

test('a later App cannot create its selected data root without owning the singleton', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'dct-app-data-'));
    try {
        const selected = path.join(temporary, 'data');
        await assert.rejects(prepareAppDataDirectory(selected, { ownsSingleton: false }), /singleton/i);
        assert.deepEqual(await readdir(temporary), []);
        assert.equal(await prepareAppDataDirectory(selected, { ownsSingleton: true }), selected);
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
});
