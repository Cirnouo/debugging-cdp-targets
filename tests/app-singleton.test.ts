import assert from 'node:assert/strict';
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acquireAppSingleton, appCoordinationPaths } from '../src/adapters/app-singleton.ts';

test('coordination namespace depends only on native account home across App data and executable roots', () => {
    const first = appCoordinationPaths('/native/account', 'linux');
    assert.equal(first.directory, '/native/account/.debugging-cdp-targets/singleton');
    assert.equal(first.lockFile, `${first.directory}/owner.lock`);
    assert.equal(first.activation, `${first.directory}/activate.sock`);
    assert.match(
        appCoordinationPaths('C:\\Users\\native-account', 'win32').activation,
        /^\\\\\.\\pipe\\debugging-cdp-targets-[a-f0-9]{32}$/,
    );
});

test('an acquired advisory descriptor stays open and its inode is never unlinked or replaced', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'dct-singleton-'));
    let descriptor: number | undefined;
    try {
        const owner = acquireAppSingleton({
            nativeAccountHome: home,
            tryLock(fd) {
                descriptor = fd;
                return true;
            },
        });
        assert.equal(owner.ownsSingleton, true);
        assert.notEqual(descriptor, undefined);
        if (descriptor === undefined) throw new Error('No descriptor observed.');
        const identity = fstatSync(descriptor);
        assert.equal(identity.isFile(), true);
        assert.equal(existsSync(owner.paths.lockFile), true);
        const losing = acquireAppSingleton({ nativeAccountHome: home, tryLock: () => false });
        assert.equal(losing.ownsSingleton, false);
        assert.equal(fstatSync(descriptor).ino, identity.ino);
        const verification = openSync(owner.paths.lockFile, 'r');
        try {
            assert.equal(fstatSync(verification).ino, identity.ino);
        } finally {
            closeSync(verification);
        }
    } finally {
        // Fixture-only descriptor disposal; the production owner exposes no release-before-exit API.
        if (descriptor !== undefined) closeSync(descriptor);
        rmSync(home, { recursive: true, force: true });
    }
});
