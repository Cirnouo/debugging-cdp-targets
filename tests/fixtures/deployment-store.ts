import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { DeploymentNativeCheck } from '../../src/adapters/app-deployment-native.ts';
import type { DeploymentEntryPurpose } from '../../src/domains/app-deployment.ts';
import { isRecord } from '../../src/shared/errors.ts';

const actual = { ...fs };
const physicalPath = {
    join: path.join,
    resolve: path.resolve,
    dirname: path.dirname,
    basename: path.basename,
    relative: path.relative,
    isAbsolute: path.isAbsolute,
    normalize: path.normalize,
};
const windowsPath = {
    join: path.win32.join,
    resolve: path.win32.resolve,
    dirname: path.win32.dirname,
    basename: path.win32.basename,
    relative: path.win32.relative,
    isAbsolute: path.win32.isAbsolute,
    normalize: path.win32.normalize,
};
type DocumentBoundary = (file: string, stats: BigIntStats) => Promise<void>;

async function removeOwned(directory: string) {
    if (
        !physicalPath.isAbsolute(directory) ||
        physicalPath.resolve(directory) !== directory ||
        physicalPath.dirname(directory) === directory ||
        !physicalPath.basename(directory).startsWith('dct-deployment-controlled-') ||
        (await actual.realpath(directory)) !== directory
    )
        throw new Error('Refusing cleanup of an unowned controlled fixture directory.');
    await actual.rm(directory, { recursive: true });
}

async function controlledStore(physical: string, directory: string, scratch: string, ownsRoot: boolean) {
    const parent = windowsPath.dirname(directory);
    const physicalParent = physicalPath.dirname(physical);
    if (
        !windowsPath.isAbsolute(directory) ||
        windowsPath.resolve(directory) !== directory ||
        !physicalPath.isAbsolute(physical) ||
        physicalPath.resolve(physical) !== physical ||
        (await actual.realpath(physical)) !== physical
    )
        throw new Error('Invalid owned controlled deployment mapping.');
    const root = await actual.lstat(physical, { bigint: true });
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Invalid controlled deployment root.');
    const stateUrl = pathToFileURL(physicalPath.join(scratch, 'state.mjs')).href;
    await actual.writeFile(physicalPath.join(scratch, 'state.mjs'), 'export const state={freshCalls:0};\n');
    const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
    const bundle = await build({
        entryPoints: [physicalPath.join(sourceRoot, 'src/adapters/app-deployment.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        write: false,
        external: [stateUrl],
        // Only this controlled bundle sees Windows identity; the actual process never does.
        define: { 'process.platform': '"win32"', 'process.arch': '"x64"' },
        plugins: [
            {
                name: 'controlled-deployment-native-io',
                setup(builder) {
                    builder.onResolve({ filter: /^\.\/app-deployment-native\.ts$/ }, (args) =>
                        args.importer.replaceAll('\\', '/').endsWith('/src/adapters/app-deployment.ts')
                            ? { path: args.path, namespace: 'controlled-deployment-native-io' }
                            : undefined,
                    );
                    builder.onLoad({ filter: /.*/, namespace: 'controlled-deployment-native-io' }, () => ({
                        contents: `import{state}from${JSON.stringify(stateUrl)};export function openDeploymentNativeAuthority(directory,writing){return state.authority(directory,writing)}export function createFreshDeploymentRoot(){state.freshCalls++;throw Error('Controlled stores cannot create or enroll deployment roots.')}`,
                    }));
                },
            },
        ],
    });
    const output = bundle.outputFiles[0];
    assert.ok(output);
    const entry = physicalPath.join(scratch, 'store.mjs');
    await actual.writeFile(entry, output.contents);
    const stateModule: unknown = await import(stateUrl);
    assert.ok(isRecord(stateModule) && isRecord(stateModule.state));
    const bridge = stateModule.state;
    let revoked = false;
    let unsafe = false;
    let documentBoundary: DocumentBoundary | undefined;
    let receiptBoundary: ((stats: BigIntStats) => void) | undefined;
    const failures = new Map<string, Error>();
    function available(file?: string) {
        if (revoked || unsafe) throw new Error('Controlled deployment authority is unavailable or unsafe.');
        const failure = file === undefined ? undefined : failures.get(file);
        if (failure) throw failure;
    }
    function map<T>(file: T): T | string {
        if (typeof file !== 'string') return file;
        if (file === parent) return physicalParent;
        if (file.startsWith(`${parent}\\`)) {
            const relative = windowsPath.relative(parent, file);
            if (relative.startsWith('..') || windowsPath.isAbsolute(relative))
                throw new Error('Controlled deployment path escaped its owned root.');
            return physicalPath.join(physicalParent, ...relative.split('\\'));
        }
        if (/^[A-Za-z]:\\controlled(?:\\|$)/.test(file)) throw new Error('Foreign controlled deployment path.');
        return file;
    }
    function owned(file: string) {
        if (file !== directory && !file.startsWith(`${directory}\\`))
            throw new Error('Controlled authority path escaped its installation.');
        return map(file);
    }
    async function check(file: string, stats: BigIntStats, purpose: DeploymentEntryPurpose) {
        available(file);
        const physicalFile = owned(file);
        const named = await actual.lstat(physicalFile, { bigint: true });
        if (
            stats.isSymbolicLink() ||
            named.isSymbolicLink() ||
            (purpose === 'directory' ? !stats.isDirectory() : !stats.isFile()) ||
            (await actual.realpath(physicalFile)) !== physicalFile
        )
            throw new Error('Controlled authority entry is unsafe.');
        if (stats.dev !== root.dev || named.dev !== root.dev)
            throw new Error('Controlled authority entry crosses its owned device.');
        if (named.dev !== stats.dev || named.ino !== stats.ino)
            throw new Error('Deployment document identity changed.');
    }
    bridge.authority = async (requested: string, writing: boolean) => {
        available();
        if (requested !== directory) throw new Error('Foreign controlled deployment root.');
        function writer() {
            available();
            if (!writing) throw new Error('Deployment reader cannot acquire writer authority.');
        }
        if (writing) writer();
        return Object.freeze({
            role: 'private',
            writer,
            entry: check,
            async entries(checks: readonly DeploymentNativeCheck[]) {
                available();
                for (const entry of checks) await check(entry.file, entry.stats, entry.purpose);
            },
            documentReceipt(stats: BigIntStats) {
                available();
                receiptBoundary?.(stats);
                if (stats.dev !== root.dev) throw new Error('Controlled authority receipt crosses its owned device.');
            },
            async document(file: string, stats: BigIntStats) {
                await documentBoundary?.(file, stats);
                await check(file, stats, 'document');
            },
            async ancestors() {
                available();
            },
            async ancestorChecks(): Promise<DeploymentNativeCheck[]> {
                available();
                return [];
            },
        });
    };
    const deployment: typeof import('../../src/adapters/app-deployment.ts') = await import(pathToFileURL(entry).href);
    const mocks: { mock: { restore(): void } }[] = [];
    const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
    const descriptors: { file: string; flags: string | number }[] = [];
    const windows = (values: string[]) => values.some((value) => /^[A-Za-z]:\\/.test(value));
    mocks.push(
        mock.method(path, 'join', (...values: string[]) =>
            windows(values) ? windowsPath.join(...values) : physicalPath.join(...values),
        ),
        mock.method(path, 'resolve', (...values: string[]) =>
            windows(values) ? windowsPath.resolve(...values) : physicalPath.resolve(...values),
        ),
        mock.method(path, 'dirname', (value: string) =>
            windows([value]) ? windowsPath.dirname(value) : physicalPath.dirname(value),
        ),
        mock.method(path, 'basename', (value: string, suffix?: string) =>
            windows([value]) ? windowsPath.basename(value, suffix) : physicalPath.basename(value, suffix),
        ),
        mock.method(path, 'relative', (from: string, to: string) =>
            windows([from, to]) ? windowsPath.relative(from, to) : physicalPath.relative(from, to),
        ),
        mock.method(path, 'isAbsolute', (value: string) =>
            windows([value]) ? windowsPath.isAbsolute(value) : physicalPath.isAbsolute(value),
        ),
        mock.method(path, 'normalize', (value: string) =>
            windows([value]) ? windowsPath.normalize(value) : physicalPath.normalize(value),
        ),
        mock.method(fs, 'lstat', (...args: Parameters<typeof fs.lstat>) => actual.lstat(map(args[0]), args[1])),
        mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
            const handle = await actual.open(map(args[0]), args[1], args[2]);
            if (typeof args[0] === 'string' && args[0].startsWith(`${parent}\\`)) {
                descriptors.push({ file: args[0], flags: args[1] ?? 'r' });
                handles.push(handle);
            }
            return handle;
        }),
        mock.method(fs, 'realpath', async (...args: Parameters<typeof fs.realpath>) => {
            const mapped = map(args[0]);
            const resolved = await actual.realpath(mapped, args[1]);
            if (mapped !== args[0]) {
                if (resolved !== mapped) throw new Error('Controlled deployment path is linked or noncanonical.');
                return args[0];
            }
            return resolved;
        }),
        mock.method(fs, 'readFile', (...args: Parameters<typeof fs.readFile>) =>
            actual.readFile(map(args[0]), args[1]),
        ),
        mock.method(fs, 'writeFile', (...args: Parameters<typeof fs.writeFile>) =>
            actual.writeFile(map(args[0]), args[1], args[2]),
        ),
        mock.method(fs, 'mkdir', (...args: Parameters<typeof fs.mkdir>) => actual.mkdir(map(args[0]), args[1])),
        mock.method(fs, 'readdir', (...args: Parameters<typeof fs.readdir>) => actual.readdir(map(args[0]), args[1])),
        mock.method(fs, 'rename', (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) =>
            actual.rename(map(from), map(to)),
        ),
        mock.method(fs, 'unlink', (file: Parameters<typeof fs.unlink>[0]) => actual.unlink(map(file))),
        mock.method(fs, 'link', (from: Parameters<typeof fs.link>[0], to: Parameters<typeof fs.link>[1]) =>
            actual.link(map(from), map(to)),
        ),
        mock.method(fs, 'rm', (...args: Parameters<typeof fs.rm>) => actual.rm(map(args[0]), args[1])),
    );
    syncBuiltinESMExports();
    return {
        directory,
        envelope: windowsPath.join(directory, '.deployment'),
        physical,
        deployment,
        descriptors,
        revoke: (value: boolean) => {
            revoked = value;
        },
        unsafe: (value: boolean) => {
            unsafe = value;
        },
        fail: (file: string, error?: Error) => {
            if (error) failures.set(file, error);
            else failures.delete(file);
        },
        onDocument: (boundary?: DocumentBoundary) => {
            documentBoundary = boundary;
        },
        onReceipt: (boundary?: (stats: BigIntStats) => void) => {
            receiptBoundary = boundary;
        },
        async cleanup() {
            const failures: unknown[] = [];
            for (const handle of handles) {
                try {
                    await handle.close();
                } catch (error) {
                    failures.push(error);
                }
            }
            for (const item of mocks.reverse()) item.mock.restore();
            syncBuiltinESMExports();
            try {
                assert.equal(bridge.freshCalls, 0, 'Controlled stores must never request fresh enrollment.');
            } catch (error) {
                failures.push(error);
            }
            try {
                await removeOwned(scratch);
            } catch (error) {
                failures.push(error);
            }
            if (ownsRoot) {
                try {
                    await removeOwned(physicalParent);
                } catch (error) {
                    failures.push(error);
                }
            }
            if (failures.length) throw new AggregateError(failures, 'Controlled deployment fixture cleanup failed.');
        },
    };
}

export async function createDeploymentStoreFixture() {
    const container = await actual.realpath(
        await actual.mkdtemp(physicalPath.join(os.tmpdir(), 'dct-deployment-controlled-')),
    );
    const physical = physicalPath.join(container, 'root');
    await actual.mkdir(physical);
    const directory = `C:\\controlled\\${physicalPath.basename(container)}\\root`;
    const root = await actual.lstat(physical, { bigint: true });
    const installation = {
        schemaVersion: 1,
        installationId: '0dd7224c-51a2-41b3-914d-01171c139ac2',
        kind: 'portable',
        platform: 'win32',
        architecture: 'x64',
        root: { realPath: directory, device: String(root.dev), inode: String(root.ino) },
    };
    const identity = createHash('sha256').update(JSON.stringify(installation)).digest('hex');
    const state = {
        schemaVersion: 1,
        installationIdentity: identity,
        phase: 'active',
        selectedBuildId: 'a'.repeat(64),
        selectedManifestSha256: 'b'.repeat(64),
    };
    await actual.mkdir(physicalPath.join(physical, '.deployment'));
    for (const [file, content] of [
        ['installation.json', `${JSON.stringify(installation)}\n`],
        ['state.json', `${JSON.stringify(state)}\n`],
        ['operation.lock', ''],
        ['use.lock', ''],
    ] as const)
        await actual.writeFile(physicalPath.join(physical, '.deployment', file), content, { flag: 'wx' });
    const scratch = await actual.realpath(
        await actual.mkdtemp(physicalPath.join(os.tmpdir(), 'dct-deployment-controlled-')),
    );
    try {
        return { ...(await controlledStore(physical, directory, scratch, true)), installation, state, identity };
    } catch (error) {
        await removeOwned(scratch);
        await removeOwned(container);
        throw error;
    }
}

export async function attachDeploymentStoreFixture(physical: string, directory: string) {
    const scratch = await actual.realpath(
        await actual.mkdtemp(physicalPath.join(os.tmpdir(), 'dct-deployment-controlled-')),
    );
    try {
        return await controlledStore(physical, directory, scratch, false);
    } catch (error) {
        await removeOwned(scratch);
        throw error;
    }
}
