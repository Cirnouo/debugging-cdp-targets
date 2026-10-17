import { createHash } from 'node:crypto';
import path from 'node:path';
import { isRecord } from '../src/shared/errors.ts';

type FileEntry = { path: string; bytes: number; sha256: string };
export type NativeFixtureSeal = {
    schemaVersion: 1;
    platform: 'win32';
    architecture: 'x64' | 'arm64';
    createdAtUtc: string;
    source: { revision: string; dirty: boolean; inputs: FileEntry[]; digest: string };
    app: { files: FileEntry[]; digest: string };
    fixture: { files: FileEntry[] };
    files: FileEntry[];
    inventoryDigest: string;
};
export type NativeFixtureSealIO = {
    listFiles(root: string): Promise<string[]>;
    readFile(file: string): Promise<Uint8Array>;
};
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const digest = (files: readonly FileEntry[]) => hash(JSON.stringify(files));
const order = (left: FileEntry, right: FileEntry) => left.path.localeCompare(right.path, 'en');
export const NATIVE_FIXTURE_PATHS = Object.freeze([
    'http-fixture-NOTICES.txt',
    'http-fixture.mjs',
    'screenshot-layers-study.mjs',
    'screenshot-timeout-study.mjs',
    'src/adapters/windows-native-process.cs',
    'tests/fixtures/compile-native-window.ps1',
    'tests/fixtures/native-window.cs',
    'tests/smoke/windows-png-evidence.ps1',
    'tests/smoke/windows-selected-tab-evidence.ps1',
    'tests/smoke/windows-window-evidence.ps1',
    'windows-cdp-helper.ps1',
    'windows-native-helper.ps1',
    'windows-native-process.cs',
]);
function requireValue(condition: unknown): asserts condition {
    if (!condition) throw new Error('Native fixture seal or its expected identity is invalid.');
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
    return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function inventory(value: unknown): FileEntry[] {
    requireValue(Array.isArray(value) && value.length > 0);
    const files = value.map((file: unknown) => {
        requireValue(isRecord(file) && keys(file, ['path', 'bytes', 'sha256']));
        requireValue(typeof file.path === 'string' && !path.isAbsolute(file.path) && !file.path.includes('\\'));
        requireValue(
            file.path
                .split('/')
                .every(
                    (part) =>
                        part &&
                        part !== '.' &&
                        part !== '..' &&
                        !/[<>:"|?*\x00-\x1f]/.test(part) &&
                        !/[. ]$/.test(part),
                ),
        );
        requireValue(typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes >= 0);
        requireValue(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256));
        return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
    });
    requireValue(new Set(files.map((file) => file.path.toLowerCase())).size === files.length);
    requireValue(JSON.stringify(files) === JSON.stringify([...files].sort(order)));
    return files;
}

/** Verify a trusted research receipt against all sealed bytes; this does not authenticate a new release. */
export async function verifyNativeFixtureSeal(
    root: string,
    receipt: unknown,
    io: NativeFixtureSealIO,
    expected: { revision?: string; sourceDigest?: string; allowDirty?: boolean } = {},
) {
    requireValue(path.isAbsolute(root) && isRecord(receipt));
    requireValue(
        keys(receipt, [
            'schemaVersion',
            'platform',
            'architecture',
            'createdAtUtc',
            'source',
            'app',
            'fixture',
            'files',
            'inventoryDigest',
        ]),
    );
    requireValue(
        receipt.schemaVersion === 1 &&
            receipt.platform === 'win32' &&
            ['x64', 'arm64'].includes(String(receipt.architecture)),
    );
    requireValue(typeof receipt.createdAtUtc === 'string' && Number.isFinite(Date.parse(receipt.createdAtUtc)));
    requireValue(isRecord(receipt.source) && keys(receipt.source, ['revision', 'dirty', 'inputs', 'digest']));
    requireValue(typeof receipt.source.revision === 'string' && /^[a-f0-9]{40}$/.test(receipt.source.revision));
    requireValue(typeof receipt.source.dirty === 'boolean' && (!receipt.source.dirty || expected.allowDirty === true));
    const inputs = inventory(receipt.source.inputs);
    requireValue(digest(inputs) === receipt.source.digest);
    requireValue(expected.revision === undefined || expected.revision === receipt.source.revision);
    requireValue(expected.sourceDigest === undefined || expected.sourceDigest === receipt.source.digest);
    requireValue(isRecord(receipt.app) && keys(receipt.app, ['files', 'digest']));
    requireValue(isRecord(receipt.fixture) && keys(receipt.fixture, ['files']));
    const appFiles = inventory(receipt.app.files);
    const fixtureFiles = inventory(receipt.fixture.files);
    const files = inventory(receipt.files);
    requireValue(digest(appFiles) === receipt.app.digest && digest(files) === receipt.inventoryDigest);
    requireValue(JSON.stringify(files) === JSON.stringify([...appFiles, ...fixtureFiles].sort(order)));
    requireValue(JSON.stringify(fixtureFiles.map((file) => file.path)) === JSON.stringify(NATIVE_FIXTURE_PATHS));
    for (const file of [
        'electron.exe',
        'resources/app/app-bootstrap.mjs',
        'resources/app/app-main.mjs',
        'resources/app/app-preload.cjs',
        'resources/app/app-renderer.js',
        'resources/app/package.json',
        'resources/app/delivery/app-release-inputs.json',
        'resources/app/delivery/app-native-release.json',
        'resources/app/delivery/official-server-release.json',
        'resources/node/node.exe',
        'resources/node/LICENSE',
        'resources/official-server/package.json',
        'resources/official-server/build/src/bin/chrome-devtools-mcp.js',
        `resources/app/node_modules/fs-native-extensions/prebuilds/win32-${receipt.architecture}/fs-native-extensions.node`,
    ])
        requireValue(appFiles.some((entry) => entry.path === file));
    requireValue(
        JSON.stringify((await io.listFiles(root)).sort((a, b) => a.localeCompare(b, 'en'))) ===
            JSON.stringify(files.map((file) => file.path)),
    );
    for (const file of files) {
        const bytes = await io.readFile(path.join(root, file.path));
        requireValue(bytes.length === file.bytes && hash(bytes) === file.sha256);
    }
    return {
        root,
        inventoryDigest: String(receipt.inventoryDigest),
        nodeExecutable: path.join(root, 'resources/node/node.exe'),
        entry: path.join(root, 'http-fixture.mjs'),
        studyEntries: {
            layers: path.join(root, 'screenshot-layers-study.mjs'),
            timeout: path.join(root, 'screenshot-timeout-study.mjs'),
        },
    };
}
