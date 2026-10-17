import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseAppNativeEvidence, parseAppReleaseInputs } from '../src/domains/app-release.ts';

test('App inputs independently identify all six Electron and ordinary Node archives', async () => {
    const source: unknown = JSON.parse(
        await readFile(new URL('../tooling/app-release-inputs.json', import.meta.url), 'utf8'),
    );
    const evidence = parseAppReleaseInputs(source);
    assert.equal(evidence.archives.length, 12);
    const node = evidence.archives.find(
        (entry) => entry.kind === 'node' && entry.platform === 'win32' && entry.architecture === 'x64',
    );
    assert.equal(node?.sha256, '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541');
    assert.equal(
        node?.runtimeFiles?.find((file) => file.destination === 'node.exe')?.sha256,
        'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
    );
    assert.throws(
        () => parseAppReleaseInputs({ ...evidence, archives: [...evidence.archives, evidence.archives[0]] }),
        /duplicate|inventory/i,
    );
    assert.throws(() => parseAppReleaseInputs({ ...evidence, archives: evidence.archives.slice(1) }), /inventory/i);
    assert.throws(() =>
        parseAppReleaseInputs({
            ...evidence,
            archives: evidence.archives.map((entry) => ({ ...entry, url: 'https://unreviewed.invalid/runtime.zip' })),
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
