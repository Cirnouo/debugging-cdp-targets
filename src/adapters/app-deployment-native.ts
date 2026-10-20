import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import { lstat, open, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    type DeploymentEntryPurpose,
    type DeploymentPayloadEntry,
    type DeploymentUnixRole,
    hasDeploymentUnixEntryPermissions,
    validateDeploymentNativeEntry,
    validateDeploymentUnixEntry,
} from '../domains/app-deployment.ts';
import { errorCode, isRecord } from '../shared/errors.ts';
import {
    encodeWindowsDeploymentCopyHeader,
    packWindowsDeploymentQueries,
    preflightWindowsDeploymentCopy,
} from './windows-deployment-protocol.ts';
import { buildWindowsDeploymentSupport } from './windows-deployment-support.ts';

type WindowsSupport = Awaited<ReturnType<typeof buildWindowsDeploymentSupport>>;
export type DeploymentNativeCheck = Readonly<{ file: string; stats: BigIntStats; purpose: DeploymentEntryPurpose }>;

const helperDirectory = fileURLToPath(new URL('.', import.meta.url));
const failure = () => new Error('Deployment native authority is unavailable or unsafe.');

function account(): string {
    if (!process.getuid || !process.geteuid) throw failure();
    const real = process.getuid();
    if (!Number.isSafeInteger(real) || real < 0 || real !== process.geteuid()) throw failure();
    return String(real);
}

async function snapshot(file: string, support?: WindowsSupport): Promise<unknown> {
    let executable: string;
    let args: string[];
    let env: NodeJS.ProcessEnv;
    if (process.platform === 'win32') {
        if (!support)
            throw new Error(
                'Windows delivered deployment support is pending; only an actual build-only lifetime may query.',
            );
        const facts = await support.query([file]);
        if (facts.length !== 1) throw failure();
        return facts[0];
    } else if (process.platform === 'darwin') {
        executable = '/usr/bin/osascript';
        args = ['-l', 'JavaScript', path.join(helperDirectory, 'macos-deployment-authority.jxa'), file];
        env = { PATH: '/usr/bin:/bin', LANG: 'C' };
    } else throw failure();
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
            executable,
            args,
            {
                shell: false,
                windowsHide: true,
                cwd: helperDirectory,
                env,
                encoding: 'utf8',
                maxBuffer: 65536,
            },
            (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr })),
        );
    });
    if (stderr || !stdout || Buffer.byteLength(stdout) > 65536) throw failure();
    return JSON.parse(stdout);
}

/** Concrete OS evidence for this enrolled root only. No JSON, role flag or environment grants writes. */
async function openAuthority(directory: string, writing: boolean, support?: WindowsSupport) {
    if (!['linux', 'win32', 'darwin'].includes(process.platform))
        throw new Error('Deployment native role is unsupported.');
    if (process.platform === 'win32' && !support)
        throw new Error(
            'Windows delivered deployment support is pending; only an actual build-only lifetime may query.',
        );
    const root = await lstat(directory, { bigint: true });
    const role: DeploymentUnixRole =
        process.platform === 'linux' && directory === '/opt/debugging-cdp-targets' && root.uid === 0n
            ? 'system'
            : 'private';
    let ownerAccount = process.platform === 'win32' ? '' : account();

    function writer() {
        if (!writing) throw new Error('Deployment reader cannot acquire writer authority.');
        if (process.platform !== 'win32' && (account() !== ownerAccount || (role === 'system' && ownerAccount !== '0')))
            throw failure();
    }

    function documentReceipt(stats: BigIntStats) {
        if (process.platform !== 'linux') return;
        if (
            account() !== ownerAccount ||
            stats.dev !== root.dev ||
            !hasDeploymentUnixEntryPermissions(
                {
                    uid: String(stats.uid),
                    gid: String(stats.gid),
                    mode: Number(stats.mode & 0o7777n),
                    directory: stats.isDirectory(),
                },
                ownerAccount,
                role,
                'document',
                false,
            )
        )
            throw failure();
    }

    async function validateOne(
        file: string,
        stats: BigIntStats,
        purpose: DeploymentEntryPurpose,
        ancestor = false,
        supplied?: unknown,
        documentRead = false,
    ) {
        if (documentRead) documentReceipt(stats);
        if (
            (!stats.isDirectory() && !stats.isFile()) ||
            stats.isSymbolicLink() ||
            (!ancestor && (purpose === 'directory') !== stats.isDirectory()) ||
            (!stats.isDirectory() && stats.nlink !== 1n) ||
            (!ancestor && stats.dev !== root.dev) ||
            (await realpath(file)) !== file
        )
            throw failure();
        if (process.platform === 'linux') {
            if (account() !== ownerAccount) throw failure();
            validateDeploymentUnixEntry(
                {
                    uid: String(stats.uid),
                    gid: String(stats.gid),
                    mode: Number(stats.mode & 0o7777n),
                    directory: stats.isDirectory(),
                },
                ownerAccount,
                role,
                purpose,
                ancestor,
            );
            // Linux UAPI magic.h. A mount spelling alone never establishes local storage.
            const volume = await statfs(file, { bigint: true });
            if (![0xef53n, 0x01021994n, 0x58465342n, 0x9123683en].includes(volume.type))
                throw new Error('Deployment filesystem is unsupported.');
        } else {
            const value = process.platform === 'win32' ? supplied : await snapshot(file, support);
            validateDeploymentNativeEntry(
                value,
                {
                    platform: process.platform === 'win32' ? 'win32' : 'darwin',
                    account: ownerAccount,
                    path: file,
                    device: String(stats.dev),
                    inode: String(stats.ino),
                    links: String(stats.nlink),
                    size: String(stats.isDirectory() ? 0 : stats.size),
                    directory: stats.isDirectory(),
                },
                ancestor,
            );
            if (process.platform === 'darwin' && account() !== ownerAccount) throw failure();
        }
        const after = await lstat(file, { bigint: true });
        if (documentRead && process.platform === 'linux') {
            function safeNamed(entry: BigIntStats) {
                documentReceipt(entry);
                if (
                    !entry.isFile() ||
                    entry.isSymbolicLink() ||
                    entry.nlink !== 1n ||
                    entry.dev !== root.dev ||
                    entry.dev !== stats.dev ||
                    entry.mode !== stats.mode ||
                    entry.uid !== stats.uid ||
                    entry.gid !== stats.gid
                )
                    throw failure();
            }
            function unchanged(first: BigIntStats, second: BigIntStats) {
                return (
                    first.dev === second.dev &&
                    first.ino === second.ino &&
                    first.nlink === second.nlink &&
                    first.size === second.size &&
                    first.ctimeNs === second.ctimeNs &&
                    first.mtimeNs === second.mtimeNs
                );
            }
            safeNamed(after);
            if ((await realpath(file)) !== file) throw failure();
            const final = await lstat(file, { bigint: true });
            safeNamed(final);
            if (!unchanged(stats, after) || !unchanged(after, final))
                throw new Error('Deployment document identity changed.');
            return;
        }
        if (
            after.dev !== stats.dev ||
            after.ino !== stats.ino ||
            after.mode !== stats.mode ||
            after.uid !== stats.uid ||
            after.gid !== stats.gid ||
            (!stats.isDirectory() &&
                (after.nlink !== stats.nlink ||
                    after.size !== stats.size ||
                    after.ctimeNs !== stats.ctimeNs ||
                    after.mtimeNs !== stats.mtimeNs)) ||
            (await realpath(file)) !== file
        )
            throw failure();
    }

    const externalAncestors: string[] = [];
    for (let current = path.dirname(directory); ; current = path.dirname(current)) {
        externalAncestors.push(current);
        if (current === path.dirname(current)) break;
    }
    externalAncestors.reverse();
    async function collect(checks: readonly DeploymentNativeCheck[], establish = false) {
        if (!support) throw failure();
        const occurrences = checks.map((check) => ({ ...check, ancestor: externalAncestors.includes(check.file) }));
        // Every occurrence retains its purpose. Dedup controls only native transport, never predicates.
        const unique = new Map<string, DeploymentNativeCheck>();
        for (const check of occurrences) {
            if (!check.ancestor && check.file !== directory && !check.file.startsWith(`${directory}${path.sep}`))
                throw failure();
            if (unique.has(check.file)) {
                const old = unique.get(check.file);
                if (!old || old.stats.dev !== check.stats.dev || old.stats.ino !== check.stats.ino) throw failure();
            } else unique.set(check.file, check);
        }
        // Canonical names/Node baselines precede each bounded native batch; after checks stay below.
        for (const check of unique.values()) {
            if ((await realpath(check.file)) !== check.file || check.stats.isSymbolicLink()) throw failure();
        }
        const names = [...unique.keys()];
        const values = await support.query(names);
        if (values.length !== names.length) throw failure();
        const byName = new Map(names.map((name, index) => [name, values[index]]));
        if (establish) {
            const initial = byName.get(directory);
            if (!isRecord(initial) || typeof initial.account !== 'string' || !initial.account) throw failure();
            ownerAccount = initial.account;
        }
        for (const check of occurrences)
            await validateOne(check.file, check.stats, check.purpose, check.ancestor, byName.get(check.file));
    }
    async function entries(checks: readonly DeploymentNativeCheck[]) {
        if (process.platform !== 'win32') {
            for (const check of checks) await validateOne(check.file, check.stats, check.purpose);
            return;
        }
        await collect(checks);
    }
    async function entry(file: string, stats: BigIntStats, purpose: DeploymentEntryPurpose) {
        if (process.platform === 'win32') await entries([{ file, stats, purpose }]);
        else await validateOne(file, stats, purpose);
    }
    async function document(file: string, stats: BigIntStats) {
        if (process.platform === 'win32') await entries([{ file, stats, purpose: 'document' }]);
        else await validateOne(file, stats, 'document', false, undefined, true);
    }
    async function ancestorChecks(): Promise<DeploymentNativeCheck[]> {
        const checks: DeploymentNativeCheck[] = [];
        for (const file of externalAncestors)
            checks.push({ file, stats: await lstat(file, { bigint: true }), purpose: 'directory' });
        return checks;
    }
    async function ancestors() {
        if (process.platform === 'win32') await collect(await ancestorChecks());
        else
            for (const file of externalAncestors)
                await validateOne(file, await lstat(file, { bigint: true }), 'directory', true);
    }
    if (process.platform === 'win32')
        await collect([{ file: directory, stats: root, purpose: 'directory' }, ...(await ancestorChecks())], true);
    else {
        await ancestors();
        await entry(directory, root, 'directory');
    }
    if (writing) writer();
    return Object.freeze({ role, entry, entries, documentReceipt, document, ancestors, ancestorChecks, writer });
}

/** Concrete enrolled-root admission. No caller source, helper, receipt or evidence input exists. */
export async function openDeploymentNativeAuthority(directory: string, writing: boolean) {
    return openAuthority(directory, writing);
}

/** Fixed source-build creation I/O. This returns object checks, never payload/enrollment authority. */
export async function createFreshDeploymentRoot(directory: string) {
    if (process.platform !== 'win32' || process.arch !== 'x64')
        throw new Error('Fresh deployment creation supports Windows x64 only; native acceptance remains pending.');
    packWindowsDeploymentQueries([directory]);
    if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || path.dirname(directory) === directory)
        throw failure();
    const parent = path.dirname(directory);
    if ((await realpath(parent)) !== parent) throw failure();
    try {
        await lstat(directory);
        throw new Error('Fresh deployment root already exists; adoption is forbidden.');
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
    }
    const support = await buildWindowsDeploymentSupport();
    try {
        const parentStats = await lstat(parent, { bigint: true });
        const parentEntries: { file: string; stats: BigIntStats }[] = [];
        for (let file = parent; ; file = path.dirname(file)) {
            parentEntries.push({ file, stats: file === parent ? parentStats : await lstat(file, { bigint: true }) });
            if (file === path.dirname(file)) break;
        }
        const parentFacts = await support.query(parentEntries.map((entry) => entry.file));
        const initial = parentFacts[0];
        if (!isRecord(initial) || typeof initial.account !== 'string') throw failure();
        const owner = initial.account;
        async function validate(file: string, stats: BigIntStats, ancestor: boolean, value?: unknown) {
            if ((!stats.isDirectory() && !stats.isFile()) || stats.isSymbolicLink() || (await realpath(file)) !== file)
                throw failure();
            validateDeploymentNativeEntry(
                value ?? (await snapshot(file, support)),
                {
                    platform: 'win32',
                    account: owner,
                    path: file,
                    device: String(stats.dev),
                    inode: String(stats.ino),
                    links: String(stats.nlink),
                    size: String(stats.isDirectory() ? 0 : stats.size),
                    directory: stats.isDirectory(),
                },
                ancestor,
            );
            const after = await lstat(file, { bigint: true });
            if (
                after.dev !== stats.dev ||
                after.ino !== stats.ino ||
                after.mode !== stats.mode ||
                after.nlink !== stats.nlink
            )
                throw failure();
        }
        if (parentFacts.length !== parentEntries.length) throw failure();
        for (const [index, entry] of parentEntries.entries())
            await validate(entry.file, entry.stats, true, parentFacts[index]);
        async function execute(
            operation: 'create-root' | 'create-directory' | 'publish',
            relative: string,
            destination: string,
            rootInode: string,
            sourceInode: string,
            parentInode: string,
        ): Promise<unknown> {
            return support.mutate(operation, {
                root: directory,
                relative,
                destination,
                device: String(parentStats.dev),
                inode: rootInode,
                sourceInode,
                parentInode,
            });
        }
        const created = await execute('create-root', '', '', '', '', String(parentStats.ino));
        const root = await lstat(directory, { bigint: true });
        if (!root.isDirectory() || root.dev !== parentStats.dev) throw failure();
        await validate(directory, root, false, created);
        const authority = await openAuthority(directory, true, support);
        const directories = new Map<string, BigIntStats>([[directory, root]]);
        function child(relative: string) {
            const file = path.join(directory, relative);
            if (!relative || path.relative(directory, file) !== relative || !file.startsWith(`${directory}${path.sep}`))
                throw failure();
            return file;
        }
        async function parentChecks(file: string) {
            const checks = await authority.ancestorChecks();
            for (let name = path.dirname(file); ; name = path.dirname(name)) {
                const expected = directories.get(name);
                if (!expected) throw failure();
                const stats = await lstat(name, { bigint: true });
                if (stats.dev !== expected.dev || stats.ino !== expected.ino) throw failure();
                checks.push({ file: name, stats, purpose: 'directory' });
                if (name === directory) return checks;
            }
        }
        async function verifyParent(file: string) {
            await authority.entries(await parentChecks(file));
        }
        async function entries(inputs: readonly Readonly<{ file: string; stats: BigIntStats }>[]) {
            const checks = await authority.ancestorChecks();
            const parents = new Set<string>();
            for (const { file, stats } of inputs) {
                if (stats.dev !== root.dev) throw failure();
                if (file !== directory && !file.startsWith(`${directory}${path.sep}`)) throw failure();
                for (let name = file === directory ? directory : path.dirname(file); ; name = path.dirname(name)) {
                    parents.add(name);
                    if (name === directory) break;
                    if (name === path.dirname(name)) throw failure();
                }
            }
            for (const file of parents) {
                const expected = directories.get(file),
                    stats = await lstat(file, { bigint: true });
                if (!expected || stats.dev !== expected.dev || stats.ino !== expected.ino) throw failure();
                checks.push({ file, stats, purpose: 'directory' });
            }
            for (const { file, stats } of inputs)
                checks.push({ file, stats, purpose: stats.isDirectory() ? 'directory' : 'document' });
            await authority.entries(checks);
        }
        async function entry(file: string, stats: BigIntStats) {
            await entries([{ file, stats }]);
        }
        async function createDirectory(relative: string) {
            const file = child(relative);
            await verifyParent(file);
            const before = await lstat(path.dirname(file), { bigint: true });
            const value = await execute('create-directory', relative, '', String(root.ino), '', String(before.ino));
            const stats = await lstat(file, { bigint: true });
            if (!stats.isDirectory()) throw failure();
            await entry(file, stats);
            validateDeploymentNativeEntry(value, {
                platform: 'win32',
                account: owner,
                path: file,
                device: String(root.dev),
                inode: String(stats.ino),
                links: String(stats.nlink),
                size: '0',
                directory: true,
            });
            directories.set(file, stats);
        }
        async function publish(relative: string, destination: string) {
            const source = child(relative),
                target = child(destination);
            await verifyParent(source);
            await verifyParent(target);
            const stats = await lstat(source, { bigint: true });
            await entry(source, stats);
            const targetParent = await lstat(path.dirname(target), { bigint: true });
            const result = await execute(
                'publish',
                relative,
                destination,
                String(root.ino),
                String(stats.ino),
                String(targetParent.ino),
            );
            const after = await lstat(target, { bigint: true });
            if (after.dev !== stats.dev || after.ino !== stats.ino) throw failure();
            await entry(target, after);
            validateDeploymentNativeEntry(result, {
                platform: 'win32',
                account: owner,
                path: target,
                device: String(after.dev),
                inode: String(after.ino),
                links: String(after.nlink),
                size: String(after.isDirectory() ? 0 : after.size),
                directory: after.isDirectory(),
            });
            if (stats.isDirectory()) {
                for (const [name, identity] of [...directories]) {
                    if (name === source || name.startsWith(`${source}${path.sep}`)) {
                        directories.delete(name);
                        directories.set(target + name.slice(source.length), identity);
                    }
                }
            }
        }
        async function copyPayload(
            sourceRoot: string,
            sourceIdentity: BigIntStats,
            relativeStage: string,
            sourceEntries: readonly DeploymentPayloadEntry[],
            canonicalManifest: Buffer,
        ) {
            // This is a comparison baseline, not evidence of the producer-created original inode.
            // The real caller's private producer selection remains the only content authority.
            const sourceBaseline = Object.freeze({
                dev: sourceIdentity.dev,
                ino: sourceIdentity.ino,
                mode: sourceIdentity.mode,
                uid: sourceIdentity.uid,
                gid: sourceIdentity.gid,
            });
            if (!sourceIdentity.isDirectory() || sourceIdentity.isSymbolicLink()) throw failure();
            const manifestBytes = Buffer.from(canonicalManifest);
            const stageRelative = relativeStage.split(path.sep).join('/');
            const entries = preflightWindowsDeploymentCopy(
                directory,
                stageRelative,
                sourceEntries,
                manifestBytes,
            ).entries;
            const stage = child(relativeStage);
            async function sourceRootCurrent() {
                const actual = await lstat(sourceRoot, { bigint: true });
                if (
                    !actual.isDirectory() ||
                    actual.isSymbolicLink() ||
                    actual.dev !== sourceBaseline.dev ||
                    actual.ino !== sourceBaseline.ino ||
                    actual.mode !== sourceBaseline.mode ||
                    actual.uid !== sourceBaseline.uid ||
                    actual.gid !== sourceBaseline.gid ||
                    (await realpath(sourceRoot)) !== sourceRoot
                )
                    throw new Error('Deployment source root comparison baseline changed.');
            }
            await sourceRootCurrent();
            const checks = await parentChecks(path.join(stage, 'payload-manifest.json'));
            await authority.entries(checks);
            const parts = stageRelative.split('/');
            const relativeParents = ['', ...parts.map((_part, index) => parts.slice(0, index + 1).join('/'))];
            const parents = relativeParents.map((relative) => {
                const current = directories.get(relative ? path.join(directory, ...relative.split('/')) : directory);
                if (!current) throw new Error('Missing actual protected copy parent identity.');
                return { relative, inode: String(current.ino) };
            });
            const header = encodeWindowsDeploymentCopyHeader({
                root: directory,
                stage: stageRelative,
                device: String(root.dev),
                parents,
                entries,
                manifest: manifestBytes,
            });
            const unchangedSource = (before: BigIntStats, after: BigIntStats) =>
                after.isFile() &&
                !after.isSymbolicLink() &&
                before.dev === after.dev &&
                before.ino === after.ino &&
                after.nlink === 1n &&
                before.nlink === after.nlink &&
                before.size === after.size &&
                before.mtimeNs === after.mtimeNs &&
                before.ctimeNs === after.ctimeNs &&
                before.mode === after.mode &&
                before.uid === after.uid &&
                before.gid === after.gid;
            async function* bodies() {
                for (const expected of entries) {
                    if (expected.type !== 'file') continue;
                    await sourceRootCurrent();
                    const file = path.join(sourceRoot, ...expected.path.split('/'));
                    if (!file.startsWith(`${sourceRoot}${path.sep}`) || (await realpath(file)) !== file)
                        throw new Error('Noncanonical deployment source path.');
                    const namedBefore = await lstat(file, { bigint: true });
                    if (
                        !namedBefore.isFile() ||
                        namedBefore.isSymbolicLink() ||
                        namedBefore.nlink !== 1n ||
                        namedBefore.size !== BigInt(expected.bytes)
                    )
                        throw new Error('Deployment source is not the expected regular one-link file.');
                    const handle = await open(
                        file,
                        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
                    );
                    let primary: unknown,
                        failed = false;
                    async function closeSource() {
                        try {
                            await handle.close();
                        } catch (close) {
                            throw failed
                                ? new AggregateError([primary, close], 'Deployment source and close failures.')
                                : close;
                        }
                    }
                    try {
                        const before = await handle.stat({ bigint: true });
                        if (!unchangedSource(namedBefore, before))
                            throw new Error('Deployment source named/open identity changed.');
                        async function current() {
                            await sourceRootCurrent();
                            const named = await lstat(file, { bigint: true }),
                                opened = await handle.stat({ bigint: true });
                            if (
                                !unchangedSource(before, named) ||
                                !unchangedSource(before, opened) ||
                                (await realpath(file)) !== file
                            )
                                throw new Error('Deployment source identity/metadata changed.');
                        }
                        const storage = Buffer.alloc(65536);
                        for (let pass = 0; pass < 2; pass++) {
                            await current();
                            const hash = createHash('sha256');
                            let offset = 0;
                            while (true) {
                                const requested = Math.min(storage.length, expected.bytes - offset + 1);
                                const read = await handle.read(storage, 0, requested, offset);
                                if (
                                    !Number.isSafeInteger(read.bytesRead) ||
                                    read.bytesRead < 0 ||
                                    read.bytesRead > requested
                                )
                                    throw new Error('Invalid deployment source read count.');
                                if (!read.bytesRead) break;
                                if (offset + read.bytesRead > expected.bytes)
                                    throw new Error('Deployment source has trailing bytes.');
                                const bytes = Buffer.from(storage.subarray(0, read.bytesRead));
                                hash.update(bytes);
                                offset += bytes.length;
                                yield bytes;
                            }
                            if (offset !== expected.bytes || hash.digest('hex') !== expected.sha256)
                                throw new Error('Deployment source length/hash differs from private expected content.');
                            await current();
                        }
                    } catch (error) {
                        primary = error;
                        failed = true;
                        throw error;
                    } finally {
                        await closeSource();
                    }
                }
                // R1: same captured producer byte sequence in both passes; never reopen scratch self-manifest.
                for (let pass = 0; pass < 2; pass++) {
                    await sourceRootCurrent();
                    for (let offset = 0; offset < manifestBytes.length; offset += 65536)
                        yield manifestBytes.subarray(offset, offset + 65536);
                }
                await sourceRootCurrent();
            }
            const created = await support.copy(header, bodies());
            const actual: { name: string; stats: BigIntStats }[] = [];
            for (const entry of created) {
                const name = path.join(stage, ...entry.path.split('/'));
                const stats = await lstat(name, { bigint: true });
                if (
                    stats.dev !== root.dev ||
                    String(stats.dev) !== entry.device ||
                    String(stats.ino) !== entry.inode ||
                    stats.isSymbolicLink() ||
                    (await realpath(name)) !== name ||
                    (entry.type === 'directory'
                        ? !stats.isDirectory()
                        : !stats.isFile() || stats.nlink !== 1n || stats.size !== BigInt(entry.bytes))
                )
                    throw new Error('Deployment copy created named identity/type/length changed.');
                actual.push({ name, stats });
            }
            await authority.entries(await parentChecks(path.join(stage, 'payload-manifest.json')));
            for (const entry of actual) if (entry.stats.isDirectory()) directories.set(entry.name, entry.stats);
            return created;
        }
        return Object.freeze({
            root,
            createDirectory,
            publish,
            entry,
            entries,
            verifyParent,
            copyPayload,
            openReaderAuthority: () => openAuthority(directory, false, support),
            close: () => support.release(),
        });
    } catch (error) {
        try {
            await support.release();
        } catch (close) {
            throw new AggregateError([error, close], 'Fresh root and support lifetime failures.');
        }
        throw error;
    }
}
