import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { type FileHandle, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { identifyDeploymentPayload, verifyDeploymentPayload } from '../src/adapters/app-delivery.ts';
import {
    createFreshDeploymentInstallation,
    type DeploymentLease,
    identifyDeploymentInstallation,
} from '../src/adapters/app-deployment.ts';
import { loadAppAdvisoryLock, verifyAppNativeInputs } from '../src/adapters/app-native.ts';
import { readRegularFile } from '../src/adapters/file-evidence.ts';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import {
    packWindowsDeploymentQueries,
    preflightWindowsDeploymentCopy,
} from '../src/adapters/windows-deployment-protocol.ts';
import {
    type DeploymentPayloadEntry,
    type DeploymentPayloadManifest,
    type DeploymentSelection,
    parseDeploymentPayloadManifest,
    parseDeploymentState,
} from '../src/domains/app-deployment.ts';
import { type AppDistribution, parseAppDistribution } from '../src/domains/app-distribution.ts';
import {
    type AppArchive,
    type AppNativePackage,
    type AppReleaseFile,
    parseAppNativeEvidence,
    parseAppReleaseInputs,
} from '../src/domains/app-release.ts';
import { isSemVer } from '../src/domains/software-version.ts';
import {
    type OfficialReleaseEvidence,
    parseOfficialReleaseEvidence,
} from '../src/gateway/official/release-evidence.ts';
import { isRecord } from '../src/shared/errors.ts';
import { isPortablePayloadRelativePath } from '../src/shared/payload-path.ts';
import { collectBundledLicenses } from './licenses/bundled-notices.ts';
import { verifyOfficialInputs } from './security/official-inputs.ts';

type AppBuild = Omit<AppDistribution, 'schemaVersion'> & {
    root: string;
    onInputs?: (inputs: readonly string[]) => Promise<void>;
};
export type StagedDesktopApp = Readonly<
    DeploymentSelection & {
        root: string;
        manifest: DeploymentPayloadManifest;
        canonicalManifest: string;
        provenance: Readonly<{
            electron: AppArchive;
            node: AppArchive;
            official: OfficialReleaseEvidence;
            nativePackages: readonly AppNativePackage[];
            generatedInputs: readonly AppReleaseFile[];
        }>;
    }
>;

function fileIdentity(name: string, bytes: Buffer): AppReleaseFile {
    return Object.freeze({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}

export class FreshDeploymentError extends Error {
    readonly outcome: 'not-published' | 'indeterminate';
    constructor(outcome: 'not-published' | 'indeterminate', cause: unknown) {
        super(`Fresh deployment ${outcome}; retained objects must not be adopted or automatically replayed.`, {
            cause,
        });
        this.outcome = outcome;
    }
}

/** Explicit contributor build only. The source producer is internal and cannot be replaced by caller evidence. */
export async function stageFreshDesktopInstallation(
    options: AppBuild & { electronArchive: string; nodeArchive: string; output: string },
): Promise<Readonly<DeploymentSelection & { installationRoot: string; buildRoot: string; executablePath: string }>> {
    const request = Object.freeze({
        root: options.root,
        kind: options.kind,
        platform: options.platform,
        architecture: options.architecture,
        electronArchive: options.electronArchive,
        nodeArchive: options.nodeArchive,
        output: options.output,
        ...(options.onInputs ? { onInputs: options.onInputs } : {}),
    });
    if (
        process.platform !== 'win32' ||
        process.arch !== 'x64' ||
        request.platform !== 'win32' ||
        request.architecture !== 'x64'
    )
        throw new Error('Fresh build enrollment supports Windows x64 only; other native cells remain pending.');
    parseAppDistribution(
        { schemaVersion: 1, kind: request.kind, platform: request.platform, architecture: request.architecture },
        request,
    );
    if (!path.isAbsolute(request.output) || path.resolve(request.output) !== request.output)
        throw new Error('Fresh installation destination must be a canonical absolute new leaf.');
    const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-app-enrollment-')));
    const scratchIdentity = await lstat(scratch, { bigint: true });
    let operation: FileHandle | undefined;
    let nativeLifetime: Awaited<ReturnType<typeof createFreshDeploymentInstallation>> | undefined;
    let use: DeploymentLease | undefined;
    let stateAttempted = false;
    let failed = false;
    let problem: unknown;
    let result:
        | Readonly<DeploymentSelection & { installationRoot: string; buildRoot: string; executablePath: string }>
        | undefined;
    const record = (error: unknown) => {
        problem = failed ? new AggregateError([problem, error], 'Fresh transaction/resource failures.') : error;
        failed = true;
    };
    try {
        const source = await stageDesktopApp({ ...request, output: path.join(scratch, 'source') });
        const canonicalManifest = Buffer.from(source.canonicalManifest, 'utf8');
        // First consumer baseline only: no claim of a retained producer-original inode.
        const sourceIdentity = await lstat(source.root, { bigint: true });
        const selection = Object.freeze({
            selectedBuildId: source.selectedBuildId,
            selectedManifestSha256: source.selectedManifestSha256,
            platform: request.platform,
            architecture: request.architecture,
        });
        const root = request.output;
        const nonce = randomUUID();
        const relativeStage = path.join('.staging', nonce, 'payload');
        const relativeBuild = path.join('builds', selection.selectedBuildId);
        preflightWindowsDeploymentCopy(
            root,
            relativeStage.split(path.sep).join('/'),
            source.manifest.entries,
            canonicalManifest,
        );
        // All actually planned fresh/control/stage/final names must fit the real query reply codec
        // before root creation. This is representability only, never permission evidence.
        const planned = new Set<string>([root]);
        for (const relative of [
            '.deployment',
            'builds',
            '.staging',
            path.join('.staging', nonce),
            relativeStage,
            relativeBuild,
            path.join('.deployment', 'operation.lock'),
            path.join('.deployment', 'use.lock'),
            path.join('.deployment', `.installation-${nonce}.json`),
            path.join('.deployment', `.state-${nonce}.json`),
            path.join('.deployment', 'installation.json'),
            path.join('.deployment', 'state.json'),
        ])
            planned.add(path.join(root, relative));
        for (const base of [relativeStage, relativeBuild])
            for (const relative of [...source.manifest.entries.map((entry) => entry.path), 'payload-manifest.json'])
                planned.add(path.join(root, base, ...relative.split('/')));
        packWindowsDeploymentQueries([...planned]);
        const native = await createFreshDeploymentInstallation(root);
        nativeLifetime = native;
        for (const relative of ['.deployment', 'builds', '.staging']) await native.createDirectory(relative);
        const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
        const regular = (stats: BigIntStats) => {
            if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n)
                throw new Error('Fresh file must be regular one-link.');
        };
        const identities = new Map<string, BigIntStats>();
        async function check(file: string, expected: BigIntStats) {
            const stats = await lstat(file, { bigint: true });
            if (!same(stats, expected)) throw new Error('Fresh object identity changed.');
            await native.entry(file, stats);
            return stats;
        }
        async function writeNew(file: string, bytes: Buffer, maximum = bytes.length) {
            if (bytes.length > maximum) throw new Error('Fresh file exceeds its bound.');
            await native.verifyParent(file);
            const handle = await open(file, 'wx+');
            let before: BigIntStats | undefined;
            let writeError: unknown;
            let writeFailed = false;
            try {
                before = await handle.stat({ bigint: true });
                regular(before);
                if (before.size !== 0n) throw new Error('Fresh file is not empty at creation.');
                await check(file, before);
                await handle.writeFile(bytes);
                await handle.sync();
                const after = await handle.stat({ bigint: true });
                regular(after);
                if (!same(before, after) || after.size !== BigInt(bytes.length))
                    throw new Error('Fresh write identity/length changed.');
                await check(file, after);
            } catch (error) {
                writeFailed = true;
                writeError = error;
            }
            try {
                await handle.close();
            } catch (error) {
                throw writeFailed ? new AggregateError([writeError, error], 'Fresh write and close failed.') : error;
            }
            if (writeFailed) throw writeError;
            if (!before) throw new Error('Fresh write has no actual object identity.');
            const readback = await open(file, 'r');
            let readError: unknown;
            let readFailed = false;
            try {
                const named = await check(file, before),
                    opened = await readback.stat({ bigint: true });
                regular(named);
                regular(opened);
                if (!same(named, opened) || opened.size !== BigInt(bytes.length))
                    throw new Error('Fresh readback identity/length changed.');
                const buffer = Buffer.alloc(bytes.length + 1);
                let used = 0;
                while (used < buffer.length) {
                    const read = await readback.read(buffer, used, buffer.length - used, used);
                    if (read.bytesRead === 0) break;
                    used += read.bytesRead;
                }
                const after = await readback.stat({ bigint: true });
                regular(after);
                if (
                    !same(opened, after) ||
                    opened.ctimeNs !== after.ctimeNs ||
                    opened.mtimeNs !== after.mtimeNs ||
                    after.size !== opened.size ||
                    !buffer.subarray(0, used).equals(bytes)
                )
                    throw new Error('Fresh canonical readback bytes changed.');
                const current = await check(file, before);
                if (
                    current.ctimeNs !== after.ctimeNs ||
                    current.mtimeNs !== after.mtimeNs ||
                    current.size !== after.size
                )
                    throw new Error('Fresh named readback changed.');
                identities.set(file, after);
            } catch (error) {
                readFailed = true;
                readError = error;
            }
            try {
                await readback.close();
            } catch (error) {
                throw readFailed ? new AggregateError([readError, error], 'Fresh readback and close failed.') : error;
            }
            if (readFailed) throw readError;
        }
        const operationName = path.join(root, '.deployment/operation.lock');
        const useName = path.join(root, '.deployment/use.lock');
        await writeNew(operationName, Buffer.alloc(0));
        await writeNew(useName, Buffer.alloc(0));
        const tryLock = await loadAppAdvisoryLock({ schemaVersion: 1, packages: source.provenance.nativePackages });
        operation = await open(operationName, 'r+');
        const opened = await operation.stat({ bigint: true });
        regular(opened);
        const fixedOperation = identities.get(operationName),
            fixedUse = identities.get(useName);
        if (!fixedOperation || !fixedUse || !same(opened, fixedOperation))
            throw new Error('Fresh operation inode changed.');
        const fixedLeases: readonly (readonly [string, BigIntStats])[] = [
            [operationName, fixedOperation],
            [useName, fixedUse],
        ];
        await check(operationName, fixedOperation);
        if (!tryLock(operation.fd, { shared: false })) throw new Error('Fresh operation lock is unavailable.');
        async function fixed() {
            if (!operation) throw new Error('Missing fresh operation descriptor.');
            const actual = await operation.stat({ bigint: true });
            regular(actual);
            if (!same(actual, opened) || actual.size !== 0n) throw new Error('Fresh operation descriptor changed.');
            const checks = [];
            for (const [file, expected] of fixedLeases) {
                const stats = await lstat(file, { bigint: true });
                regular(stats);
                if (!same(stats, expected) || stats.size !== 0n) throw new Error('Fresh fixed lease changed.');
                checks.push({ file, stats });
            }
            await native.entries(checks);
        }
        await native.createDirectory(path.join('.staging', nonce));
        await native.createDirectory(relativeStage);
        const stage = path.join(root, relativeStage);
        identities.set(stage, await lstat(stage, { bigint: true }));
        const copied = await native.copyPayload(
            source.root,
            sourceIdentity,
            relativeStage,
            source.manifest.entries,
            canonicalManifest,
        );
        for (const entry of copied) {
            const file = path.join(stage, ...entry.path.split('/'));
            const actual = await lstat(file, { bigint: true });
            if (String(actual.dev) !== entry.device || String(actual.ino) !== entry.inode)
                throw new Error('Fresh copied identity changed before its consumer baseline.');
            identities.set(file, actual);
        }
        async function payloadSweep(directory: string) {
            const checks = [];
            for (const [file, identity] of identities) {
                if (file !== stage && !file.startsWith(`${stage}${path.sep}`)) continue;
                const current = directory + file.slice(stage.length),
                    stats = await lstat(current, { bigint: true });
                if (!same(stats, identity)) throw new Error('Fresh payload identity changed.');
                checks.push({ file: current, stats });
            }
            await native.entries(checks);
        }
        async function payload(directory: string) {
            // Each complete sweep has new facts; none survive the actual content read or publication.
            await payloadSweep(directory);
            await verifyDeploymentPayload(directory, selection);
            await payloadSweep(directory);
            await fixed();
        }
        await payload(stage);
        await native.publish(relativeStage, relativeBuild);
        const buildRoot = path.join(root, relativeBuild);
        await payload(buildRoot);
        const identified = identifyDeploymentInstallation({
            schemaVersion: 1,
            installationId: randomUUID(),
            kind: request.kind,
            platform: request.platform,
            architecture: request.architecture,
            root: { realPath: root, device: String(native.root.dev), inode: String(native.root.ino) },
        });
        const installationBytes = Buffer.from(`${JSON.stringify(identified.installation)}\n`, 'utf8');
        const state = parseDeploymentState(
            {
                schemaVersion: 1,
                installationIdentity: identified.identity,
                phase: 'active',
                selectedBuildId: selection.selectedBuildId,
                selectedManifestSha256: selection.selectedManifestSha256,
            },
            identified.identity,
        );
        const installationPrepared = path.join('.deployment', `.installation-${nonce}.json`);
        const statePrepared = path.join('.deployment', `.state-${nonce}.json`);
        const stateBytes = Buffer.from(`${JSON.stringify(state)}\n`, 'utf8');
        await writeNew(path.join(root, installationPrepared), installationBytes, 65536);
        await writeNew(path.join(root, statePrepared), stateBytes, 1024);
        async function prepared(relative: string, bytes: Buffer) {
            const file = path.join(root, relative),
                expected = identities.get(file);
            if (!expected) throw new Error('Missing owned prepared identity.');
            const actual = await check(file, expected);
            regular(actual);
            if (
                actual.size !== expected.size ||
                actual.mtimeNs !== expected.mtimeNs ||
                actual.ctimeNs !== expected.ctimeNs ||
                !(await readRegularFile(file)).equals(bytes)
            )
                throw new Error('Prepared canonical document changed.');
        }
        await fixed();
        await payload(buildRoot);
        await prepared(installationPrepared, installationBytes);
        await native.publish(installationPrepared, path.join('.deployment', 'installation.json'));
        await fixed();
        await payload(buildRoot);
        await prepared(statePrepared, stateBytes);
        stateAttempted = true;
        await native.publish(statePrepared, path.join('.deployment', 'state.json'));
        const reader = await native.openReader(tryLock);
        if (reader.identity !== identified.identity) throw new Error('Fresh read admission identity disagrees.');
        use = await reader.tryAcquire('use');
        if (!use || JSON.stringify(await reader.read(use)) !== JSON.stringify(state))
            throw new Error('Fresh read admission failed.');
        await fixed();
        await payload(buildRoot);
        result = Object.freeze({
            selectedBuildId: selection.selectedBuildId,
            selectedManifestSha256: selection.selectedManifestSha256,
            installationRoot: root,
            buildRoot,
            executablePath: path.join(buildRoot, 'electron.exe'),
        });
    } catch (error) {
        record(error);
    } finally {
        if (use) {
            try {
                await use.release();
            } catch (error) {
                record(error);
            }
        }
        if (operation) {
            try {
                await operation.close();
            } catch (error) {
                record(error);
            }
        }
        if (nativeLifetime) {
            try {
                await nativeLifetime.close();
            } catch (error) {
                record(error);
            }
        }
    }
    if (failed) throw new FreshDeploymentError(stateAttempted ? 'indeterminate' : 'not-published', problem);
    if (!result) throw new FreshDeploymentError('indeterminate', new Error('Missing fresh result.'));
    try {
        const current = await lstat(scratch, { bigint: true });
        if (
            current.dev !== scratchIdentity.dev ||
            current.ino !== scratchIdentity.ino ||
            (await realpath(scratch)) !== scratch
        )
            throw new Error('Source scratch identity changed; retained.');
        await rm(scratch, { recursive: true });
    } catch (error) {
        throw new FreshDeploymentError('indeterminate', error);
    }
    return result;
}
function demandSourceFiles(files: ReadonlyMap<string, Buffer>, expected: readonly AppReleaseFile[]) {
    if (files.size !== expected.length) throw new Error('App payload original source inventory changed.');
    for (const entry of expected) {
        const bytes = files.get(entry.path);
        if (!bytes || bytes.length !== entry.bytes || fileIdentity(entry.path, bytes).sha256 !== entry.sha256)
            throw new Error('App payload original source bytes disagree with independent evidence.');
    }
}

/** Content composition only. The stage owner obtains these inputs from their actual verified producers. */
export function composeAppPayloadManifest(sources: {
    platform: AppDistribution['platform'];
    architecture: AppDistribution['architecture'];
    electron: readonly DeploymentPayloadEntry[];
    node: ReadonlyMap<string, Buffer>;
    app: ReadonlyMap<string, Buffer>;
    official: ReadonlyMap<string, Buffer>;
}) {
    if (sources.platform !== 'win32') throw new Error('Non-Windows payload source composition remains pending.');
    const entries = new Map<string, DeploymentPayloadEntry>();
    const add = (entry: DeploymentPayloadEntry) => {
        const existing = entries.get(entry.path);
        if (existing) {
            if (entry.type !== 'directory' || existing.type !== 'directory')
                throw new Error('App payload sources overlap.');
            return;
        }
        entries.set(entry.path, entry);
    };
    for (const entry of sources.electron) {
        if (/^resources\/(?:app|node|official-server)(?:\/|$)/i.test(entry.path))
            throw new Error('Electron archive occupies another payload source namespace.');
        add(entry);
    }
    for (const [prefix, files] of [
        ['resources/node', sources.node],
        ['resources/app', sources.app],
        ['resources/official-server', sources.official],
    ] as const) {
        for (const [name, bytes] of files) {
            const full = `${prefix}/${name}`;
            for (let parent = path.posix.dirname(full); parent !== '.'; parent = path.posix.dirname(parent))
                add({ type: 'directory', path: parent, executableBits: null });
            add({
                type: 'file',
                path: full,
                bytes: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                executableBits: null,
            });
        }
    }
    return identifyDeploymentPayload({
        schemaVersion: 1,
        platform: sources.platform,
        architecture: sources.architecture,
        entries: [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    });
}

/** Authenticates and inventories the same locked ZIP stream used by the fixed file-only extractor. */
export async function extractAppArchive(
    root: string,
    archive: string,
    expected: Pick<AppArchive, 'bytes' | 'sha256' | 'platform' | 'architecture'>,
    destination: string,
): Promise<readonly DeploymentPayloadEntry[]> {
    if (process.platform !== 'win32') throw new Error('This source extractor supports Windows ZIP inputs only.');
    if (
        expected.platform !== 'win32' ||
        !['x64', 'arm64'].includes(expected.architecture) ||
        !Number.isSafeInteger(expected.bytes) ||
        expected.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(expected.sha256)
    )
        throw new Error('Invalid independently expected archive source selection.');
    const source = await lstat(path.resolve(archive));
    if (!source.isFile() || source.isSymbolicLink() || source.size !== expected.bytes)
        throw new Error('Archive source must be a regular file with its independently expected length.');
    const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
            'pwsh',
            [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-File',
                path.join(root, 'tooling/extract-app-zip.ps1'),
                '-Archive',
                path.resolve(archive),
                '-Destination',
                path.resolve(destination),
                '-ExpectedBytes',
                String(expected.bytes),
                '-ExpectedSha256',
                expected.sha256,
            ],
            { encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024 },
            (error, output) => (error ? reject(error) : resolve(output)),
        );
    });
    const value: unknown = JSON.parse(stdout);
    if (
        !isRecord(value) ||
        Object.keys(value).sort().join() !== 'archive,entries,schemaVersion' ||
        value.schemaVersion !== 1 ||
        !isRecord(value.archive) ||
        Object.keys(value.archive).sort().join() !== 'bytes,sha256' ||
        value.archive.bytes !== expected.bytes ||
        value.archive.sha256 !== expected.sha256 ||
        !Array.isArray(value.entries)
    )
        throw new Error('Invalid authenticated archive source inventory.');
    return parseDeploymentPayloadManifest({
        schemaVersion: 1,
        platform: expected.platform,
        architecture: expected.architecture,
        entries: value.entries.sort((a: unknown, b: unknown) => {
            if (!isRecord(a) || !isRecord(b) || typeof a.path !== 'string' || typeof b.path !== 'string')
                throw new Error('Invalid archive source entry.');
            return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
        }),
    }).entries;
}
export async function readAppVersion(root: string) {
    const metadata: unknown = JSON.parse((await readRegularFile(path.join(root, 'package.json'))).toString('utf8'));
    if (!isRecord(metadata) || !isSemVer(metadata.version)) throw new Error('Invalid App build version.');
    return metadata.version;
}
export async function readAppOfficialFiles(root: string) {
    const { release } = await verifyOfficialInputs(root);
    return verifyOfficialPackage(await realpath(path.join(root, 'node_modules', release.name)), release, {
        pnpmInstalled: true,
    });
}
export async function generateAppFiles(options: AppBuild) {
    const { root } = options;
    const version = await readAppVersion(root);
    const distribution = parseAppDistribution(
        { schemaVersion: 1, kind: options.kind, platform: options.platform, architecture: options.architecture },
        { platform: options.platform, architecture: options.architecture },
    );
    const { release } = await verifyOfficialInputs(root);
    const catalog: unknown = JSON.parse(await readFile(path.join(root, 'tooling/official-tool-catalog.json'), 'utf8'));
    const files = new Map<string, Buffer>();
    const inputs = new Set<string>();
    for (const [entry, platform, format, output] of [
        ['app-bootstrap', 'node', 'esm', 'app-bootstrap.mjs'],
        ['app-main', 'node', 'esm', 'app-main.mjs'],
        ['app-preload', 'node', 'cjs', 'app-preload.cjs'],
        ['app-renderer', 'browser', 'iife', 'app-renderer.js'],
    ] as const) {
        const result = await build({
            absWorkingDir: root,
            entryPoints: [path.join(root, `src/interface/${entry}.ts`)],
            outfile: path.join(root, output),
            bundle: true,
            platform,
            format,
            target: platform === 'node' ? 'node24' : 'chrome144',
            external: platform === 'node' ? ['electron', 'fs-native-extensions'] : [],
            define: {
                __DCT_OFFICIAL_RELEASE__: JSON.stringify(release),
                __DCT_TOOL_CATALOG__: JSON.stringify(catalog),
                __DCT_APP_VERSION__: JSON.stringify(version),
                'process.env.NODE_ENV': '"production"',
                'process.env.WS_NO_BUFFER_UTIL': '"1"',
                'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
            },
            plugins: [
                {
                    name: 'separate-synchronous-bootstrap',
                    setup(builder) {
                        builder.onResolve({ filter: /^\.\/app-main\.ts$/ }, () => ({
                            path: './app-main.mjs',
                            external: true,
                        }));
                    },
                },
            ],
            ...(entry === 'app-main'
                ? {
                      banner: {
                          js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
                      },
                  }
                : {}),
            write: false,
            metafile: true,
            legalComments: 'none',
            logLevel: 'warning',
        });
        for (const file of result.outputFiles) files.set(path.basename(file.path), Buffer.from(file.contents));
        const selectedExternals = new Set(
            entry === 'app-main'
                ? ['electron', 'fs-native-extensions']
                : entry === 'app-bootstrap'
                  ? ['electron', './app-main.mjs']
                  : entry === 'app-preload'
                    ? ['electron']
                    : [],
        );
        for (const emitted of Object.values(result.metafile.outputs))
            for (const imported of emitted.imports)
                if (imported.external && !isBuiltin(imported.path) && !selectedExternals.has(imported.path))
                    throw new Error(`App bundle has an undeclared external import: ${imported.path}`);
        for (const input of Object.keys(result.metafile.inputs)) inputs.add(input);
    }
    for (const file of ['app.html', 'app.css'])
        files.set(file, await readRegularFile(path.join(root, 'src/interface', file)));
    files.set('icon.png', await readRegularFile(path.join(root, 'packaging/shared/assets/icon.png')));
    files.set('LICENSE', await readRegularFile(path.join(root, 'LICENSE')));
    files.set('distribution.json', Buffer.from(`${JSON.stringify(distribution, null, 4)}\n`));
    files.set(
        'package.json',
        Buffer.from(
            `${JSON.stringify({ name: 'debugging-cdp-targets', version, type: 'module', main: 'app-bootstrap.mjs' }, null, 4)}\n`,
        ),
    );
    for (const file of ['app-release-inputs.json', 'app-native-release.json', 'official-server-release.json'])
        files.set(`delivery/${file}`, await readRegularFile(path.join(root, 'tooling', file)));
    for (const file of [
        'windows-cdp-helper.ps1',
        'windows-native-helper.ps1',
        'windows-native-process.cs',
        'macos-deployment-authority.jxa',
    ])
        files.set(file, await readRegularFile(path.join(root, 'src/adapters', file)));
    const native = parseAppNativeEvidence(
        JSON.parse(files.get('delivery/app-native-release.json')?.toString('utf8') ?? 'null'),
    );
    const packages = await verifyAppNativeInputs(native);
    const nativeNotices = [];
    for (const [name, original] of packages) {
        for (const [file, bytes] of original.files) files.set(`node_modules/${name}/${file}`, bytes);
        nativeNotices.push(`${name} — LICENSE\n\n${original.files.get('LICENSE')?.toString('utf8').trim()}\n`);
    }
    const bundled = await collectBundledLicenses([...inputs], root);
    files.set('THIRD-PARTY-NOTICES.txt', Buffer.concat([bundled, Buffer.from(`\n${nativeNotices.join('\n')}`)]));
    await options.onInputs?.([
        ...inputs,
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'tooling/build-app.ts',
        'tooling/licenses/bundled-notices.ts',
        'tooling/licenses/canonical-inputs.ts',
        'tooling/extract-app-zip.ps1',
        'tooling/licenses/reviewed-vendors.json',
        'tooling/official-tool-catalog.json',
        ...['app-release-inputs.json', 'app-native-release.json', 'official-server-release.json'].map(
            (file) => `tooling/${file}`,
        ),
        'src/interface/app.html',
        'src/interface/app.css',
        'packaging/shared/assets/icon.png',
        'LICENSE',
        ...[
            'windows-cdp-helper.ps1',
            'windows-native-helper.ps1',
            'windows-native-process.cs',
            'macos-deployment-authority.jxa',
        ].map((file) => `src/adapters/${file}`),
    ]);
    return files;
}

export async function stageDesktopApp(
    options: AppBuild & { electronArchive: string; nodeArchive: string; output: string },
): Promise<StagedDesktopApp> {
    const request = Object.freeze({
        root: options.root,
        kind: options.kind,
        platform: options.platform,
        architecture: options.architecture,
        electronArchive: options.electronArchive,
        nodeArchive: options.nodeArchive,
        output: options.output,
        onInputs: options.onInputs,
    });
    if (process.platform !== 'win32' || request.platform !== 'win32')
        throw new Error('This native stage extractor currently supports Windows; other native cells remain pending.');
    const distribution = parseAppDistribution(
        { schemaVersion: 1, kind: request.kind, platform: request.platform, architecture: request.architecture },
        { platform: request.platform, architecture: request.architecture },
    );
    const inputs = parseAppReleaseInputs(
        JSON.parse(
            (await readRegularFile(path.join(request.root, 'tooling/app-release-inputs.json'))).toString('utf8'),
        ),
    );
    const electron = inputs.archives.find(
        (item) =>
            item.kind === 'electron' &&
            item.platform === request.platform &&
            item.architecture === request.architecture,
    );
    const node = inputs.archives.find(
        (item) =>
            item.kind === 'node' && item.platform === request.platform && item.architecture === request.architecture,
    );
    if (!electron || !node?.runtimeFiles) throw new Error('Native extraction evidence is unavailable.');
    const output = path.resolve(request.output);
    const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-app-stage-')));
    try {
        const electronExtracted = path.join(scratch, 'electron');
        const electronEntries = await extractAppArchive(
            request.root,
            request.electronArchive,
            electron,
            electronExtracted,
        );
        const nodeExtracted = path.join(scratch, 'node');
        const nodeEntries = new Map(
            (await extractAppArchive(request.root, request.nodeArchive, node, nodeExtracted)).map((entry) => [
                entry.path,
                entry,
            ]),
        );
        for (const required of ['electron.exe', 'LICENSE', 'LICENSES.chromium.html'])
            if (!electronEntries.some((entry) => entry.path === required && entry.type === 'file'))
                throw new Error('Electron archive is missing its original runtime or licenses.');
        for (const license of electron.licenses ?? []) {
            const observed = electronEntries.find((entry) => entry.path === license.path);
            if (observed?.type !== 'file' || observed.bytes !== license.bytes || observed.sha256 !== license.sha256)
                throw new Error('Electron archive original license evidence changed.');
        }
        const runtime = new Map<string, Buffer>();
        for (const file of node.runtimeFiles) {
            const observed = nodeEntries.get(file.path);
            if (observed?.type !== 'file' || observed.bytes !== file.bytes || observed.sha256 !== file.sha256)
                throw new Error('Node archive runtime source disagrees with independent evidence.');
            runtime.set(file.destination, await readRegularFile(path.join(nodeExtracted, file.path)));
        }
        demandSourceFiles(
            runtime,
            node.runtimeFiles.map((file) => ({ ...file, path: file.destination })),
        );
        const generatedInputs: AppReleaseFile[] = [];
        const files = await generateAppFiles({
            ...request,
            onInputs: async (names) => {
                const seen = new Set<string>();
                for (const name of names) {
                    if (['<define:__DCT_OFFICIAL_RELEASE__>', '<define:__DCT_TOOL_CATALOG__>'].includes(name)) continue;
                    const absolute = path.resolve(request.root, name);
                    const relative = path.relative(request.root, absolute).replaceAll('\\', '/');
                    if (!isPortablePayloadRelativePath(relative))
                        throw new Error('App generated source input is outside its repository.');
                    if (seen.has(relative)) continue;
                    seen.add(relative);
                    generatedInputs.push(fileIdentity(relative, await readRegularFile(absolute)));
                }
                generatedInputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
                await request.onInputs?.(names);
            },
        });
        const original = await readAppOfficialFiles(request.root);
        const deliveredArchives = parseAppReleaseInputs(
            JSON.parse(files.get('delivery/app-release-inputs.json')?.toString('utf8') ?? 'null'),
        );
        if (JSON.stringify(deliveredArchives) !== JSON.stringify(inputs))
            throw new Error('App archive source evidence changed during production.');
        const official = parseOfficialReleaseEvidence(
            JSON.parse(files.get('delivery/official-server-release.json')?.toString('utf8') ?? 'null'),
        );
        demandSourceFiles(original, official.files);
        const native = parseAppNativeEvidence(
            JSON.parse(files.get('delivery/app-native-release.json')?.toString('utf8') ?? 'null'),
        );
        let nativeCount = 0;
        for (const entry of native.packages) {
            const prefix = `node_modules/${entry.package}/`;
            const selected = new Map(
                [...files]
                    .filter(([name]) => name.startsWith(prefix))
                    .map(([name, bytes]) => [name.slice(prefix.length), bytes]),
            );
            demandSourceFiles(selected, entry.files);
            nativeCount += selected.size;
        }
        if ([...files.keys()].filter((name) => name.startsWith('node_modules/')).length !== nativeCount)
            throw new Error('Unknown App native package source.');
        // Expected content comes only from these actual input producers, before the output exists.
        const identity = composeAppPayloadManifest({
            ...distribution,
            electron: electronEntries,
            node: runtime,
            app: files,
            official: original,
        });
        await mkdir(path.dirname(output), { recursive: true });
        // A failure leaves an unusable stage; existing trees are never overwritten or repaired.
        await mkdir(output);
        const root = await realpath(output);
        for (const entry of electronEntries) {
            const destination = path.join(root, entry.path);
            if (entry.type === 'directory') await mkdir(destination, { recursive: true });
            else if (entry.type === 'file') {
                const bytes = await readRegularFile(path.join(electronExtracted, entry.path));
                demandSourceFiles(new Map([[entry.path, bytes]]), [entry]);
                await writeFile(destination, bytes, { flag: 'wx' });
            } else throw new Error('Windows archive links are not supported.');
        }
        for (const [prefix, selected] of [
            ['resources/node', runtime],
            ['resources/official-server', original],
            ['resources/app', files],
        ] as const)
            for (const [file, bytes] of selected) {
                const destination = path.join(root, prefix, file);
                await mkdir(path.dirname(destination), { recursive: true });
                await writeFile(destination, bytes, { flag: 'wx' });
            }
        await writeFile(path.join(root, 'payload-manifest.json'), identity.canonicalManifest, { flag: 'wx' });
        await verifyDeploymentPayload(root, {
            ...identity,
            platform: distribution.platform,
            architecture: distribution.architecture,
        });
        return Object.freeze({
            root,
            ...identity,
            provenance: Object.freeze({
                electron,
                node,
                official,
                nativePackages: native.packages,
                generatedInputs: Object.freeze(generatedInputs),
            }),
        });
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const value = (name: string) => {
        const index = process.argv.indexOf(name);
        const result = process.argv[index + 1];
        if (index < 0 || !result || result.startsWith('--')) throw new Error(`Required build option: ${name}`);
        return result;
    };
    const kind = process.argv.includes('--portable') ? 'portable' : 'installed';
    const platform = process.platform;
    const architecture = process.arch;
    const metadata = parseAppDistribution(
        { schemaVersion: 1, kind, platform, architecture },
        { platform, architecture },
    );
    if (process.argv.includes('--check')) {
        await generateAppFiles({ root, ...metadata });
        await readAppOfficialFiles(root);
        console.log('App bundles, original native loading closure and actual graph licenses verified without writing.');
    } else {
        const output = await stageDesktopApp({
            root,
            ...metadata,
            electronArchive: value('--electron-archive'),
            nodeArchive: value('--node-archive'),
            output: value('--output'),
        });
        console.log(`Verified local App stage built: ${output.root}`);
    }
}
