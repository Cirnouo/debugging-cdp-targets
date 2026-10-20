import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { readRegularFile } from '../src/adapters/file-evidence.ts';
import { readAppVersion, stageDesktopApp } from './build-app.ts';
import { readDistributionTree } from './distribution/regular-file-tree.ts';
import { collectBundledLicenses } from './licenses/bundled-notices.ts';
import {
    NATIVE_FIXTURE_PATHS,
    type NativeFixtureSeal,
    verifyNativeFixtureSeal,
} from './native-fixture-verification.ts';
import { verifyOfficialInputs } from './security/official-inputs.ts';

export {
    type NativeFixtureSeal,
    type NativeFixtureSealIO,
    verifyNativeFixtureSeal,
} from './native-fixture-verification.ts';

type FileEntry = { path: string; bytes: number; sha256: string };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const digest = (files: readonly FileEntry[]) => hash(JSON.stringify(files));
const order = (left: FileEntry, right: FileEntry) => left.path.localeCompare(right.path, 'en');
function requireValue(condition: unknown): asserts condition {
    if (!condition) throw new Error('Native fixture seal or its expected identity is invalid.');
}

function fileEntries(files: ReadonlyMap<string, Buffer>): FileEntry[] {
    return [...files].map(([file, bytes]) => ({ path: file, bytes: bytes.length, sha256: hash(bytes) })).sort(order);
}

/** Build the closed research subjects without acquiring an Electron/target process. */
export async function generateNativeFixtureFiles(root: string) {
    const { release } = await verifyOfficialInputs(root);
    const catalog: unknown = JSON.parse(await readFile(path.join(root, 'tooling/official-tool-catalog.json'), 'utf8'));
    const files = new Map<string, Buffer>();
    const inputs = new Set<string>();
    const externalImports = new Set<string>();
    for (const [source, destination] of [
        ['tests/fixtures/http-gateway.ts', 'http-fixture.mjs'],
        ['tests/smoke/screenshot-layers.ts', 'screenshot-layers-study.mjs'],
        ['tests/smoke/screenshot-timeout-probe.ts', 'screenshot-timeout-study.mjs'],
    ]) {
        requireValue(source && destination);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [source],
            outfile: destination,
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            write: false,
            metafile: true,
            define: {
                __DCT_FIXTURE_STAGE__: 'true',
                __DCT_SEALED_STUDY__: 'true',
                __DCT_OFFICIAL_RELEASE__: JSON.stringify(release),
                __DCT_TOOL_CATALOG__: JSON.stringify(catalog),
                __DCT_APP_VERSION__: JSON.stringify(await readAppVersion(root)),
                'process.env.WS_NO_BUFFER_UTIL': '"1"',
                'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
            },
            banner: {
                js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
            },
            minifySyntax: true,
            legalComments: 'none',
            logLevel: 'warning',
        });
        for (const input of Object.keys(bundle.metafile.inputs)) inputs.add(input);
        for (const output of Object.values(bundle.metafile.outputs))
            for (const imported of output.imports) if (imported.external) externalImports.add(imported.path);
        const output = bundle.outputFiles[0];
        requireValue(output);
        files.set(destination, Buffer.from(output.contents));
    }
    files.set('http-fixture-NOTICES.txt', await collectBundledLicenses([...inputs], root));
    requireValue([...externalImports].every(isBuiltin));
    for (const [source, destination] of [
        ['src/adapters/windows-cdp-helper.ps1', 'windows-cdp-helper.ps1'],
        ['src/adapters/windows-native-helper.ps1', 'windows-native-helper.ps1'],
        ['src/adapters/windows-native-process.cs', 'windows-native-process.cs'],
        ...[
            'src/adapters/windows-native-process.cs',
            'tests/smoke/windows-window-evidence.ps1',
            'tests/smoke/windows-selected-tab-evidence.ps1',
            'tests/smoke/windows-png-evidence.ps1',
            'tests/fixtures/compile-native-window.ps1',
            'tests/fixtures/native-window.cs',
        ].map((file) => [file, file]),
    ]) {
        requireValue(source && destination);
        inputs.add(source);
        files.set(destination, await readRegularFile(path.join(root, source)));
    }
    requireValue(
        JSON.stringify([...files.keys()].sort((a, b) => a.localeCompare(b, 'en'))) ===
            JSON.stringify(NATIVE_FIXTURE_PATHS),
    );
    return { files, inputs: [...inputs], externalImports: [...externalImports] };
}

/** Opt-in research builder. Produces a fresh complete App plus test-only composition; never ships in plugins. */
export async function buildNativeFixtureStage(options: {
    root: string;
    electronArchive: string;
    nodeArchive: string;
    output: string;
    architecture: 'x64' | 'arm64';
    allowDirty?: boolean;
}) {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: options.root,
        encoding: 'utf8',
        windowsHide: true,
    }).trim();
    const dirty =
        execFileSync('git', ['status', '--porcelain'], { cwd: options.root, encoding: 'utf8', windowsHide: true })
            .length > 0;
    requireValue(!dirty || options.allowDirty === true);
    const sourcePaths = new Set<string>(['tooling/native-fixture-seal.ts']);
    const output = await stageDesktopApp({
        ...options,
        platform: 'win32',
        kind: 'portable',
        onInputs: async (inputs) => {
            for (const input of inputs) sourcePaths.add(input);
        },
    });
    const appFiles = fileEntries(await readDistributionTree(output));
    const fixture = await generateNativeFixtureFiles(options.root);
    for (const input of fixture.inputs) sourcePaths.add(input);
    for (const [file, bytes] of fixture.files) {
        const destination = path.join(output, file);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx' });
    }
    const source = new Map<string, Buffer>();
    for (const file of sourcePaths) {
        // esbuild reports object defines as virtual modules. Their exact reviewed JSON inputs
        // are already recorded above, alongside the resulting bundle and delivered evidence.
        if (['<define:__DCT_OFFICIAL_RELEASE__>', '<define:__DCT_TOOL_CATALOG__>'].includes(file)) continue;
        const absolute = path.resolve(options.root, file);
        const relative = path.relative(options.root, absolute).replaceAll('\\', '/');
        requireValue(relative && !relative.startsWith('../') && !path.isAbsolute(relative));
        source.set(relative, await readRegularFile(absolute));
    }
    const inputs = fileEntries(source);
    const files = fileEntries(await readDistributionTree(output));
    const receipt: NativeFixtureSeal = {
        schemaVersion: 1,
        platform: 'win32',
        architecture: options.architecture,
        createdAtUtc: new Date().toISOString(),
        source: { revision, dirty, inputs, digest: digest(inputs) },
        app: { files: appFiles, digest: digest(appFiles) },
        fixture: { files: fileEntries(fixture.files) },
        files,
        inventoryDigest: digest(files),
    };
    await verifyNativeFixtureSeal(
        output,
        receipt,
        {
            listFiles: async (directory) => [...(await readDistributionTree(directory)).keys()],
            readFile: readRegularFile,
        },
        options.allowDirty === undefined ? {} : { allowDirty: options.allowDirty },
    );
    return { root: output, receipt };
}
