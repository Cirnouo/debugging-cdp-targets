import { isRecord } from '../shared/errors.ts';
import { isPortablePayloadRelativePath } from '../shared/payload-path.ts';

export const APP_ELECTRON_VERSION = '44.8.0';
export const APP_NODE_VERSION = '24.21.0';
export type AppReleaseFile = Readonly<{ path: string; bytes: number; sha256: string }>;
export type AppRuntimeFile = AppReleaseFile & Readonly<{ destination: string }>;
export type AppArchive = Readonly<{
    kind: 'electron' | 'node';
    version: string;
    platform: 'win32' | 'darwin' | 'linux';
    architecture: 'x64' | 'arm64';
    filename: string;
    url: string;
    bytes: number;
    sha256: string;
    runtimeFiles?: readonly AppRuntimeFile[];
    licenses?: readonly AppReleaseFile[];
}>;
export type AppReleaseInputs = Readonly<{
    schemaVersion: 1;
    sources: Readonly<{ electronChecksums: string; electronRelease: string; nodeChecksums: string }>;
    archives: readonly AppArchive[];
}>;
export type AppNativePackage = Readonly<{
    package: string;
    version: string;
    tarball: string;
    integrity: string;
    files: readonly AppReleaseFile[];
}>;
export type AppNativeEvidence = Readonly<{ schemaVersion: 1; packages: readonly AppNativePackage[] }>;

const NATIVE_VERSIONS = new Map([
    ['fs-native-extensions', '1.5.1'],
    ['require-addon', '1.3.0'],
    ['which-runtime', '1.4.0'],
    ['bare-addon-resolve', '1.11.0'],
    ['bare-module-resolve', '1.12.6'],
    ['bare-semver', '1.1.0'],
]);

function fields(
    value: unknown,
    required: readonly string[],
    optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
    if (
        !isRecord(value) ||
        required.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
    )
        throw new Error('Malformed App release evidence fields.');
}

function digest(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function releaseFile(value: unknown, withDestination = false): AppReleaseFile {
    fields(value, ['path', 'bytes', 'sha256'], withDestination ? ['destination'] : []);
    if (
        !isPortablePayloadRelativePath(value.path) ||
        typeof value.bytes !== 'number' ||
        !Number.isSafeInteger(value.bytes) ||
        value.bytes < 0 ||
        !digest(value.sha256)
    )
        throw new Error('Invalid App release file identity.');
    return Object.freeze({ path: value.path, bytes: value.bytes, sha256: value.sha256 });
}

function files(value: unknown, withDestination = false): AppReleaseFile[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error('Missing App release file inventory.');
    const result = value.map((entry) => releaseFile(entry, withDestination));
    if (new Set(result.map((file) => file.path.toLowerCase())).size !== result.length)
        throw new Error('Duplicate App release file identity.');
    return result;
}

export function parseAppReleaseInputs(value: unknown): AppReleaseInputs {
    fields(value, ['schemaVersion', 'sources', 'archives']);
    fields(value.sources, ['electronChecksums', 'electronRelease', 'nodeChecksums']);
    if (
        value.schemaVersion !== 1 ||
        value.sources.electronChecksums !==
            `https://github.com/electron/electron/releases/download/v${APP_ELECTRON_VERSION}/SHASUMS256.txt` ||
        value.sources.electronRelease !==
            `https://api.github.com/repos/electron/electron/releases/tags/v${APP_ELECTRON_VERSION}` ||
        value.sources.nodeChecksums !== `https://nodejs.org/dist/v${APP_NODE_VERSION}/SHASUMS256.txt` ||
        !Array.isArray(value.archives) ||
        value.archives.length !== 12
    )
        throw new Error('Invalid App release source or archive inventory.');
    const identities = new Set<string>();
    const archives: AppArchive[] = value.archives.map((entry: unknown) => {
        fields(
            entry,
            ['kind', 'version', 'platform', 'architecture', 'filename', 'url', 'bytes', 'sha256'],
            ['runtimeFiles', 'licenses'],
        );
        if (
            (entry.kind !== 'electron' && entry.kind !== 'node') ||
            (entry.platform !== 'win32' && entry.platform !== 'darwin' && entry.platform !== 'linux') ||
            (entry.architecture !== 'x64' && entry.architecture !== 'arm64')
        )
            throw new Error('Unsupported App archive platform identity.');
        const version = entry.kind === 'electron' ? APP_ELECTRON_VERSION : APP_NODE_VERSION;
        const nodePlatform = entry.platform === 'win32' ? 'win' : entry.platform;
        const filename =
            entry.kind === 'electron'
                ? `electron-v${version}-${entry.platform}-${entry.architecture}.zip`
                : `node-v${version}-${nodePlatform}-${entry.architecture}.${entry.platform === 'win32' ? 'zip' : 'tar.gz'}`;
        const url =
            entry.kind === 'electron'
                ? `https://github.com/electron/electron/releases/download/v${version}/${filename}`
                : `https://nodejs.org/dist/v${version}/${filename}`;
        if (
            entry.version !== version ||
            entry.filename !== filename ||
            entry.url !== url ||
            typeof entry.bytes !== 'number' ||
            !Number.isSafeInteger(entry.bytes) ||
            entry.bytes <= 0 ||
            !digest(entry.sha256)
        )
            throw new Error('Changed App archive immutable source identity.');
        const identity = `${entry.kind}:${entry.platform}:${entry.architecture}`;
        if (identities.has(identity)) throw new Error('Duplicate App archive inventory identity.');
        identities.add(identity);
        let runtimeFiles: AppRuntimeFile[] | undefined;
        if (entry.runtimeFiles !== undefined) {
            if (entry.kind !== 'node' || !Array.isArray(entry.runtimeFiles))
                throw new Error('Invalid Node runtime file inventory.');
            files(entry.runtimeFiles, true);
            runtimeFiles = entry.runtimeFiles.map((file: unknown) => {
                fields(file, ['path', 'destination', 'bytes', 'sha256']);
                if (!isPortablePayloadRelativePath(file.destination)) throw new Error('Invalid Node delivery path.');
                return { ...releaseFile(file, true), destination: file.destination };
            });
            if (
                new Set(runtimeFiles.map((file) => file.destination.toLowerCase())).size !== runtimeFiles.length ||
                !runtimeFiles.some((file) => file.destination === 'LICENSE') ||
                !runtimeFiles.some((file) => file.destination === (entry.platform === 'win32' ? 'node.exe' : 'node'))
            )
                throw new Error('Incomplete Node runtime and license evidence.');
        }
        let licenses: AppReleaseFile[] | undefined;
        if (entry.licenses !== undefined) {
            if (entry.kind !== 'electron') throw new Error('Unexpected App archive license inventory.');
            licenses = files(entry.licenses);
            if (
                !licenses.some((file) => file.path === 'LICENSE') ||
                !licenses.some((file) => file.path === 'LICENSES.chromium.html')
            )
                throw new Error('Incomplete Electron license evidence.');
        }
        return Object.freeze({
            kind: entry.kind,
            version,
            platform: entry.platform,
            architecture: entry.architecture,
            filename,
            url,
            bytes: entry.bytes,
            sha256: entry.sha256,
            ...(runtimeFiles ? { runtimeFiles } : {}),
            ...(licenses ? { licenses } : {}),
        });
    });
    return Object.freeze({
        schemaVersion: 1,
        sources: {
            electronChecksums: `https://github.com/electron/electron/releases/download/v${APP_ELECTRON_VERSION}/SHASUMS256.txt`,
            electronRelease: `https://api.github.com/repos/electron/electron/releases/tags/v${APP_ELECTRON_VERSION}`,
            nodeChecksums: `https://nodejs.org/dist/v${APP_NODE_VERSION}/SHASUMS256.txt`,
        },
        archives,
    });
}

export function parseAppNativeEvidence(value: unknown): AppNativeEvidence {
    fields(value, ['schemaVersion', 'packages']);
    if (value.schemaVersion !== 1 || !Array.isArray(value.packages) || value.packages.length !== NATIVE_VERSIONS.size)
        throw new Error('Incomplete App native loading closure.');
    const identities = new Set<string>();
    const packages: AppNativePackage[] = value.packages.map((entry: unknown) => {
        fields(entry, ['package', 'version', 'tarball', 'integrity', 'files']);
        if (
            typeof entry.package !== 'string' ||
            NATIVE_VERSIONS.get(entry.package) !== entry.version ||
            typeof entry.version !== 'string' ||
            entry.tarball !== `https://registry.npmjs.org/${entry.package}/-/${entry.package}-${entry.version}.tgz` ||
            typeof entry.integrity !== 'string' ||
            !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity) ||
            identities.has(entry.package)
        )
            throw new Error('Invalid or duplicate App native package identity.');
        identities.add(entry.package);
        const inventory = files(entry.files);
        for (const required of [
            'LICENSE',
            'package.json',
            ...(entry.package === 'fs-native-extensions'
                ? [
                      'index.js',
                      'binding.js',
                      ...['win32', 'darwin', 'linux'].flatMap((platform) =>
                          ['x64', 'arm64'].map(
                              (architecture) => `prebuilds/${platform}-${architecture}/fs-native-extensions.node`,
                          ),
                      ),
                  ]
                : []),
        ])
            if (!inventory.some((file) => file.path === required))
                throw new Error('Incomplete native package or license evidence.');
        return Object.freeze({
            package: entry.package,
            version: entry.version,
            tarball: entry.tarball,
            integrity: entry.integrity,
            files: inventory,
        });
    });
    return Object.freeze({ schemaVersion: 1, packages });
}
