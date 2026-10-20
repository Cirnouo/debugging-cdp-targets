import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { after, mock, test } from 'node:test';

const forbidden = () => {
    throw new Error('Real native/process execution is forbidden in deployment protocol tests.');
};
mock.method(childProcess, 'spawn', forbidden);
const nativeSpawn = Object.getOwnPropertyDescriptor(childProcess.ChildProcess.prototype, 'spawn');
assert.ok(nativeSpawn);
Object.defineProperty(childProcess.ChildProcess.prototype, 'spawn', { ...nativeSpawn, value: forbidden });
mock.method(childProcess, 'execFile', forbidden);
mock.method(process, 'dlopen', forbidden);
syncBuiltinESMExports();
after(() => {
    Object.defineProperty(childProcess.ChildProcess.prototype, 'spawn', nativeSpawn);
    mock.restoreAll();
    syncBuiltinESMExports();
});
const {
    packWindowsDeploymentQueries,
    decodeWindowsDeploymentQuery,
    decodeWindowsDeploymentFacts,
    encodeWindowsDeploymentMutation,
    decodeWindowsDeploymentMutation,
    encodeWindowsDeploymentCopyHeader,
    decodeWindowsDeploymentCopyHeader,
    decodeWindowsDeploymentCopyReply,
    preflightWindowsDeploymentCopy,
} = await import('../src/adapters/windows-deployment-protocol.ts');

test('query codec emits independently specified little-endian UTF-8 bytes', () => {
    const batches = packWindowsDeploymentQueries(['C:\\a']);
    assert.equal(batches.length, 1);
    assert.equal(batches[0]?.toString('hex'), '444354515259310a0100000004000000433a5c61');
});

test('mutation request has independently fixed eight-field UTF-8 bytes and exact EOF', () => {
    const fields = ['create-root', 'C:\\owned', '', '', '1', '', '', '2'];
    const bytes = encodeWindowsDeploymentMutation(fields);
    assert.equal(
        bytes.toString('hex'),
        '4443544d5554310a080000000b0000006372656174652d726f6f7408000000433a5c6f776e65640000000000000000010000003100000000000000000100000032',
    );
    assert.deepEqual(decodeWindowsDeploymentMutation(bytes), fields);
    assert.throws(() => decodeWindowsDeploymentMutation(bytes.subarray(0, bytes.length - 1)));
    assert.throws(() => decodeWindowsDeploymentMutation(Buffer.concat([bytes, Buffer.from([0])])));
    for (const index of [4, 7]) {
        const missing = [...fields];
        missing[index] = '';
        assert.throws(() => encodeWindowsDeploymentMutation(missing));
    }
    const long = [...fields];
    long[1] = `C:\\${Array(60).fill('r'.repeat(200)).join('\\')}`;
    assert.deepEqual(decodeWindowsDeploymentMutation(encodeWindowsDeploymentMutation(long)), long);
    for (const [index, value] of [
        [0, 'unknown'],
        [4, '01'],
        [4, '18446744073709551616'],
        [7, '0'],
        [2, 'x'],
    ] as const) {
        const invalid = [...fields];
        invalid[index] = value;
        assert.throws(() => encodeWindowsDeploymentMutation(invalid));
    }
    for (const valid of [
        ['create-directory', 'C:\\owned', '.deployment', '', '1', '2', '', '3'],
        ['publish', 'C:\\owned', 'source', 'target', '1', '2', '3', '4'],
    ])
        assert.deepEqual(decodeWindowsDeploymentMutation(encodeWindowsDeploymentMutation(valid)), valid);
});

const copyStage = '.staging/0dd7224c-51a2-41b3-914d-01171c139ac2/payload';
const copyManifest = Buffer.from('{"schemaVersion":1,"platform":"win32","architecture":"x64","entries":[]}\n');
const copyParents = [
    { relative: '', inode: '2' },
    { relative: '.staging', inode: '3' },
    { relative: copyStage.slice(0, -8), inode: '4' },
    { relative: copyStage, inode: '5' },
];

test('finite copy header has independently specified bytes, exact protected-parent identities and manifest digest', () => {
    const header = encodeWindowsDeploymentCopyHeader({
        root: 'C:\\owned',
        stage: copyStage,
        device: '1',
        parents: copyParents,
        entries: [],
        manifest: copyManifest,
    });
    assert.equal(
        header.toString('hex'),
        '444354435059310a1f01000008000000433a5c6f776e6564350000002e73746167696e672f30646437323234632d353161322d343162332d393134642d3031313731633133396163322f7061796c6f6164010000000000000004000000000000000200000000000000080000002e73746167696e6703000000000000002d0000002e73746167696e672f30646437323234632d353161322d343162332d393134642d3031313731633133396163320400000000000000350000002e73746167696e672f30646437323234632d353161322d343162332d393134642d3031313731633133396163322f7061796c6f616405000000000000000000000049000000ddc1f4326e24a038cb8d4e67c8f31628e2c6752158b56bd64b75a46664bc7afe',
    );
    assert.deepEqual(decodeWindowsDeploymentCopyHeader(header), {
        root: 'C:\\owned',
        stage: copyStage,
        device: '1',
        parents: copyParents,
        entries: [],
        manifestLength: 73,
        manifestSha256: 'ddc1f4326e24a038cb8d4e67c8f31628e2c6752158b56bd64b75a46664bc7afe',
    });
    for (const bytes of [header.subarray(0, header.length - 1), Buffer.concat([header, Buffer.from([0])])])
        assert.throws(() => decodeWindowsDeploymentCopyHeader(bytes));
});

test('copy reply requires exact relative inventory, type, length and unsigned IDs without a grant field', () => {
    const header = decodeWindowsDeploymentCopyHeader(
        encodeWindowsDeploymentCopyHeader({
            root: 'C:\\owned',
            stage: copyStage,
            device: '1',
            parents: copyParents,
            entries: [],
            manifest: copyManifest,
        }),
    );
    const bytes = Buffer.from(
        '444354435052310a01000000150000007061796c6f61642d6d616e69666573742e6a736f6e01000000000000000900000000000000014900000000000000',
        'hex',
    );
    assert.deepEqual(decodeWindowsDeploymentCopyReply(bytes, header), [
        { path: 'payload-manifest.json', type: 'file', device: '1', inode: '9', bytes: 73 },
    ]);
    for (const mutate of [
        (value: Buffer) => value.writeUInt32LE(2, 8),
        (value: Buffer) => value.writeBigUInt64LE(0n, 45),
        (value: Buffer) => value.writeBigUInt64LE(2n, 37),
        (value: Buffer) => value.writeUInt8(0, 53),
    ]) {
        const invalid = Buffer.from(bytes);
        mutate(invalid);
        assert.throws(() => decodeWindowsDeploymentCopyReply(invalid, header));
    }
    assert.throws(() => decodeWindowsDeploymentCopyReply(Buffer.concat([bytes, Buffer.from([1])]), header));
});

test('copy preflight refuses incomplete parent identity, canonical mismatch, links, count and byte overflow', () => {
    const base = {
        root: 'C:\\owned',
        stage: copyStage,
        device: '1',
        parents: copyParents,
        entries: [],
        manifest: copyManifest,
    };
    assert.throws(() => encodeWindowsDeploymentCopyHeader({ ...base, parents: copyParents.slice(1) }));
    assert.throws(() =>
        encodeWindowsDeploymentCopyHeader({
            ...base,
            parents: copyParents.map((parent) => ({ ...parent, inode: '0' })),
        }),
    );
    assert.throws(() =>
        preflightWindowsDeploymentCopy(base.root, base.stage, [], Buffer.from(copyManifest.toString().trimEnd())),
    );
    for (const entries of [
        [{ type: 'file', path: 'file', bytes: 2 * 1024 ** 3 + 1, sha256: 'a'.repeat(64), executableBits: null }],
        [{ type: 'symlink', path: 'link', target: 'file' }],
        Array.from({ length: 4097 }, (_, index) => ({
            type: 'file',
            path: `f${String(index).padStart(4, '0')}`,
            bytes: 0,
            sha256: 'a'.repeat(64),
            executableBits: null,
        })),
        Array.from({ length: 5 }, (_, index) => ({
            type: 'file',
            path: `f${index}`,
            bytes: 2 * 1024 ** 3,
            sha256: 'a'.repeat(64),
            executableBits: null,
        })),
    ]) {
        const manifest = Buffer.from(
            `${JSON.stringify({ schemaVersion: 1, platform: 'win32', architecture: 'x64', entries })}\n`,
        );
        assert.throws(() =>
            Reflect.apply(preflightWindowsDeploymentCopy, undefined, [base.root, base.stage, entries, manifest]),
        );
    }
});

// Independent finite native reply fixture; no production encoder computes expected bytes.
function facts(paths: readonly string[]) {
    const parts = [Buffer.from('DCTQRS1\n'), Buffer.from([paths.length, 0, 0, 0])];
    const text = (value: string) => {
        const body = Buffer.from(value);
        const length = Buffer.alloc(4);
        length.writeUInt32LE(body.length);
        parts.push(length, body);
    };
    for (const name of paths) {
        for (const value of ['S-1-5-21-101', 'S-1-5-21-101', name, '4294967295', '18446744073709551615', '1', '9'])
            text(value);
        parts.push(Buffer.from([0, 1, 0]));
        text('NTFS');
        parts.push(Buffer.from('080000000300000001000000', 'hex'));
        text('S-1-5-21-101');
        parts.push(Buffer.from('ff011f000000000000000000', 'hex'));
    }
    return Buffer.concat(parts);
}

test('native reply preserves unsigned identity and exact bijection; unsafe facts are not blessed', () => {
    const decoded = decodeWindowsDeploymentFacts(facts(['C:\\a']), ['C:\\a']);
    assert.deepEqual(decoded, [
        {
            platform: 'win32',
            account: 'S-1-5-21-101',
            owner: 'S-1-5-21-101',
            path: 'C:\\a',
            device: '4294967295',
            inode: '18446744073709551615',
            links: '1',
            size: '9',
            directory: false,
            protected: true,
            reparse: false,
            filesystem: 'NTFS',
            volumeFlags: 8,
            driveType: 3,
            dacl: [{ sid: 'S-1-5-21-101', mask: '2032127', flags: 0, type: 0 }],
        },
    ]);
    for (const [bytes, paths] of [
        [facts(['C:\\b']), ['C:\\a']],
        [facts(['C:\\a', 'C:\\a']), ['C:\\a', 'C:\\b']],
        [facts(['C:\\b', 'C:\\a']), ['C:\\a', 'C:\\b']],
        [Buffer.concat([facts(['C:\\a']), Buffer.from([0])]), ['C:\\a']],
    ] as const)
        assert.throws(() => decodeWindowsDeploymentFacts(bytes, paths));
});

test('query count cap packs 129 short unique paths into 128 and one', () => {
    const names = Array.from({ length: 129 }, (_, index) => `C:\\f${index}`);
    const batches = packWindowsDeploymentQueries(names);
    assert.deepEqual(
        batches.map((batch) => batch.readUInt32LE(8)),
        [128, 1],
    );
    assert.deepEqual(batches.flatMap(decodeWindowsDeploymentQuery), names);
});

test('query byte cap includes repeated long roots and framing before count cap', () => {
    const root = `C:\\${Array(40).fill('r'.repeat(201)).join('\\')}`;
    const names = Array.from(
        { length: 128 },
        (_, index) => `${root}\\${String(index).padStart(3, '0')}${'f'.repeat(197)}`,
    );
    const batches = packWindowsDeploymentQueries(names);
    assert.deepEqual(
        batches.map((batch) => batch.readUInt32LE(8)),
        [126, 2],
    );
    assert.ok(batches.every((batch) => batch.length <= 1024 * 1024));
    assert.deepEqual(batches.flatMap(decodeWindowsDeploymentQuery), names);
});

test('query reply representability derives actual UTF-8 field framing and ACE maxima before any batch', () => {
    // Worst record overhead = 26127 bytes: seven strings, booleans, filesystem,
    // volume fields, and 128 ACEs with SID<=184 plus its exact three uint fields.
    const name = `C:\\${Array.from({ length: 60 }, (_, index) => '界'.repeat(216) + 'a'.repeat(index < 47 ? 8 : 7)).join('\\')}`;
    assert.equal(Buffer.byteLength(name), 39409);
    assert.ok(name.length < 32768);
    assert.equal(packWindowsDeploymentQueries([name]).length, 1);
    assert.throws(() => packWindowsDeploymentQueries(['C:\\normal', `${name}a`]), /reply|record/);
});

test('query rejects one oversized record, noncanonical paths and duplicate coverage', () => {
    for (const names of [[`C:\\${'x'.repeat(32766)}`], ['C:\\x\\..\\a'], ['C:\\a', 'C:\\a'], ['C:\\a\0b']])
        assert.throws(() => packWindowsDeploymentQueries(names));
});

test('finite codecs refuse Windows device names, trailing aliases and reserved characters before effects', () => {
    for (const name of ['C:\\CON', 'C:\\owned.', 'C:\\a\\b ', 'C:\\a\\x?y', 'C:\\nul.txt'])
        assert.throws(() => packWindowsDeploymentQueries([name]));
});

test('query decoder rejects short, trailing, count overflow and invalid UTF-8', () => {
    for (const hex of [
        '444354515259310a0100000004000000433a5c',
        '444354515259310a0100000004000000433a5c6100',
        '444354515259310a81000000',
        '444354515259310a0100000004000000433a5cff',
    ])
        assert.throws(() => decodeWindowsDeploymentQuery(Buffer.from(hex, 'hex')));
});
