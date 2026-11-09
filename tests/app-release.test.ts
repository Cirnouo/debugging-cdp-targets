import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseAppNativeEvidence, parseAppReleaseInputs } from '../src/domains/app-release.ts';

const windowsInputs = {
    schemaVersion: 1,
    sources: {
        electronChecksums: 'https://github.com/electron/electron/releases/download/v44.9.1/SHASUMS256.txt',
        electronRelease: 'https://api.github.com/repos/electron/electron/releases/tags/v44.9.1',
        nodeChecksums: 'https://nodejs.org/dist/v24.21.0/SHASUMS256.txt',
    },
    archives: [
        {
            kind: 'electron',
            version: '44.9.1',
            platform: 'win32',
            architecture: 'x64',
            filename: 'electron-v44.9.1-win32-x64.zip',
            url: 'https://github.com/electron/electron/releases/download/v44.9.1/electron-v44.9.1-win32-x64.zip',
            bytes: 158389896,
            sha256: '41bd7900bd42d0f49110a81617876137041fbbf473466920248ddb076349ef91',
            licenses: [
                {
                    path: 'LICENSE',
                    bytes: 1096,
                    sha256: '5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d',
                },
                {
                    path: 'LICENSES.chromium.html',
                    bytes: 20477229,
                    sha256: 'e6e6b1f9cb0f32235412be113de7716333e88121f9159a0ea0ff3be652021af7',
                },
            ],
        },
        {
            kind: 'node',
            version: '24.21.0',
            platform: 'win32',
            architecture: 'x64',
            filename: 'node-v24.21.0-win-x64.zip',
            url: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',
            bytes: 37618919,
            sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
            runtimeFiles: [
                {
                    path: 'node-v24.21.0-win-x64/node.exe',
                    destination: 'node.exe',
                    bytes: 93580104,
                    sha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
                },
                {
                    path: 'node-v24.21.0-win-x64/LICENSE',
                    destination: 'LICENSE',
                    bytes: 160555,
                    sha256: 'ed34dd8e3f0a78dbaf00d0444ce8e285b015b765379c2e17880455f70370f8e9',
                },
            ],
        },
        {
            kind: 'electron',
            version: '44.9.1',
            platform: 'win32',
            architecture: 'arm64',
            filename: 'electron-v44.9.1-win32-arm64.zip',
            url: 'https://github.com/electron/electron/releases/download/v44.9.1/electron-v44.9.1-win32-arm64.zip',
            bytes: 156452965,
            sha256: '81dc235e033cefb9d47ba5bbdedbf9d5390761ed0e362d9bf0518d981ef10b85',
        },
        {
            kind: 'node',
            version: '24.21.0',
            platform: 'win32',
            architecture: 'arm64',
            filename: 'node-v24.21.0-win-arm64.zip',
            url: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-arm64.zip',
            bytes: 33679608,
            sha256: '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921',
        },
    ],
};

test('App inputs identify exactly four retained Windows archives independently of runner OS', async () => {
    const source: unknown = JSON.parse(
        await readFile(new URL('../tooling/app-release-inputs.json', import.meta.url), 'utf8'),
    );
    const evidence = parseAppReleaseInputs(source);
    assert.deepEqual(evidence.archives.map((entry) => `${entry.kind}:${entry.platform}:${entry.architecture}`).sort(), [
        'electron:win32:arm64',
        'electron:win32:x64',
        'node:win32:arm64',
        'node:win32:x64',
    ]);
    assert.deepEqual(source, windowsInputs, 'Every retained object, original-file record and source stays exact.');
    assert.deepEqual(evidence, windowsInputs);
});

test('App archive parser rejects missing, duplicate, substituted and malformed Windows evidence', () => {
    assert.doesNotThrow(() => parseAppReleaseInputs(windowsInputs));
    const replaceFirst = (replacement: unknown) => [replacement, ...windowsInputs.archives.slice(1)];
    const first = windowsInputs.archives[0];
    assert.ok(first);
    const invalid: [string, unknown][] = [
        ['missing archive', { ...windowsInputs, archives: windowsInputs.archives.slice(1) }],
        ['extra duplicate', { ...windowsInputs, archives: [...windowsInputs.archives, first] }],
        ['same-count duplicate', { ...windowsInputs, archives: replaceFirst(windowsInputs.archives[1]) }],
        ['unknown root field', { ...windowsInputs, trusted: true }],
        ['unknown source field', { ...windowsInputs, sources: { ...windowsInputs.sources, trusted: true } }],
        [
            'foreign source',
            {
                ...windowsInputs,
                sources: { ...windowsInputs.sources, nodeChecksums: 'https://unreviewed.invalid/SHASUMS256.txt' },
            },
        ],
    ];
    for (const platform of ['linux', 'darwin', 'freebsd']) {
        const filename = `electron-v44.9.1-${platform}-x64.zip`;
        invalid.push([
            `substituted ${platform} archive`,
            {
                ...windowsInputs,
                archives: replaceFirst({
                    ...first,
                    platform,
                    filename,
                    url: `https://github.com/electron/electron/releases/download/v44.9.1/${filename}`,
                }),
            },
        ]);
    }
    for (const [field, value] of [
        ['kind', 'runtime'],
        ['architecture', 'ia32'],
        ['version', '44.8.0'],
        ['filename', 'foreign.zip'],
        ['url', 'https://unreviewed.invalid/runtime.zip'],
        ['bytes', 0],
        ['bytes', -1],
        ['bytes', 1.5],
        ['bytes', Number.MAX_SAFE_INTEGER + 1],
        ['bytes', '158389896'],
        ['sha256', 'unverified'],
        ['sha256', 'a'.repeat(63)],
        ['sha256', 'A'.repeat(64)],
        ['trusted', true],
    ])
        invalid.push([
            `${field}: ${String(value)}`,
            { ...windowsInputs, archives: replaceFirst({ ...first, [String(field)]: value }) },
        ]);
    for (const [name, mutation] of invalid) assert.throws(() => parseAppReleaseInputs(mutation), Error, name);

    // Shape validation is separate from independent verification of actual archive bytes.
    assert.doesNotThrow(() =>
        parseAppReleaseInputs({
            ...windowsInputs,
            archives: replaceFirst({ ...first, sha256: '0'.repeat(64) }),
        }),
    );
});

test('native evidence preserves the complete original loader closure and every original license', async () => {
    const source: unknown = JSON.parse(
        await readFile(new URL('../tooling/app-native-release.json', import.meta.url), 'utf8'),
    );
    const evidence = parseAppNativeEvidence(source);
    assert.equal(evidence.packages.length, 6);
    const extension = evidence.packages.find((entry) => entry.package === 'fs-native-extensions');
    assert.equal(extension?.files.length, 38);
    assert.equal(
        extension?.files.find((file) => file.path === 'prebuilds/win32-x64/fs-native-extensions.node')?.sha256,
        'dd3f8eb1d53441f151551c84a1211c79524b1eab74ff83ab93e68037f3997ba4',
    );
    for (const mutation of [
        { ...evidence, packages: evidence.packages.slice(1) },
        { ...evidence, packages: [...evidence.packages, evidence.packages[0]] },
        {
            ...evidence,
            packages: evidence.packages.map((entry) => ({
                ...entry,
                files: entry.files.filter((file) => file.path !== 'LICENSE'),
            })),
        },
        {
            ...evidence,
            packages: evidence.packages.map((entry) => ({
                ...entry,
                files: entry.files.map((file) => ({ ...file, path: '../escape' })),
            })),
        },
        {
            ...evidence,
            packages: evidence.packages.map((entry) => ({
                ...entry,
                files: entry.files.map((file) => ({ ...file, sha256: 'unverified' })),
            })),
        },
    ])
        assert.throws(() => parseAppNativeEvidence(mutation));
});
