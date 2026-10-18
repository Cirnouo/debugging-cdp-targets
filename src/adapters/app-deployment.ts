import { createHash, randomUUID } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import { type FileHandle, lstat, open, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import {
    type DeploymentInstallation,
    type DeploymentState,
    parseDeploymentInstallation,
    parseDeploymentState,
    transitionDeploymentState,
} from '../domains/app-deployment.ts';
import { errorCode } from '../shared/errors.ts';
import type { AdvisoryLock } from './app-singleton.ts';

export type DeploymentLeaseKind = 'operation' | 'use' | 'deletion';
export interface DeploymentLease {
    readonly kind: DeploymentLeaseKind;
    release(): Promise<void>;
}
type LeaseEntry = {
    handle: FileHandle;
    file: string;
    identity: BigIntStats;
    kind: DeploymentLeaseKind;
    parent?: DeploymentLease;
    closed: boolean;
};
type StateIO = Readonly<{
    flush?: (handle: FileHandle) => Promise<void>;
    replace?: (source: string, destination: string) => Promise<void>;
}>;

export class DeploymentCommitError extends Error {
    readonly outcome: 'not-committed' | 'indeterminate';
    constructor(outcome: 'not-committed' | 'indeterminate', cause: unknown) {
        super(`Deployment state ${outcome}.`, { cause });
        this.outcome = outcome;
    }
}

function sameIdentity(first: BigIntStats, second: BigIntStats) {
    return first.dev === second.dev && first.ino === second.ino;
}

function privateEntry(entry: BigIntStats) {
    // No metadata field grants this role. System-DEB ownership and native ACLs are later producers.
    if (entry.uid !== BigInt(userInfo().uid) || (entry.mode & 0o077n) !== 0n)
        throw new Error('Deployment entry lacks native private-account permissions.');
}

function regular(entry: BigIntStats) {
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1n)
        throw new Error('Deployment metadata/lease must be a regular file with one link.');
    privateEntry(entry);
}

function regularDocument(entry: BigIntStats) {
    if (entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 0n)
        throw new Error('Deployment document identity changed.');
    regular(entry);
}

function unchanged(first: BigIntStats, second: BigIntStats) {
    return (
        sameIdentity(first, second) &&
        first.size === second.size &&
        first.mtimeNs === second.mtimeNs &&
        first.ctimeNs === second.ctimeNs
    );
}

async function readDocument<T>(
    file: string,
    maximum: number,
    parse: (value: unknown) => T,
): Promise<{ value: T; bytes: Buffer }> {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await handle.stat({ bigint: true });
        regularDocument(before);
        if (before.size < 1n || before.size > BigInt(maximum))
            throw new Error('Deployment document exceeds its bound.');
        const named = await lstat(file, { bigint: true });
        regularDocument(named);
        if (!unchanged(before, named)) throw new Error('Deployment document identity changed.');
        const buffer = Buffer.alloc(maximum + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
            const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
            if (result.bytesRead === 0) break;
            bytesRead += result.bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        const current = await lstat(file, { bigint: true });
        if (
            bytesRead > maximum ||
            BigInt(bytesRead) !== before.size ||
            after.nlink !== before.nlink ||
            !unchanged(before, after) ||
            !unchanged(before, current)
        )
            throw new Error('Deployment document identity or bounded content changed.');
        regularDocument(after);
        regularDocument(current);
        const bytes = buffer.subarray(0, bytesRead);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const value = parse(JSON.parse(text));
        // One canonical UTF-8 JSON line refuses duplicate keys, BOM and ambiguous encodings.
        if (!bytes.equals(Buffer.from(`${JSON.stringify(value)}\n`)))
            throw new Error('Deployment document is not canonical.');
        return { value, bytes };
    } finally {
        await handle.close();
    }
}

/** Already enrolled metadata only. This does not stage, verify or remove any build payload. */
export async function openDeploymentInstallation(
    directory: string,
    options: { tryLock: AdvisoryLock; stateIO?: StateIO },
) {
    if (process.platform !== 'linux') throw new Error('Deployment native permission/filesystem role is unsupported.');
    if (
        !path.isAbsolute(directory) ||
        path.resolve(directory) !== directory ||
        (await realpath(directory)) !== directory
    )
        throw new Error('Deployment root identity must be its canonical absolute directory.');
    // Linux UAPI magic.h: 0xef53 covers ext2/3/4; these IDs do not prove power-loss durability.
    // https://raw.githubusercontent.com/torvalds/linux/v6.8/include/uapi/linux/magic.h
    const filesystem = await statfs(directory, { bigint: true });
    if (![0xef53n, 0x01021994n, 0x58465342n, 0x9123683en].includes(filesystem.type))
        throw new Error('Deployment filesystem is unsupported.');
    const envelope = path.join(directory, '.deployment');
    const rootIdentity = await lstat(directory, { bigint: true });
    const envelopeIdentity = await lstat(envelope, { bigint: true });
    const installationFile = path.join(envelope, 'installation.json');
    const stateFile = path.join(envelope, 'state.json');
    const leases = new Map<DeploymentLease, LeaseEntry>();
    let writing = false;
    let deletionAcquisitions = 0;

    async function verifyRoot() {
        for (const [name, identity] of [
            [directory, rootIdentity],
            [envelope, envelopeIdentity],
        ] as const) {
            const entry = await lstat(name, { bigint: true });
            if (
                !entry.isDirectory() ||
                entry.isSymbolicLink() ||
                !sameIdentity(identity, entry) ||
                (await realpath(name)) !== name
            )
                throw new Error('Deployment root/envelope identity changed.');
            privateEntry(entry);
        }
        if (rootIdentity.dev !== envelopeIdentity.dev) throw new Error('Deployment envelope crosses filesystems.');
    }
    await verifyRoot();
    const original = await readDocument(installationFile, 65536, parseDeploymentInstallation);
    const installation: DeploymentInstallation = original.value;
    if (
        installation.platform !== process.platform ||
        installation.architecture !== process.arch ||
        installation.root.realPath !== directory ||
        installation.root.device !== String(rootIdentity.dev) ||
        installation.root.inode !== String(rootIdentity.ino)
    )
        throw new Error('Deployment installation has foreign physical root identity.');
    const identity = createHash('sha256').update(JSON.stringify(installation)).digest('hex');

    async function verifyInstallation() {
        await verifyRoot();
        if (!(await readDocument(installationFile, 65536, parseDeploymentInstallation)).bytes.equals(original.bytes))
            throw new Error('Deployment installation identity changed.');
    }

    async function entryFor(lease: DeploymentLease, kind?: DeploymentLeaseKind) {
        const entry = leases.get(lease);
        if (!entry || entry.closed || (kind !== undefined && entry.kind !== kind))
            throw new Error(`Invalid deployment ${kind ?? ''} lease.`);
        if (entry.parent) await entryFor(entry.parent, 'operation');
        await verifyInstallation();
        const opened = await entry.handle.stat({ bigint: true });
        const named = await lstat(entry.file, { bigint: true });
        regular(opened);
        regular(named);
        if (
            !sameIdentity(entry.identity, opened) ||
            !sameIdentity(opened, named) ||
            opened.size !== 0n ||
            named.size !== 0n
        )
            throw new Error('Deployment lease identity changed.');
        return entry;
    }

    async function state() {
        await verifyInstallation();
        const result = await readDocument(stateFile, 1024, (value) => parseDeploymentState(value, identity));
        await verifyInstallation();
        return result.value;
    }
    await state();

    async function read(lease: DeploymentLease): Promise<DeploymentState> {
        await entryFor(lease);
        const result = await state();
        await entryFor(lease);
        return result;
    }

    async function acquireLease(
        kind: DeploymentLeaseKind,
        operation?: DeploymentLease,
    ): Promise<DeploymentLease | undefined> {
        if (kind !== 'operation' && kind !== 'use' && kind !== 'deletion')
            throw new Error('Invalid deployment lease kind.');
        if (kind === 'deletion') {
            if (!operation) throw new Error('Deletion requires an operation lease.');
            await entryFor(operation, 'operation');
            if ((await state()).phase !== 'removing') throw new Error('Deletion requires a removal fence.');
        } else if (operation !== undefined) throw new Error('Unexpected operation lease.');
        await verifyInstallation();
        const file = path.join(envelope, kind === 'operation' ? 'operation.lock' : 'use.lock');
        const handle = await open(
            file,
            (kind === 'use' ? constants.O_RDONLY : constants.O_RDWR) | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        let retained = false;
        try {
            const opened = await handle.stat({ bigint: true });
            const named = await lstat(file, { bigint: true });
            regular(opened);
            regular(named);
            if (!sameIdentity(opened, named) || opened.size !== 0n || named.size !== 0n)
                throw new Error('Deployment lease identity changed.');
            if (opened.dev !== rootIdentity.dev) throw new Error('Deployment lease crosses filesystems.');
            if (!options.tryLock(handle.fd, { shared: kind === 'use' })) return undefined;
            const lease: DeploymentLease = Object.freeze({
                kind,
                async release() {
                    const entry = leases.get(lease);
                    if (!entry || entry.closed) throw new Error('Deployment lease is closed.');
                    if (writing) throw new Error('Deployment state commit still owns its lease.');
                    if ([...leases.values()].some((other) => !other.closed && other.parent === lease))
                        throw new Error('Deletion still owns its operation lease.');
                    await handle.close();
                    entry.closed = true;
                    leases.delete(lease);
                },
            });
            leases.set(lease, {
                handle,
                file,
                identity: opened,
                kind,
                ...(operation ? { parent: operation } : {}),
                closed: false,
            });
            try {
                await entryFor(lease);
                if (kind === 'use' && (await state()).phase !== 'active')
                    throw new Error('Deployment admission is fenced.');
                if (kind === 'deletion' && (await state()).phase !== 'removing')
                    throw new Error('Deployment deletion fence changed.');
                retained = true;
                return lease;
            } catch (error) {
                leases.delete(lease);
                throw error;
            }
        } finally {
            if (!retained) await handle.close();
        }
    }

    async function tryAcquire(
        kind: DeploymentLeaseKind,
        operation?: DeploymentLease,
    ): Promise<DeploymentLease | undefined> {
        if (kind !== 'deletion') return acquireLease(kind, operation);
        if (writing) throw new Error('Deployment state commit excludes deletion acquisition.');
        // Reserve before the first await, including validation and descriptor acquisition.
        deletionAcquisitions++;
        try {
            return await acquireLease(kind, operation);
        } finally {
            deletionAcquisitions--;
        }
    }

    async function commit(
        operation: DeploymentLease,
        expected: unknown,
        action: unknown,
        deletion?: DeploymentLease,
    ): Promise<DeploymentState> {
        if (writing) throw new Error('Deployment state commit is already in progress.');
        if (deletionAcquisitions > 0) throw new Error('Deployment deletion acquisition excludes state commit.');
        // State writes and pending deletion admission exclude each other through all async work.
        writing = true;
        let temporary: string | undefined;
        let temporaryIdentity: BigIntStats | undefined;
        let attempted = false;
        let result: DeploymentState | undefined;
        let failure: unknown;
        let failed = false;
        try {
            await entryFor(operation, 'operation');
            const previous = parseDeploymentState(expected, identity);
            if (JSON.stringify(await state()) !== JSON.stringify(previous)) throw new Error('Stale deployment state.');
            const next = transitionDeploymentState(previous, action);
            if (
                next.phase === 'active' &&
                previous.phase === 'removing' &&
                [...leases.values()].some((entry) => !entry.closed && entry.parent === operation)
            )
                throw new Error('Cancellation cannot clear a held deletion lease fence.');
            if (next.phase === 'removed') {
                if (!deletion) throw new Error('Completion requires a deletion lease.');
                await entryFor(deletion, 'deletion');
                if (leases.get(deletion)?.parent !== operation) throw new Error('Foreign deletion operation lease.');
            } else if (deletion !== undefined) throw new Error('Unexpected deletion lease.');
            temporary = path.join(envelope, `.state-${randomUUID()}.tmp`);
            const handle = await open(
                temporary,
                constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
                0o600,
            );
            try {
                temporaryIdentity = await handle.stat({ bigint: true });
                regular(temporaryIdentity);
                await handle.writeFile(`${JSON.stringify(next)}\n`, 'utf8');
                await (options.stateIO?.flush ?? ((file) => file.sync()))(handle);
            } finally {
                await handle.close();
            }
            await entryFor(operation, 'operation');
            if (deletion) await entryFor(deletion, 'deletion');
            if (JSON.stringify(await state()) !== JSON.stringify(previous))
                throw new Error('Stale deployment state before commit.');
            const prepared = await lstat(temporary, { bigint: true });
            regular(prepared);
            if (!sameIdentity(temporaryIdentity, prepared)) throw new Error('Deployment temporary identity changed.');
            if (
                JSON.stringify(
                    (await readDocument(temporary, 1024, (value) => parseDeploymentState(value, identity))).value,
                ) !== JSON.stringify(next)
            )
                throw new Error('Deployment prepared state differs.');
            attempted = true;
            await (options.stateIO?.replace ?? rename)(temporary, stateFile);
            result = await read(operation);
            if (JSON.stringify(result) !== JSON.stringify(next)) throw new Error('Deployment state readback differs.');
        } catch (error) {
            failed = true;
            failure = error;
        }
        if (temporary && temporaryIdentity) {
            try {
                await verifyRoot();
                const remaining = await lstat(temporary, { bigint: true });
                regular(remaining);
                if (!sameIdentity(temporaryIdentity, remaining))
                    throw new Error('Deployment temporary identity changed; retained.');
                await unlink(temporary);
            } catch (error) {
                if (errorCode(error) !== 'ENOENT') {
                    failure = !failed
                        ? error
                        : new AggregateError([failure, error], 'Deployment state and temporary cleanup failed.');
                    failed = true;
                }
            }
        }
        writing = false;
        if (failed) throw new DeploymentCommitError(attempted ? 'indeterminate' : 'not-committed', failure);
        if (!result) throw new Error('Missing deployment commit outcome.');
        return result;
    }

    return Object.freeze({ installation, identity, tryAcquire, read, commit });
}
