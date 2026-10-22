import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { isRecord } from '../src/shared/errors.ts';

async function candidate(
    patch: {
        errno?: number;
        acl?: 'empty' | 'present' | 'deny';
        mask?: boolean;
        length?: boolean;
        changed?: boolean;
        relative?: boolean;
        failedClose?: boolean;
        volumeMask?: number;
    } = {},
) {
    const source = await readFile(
        new URL('../src/adapters/macos-deployment-authority.jxa', import.meta.url),
        'utf8',
    ).catch(() => '');
    assert.ok(source, 'concrete macOS evidence producer must exist');
    let snapshots = 0;
    let closed = false;
    const errno = { 0: 0 };
    const data = (bytes: Buffer) => ({
        bytes,
        mutableBytes: bytes,
        length: bytes.length,
        subdataWithRange: (range: { location: number; length: number }) =>
            data(bytes.subarray(range.location, range.location + range.length)),
        replaceBytesInRangeWithBytes: (range: { location: number; length: number }, value: { 0: number }) => {
            if (range.length === 2) bytes.writeUInt16LE(value[0], range.location);
            else bytes.writeUInt32LE(value[0], range.location);
        },
    });
    const common = Buffer.alloc(56);
    common.writeUInt32LE(56, 0);
    common.writeUInt32LE(0x8207800a, 4);
    common.writeUInt32LE(1, 24);
    common.writeUInt32LE(1, 28);
    common.writeUInt32LE(501, 32);
    common.writeUInt32LE(20, 36);
    common.writeUInt32LE(0o100600, 40);
    common.writeBigUInt64LE(18446744073709551615n, 48);
    const details = Buffer.alloc(36);
    details.writeUInt32LE(36, 0);
    details.writeUInt32LE(0x80000000, 4);
    details.writeUInt32LE(0x201, 16);
    details.writeUInt32LE(1, 24);
    details.writeBigUInt64LE(0n, 28);
    const volume = Buffer.alloc(76);
    volume.writeUInt32LE(76, 0);
    volume.writeUInt32LE(0x80000000, 4);
    // xnu-11215.1.10 getvolattrlist returns actual data bits, excluding request-only ATTR_VOL_INFO.
    // https://github.com/apple-oss-distributions/xnu/blob/xnu-11215.1.10/bsd/vfs/vfs_attrlist.c#L1165
    volume.writeUInt32LE(patch.volumeMask ?? 0x00124000, 8);
    volume.writeUInt32LE(0x1000, 24);
    volume.writeUInt32LE(0x300, 32);
    volume.writeUInt32LE(0x300, 48);
    volume.writeInt32LE(8, 60);
    volume.writeUInt32LE(5, 64);
    volume.write('apfs\0', 68);
    const bindings = {
        NSMutableData: { dataWithLength: (length: number) => data(Buffer.alloc(length)) },
        NSMakeRange: (location: number, length: number) => ({ location, length }),
        NSUTF8StringEncoding: 4,
        NSString: {
            alloc: {
                initWithBytesLengthEncoding: (bytes: Buffer, length: number) => ({
                    value: bytes.subarray(0, length).toString('utf8'),
                    isNil: () => false,
                }),
            },
        },
        memcpy: (output: { 0: number }, bytes: Buffer, length: number) => {
            output[0] = length === 1 ? (bytes[0] ?? 0) : bytes.readUInt32LE();
        },
        __error: () => errno,
        open: (_name: string, flags: number) => {
            assert.equal(flags, 0x104);
            return 97;
        },
        close: (fd: number) => {
            assert.equal(fd, 97);
            closed = true;
            return patch.failedClose ? -1 : 0;
        },
        getuid: () => 501,
        geteuid: () => 501,
        fcntl: (fd: number, command: number, storage: Buffer) => {
            assert.equal(fd, 97);
            assert.equal(command, 50);
            storage.write('/owned/use.lock\0');
            return 0;
        },
        fgetattrlist: (fd: number, requested: Buffer, output: Buffer, bound: number, options: number) => {
            assert.equal(fd, 97);
            assert.equal(bound, 512);
            assert.equal(options, 0);
            assert.equal(errno[0], 0);
            const commonMask = requested.readUInt32LE(4);
            const volumeMask = requested.readUInt32LE(8);
            let result: Buffer;
            if (commonMask === 0x8207800a) {
                snapshots++;
                result = Buffer.from(common);
                if (patch.mask) result.writeUInt32LE(0, 4);
                if (patch.length) result.writeUInt32LE(513, 0);
                if (patch.changed && snapshots > 1) result.writeBigUInt64LE(18446744073709551614n, 48);
            } else if (volumeMask === 0x80124000) {
                assert.equal(requested.readUInt32LE(12), 0);
                assert.equal(requested.readUInt32LE(16), 0);
                result = Buffer.from(volume);
                if (patch.relative) result.writeInt32LE(999, 60);
            } else {
                assert.equal(requested.readUInt32LE(16), 0x201);
                result = details;
            }
            result.copy(output);
            return 0;
        },
        acl_get_fd_np: (fd: number, type: number) => {
            assert.equal(fd, 97);
            assert.equal(type, 0x100);
            assert.equal(errno[0], 0);
            errno[0] = patch.errno ?? (patch.acl ? 0 : 2);
            return patch.acl ? { pointer: 1 } : null;
        },
        acl_valid: () => 0,
        acl_get_entry: (_acl: unknown, selector: number, entry: { 0: unknown }) => {
            if (selector === -1 || patch.acl === 'empty') {
                errno[0] = 22;
                return -1;
            }
            entry[0] = { pointer: 2 };
            return 0;
        },
        acl_get_tag_type: (_entry: unknown, tag: { 0: number }) => {
            tag[0] = patch.acl === 'deny' ? 2 : 1;
            return 0;
        },
        acl_free: () => 0,
    };
    try {
        const result: unknown = runInNewContext(`${source}\nrun(['/owned/use.lock']);`, {
            ObjC: { import: () => {}, bindFunction: () => {}, unwrap: (value: { value: string }) => value.value },
            $: bindings,
            Ref: Object.assign(() => ({ 0: null }), { equals: (a: unknown, b: unknown) => a === b }),
        });
        assert.equal(typeof result, 'string');
        const parsed: unknown = JSON.parse(String(result));
        assert.ok(isRecord(parsed));
        return parsed;
    } finally {
        assert.equal(closed, true);
    }
}

test('fixed macOS producer preserves unsigned native file IDs and returns distinct absent, empty and present ACL evidence', async () => {
    const result = await candidate();
    assert.equal(result.inode, '18446744073709551615');
    assert.equal(result.acl, 'absent');
    assert.equal(result.filesystem, 'apfs');
    assert.equal(result.lockCapabilities, true);
    assert.equal((await candidate({ acl: 'empty' })).acl, 'empty');
    assert.equal((await candidate({ acl: 'present' })).acl, 'present');
    assert.equal((await candidate({ acl: 'deny' })).acl, 'deny-only');
});

test('fixed macOS producer refuses native failures, missing masks, oversized buffers, relative escapes and changed descriptors', async () => {
    for (const patch of [
        { errno: 0 },
        { errno: 1 },
        { mask: true },
        { length: true },
        { changed: true },
        { relative: true },
        { failedClose: true },
    ])
        await assert.rejects(candidate(patch), /Deployment native evidence is unavailable/);
});

test('macOS actual volume mask requires every result field and rejects unknown or request-selector result bits', async () => {
    assert.equal((await candidate({ volumeMask: 0x00124000 })).filesystem, 'apfs');
    for (const volumeMask of [0x00120000, 0x00104000, 0x00024000, 0x00124001, 0x80124000])
        await assert.rejects(candidate({ volumeMask }), /Deployment native evidence is unavailable/);
});

test('finite Windows copy source preserves pinned change-time ABI, closed file-only dispatch and checked close boundaries', async () => {
    const source = await readFile(new URL('../src/adapters/windows-deployment-create.cs', import.meta.url), 'utf8');
    assert.match(source, /public static void Copy\(Stream/);
    assert.match(source, /FinishCopyStreams\(FileStream stream, SHA256 hash, Exception primary\)/);
    assert.doesNotMatch(source, /using \(FileStream stream = CopyStream/);
    assert.match(source, /LayoutKind\.Explicit, Size = 40/);
    assert.match(source, /\[FieldOffset\(16\)\] public long lastWrite/);
    assert.match(source, /\[FieldOffset\(24\)\] public long change/);
    assert.match(source, /GetFileInformationByHandleEx\(handle, 0,/);
    assert.match(source, /lastWrite == after\.lastWrite && before\.change == after\.change/);
    assert.match(source, /if \(!CloseHandle\(raw\)\)/);
    assert.match(source, /CreateCopyFileW\(name, 0x40020080, 1, ref attributes, 1,/);
    assert.match(source, /arguments\[0\] == "copy"/);
    assert.match(
        source,
        /DctDeploymentCreate\.Copy\(Console\.OpenStandardInput\(\), Console\.OpenStandardOutput\(\)\)/,
    );
    assert.doesNotMatch(
        source,
        /Json|installation\.json|state\.json|selectedBuildId|Process\.Start|SetNamedSecurityInfo/,
    );
});
