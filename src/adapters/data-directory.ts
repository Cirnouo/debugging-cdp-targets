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

export interface DataDirectoryLease {
    readonly evidence: DataDirectoryEvidence;
    release(): Promise<DataDirectoryEvidence>;
}
export class DataDirectoryError extends Error {
    readonly code: DataDirectoryErrorCode;
    readonly lease: DataDirectoryLease | undefined;
    constructor(code: DataDirectoryErrorCode, lease?: DataDirectoryLease) {
        super(code);
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
    );
}

/** Gateway-local claims. The application owns all release barriers and late-acquisition tracking. */
export class DataDirectoryRegistry {
    private readonly platform: string;
    private readonly io: DataDirectoryIO;
    private readonly claims = new Map<symbol, string>();
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
        const acquisition = this.acquisition.then(() => this.acquireDirectory(selection, cleanup, onAcquired));
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
        const key = this.key(directory);
        for (const claimed of this.claims.values()) {
            if (this.ancestor(claimed, key) || (descendants && this.ancestor(key, claimed))) {
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
            actual = await this.io.canonical(requested);
            if (!isAbsoluteDataDirectory(actual, this.platform)) throw new DataDirectoryError('directory-invalid');
            if (selected.kind === 'new') {
                const parent = await this.io.inspect(actual);
                if (!parent.isDirectory() || parent.isSymbolicLink())
                    throw new DataDirectoryError('directory-not-directory');
                const native = this.platform === 'win32' ? path.win32 : path.posix;
                if (selected.name !== undefined) {
                    actual = native.join(actual, selected.name);
                    this.available(actual);
                    await this.io.create(actual);
                } else {
                    this.available(actual, false);
                    actual = await this.io.createRandom(native.join(actual, 'dct-'));
                }
            } else this.available(actual);
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
        this.claims.set(generation, key);
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
            if (this.claims.get(generation) === key) this.claims.delete(generation);
        };
        const dispose = async (): Promise<DataDirectoryEvidence> => {
            await inspectionFinished;
            if (state === 'retained' || state === 'deleted') return evidence();
            if (cleanup === 'retain') {
                state = 'retained';
                removeClaim();
                return evidence();
            }
            try {
                if (this.claims.get(generation) !== key || identity === undefined)
                    throw new DataDirectoryError('directory-identity-changed', lease);
                const current = await this.io.inspect(actual);
                if (
                    !current.isDirectory() ||
                    current.isSymbolicLink() ||
                    current.dev !== identity.dev ||
                    current.ino !== identity.ino
                ) {
                    throw new DataDirectoryError('directory-identity-changed', lease);
                }
                await this.io.remove(actual);
                state = 'deleted';
                removeClaim();
                return evidence();
            } catch (error) {
                state = 'cleanup-failed';
                throw error instanceof DataDirectoryError
                    ? error
                    : new DataDirectoryError('directory-cleanup-failed', lease);
            }
        };
        const lease: DataDirectoryLease = {
            get evidence() {
                return evidence();
            },
            release: () => {
                if (pendingRelease) return pendingRelease;
                const release = dispose();
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
            const root = await this.io.inspect(actual);
            if (!root.isDirectory() || root.isSymbolicLink()) {
                if (selected.kind === 'existing') removeClaim();
                throw new DataDirectoryError('directory-not-directory', selected.kind === 'new' ? lease : undefined);
            }
            identity = root;
            nonempty = (await this.io.entries(actual)).length > 0;
            return lease;
        } catch (error) {
            state = 'cleanup-failed';
            if (
                error instanceof DataDirectoryError &&
                ['directory-not-directory', 'directory-overlap'].includes(error.code)
            )
                throw error;
            throw new DataDirectoryError('directory-inspection-failed', lease);
        } finally {
            finishInspection();
        }
    }
}
