import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { verifyAppArchive, verifyAppReleaseTree } from '../src/adapters/app-delivery.ts';
import { verifyAppNativeInputs } from '../src/adapters/app-native.ts';
import { readRegularFile } from '../src/adapters/file-evidence.ts';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import { type AppDistribution, parseAppDistribution } from '../src/domains/app-distribution.ts';
import { parseAppNativeEvidence, parseAppReleaseInputs } from '../src/domains/app-release.ts';
import { isRecord } from '../src/shared/errors.ts';
import { collectBundledLicenses } from './licenses/bundled-notices.ts';
import { verifyOfficialInputs } from './security/official-inputs.ts';
import { isSemVer } from './version-policy.ts';

type AppBuild = Omit<AppDistribution, 'schemaVersion'> & {
    root: string;
    onInputs?: (inputs: readonly string[]) => Promise<void>;
};
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
        'windows-deployment-authority.ps1',
        'windows-deployment-authority.cs',
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
            'windows-deployment-authority.ps1',
            'windows-deployment-authority.cs',
            'macos-deployment-authority.jxa',
        ].map((file) => `src/adapters/${file}`),
    ]);
    return files;
}

export async function stageDesktopApp(
    options: AppBuild & { electronArchive: string; nodeArchive: string; output: string },
) {
    if (process.platform !== 'win32' || options.platform !== 'win32')
        throw new Error('This native stage extractor currently supports Windows; other native cells remain pending.');
    const inputs = parseAppReleaseInputs(
        JSON.parse(await readFile(path.join(options.root, 'tooling/app-release-inputs.json'), 'utf8')),
    );
    const electron = inputs.archives.find(
        (item) =>
            item.kind === 'electron' &&
            item.platform === options.platform &&
            item.architecture === options.architecture,
    );
    const node = inputs.archives.find(
        (item) =>
            item.kind === 'node' && item.platform === options.platform && item.architecture === options.architecture,
    );
    if (!electron || !node?.runtimeFiles) throw new Error('Native extraction evidence is unavailable.');
    await verifyAppArchive(options.electronArchive, electron);
    await verifyAppArchive(options.nodeArchive, node);
    const files = await generateAppFiles(options);
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    // Existing stages, including a running same-version build, are never overwritten or removed.
    await mkdir(output);
    const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-app-stage-')));
    try {
        const extract = async (archive: string, destination: string) => {
            await promisify(execFile)(
                'pwsh',
                [
                    '-NoProfile',
                    '-File',
                    path.join(options.root, 'tooling/extract-app-zip.ps1'),
                    '-Archive',
                    path.resolve(archive),
                    '-Destination',
                    destination,
                ],
                { windowsHide: true },
            );
        };
        await extract(options.electronArchive, output);
        const nodeExtracted = path.join(scratch, 'node');
        await extract(options.nodeArchive, nodeExtracted);
        const nodeDirectory = path.join(output, 'resources/node');
        await mkdir(nodeDirectory, { recursive: true });
        for (const file of node.runtimeFiles) {
            const destination = path.join(nodeDirectory, file.destination);
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, await readRegularFile(path.join(nodeExtracted, file.path)));
        }
        await verifyAppReleaseTree(
            nodeDirectory,
            node.runtimeFiles.map((file) => ({ path: file.destination, bytes: file.bytes, sha256: file.sha256 })),
        );
        const original = await readAppOfficialFiles(options.root);
        for (const [file, bytes] of original) {
            const destination = path.join(output, 'resources/official-server', file);
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, bytes);
        }
        for (const [file, bytes] of files) {
            const destination = path.join(output, 'resources/app', file);
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, bytes);
        }
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
    return output;
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
        console.log(`Verified local App stage built: ${output}`);
    }
}
