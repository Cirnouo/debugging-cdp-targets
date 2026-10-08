import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import {
    type DataDirectoryCleanup,
    type DataDirectoryEvidence,
    type DataDirectorySelection,
    type DataDirectoryState,
    parseDataIsolation,
} from '../domains/data-isolation.ts';
import { errorCode } from '../shared/errors.ts';
import {
    beginFixtureStage,
    captureFixtureOrigin,
    type FixtureFields,
    type FixtureStage,
    runFixtureResource,
} from './fixture-diagnostics.ts';

export interface DataDirectoryLease {
    readonly evidence: DataDirectoryEvidence;
    release(): Promise<DataDirectoryEvidence>;
}
export class DataDirectoryError extends Error {
    readonly code: DataDirectoryErrorCode;
    readonly lease: DataDirectoryLease | undefined;
    constructor(code: DataDirectoryErrorCode, lease?: DataDirectoryLease, cause?: unknown) {
        super(code, cause === undefined ? undefined : { cause });
        this.code = code;
        this.lease = lease;
    }
}
export type DataDirectoryErrorCode =
    | 'directory-invalid'
    | 'directory-missing'
    | 'directory-exists'
    | 'directory-not-directory'
    | 'directory-overlap'
    | 'directory-acquisition-failed'
    | 'directory-inspection-failed'
    | 'directory-identity-changed'
    | 'directory-cleanup-failed';

export interface DataDirectoryIO {
    canonical(directory: string): Promise<string>;
    inspect(directory: string): Promise<BigIntStats>;
    entries(directory: string): Promise<string[]>;
    create(directory: string): Promise<void>;
    createRandom(prefix: string): Promise<string>;
    remove(directory: string): Promise<void>;
}

interface DirectoryIdentity {
    dev: bigint;
    ino: bigint;
}

interface DirectoryLocation {
    path: string;
    identity: DirectoryIdentity;
}

interface DirectoryClaim {
    key: string;
    locations?: DirectoryLocation[];
}

function sameDirectory(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
    return left.dev === right.dev && left.ino === right.ino;
}

export function isAbsoluteDataDirectory(directory: string, platform: string): boolean {
    if (!directory.trim() || directory.includes('\0')) return false;
    if (platform !== 'win32') return path.posix.isAbsolute(directory);
    const namespace = directory.replaceAll('/', '\\').match(/^\\\\[?.]\\(.*)$/)?.[1];
    if (namespace !== undefined) {
        if (/^[A-Za-z]:/.test(namespace)) return /^[A-Za-z]:\\/.test(namespace);
        if (/^UNC(?:\\|$)/i.test(namespace)) return /^UNC\\[^\\]+\\[^\\]+(?:\\|$)/i.test(namespace);
        if (/^Volume\{[^{}]+\}\\/i.test(namespace)) return true;
        return /^[^\\]+\\[^\\]+/.test(namespace);
    }
    return /^[A-Za-z]:[/\\]/.test(directory) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+(?:[/\\]|$)/.test(directory);
}

function filesystemFailure(error: unknown, fallback: DataDirectoryErrorCode): DataDirectoryError {
    if (error instanceof DataDirectoryError) return error;
    const code = errorCode(error);
    return new DataDirectoryError(
        code === 'ENOENT'
            ? 'directory-missing'
            : code === 'EEXIST'
              ? 'directory-exists'
              : code === 'ENOTDIR'
                ? 'directory-not-directory'
                : fallback,
        undefined,
        error,
    );
}

async function observeDirectory<T>(
    stage: FixtureStage,
    phase: NonNullable<FixtureFields['phase']>,
    job: () => Promise<T>,
): Promise<T> {
    const finish = beginFixtureStage(stage, { phase });
    try {
        const result = await job();
        finish('succeeded');
        return result;
    } catch (error) {
        finish('failed', {}, error);
        throw error;
    }
}

/** Gateway-local claims. The application owns all release barriers and late-acquisition tracking. */
export class DataDirectoryRegistry {
    private readonly platform: string;
    private readonly io: DataDirectoryIO;
    private readonly claims = new Map<symbol, DirectoryClaim>();
    private acquisition: Promise<unknown> = Promise.resolve();

    constructor(options: { io?: Partial<DataDirectoryIO>; platform?: string } = {}) {
        this.platform = options.platform ?? process.platform;
        this.io = {
            canonical: realpath,
            inspect: (directory) => lstat(directory, { bigint: true }),
            entries: readdir,
            create: async (directory) => {
                await mkdir(directory);
            },
            createRandom: mkdtemp,
            remove: (directory) => rm(directory, { recursive: true, force: false }),
            ...options.io,
        };
    }

    acquire(
        selection: DataDirectorySelection,
        cleanup: DataDirectoryCleanup,
        onAcquired?: (lease: DataDirectoryLease) => void,
    ): Promise<DataDirectoryLease> {
        const origin = captureFixtureOrigin({ sessionId: undefined });
        const acquisition = this.acquisition.then(() =>
            runFixtureResource(origin, () =>
                observeDirectory('data-directory-acquire', 'acquiring-data-directory', () =>
                    this.acquireDirectory(selection, cleanup, onAcquired),
                ),
            ),
        );
        this.acquisition = acquisition.catch(() => undefined);
        return acquisition;
    }

    private key(directory: string): string {
        const native = this.platform === 'win32' ? path.win32 : path.posix;
        const normalized = native.normalize(directory);
        const key = this.platform === 'win32' ? normalized.toLowerCase() : normalized;
        return key.length > native.parse(key).root.length
            ? key.replace(this.platform === 'win32' ? /\\+$/ : /\/+$/, '')
            : key;
    }

    private ancestor(ancestor: string, child: string): boolean {
        const separator = this.platform === 'win32' ? '\\' : '/';
        return (
            child === ancestor || child.startsWith(ancestor.endsWith(separator) ? ancestor : `${ancestor}${separator}`)
        );
    }

    private available(directory: string, descendants = true): void {
        const finish = beginFixtureStage('data-directory-acquire', { phase: 'overlap' });
        try {
            const key = this.key(directory);
            for (const claimed of this.claims.values()) {
                if (this.ancestor(claimed.key, key) || (descendants && this.ancestor(key, claimed.key))) {
                    throw new DataDirectoryError('directory-overlap');
                }
            }
            finish('succeeded');
        } catch (error) {
            finish('rejected', {}, error);
            throw error;
        }
    }

    private async locations(
        directory: string,
        root?: BigIntStats,
        stage: FixtureStage = 'data-directory-acquire',
    ): Promise<DirectoryLocation[]> {
        const native = this.platform === 'win32' ? path.win32 : path.posix;
        const locations: DirectoryLocation[] = [];
        let current = directory;
        try {
            for (;;) {
                const identity =
                    current === directory && root !== undefined
                        ? root
                        : await observeDirectory(stage, 'inspect', () => this.io.inspect(current));
                if (!identity.isDirectory() || identity.isSymbolicLink())
                    throw new DataDirectoryError('directory-inspection-failed');
                locations.push({ path: current, identity: { dev: identity.dev, ino: identity.ino } });
                const parent = native.dirname(current);
                if (parent === current) break;
                current = parent;
            }
            const captured = locations[0];
            const confirmed = await observeDirectory(stage, 'inspect', () => this.io.inspect(directory));
            if (
                !captured ||
                !confirmed.isDirectory() ||
                confirmed.isSymbolicLink() ||
                !sameDirectory(confirmed, captured.identity)
            )
                throw new DataDirectoryError('directory-inspection-failed');
            return locations;
        } catch (error) {
            throw new DataDirectoryError('directory-inspection-failed', undefined, error);
        }
    }

    private availableObjects(
        locations: DirectoryLocation[],
        descendants = true,
        excluded?: DirectoryClaim,
        stage: FixtureStage = 'data-directory-acquire',
    ): Promise<void> {
        return observeDirectory(stage, 'overlap', () =>
            this.verifyAvailableObjects(locations, descendants, excluded, stage),
        );
    }

    private async verifyAvailableObjects(
        locations: DirectoryLocation[],
        descendants: boolean,
        excluded: DirectoryClaim | undefined,
        stage: FixtureStage,
    ): Promise<void> {
        const root = locations[0];
        if (!root) throw new DataDirectoryError('directory-inspection-failed');
        for (const claimed of this.claims.values()) {
            if (claimed === excluded) continue;
            const held = claimed.locations;
            const heldRoot = held?.[0];
            if (!held || !heldRoot) throw new DataDirectoryError('directory-inspection-failed');
            try {
                for (const location of [...held].reverse()) {
                    const current = await observeDirectory(stage, 'inspect', () => this.io.inspect(location.path));
                    if (
                        !current.isDirectory() ||
                        current.isSymbolicLink() ||
                        !sameDirectory(current, location.identity)
                    )
                        throw new DataDirectoryError('directory-inspection-failed');
                }
            } catch (error) {
                throw new DataDirectoryError('directory-inspection-failed', undefined, error);
            }
            // Roots may have several canonical names; shared ancestors alone do not make siblings overlap.
            if (
                sameDirectory(root.identity, heldRoot.identity) ||
                locations.slice(1).some((location) => sameDirectory(location.identity, heldRoot.identity)) ||
                (descendants && held.slice(1).some((location) => sameDirectory(location.identity, root.identity)))
            ) {
                throw new DataDirectoryError('directory-overlap');
            }
        }
    }

    private async acquireDirectory(
        selection: DataDirectorySelection,
        cleanup: DataDirectoryCleanup,
        onAcquired?: (lease: DataDirectoryLease) => void,
    ): Promise<DataDirectoryLease> {
        let parsed: ReturnType<typeof parseDataIsolation>;
        try {
            parsed = parseDataIsolation({ mode: 'data-dir', directory: selection, cleanup });
        } catch {
            throw new DataDirectoryError('directory-invalid');
        }
        if (parsed.mode !== 'data-dir') throw new DataDirectoryError('directory-invalid');
        const selected = parsed.directory;
        const requested = selected.kind === 'existing' ? selected.path : selected.parent;
        if (!isAbsoluteDataDirectory(requested, this.platform)) throw new DataDirectoryError('directory-invalid');
        let actual: string;
        try {
            actual = await observeDirectory('data-directory-acquire', 'canonical', () => this.io.canonical(requested));
            if (!isAbsoluteDataDirectory(actual, this.platform)) throw new DataDirectoryError('directory-invalid');
            if (selected.kind === 'new') {
                const parent = await observeDirectory('data-directory-acquire', 'inspect', () =>
                    this.io.inspect(actual),
                );
                if (!parent.isDirectory() || parent.isSymbolicLink())
                    throw new DataDirectoryError('directory-not-directory');
                if (this.claims.size > 0) await this.availableObjects(await this.locations(actual, parent), false);
                const native = this.platform === 'win32' ? path.win32 : path.posix;
                if (selected.name !== undefined) {
                    actual = native.join(actual, selected.name);
                    this.available(actual);
                    await observeDirectory('data-directory-acquire', 'create', () => this.io.create(actual));
                } else {
                    this.available(actual, false);
                    actual = await observeDirectory('data-directory-acquire', 'create', () =>
                        this.io.createRandom(native.join(actual, 'dct-')),
                    );
                }
            } else {
                this.available(actual);
                if (this.claims.size > 0) await this.availableObjects(await this.locations(actual));
            }
        } catch (error) {
            throw filesystemFailure(error, 'directory-acquisition-failed');
        }
        // Claim before inspection so successful creation can never disappear from the ownership ledger.
        const key = this.key(actual);
        const generation = Symbol('directory-claim');
        let overlap = false;
        try {
            this.available(actual);
        } catch {
            overlap = true;
        }
        const claim: DirectoryClaim = { key };
        this.claims.set(generation, claim);
        let identity: BigIntStats | undefined;
        let nonempty: boolean | undefined;
        let state: DataDirectoryState = 'held';
        let pendingRelease: Promise<DataDirectoryEvidence> | undefined;
        let finishInspection = () => {};
        const inspectionFinished = new Promise<void>((resolve) => {
            finishInspection = resolve;
        });
        const evidence = (): DataDirectoryEvidence =>
            Object.freeze({ path: actual, cleanup, state, ...(nonempty === undefined ? {} : { nonempty }) });
        const removeClaim = () => {
            if (this.claims.get(generation) === claim) this.claims.delete(generation);
        };
        const origin = captureFixtureOrigin({ sessionId: undefined });
        const dispose = async (): Promise<DataDirectoryEvidence> => {
            await inspectionFinished;
            if (state === 'retained' || state === 'deleted') return evidence();
            if (cleanup === 'retain') {
                state = 'retained';
                removeClaim();
                return evidence();
            }
            try {
                const current = await observeDirectory('data-directory-cleanup', 'identity', async () => {
                    if (this.claims.get(generation) !== claim || identity === undefined)
                        throw new DataDirectoryError('directory-identity-changed', lease);
                    const current = await observeDirectory('data-directory-cleanup', 'inspect', () =>
                        this.io.inspect(actual),
                    );
                    if (
                        !current.isDirectory() ||
                        current.isSymbolicLink() ||
                        current.dev !== identity.dev ||
                        current.ino !== identity.ino
                    )
                        throw new DataDirectoryError('directory-identity-changed', lease);
                    return current;
                });
                if (this.claims.size > 1)
                    await this.availableObjects(
                        await this.locations(actual, current, 'data-directory-cleanup'),
                        true,
                        claim,
                        'data-directory-cleanup',
                    );
                await observeDirectory('data-directory-cleanup', 'remove', () => this.io.remove(actual));
                state = 'deleted';
                removeClaim();
                return evidence();
            } catch (error) {
                state = 'cleanup-failed';
                throw error instanceof DataDirectoryError
                    ? error
                    : new DataDirectoryError('directory-cleanup-failed', lease, error);
            }
        };
        const lease: DataDirectoryLease = {
            get evidence() {
                return evidence();
            },
            release: () => {
                if (pendingRelease) return pendingRelease;
                const release = runFixtureResource(origin, () =>
                    observeDirectory('data-directory-release', 'resource-cleanup', dispose),
                );
                pendingRelease = release;
                void release.then(
                    () => {
                        pendingRelease = undefined;
                    },
                    () => {
                        pendingRelease = undefined;
                    },
                );
                return release;
            },
        };
        try {
            onAcquired?.(lease);
            if (overlap) throw new DataDirectoryError('directory-overlap', lease);
            const root = await observeDirectory('data-directory-acquire', 'inspect', () => this.io.inspect(actual));
            if (!root.isDirectory() || root.isSymbolicLink()) {
                if (selected.kind === 'existing') removeClaim();
                throw new DataDirectoryError('directory-not-directory', selected.kind === 'new' ? lease : undefined);
            }
            identity = root;
            claim.locations = await this.locations(actual, root);
            await this.availableObjects(claim.locations, true, claim);
            nonempty =
                (await observeDirectory('data-directory-acquire', 'entries', () => this.io.entries(actual))).length > 0;
            return lease;
        } catch (error) {
            state = 'cleanup-failed';
            if (error instanceof DataDirectoryError && error.code === 'directory-overlap')
                throw new DataDirectoryError('directory-overlap', lease, error);
            if (error instanceof DataDirectoryError && error.code === 'directory-not-directory') throw error;
            throw new DataDirectoryError('directory-inspection-failed', lease, error);
        } finally {
            finishInspection();
        }
    }
}
