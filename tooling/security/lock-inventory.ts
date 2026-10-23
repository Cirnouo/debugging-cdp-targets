import { parseAllDocuments } from 'yaml';
import { isSemVer } from '../../src/domains/software-version.ts';
import { isRecord } from '../../src/shared/errors.ts';

export interface PackageIdentity {
    name: string;
    version: string;
    integrity: string;
}
export interface LockReference {
    specifier?: string;
    version: string;
}
export interface LockImporter {
    configDependencies?: unknown;
    dependencies?: Record<string, LockReference>;
    devDependencies?: Record<string, LockReference>;
    optionalDependencies?: Record<string, LockReference>;
    packageManagerDependencies?: Record<string, LockReference>;
}
export interface LockDocument {
    lockfileVersion: string;
    configDependencies?: unknown;
    importers: Record<string, LockImporter>;
    packages: Record<string, { resolution: { integrity: string; tarball?: string } }>;
    snapshots: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
}
export interface LockInventory {
    packages: PackageIdentity[];
    documents: LockDocument[];
}
const PACKAGE = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/;
function demand(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
function identity(key: string) {
    const match = /^((?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)@([^()]+)(?:\(.*\))?$/.exec(key);
    demand(
        match?.[1] && match[2] && PACKAGE.test(match[1]) && isSemVer(match[2]),
        `Non-registry or unpinned dependency: ${key}`,
    );
    return { name: match[1], version: match[2] };
}

export function validateConfigurationDependencies(value: unknown) {
    demand(
        value === undefined || (object(value) && Object.keys(value).length === 0),
        'Unreviewed configuration dependencies are prohibited.',
    );
}

export function readLockInventory(source: string): LockInventory {
    const parsed = parseAllDocuments(source);
    demand(parsed.length > 0 && parsed.every((doc) => doc.errors.length === 0), 'Malformed lockfile YAML.');
    const values: unknown[] = parsed.map((doc) => doc.toJS() as unknown);
    const documents: LockDocument[] = [];
    const all = new Map<string, PackageIdentity>();
    for (const doc of values) {
        demand(
            object(doc) &&
                doc.lockfileVersion === '9.0' &&
                object(doc.importers) &&
                object(doc.importers['.']) &&
                object(doc.packages) &&
                object(doc.snapshots),
            'Incomplete lockfile inventory.',
        );
        validateConfigurationDependencies(doc.configDependencies);
        const packageKeys = new Set();
        for (const [key, value] of Object.entries(doc.packages)) {
            const { name, version } = identity(key);
            demand(object(value) && object(value.resolution), `Invalid resolution: ${key}`);
            const integrity = value.resolution.integrity;
            demand(
                nonempty(integrity) && /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(integrity),
                `Missing registry integrity: ${key}`,
            );
            demand(
                !value.resolution.tarball ||
                    (typeof value.resolution.tarball === 'string' &&
                        value.resolution.tarball.startsWith('https://registry.npmjs.org/')),
                `Non-standard dependency source: ${key}`,
            );
            const previous = all.get(`${name}@${version}`);
            demand(!previous || previous.integrity === integrity, `Conflicting dependency integrity: ${key}`);
            all.set(`${name}@${version}`, { name, version, integrity });
            packageKeys.add(`${name}@${version}`);
        }
        const snapshotKeys = new Set(
            Object.keys(doc.snapshots).map((key) => {
                const item = identity(key);
                const plain = `${item.name}@${item.version}`;
                demand(packageKeys.has(plain), `Snapshot missing from inventory: ${key}`);
                return plain;
            }),
        );
        demand(snapshotKeys.size === packageKeys.size, 'Lockfile graph omits packages.');
        for (const snapshot of Object.values(doc.snapshots)) {
            demand(object(snapshot), 'Invalid dependency snapshot.');
            for (const field of ['dependencies', 'optionalDependencies']) {
                const dependencies = snapshot[field] ?? {};
                demand(object(dependencies), 'Invalid snapshot dependencies.');
                for (const [name, version] of Object.entries(dependencies)) {
                    demand(typeof version === 'string', 'Invalid dependency version.');
                    const item = identity(`${name}@${version}`);
                    demand(
                        packageKeys.has(`${item.name}@${item.version}`),
                        `Graph references missing dependency: ${name}@${version}`,
                    );
                }
            }
        }
        for (const importer of Object.values(doc.importers)) {
            demand(object(importer), 'Invalid lock importer.');
            validateConfigurationDependencies(importer.configDependencies);
            for (const field of [
                'dependencies',
                'devDependencies',
                'optionalDependencies',
                'packageManagerDependencies',
            ]) {
                const dependencies = importer[field] ?? {};
                demand(object(dependencies), 'Invalid importer dependencies.');
                for (const [name, value] of Object.entries(dependencies)) {
                    demand(
                        object(value) &&
                            typeof value.version === 'string' &&
                            (value.specifier === undefined || typeof value.specifier === 'string'),
                        'Invalid importer reference.',
                    );
                    const item = identity(`${name}@${value.version}`);
                    demand(
                        packageKeys.has(`${item.name}@${item.version}`),
                        `Importer references missing dependency: ${name}`,
                    );
                }
            }
        }
        // All nested lock identities and references were checked above.
        documents.push({
            ...doc,
            lockfileVersion: '9.0',
            importers: doc.importers as Record<string, LockImporter>,
            packages: doc.packages as LockDocument['packages'],
            snapshots: doc.snapshots as LockDocument['snapshots'],
        });
    }
    demand(all.size > 0, 'Empty dependency inventory.');
    return {
        packages: [...all.values()].sort((a, b) =>
            `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'),
        ),
        documents,
    };
}

export function canonicalLockEvidence(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalLockEvidence);
    if (isRecord(value))
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonicalLockEvidence(value[key])]),
        );
    return value;
}
