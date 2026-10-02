import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import { NPM_REGISTRY, PACKAGE_NAME, PACKAGE_VERSION } from '../src/shared/constants.ts';
import { isRecord } from '../src/shared/errors.ts';
import { parseOfficialReleaseEvidence } from '../src/shared/official-package.ts';
import { readLockInventory } from '../tooling/security/audit-policy.ts';

test('reviewed official release agrees with exact build dependency and isolated lock', async () => {
    const manifest: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.ok(isRecord(manifest) && isRecord(manifest.devDependencies));
    assert.equal(manifest.devDependencies[PACKAGE_NAME], PACKAGE_VERSION);
    const release: unknown = JSON.parse(
        await readFile(new URL('../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release));
    assert.equal(release.name, PACKAGE_NAME);
    assert.equal(release.version, PACKAGE_VERSION);
    assert.equal(release.registry, NPM_REGISTRY);
    assert.equal(release.tarball, `${NPM_REGISTRY}/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`);
    assert.equal(
        release.integrity,
        'sha512-Klw6HWDqHC/XS1JwZldd2r49aUhbUJN9m9Mvcx4SEueIPXtzuQX+QelxAViobv8YUkDZ7HWDrmViR6LeYK0wAw==',
    );
    assert.equal(release.bin, 'build/src/bin/chrome-devtools-mcp.js');
    assert.ok(Array.isArray(release.files) && release.files.length > 0);
    for (const [file, group] of [
        ['../pnpm-lock.yaml', 'devDependencies'],
        ['../tooling/security/upstream-pnpm-lock.yaml', 'dependencies'],
    ] as const) {
        const inventory = readLockInventory(await readFile(new URL(file, import.meta.url), 'utf8'));
        const importer = inventory.documents.find((document) => document.importers['.']?.[group]?.[PACKAGE_NAME]);
        assert.equal(importer?.importers['.']?.[group]?.[PACKAGE_NAME]?.specifier, PACKAGE_VERSION);
        const official = inventory.packages.filter((item) => item.name === PACKAGE_NAME);
        assert.equal(official.length, 1);
        assert.equal(official[0]?.version, release.version);
        assert.equal(official[0]?.integrity, release.integrity);
    }
});

async function packageFixture(launchMarker = false) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-official-package-'));
    const release: unknown = JSON.parse(
        await readFile(new URL('../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release));
    const contents = new Map([
        [
            'package.json',
            JSON.stringify({
                name: PACKAGE_NAME,
                version: PACKAGE_VERSION,
                type: 'module',
                bin: { [PACKAGE_NAME]: './build/src/bin/chrome-devtools-mcp.js' },
            }),
        ],
        [
            'build/src/bin/chrome-devtools-mcp.js',
            launchMarker
                ? `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(path.join(root, 'spawn-marker'))}, 'started'); process.stdin.resume();\n`
                : 'export {};\n',
        ],
        ['LICENSE', 'Apache License\n'],
        ['build/src/third_party/THIRD_PARTY_NOTICES', 'Vendor licenses\n'],
        ['build/src/third_party/bundled-packages.json', '{}\n'],
        ['build/src/resource.json', '{"resource":true}\n'],
        ['skills/devtools/SKILL.md', 'Official skill\n'],
    ]);
    for (const [name, bytes] of contents) {
        await mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await writeFile(path.join(root, name), bytes);
    }
    const input = {
        ...release,
        files: [...contents]
            .map(([file, bytes]) => ({
                path: file,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                bytes: Buffer.byteLength(bytes),
            }))
            .sort((a, b) => (a.path < b.path ? -1 : 1)),
    };
    return { root, input, contents };
}

test('release evidence rejects wrong identity, malformed digests, unsafe or duplicate paths and missing required files', async () => {
    const fixture = await packageFixture();
    try {
        const input = fixture.input;
        assert.equal(parseOfficialReleaseEvidence(input).files.length, 7);
        for (const changed of [
            { ...input, name: 'other' },
            { ...input, version: '1.10.0' },
            { ...input, registry: 'https://other.invalid' },
            { ...input, integrity: 'sha512-short' },
            { ...input, bin: '../outside.js' },
            { ...input, files: [...input.files, input.files[0]] },
            ...[
                '../escape',
                '/absolute',
                'C:/escape',
                'a\\b',
                'a/../b',
                'a//b',
                'a./file',
                'CON/file',
                'file:stream',
            ].map((file) => ({ ...input, files: [{ path: file, sha256: '0'.repeat(64), bytes: 1 }, ...input.files] })),
            ...['LICENSE', 'build/src/bin/chrome-devtools-mcp.js', 'build/src/third_party/THIRD_PARTY_NOTICES'].map(
                (file) => ({
                    ...input,
                    files: input.files.filter((item) => item.path !== file),
                }),
            ),
            { ...input, files: input.files.map((item) => ({ ...item, sha256: 'bad' })) },
            { ...input, files: input.files.map((item) => ({ ...item, bytes: -1 })) },
        ])
            assert.throws(() => parseOfficialReleaseEvidence(changed));
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('package verifier preserves exact nested bytes and rejects changed, missing and extra content', async () => {
    const fixture = await packageFixture();
    try {
        const evidence = parseOfficialReleaseEvidence(fixture.input);
        const files = await verifyOfficialPackage(fixture.root, evidence);
        assert.deepEqual([...files.keys()].sort(), [...fixture.contents.keys()].sort());
        for (const [file, bytes] of fixture.contents) assert.equal(files.get(file)?.toString(), bytes);
        await writeFile(path.join(fixture.root, 'build/src/resource.json'), 'changed');
        await assert.rejects(verifyOfficialPackage(fixture.root, evidence), /digest|length|changed/i);
        await writeFile(
            path.join(fixture.root, 'build/src/resource.json'),
            fixture.contents.get('build/src/resource.json') ?? '',
        );
        await rm(path.join(fixture.root, 'LICENSE'));
        await assert.rejects(verifyOfficialPackage(fixture.root, evidence), /missing/i);
        await writeFile(path.join(fixture.root, 'LICENSE'), 'Apache License\n');
        await writeFile(path.join(fixture.root, 'extra'), 'extra');
        await assert.rejects(verifyOfficialPackage(fixture.root, evidence), /extra|unexpected/i);
        await rm(path.join(fixture.root, 'extra'));
        await mkdir(path.join(fixture.root, 'extra-directory'));
        await assert.rejects(verifyOfficialPackage(fixture.root, evidence), /extra|unexpected/i);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('package verifier rejects internal links and a linked package root', async () => {
    const fixture = await packageFixture();
    const container = await mkdtemp(path.join(os.tmpdir(), 'dct-official-links-'));
    try {
        const evidence = parseOfficialReleaseEvidence(fixture.input);
        await symlink(fixture.root, path.join(container, 'package'), 'junction');
        await assert.rejects(verifyOfficialPackage(path.join(container, 'package'), evidence), /link/i);
        await symlink(container, path.join(fixture.root, 'build/src/linked'), 'junction');
        await assert.rejects(verifyOfficialPackage(fixture.root, evidence), /link/i);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
        await rm(container, { recursive: true, force: true });
    }
});

test('installed pnpm bin shims are excluded only by the explicit build-input boundary', async () => {
    const fixture = await packageFixture();
    try {
        const evidence = parseOfficialReleaseEvidence(fixture.input);
        await mkdir(path.join(fixture.root, 'node_modules/.bin'), { recursive: true });
        await writeFile(path.join(fixture.root, 'node_modules/.bin/chrome-devtools-mcp.cmd'), 'manager shim');
        await assert.rejects(verifyOfficialPackage(fixture.root, evidence), /Unexpected/);
        const files = await verifyOfficialPackage(fixture.root, evidence, { pnpmInstalled: true });
        assert.equal(files.size, fixture.contents.size);
        assert.ok(!files.has('node_modules/.bin/chrome-devtools-mcp.cmd'));
        await writeFile(path.join(fixture.root, 'node_modules/.bin/extra'), 'extra');
        await assert.rejects(verifyOfficialPackage(fixture.root, evidence, { pnpmInstalled: true }), /Unexpected/);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('native Server resolution is independent of the caller working directory', async () => {
    const execute = promisify(execFile);
    const module = new URL('../src/adapters/official-server.ts', import.meta.url).href;
    const result = await execute(
        process.execPath,
        [
            '--input-type=module',
            '--eval',
            `import { resolveServerBin } from ${JSON.stringify(module)}; console.log(await resolveServerBin());`,
        ],
        { cwd: os.tmpdir(), timeout: 5000, windowsHide: true, shell: false },
    );
    assert.equal(
        result.stdout.trim(),
        fileURLToPath(
            new URL(
                '../plugins/debugging-cdp-targets/dist/official-server/build/src/bin/chrome-devtools-mcp.js',
                import.meta.url,
            ),
        ),
    );
});

test('packaged resolver verifies every call and rejects missing or changed content before child spawn', async () => {
    const fixture = await packageFixture(true);
    const execute = promisify(execFile);
    try {
        for (const [name, bytes] of fixture.contents) {
            await mkdir(path.dirname(path.join(fixture.root, 'official-server', name)), { recursive: true });
            await writeFile(path.join(fixture.root, 'official-server', name), bytes);
        }
        const output = path.join(fixture.root, 'gateway.mjs');
        await build({
            stdin: {
                contents:
                    "export { resolveServerBin } from './src/adapters/official-server.ts'; export { createOfficialConnection } from './src/adapters/mcp-bridge.ts';",
                resolveDir: fileURLToPath(new URL('..', import.meta.url)),
            },
            outfile: output,
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            define: { __DCT_OFFICIAL_RELEASE__: JSON.stringify(fixture.input) },
            banner: {
                js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
            },
        });
        const prelude = `const m = await import(${JSON.stringify(pathToFileURL(output).href)});`;
        const options = { cwd: os.tmpdir(), timeout: 5000, windowsHide: true, shell: false };
        const result = await execute(
            process.execPath,
            ['--input-type=module', '--eval', `${prelude} console.log(await m.resolveServerBin());`],
            options,
        );
        assert.equal(
            result.stdout.trim(),
            path.join(fixture.root, 'official-server/build/src/bin/chrome-devtools-mcp.js'),
        );
        const changed = path.join(fixture.root, 'official-server/build/src/resource.json');
        await assert.rejects(
            execute(
                process.execPath,
                [
                    '--input-type=module',
                    '--eval',
                    `${prelude} await m.resolveServerBin(); const fs = await import('node:fs/promises'); await fs.writeFile(${JSON.stringify(changed)}, 'changed'); await m.resolveServerBin();`,
                ],
                options,
            ),
            /digest|length|changed/,
        );
        await assert.rejects(
            execute(
                process.execPath,
                [
                    '--input-type=module',
                    '--eval',
                    `${prelude} await m.createOfficialConnection('http://127.0.0.1:9222');`,
                ],
                options,
            ),
            /digest|length|changed/,
        );
        await writeFile(changed, fixture.contents.get('build/src/resource.json') ?? '');
        await rm(path.join(fixture.root, 'official-server/LICENSE'));
        await assert.rejects(
            execute(
                process.execPath,
                [
                    '--input-type=module',
                    '--eval',
                    `${prelude} await m.createOfficialConnection('http://127.0.0.1:9222');`,
                ],
                options,
            ),
            /Missing official package file/,
        );
        await assert.rejects(readFile(path.join(fixture.root, 'spawn-marker')), /ENOENT/);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});
