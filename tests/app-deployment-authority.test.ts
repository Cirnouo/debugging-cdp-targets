import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as deployment from '../src/domains/app-deployment.ts';

const sid = 'S-1-5-21-1-2-3-1001';
const file = { device: '4294967295', inode: '18446744073709551615', links: '1', size: '0', directory: false };
const windows = () => ({
    platform: 'win32',
    account: sid,
    owner: sid,
    ...file,
    path: 'C:\\owned\\use.lock',
    protected: true,
    reparse: false,
    dacl: [{ sid, mask: '2032127', flags: 0, type: 0 }],
    filesystem: 'NTFS',
    volumeFlags: 8,
    driveType: 3,
});
function validate(value: unknown, expected: deployment.DeploymentNativeIdentity, ancestor = false) {
    assert.ok('validateDeploymentNativeEntry' in deployment, 'native authority validation must exist');
    const operation = deployment.validateDeploymentNativeEntry;
    assert.equal(typeof operation, 'function');
    if (typeof operation !== 'function') throw new Error('Missing native authority validator.');
    return operation(value, expected, ancestor);
}
const expected = { platform: 'win32' as const, account: sid, path: 'C:\\owned\\use.lock', ...file };

test('Windows authority retains the full unsigned NTFS identity and accepts only the protected SID template', () => {
    assert.doesNotThrow(() => validate(windows(), expected));
    for (const change of [
        { inode: '18446744073709551614' },
        { inode: Number('18446744073709551615') },
        { device: '4294967296' },
        { links: '2' },
        { reparse: true },
        { path: 'C:\\other\\use.lock' },
        { owner: 'S-1-5-21-4' },
        { account: 'S-1-5-21-4' },
        { protected: false },
        { dacl: null },
        { filesystem: 'ReFS' },
        { driveType: 4 },
        { volumeFlags: 0 },
        { volumeFlags: 524296 },
        { dacl: [{ sid: 'S-1-1-0', mask: '2032127', flags: 0, type: 0 }] },
        { dacl: [{ sid, mask: '2032127', flags: 0, type: 5 }] },
        { dacl: [{ sid, mask: '2147483648', flags: 0, type: 0 }] },
    ])
        assert.throws(() => validate({ ...windows(), ...change }, expected), JSON.stringify(change));
});

test('Windows ancestor evidence permits known read traversal but refuses foreign mutation and unknown inheritance', () => {
    const value = {
        ...windows(),
        protected: false,
        owner: 'S-1-5-18',
        dacl: [
            { sid: 'S-1-5-18', mask: '2032127', flags: 3, type: 0 },
            { sid: 'S-1-1-0', mask: '1179817', flags: 0, type: 0 },
        ],
    };
    assert.doesNotThrow(() => validate(value, expected, true));
    for (const mask of ['64', '65536', '2', '262144', '524288'])
        assert.throws(() =>
            validate({ ...value, dacl: [{ sid: 'S-1-1-0', mask, flags: 0, type: 0 }] }, expected, true),
        );
    assert.throws(() => validate({ ...value, dacl: [{ sid, mask: '2032127', flags: 32, type: 0 }] }, expected, true));
});

test('Windows files may inherit only the verified protected-parent template; unprotected explicit grants fail', () => {
    const inherited = { ...windows(), protected: false, dacl: [{ sid, mask: '2032127', flags: 16, type: 0 }] };
    assert.doesNotThrow(() => validate(inherited, expected));
    assert.throws(() => validate({ ...inherited, dacl: [{ sid, mask: '2032127', flags: 0, type: 0 }] }, expected));
    assert.throws(() => validate({ ...inherited, directory: true }, { ...expected, directory: true }));
    assert.doesNotThrow(() =>
        validate(
            { ...windows(), directory: true, dacl: [{ sid, mask: '2032127', flags: 3, type: 0 }] },
            { ...expected, directory: true },
        ),
    );
    assert.throws(() => validate({ ...windows(), directory: true }, { ...expected, directory: true }));
    assert.doesNotThrow(() =>
        validate(
            { ...windows(), directory: true, links: '3', dacl: [{ sid, mask: '2032127', flags: 3, type: 0 }] },
            { ...expected, directory: true, links: '2' },
        ),
    );
});

test('macOS authority requires exact UID identity, absent or empty ACL, and writable local ownership-enabled APFS', () => {
    const native = {
        platform: 'darwin',
        account: '501',
        owner: '501',
        ...file,
        device: '1',
        inode: '9007199254740993',
        path: '/owned/use.lock',
        mode: 0o600,
        acl: 'absent',
        filesystem: 'apfs',
        mountFlags: 4096,
        lockCapabilities: true,
    };
    const wanted = {
        platform: 'darwin' as const,
        account: '501',
        path: '/owned/use.lock',
        ...file,
        device: '1',
        inode: '9007199254740993',
    };
    assert.doesNotThrow(() => validate(native, wanted));
    assert.doesNotThrow(() => validate({ ...native, acl: 'empty' }, wanted));
    for (const change of [
        { inode: '9007199254740992' },
        { owner: '0' },
        { mode: 0o660 },
        { acl: 'present' },
        { acl: 'error' },
        { filesystem: 'hfs' },
        { mountFlags: 0 },
        { mountFlags: 4097 },
        { mountFlags: 2101248 },
        { lockCapabilities: false },
    ])
        assert.throws(() => validate({ ...native, ...change }, wanted), JSON.stringify(change));
});

test('Linux system readers do not gain root writer authority from installation kind or environment', () => {
    assert.ok('validateDeploymentUnixEntry' in deployment);
    const check = deployment.validateDeploymentUnixEntry;
    assert.equal(typeof check, 'function');
    if (typeof check !== 'function') throw new Error('Missing Unix permission policy.');
    const entry = { uid: '0', gid: '0', mode: 0o644, directory: false };
    assert.doesNotThrow(() => check(entry, '1000', 'system', 'document', false));
    for (const patch of [{ uid: '1000' }, { gid: '1000' }, { mode: 0o664 }, { mode: 0o4644 }])
        assert.throws(() => check({ ...entry, ...patch }, '1000', 'system', 'document', false));
    assert.doesNotThrow(() => check({ ...entry, mode: 0o600 }, '1000', 'system', 'operation', false));
    assert.throws(() => check({ ...entry, mode: 0o644 }, '1000', 'system', 'operation', false));
    assert.doesNotThrow(() =>
        check({ uid: '1000', gid: '1000', mode: 0o700, directory: true }, '1000', 'private', 'directory', false),
    );
    assert.throws(() =>
        check({ uid: '1000', gid: '1000', mode: 0o755, directory: true }, '1000', 'private', 'directory', false),
    );
    assert.doesNotThrow(() =>
        check({ uid: '0', gid: '0', mode: 0o755, directory: true }, '1000', 'private', 'directory', true),
    );
    for (const patch of [{ uid: '1001' }, { mode: 0o777 }, { mode: 0o1777 }])
        assert.throws(() =>
            check({ uid: '0', gid: '0', mode: 0o755, directory: true, ...patch }, '1000', 'private', 'directory', true),
        );
});
