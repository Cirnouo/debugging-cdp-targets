import { createHash } from 'node:crypto';
import path from 'node:path';
import { type DeploymentPayloadEntry, parseDeploymentPayloadManifest } from '../domains/app-deployment.ts';

const queryMagic = Buffer.from('DCTQRY1\n', 'ascii');
const queryMaximum = 1024 * 1024;
const queryCount = 128;
// Seven text prefixes/account+owner/four IDs, booleans, filesystem prefix/data,
// volume fields, DACL count, and 128 (SID prefix/data + mask/flags/type) entries.
const nativeFactOverhead = 7 * 4 + 2 * 184 + 4 * 20 + 3 + 4 + 32 + 2 * 4 + 4 + 128 * (4 + 184 + 3 * 4);

export function demandWindowsDeploymentPath(name: string) {
    if (
        typeof name !== 'string' ||
        !/^[A-Za-z]:\\/.test(name) ||
        name.length > 32768 ||
        /[\0\r\n/]/.test(name) ||
        name.indexOf(':', 2) !== -1 ||
        path.win32.normalize(name) !== name ||
        (name.length > 3 && name.endsWith('\\')) ||
        name.slice(3).split('\\').length > 64 ||
        Buffer.from(name, 'utf8').toString('utf8') !== name
    )
        throw new Error('Invalid bounded canonical deployment DOS path.');
    if (nativeFactOverhead + Buffer.byteLength(name, 'utf8') > 65536)
        throw new Error('Deployment native reply record cannot fit its bounded codec.');
    if (
        name.length > 3 &&
        name
            .slice(3)
            .split('\\')
            .some(
                (part) =>
                    !part ||
                    /[<>:"|?*\x00-\x1f]/.test(part) ||
                    /[. ]$/.test(part) ||
                    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(part.split('.')[0] ?? ''),
            )
    )
        throw new Error('Ambiguous deployment Windows path component.');
}

/** Exact deterministic dual-cap packing. No request is produced until every record is admissible. */
export function packWindowsDeploymentQueries(names: readonly string[]): readonly Buffer[] {
    const records: Buffer[] = [];
    const unique = new Set<string>();
    for (const name of names) {
        demandWindowsDeploymentPath(name);
        if (unique.has(name.toUpperCase())) throw new Error('Duplicate deployment query path.');
        unique.add(name.toUpperCase());
        const text = Buffer.from(name, 'utf8');
        if (text.length + 4 + 12 > queryMaximum) throw new Error('Deployment query record cannot fit.');
        const record = Buffer.alloc(4 + text.length);
        record.writeUInt32LE(text.length, 0);
        text.copy(record, 4);
        records.push(record);
    }
    const batches: Buffer[] = [];
    let pending: Buffer[] = [];
    let size = 12;
    function finish() {
        if (!pending.length) return;
        if (
            12 + pending.reduce((total, record) => total + nativeFactOverhead + record.length - 4, 0) >
            16 * 1024 * 1024
        )
            throw new Error('Deployment native reply cannot fit its bounded codec.');
        const header = Buffer.alloc(12);
        queryMagic.copy(header);
        header.writeUInt32LE(pending.length, 8);
        batches.push(Buffer.concat([header, ...pending], size));
        pending = [];
        size = 12;
    }
    for (const record of records) {
        if (pending.length === queryCount || size + record.length > queryMaximum) finish();
        pending.push(record);
        size += record.length;
    }
    finish();
    return batches;
}

export function decodeWindowsDeploymentQuery(bytes: Buffer): string[] {
    if (bytes.length < 12 || bytes.length > queryMaximum || !bytes.subarray(0, 8).equals(queryMagic))
        throw new Error('Invalid bounded deployment query.');
    const count = bytes.readUInt32LE(8);
    if (count < 1 || count > queryCount) throw new Error('Invalid deployment query count.');
    let offset = 12;
    const names: string[] = [];
    for (let index = 0; index < count; index++) {
        if (offset + 4 > bytes.length) throw new Error('Short deployment query.');
        const length = bytes.readUInt32LE(offset);
        offset += 4;
        if (length < 3 || offset + length > bytes.length) throw new Error('Short deployment query path.');
        const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length));
        demandWindowsDeploymentPath(name);
        if (names.some((old) => old.toUpperCase() === name.toUpperCase()))
            throw new Error('Duplicate deployment query path.');
        names.push(name);
        offset += length;
    }
    if (offset !== bytes.length) throw new Error('Trailing deployment query data.');
    return names;
}

class WindowsDeploymentReader {
    offset = 0;
    readonly bytes: Buffer;
    constructor(bytes: Buffer) {
        this.bytes = bytes;
    }
    take(length: number) {
        if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length)
            throw new Error('Short deployment response.');
        const result = this.bytes.subarray(this.offset, this.offset + length);
        this.offset += length;
        return result;
    }
    uint() {
        return this.take(4).readUInt32LE();
    }
    ulong() {
        return this.take(8).readBigUInt64LE();
    }
    text(maximum: number) {
        const length = this.uint();
        if (length > maximum) throw new Error('Deployment response field exceeds bound.');
        return new TextDecoder('utf-8', { fatal: true }).decode(this.take(length));
    }
    boolean() {
        const value = this.take(1)[0];
        if (value !== 0 && value !== 1) throw new Error('Invalid deployment boolean.');
        return value === 1;
    }
}

/** Decode raw facts only; the existing domain validator still decides every native predicate. */
export function decodeWindowsDeploymentFacts(bytes: Buffer, expectedPaths: readonly string[]): unknown[] {
    if (bytes.length > 16 * 1024 * 1024 || expectedPaths.length < 1 || expectedPaths.length > 128)
        throw new Error('Deployment native reply exceeds bound.');
    const reader = new WindowsDeploymentReader(bytes);
    if (!reader.take(8).equals(Buffer.from('DCTQRS1\n')) || reader.uint() !== expectedPaths.length)
        throw new Error('Deployment native reply coverage changed.');
    const facts: unknown[] = [];
    for (const expected of expectedPaths) {
        const start = reader.offset;
        const account = reader.text(184),
            owner = reader.text(184),
            name = reader.text(65536);
        if (name !== expected) throw new Error('Deployment native reply path/order changed.');
        const device = reader.text(20),
            inode = reader.text(20),
            links = reader.text(20),
            size = reader.text(20);
        const directory = reader.boolean(),
            protectedDacl = reader.boolean(),
            reparse = reader.boolean();
        const filesystem = reader.text(32),
            volumeFlags = reader.uint(),
            driveType = reader.uint();
        const count = reader.uint();
        if (count > 128) throw new Error('Deployment native reply DACL exceeds bound.');
        const dacl = [];
        for (let index = 0; index < count; index++)
            dacl.push({
                sid: reader.text(184),
                mask: String(reader.uint()),
                flags: reader.uint(),
                type: reader.uint(),
            });
        if (reader.offset - start > 65536) throw new Error('Deployment native facts exceed bound.');
        facts.push({
            platform: 'win32',
            account,
            owner,
            path: name,
            device,
            inode,
            links,
            size,
            directory,
            protected: protectedDacl,
            reparse,
            filesystem,
            volumeFlags,
            driveType,
            dacl,
        });
    }
    if (reader.offset !== bytes.length) throw new Error('Trailing deployment native reply.');
    return facts;
}

function mutationFields(fields: readonly string[]) {
    if (
        fields.length !== 8 ||
        fields.some(
            (value) => typeof value !== 'string' || Buffer.from(value).toString() !== value || /[\0\r\n]/.test(value),
        )
    )
        throw new Error('Invalid deployment mutation fields.');
    const [operation, root, relative, destination, device, inode, sourceInode, parentInode] = fields;
    if (
        !operation ||
        !root ||
        relative === undefined ||
        destination === undefined ||
        device === undefined ||
        inode === undefined ||
        sourceInode === undefined ||
        parentInode === undefined ||
        !['create-root', 'create-directory', 'publish'].includes(operation)
    )
        throw new Error('Invalid deployment mutation operation.');
    demandWindowsDeploymentPath(root);
    if (root.length <= 3) throw new Error('Deployment mutation requires a child root.');
    const child = (name: string) => {
        const target = path.win32.join(root, name);
        demandWindowsDeploymentPath(target);
        if (
            !name ||
            Buffer.byteLength(name) > 8192 ||
            path.win32.relative(root, target) !== name ||
            !target.startsWith(`${root}\\`)
        )
            throw new Error('Invalid deployment mutation child.');
    };
    if (operation === 'create-root') {
        if (relative || destination || inode || sourceInode) throw new Error('Invalid create-root placeholders.');
    } else {
        child(relative);
        if (operation === 'publish') child(destination);
        else if (destination || sourceInode) throw new Error('Invalid create-directory placeholders.');
    }
    for (const [value, empty, zero] of [
        [device, false, true],
        [parentInode, false, false],
        [inode, operation === 'create-root', false],
        [sourceInode, operation !== 'publish', false],
    ] as const) {
        if (
            empty
                ? value !== ''
                : !/^(0|[1-9][0-9]{0,19})$/.test(value) ||
                  (!zero && value === '0') ||
                  BigInt(value) > 18446744073709551615n
        )
            throw new Error('Invalid deployment unsigned identity/placeholders.');
    }
    return [...fields];
}

export function encodeWindowsDeploymentMutation(fields: readonly string[]): Buffer {
    const values = mutationFields(fields);
    const parts = [Buffer.from('DCTMUT1\n'), Buffer.from([8, 0, 0, 0])];
    for (const value of values) {
        const bytes = Buffer.from(value, 'utf8'),
            length = Buffer.alloc(4);
        length.writeUInt32LE(bytes.length);
        parts.push(length, bytes);
    }
    const size = parts.reduce((total, bytes) => total + bytes.length, 0);
    if (size > 1024 * 1024) throw new Error('Deployment mutation exceeds bound.');
    return Buffer.concat(parts, size);
}

export function decodeWindowsDeploymentMutation(bytes: Buffer): string[] {
    if (bytes.length > 1024 * 1024) throw new Error('Deployment mutation exceeds bound.');
    const reader = new WindowsDeploymentReader(bytes);
    if (!reader.take(8).equals(Buffer.from('DCTMUT1\n')) || reader.uint() !== 8)
        throw new Error('Invalid deployment mutation header.');
    const fields = [];
    for (const limit of [16, 98304, 8192, 8192, 20, 20, 20, 20]) fields.push(reader.text(limit));
    if (reader.offset !== bytes.length) throw new Error('Trailing deployment mutation input.');
    return mutationFields(fields);
}

export type WindowsDeploymentCopyPlan = Readonly<{
    root: string;
    stage: string;
    device: string;
    parents: readonly Readonly<{ relative: string; inode: string }>[];
    entries: readonly DeploymentPayloadEntry[];
    manifestLength: number;
    manifestSha256: string;
}>;

function copyParents(stage: string) {
    if (!/^\.staging\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/payload$/.test(stage))
        throw new Error('Invalid fixed deployment copy stage.');
    return ['', '.staging', stage.slice(0, -8), stage];
}

function copyBounds(root: string, stage: string, inputs: readonly DeploymentPayloadEntry[], manifestLength: number) {
    demandWindowsDeploymentPath(root);
    const parents = copyParents(stage);
    if (
        inputs.length > 4096 ||
        !Number.isSafeInteger(manifestLength) ||
        manifestLength < 1 ||
        manifestLength > 16 * 1024 * 1024
    )
        throw new Error('Deployment copy count/manifest bound exceeded.');
    const entries = parseDeploymentPayloadManifest({
        schemaVersion: 1,
        platform: 'win32',
        architecture: 'x64',
        entries: inputs,
    }).entries;
    let paths = Buffer.byteLength('payload-manifest.json'),
        payloadBytes = 0;
    const stageRoot = path.win32.join(root, ...stage.split('/'));
    for (const relative of parents)
        demandWindowsDeploymentPath(relative ? path.win32.join(root, ...relative.split('/')) : root);
    for (const entry of entries) {
        if (entry.type === 'symlink') throw new Error('Windows deployment copy links are unsupported.');
        const length = Buffer.byteLength(entry.path);
        if (length > 8192 || entry.path.split('/').length > 64)
            throw new Error('Deployment copy relative path exceeds bound.');
        demandWindowsDeploymentPath(path.win32.join(stageRoot, ...entry.path.split('/')));
        paths += length;
        if (entry.type === 'file') {
            if (entry.bytes > 2 * 1024 ** 3) throw new Error('Deployment copy file exceeds bound.');
            payloadBytes += entry.bytes;
        }
    }
    demandWindowsDeploymentPath(path.win32.join(stageRoot, 'payload-manifest.json'));
    if (paths > 1024 * 1024 || payloadBytes > 8 * 1024 ** 3) throw new Error('Deployment copy total bound exceeded.');
    const headerBytes =
        12 +
        4 +
        Buffer.byteLength(root) +
        4 +
        Buffer.byteLength(stage) +
        8 +
        4 +
        parents.reduce((sum, relative) => sum + 4 + Buffer.byteLength(relative) + 8, 0) +
        4 +
        entries.reduce((sum, entry) => sum + 1 + 4 + Buffer.byteLength(entry.path) + 8 + 32, 0) +
        4 +
        32;
    const replyBytes = 12 + paths + (entries.length + 1) * (4 + 8 + 8 + 1 + 8);
    const transportBytes = headerBytes + 2 * payloadBytes + 2 * manifestLength;
    if (
        headerBytes > 8 * 1024 * 1024 ||
        replyBytes > 2 * 1024 * 1024 ||
        transportBytes > 16 * 1024 ** 3 + 32 * 1024 * 1024
    )
        throw new Error('Deployment copy encoded bound exceeded.');
    return { entries, parents, headerBytes, replyBytes, transportBytes };
}

/** Pure representability only. Producer provenance and native permission remain separate. */
export function preflightWindowsDeploymentCopy(
    root: string,
    stage: string,
    entries: readonly DeploymentPayloadEntry[],
    manifest: Buffer,
) {
    const bounds = copyBounds(root, stage, entries, manifest.length);
    const value = parseDeploymentPayloadManifest(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(manifest)));
    if (
        value.platform !== 'win32' ||
        value.architecture !== 'x64' ||
        !manifest.equals(Buffer.from(`${JSON.stringify(value)}\n`)) ||
        JSON.stringify(value.entries) !== JSON.stringify(bounds.entries)
    )
        throw new Error('Deployment copy canonical manifest/entries disagree.');
    return bounds;
}

export function encodeWindowsDeploymentCopyHeader(
    input: Readonly<Omit<WindowsDeploymentCopyPlan, 'manifestLength' | 'manifestSha256'> & { manifest: Buffer }>,
): Buffer {
    const bounds = preflightWindowsDeploymentCopy(input.root, input.stage, input.entries, input.manifest);
    if (
        input.parents.length !== bounds.parents.length ||
        input.parents.some((parent, index) => parent.relative !== bounds.parents[index])
    )
        throw new Error('Deployment copy protected parent inventory changed.');
    const parts = [Buffer.from('DCTCPY1\n'), Buffer.alloc(4)];
    parts[1]?.writeUInt32LE(bounds.headerBytes);
    const uint = (value: number) => {
        const bytes = Buffer.alloc(4);
        bytes.writeUInt32LE(value);
        parts.push(bytes);
    };
    const ulong = (value: string, nonzero: boolean) => {
        if (
            !/^(0|[1-9][0-9]{0,19})$/.test(value) ||
            BigInt(value) > 18446744073709551615n ||
            (nonzero && value === '0')
        )
            throw new Error('Invalid deployment copy identity.');
        const bytes = Buffer.alloc(8);
        bytes.writeBigUInt64LE(BigInt(value));
        parts.push(bytes);
    };
    const text = (value: string) => {
        const bytes = Buffer.from(value, 'utf8');
        uint(bytes.length);
        parts.push(bytes);
    };
    text(input.root);
    text(input.stage);
    ulong(input.device, false);
    uint(input.parents.length);
    for (const parent of input.parents) {
        text(parent.relative);
        ulong(parent.inode, true);
    }
    uint(bounds.entries.length);
    for (const entry of bounds.entries) {
        if (entry.type === 'symlink') throw new Error('Windows copy links are unsupported.');
        parts.push(Buffer.from([entry.type === 'file' ? 1 : 0]));
        text(entry.path);
        ulong(String(entry.type === 'file' ? entry.bytes : 0), false);
        parts.push(entry.type === 'file' ? Buffer.from(entry.sha256, 'hex') : Buffer.alloc(32));
    }
    uint(input.manifest.length);
    parts.push(createHash('sha256').update(input.manifest).digest());
    const bytes = Buffer.concat(parts);
    if (bytes.length !== bounds.headerBytes) throw new Error('Deployment copy framing disagrees with bound.');
    return bytes;
}

export function decodeWindowsDeploymentCopyHeader(bytes: Buffer): WindowsDeploymentCopyPlan {
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Deployment copy header exceeds bound.');
    const reader = new WindowsDeploymentReader(bytes);
    if (!reader.take(8).equals(Buffer.from('DCTCPY1\n')) || reader.uint() !== bytes.length)
        throw new Error('Invalid deployment copy header.');
    const root = reader.text(98304),
        stage = reader.text(8192),
        device = String(reader.ulong());
    const count = reader.uint();
    const expectedParents = copyParents(stage);
    if (count !== expectedParents.length) throw new Error('Deployment copy parent count changed.');
    const parents = [];
    for (const relative of expectedParents) {
        if (reader.text(8192) !== relative) throw new Error('Deployment copy parent path changed.');
        const inode = String(reader.ulong());
        if (inode === '0') throw new Error('Invalid deployment copy parent identity.');
        parents.push(Object.freeze({ relative, inode }));
    }
    const entryCount = reader.uint();
    if (entryCount > 4096) throw new Error('Deployment copy entry count exceeds bound.');
    const entries: DeploymentPayloadEntry[] = [];
    for (let index = 0; index < entryCount; index++) {
        const type = reader.take(1)[0],
            name = reader.text(8192),
            length = reader.ulong(),
            hash = reader.take(32);
        if (type === 1 && length <= 2n * 1024n ** 3n)
            entries.push({
                type: 'file',
                path: name,
                bytes: Number(length),
                sha256: hash.toString('hex'),
                executableBits: null,
            });
        else if (type === 0 && length === 0n && hash.every((byte) => byte === 0))
            entries.push({ type: 'directory', path: name, executableBits: null });
        else throw new Error('Invalid deployment copy entry type/length/hash.');
    }
    const manifestLength = reader.uint(),
        manifestSha256 = reader.take(32).toString('hex');
    if (reader.offset !== bytes.length) throw new Error('Trailing deployment copy header.');
    const bounds = copyBounds(root, stage, entries, manifestLength);
    if (bytes.length !== bounds.headerBytes) throw new Error('Deployment copy framing changed.');
    return Object.freeze({
        root,
        stage,
        device,
        parents: Object.freeze(parents),
        entries: bounds.entries,
        manifestLength,
        manifestSha256,
    });
}

/** Created-object observations only. No permission, provenance or enrollment grant is encoded. */
export function decodeWindowsDeploymentCopyReply(bytes: Buffer, plan: WindowsDeploymentCopyPlan) {
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Deployment copy reply exceeds bound.');
    const reader = new WindowsDeploymentReader(bytes);
    const expected = [
        ...plan.entries,
        { type: 'file' as const, path: 'payload-manifest.json', bytes: plan.manifestLength },
    ];
    if (!reader.take(8).equals(Buffer.from('DCTCPR1\n')) || reader.uint() !== expected.length)
        throw new Error('Deployment copy reply inventory count changed.');
    const results = [];
    for (const entry of expected) {
        const name = reader.text(8192),
            device = String(reader.ulong()),
            inode = String(reader.ulong()),
            type = reader.take(1)[0],
            length = reader.ulong();
        if (
            name !== entry.path ||
            device !== plan.device ||
            inode === '0' ||
            type !== (entry.type === 'file' ? 1 : 0) ||
            length !== BigInt(entry.type === 'file' ? entry.bytes : 0)
        )
            throw new Error('Deployment copy reply inventory identity/type/length changed.');
        results.push(Object.freeze({ path: name, type: entry.type, device, inode, bytes: Number(length) }));
    }
    if (reader.offset !== bytes.length) throw new Error('Trailing deployment copy reply.');
    return Object.freeze(results);
}
