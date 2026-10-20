import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../src/shared/errors.ts';
import { generateAppFiles, readAppOfficialFiles } from '../tooling/build-app.ts';
import { parseOfficialSmokeArguments } from '../tooling/smoke-official-catalog.ts';

test('official catalog evidence requires one explicit source mode and never silently falls back', () => {
    const stage = fileURLToPath(new URL('.', import.meta.url));
    assert.deepEqual(parseOfficialSmokeArguments(['--installed']), { kind: 'installed' });
    assert.deepEqual(parseOfficialSmokeArguments(['--stage', stage]), { kind: 'stage', directory: stage });
    for (const args of [
        [],
        ['--stage'],
        ['--installed', '--stage', stage],
        ['--stage', stage, '--installed'],
        ['--stage', '--installed'],
        ['--unknown'],
    ])
        assert.throws(() => parseOfficialSmokeArguments(args));
});

test('App build separates synchronous bootstrap and emits only sandboxed local renderer assets with actual licenses', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    let actualInputs: readonly string[] = [];
    const files = await generateAppFiles({
        root,
        kind: 'portable',
        platform: 'win32',
        architecture: 'x64',
        onInputs: async (inputs) => {
            actualInputs = inputs;
        },
    });
    for (const input of [
        'src/gateway/core.ts',
        'src/gateway/registry.ts',
        'src/gateway/targets/target-lifecycle.ts',
        'tooling/licenses/bundled-notices.ts',
        'tooling/licenses/canonical-inputs.ts',
        'tooling/licenses/reviewed-vendors.json',
        'src/gateway/connections/resource-owner.ts',
        'src/gateway/connections/directory-lease.ts',
        'src/gateway/owned-tool-arguments.ts',
        'src/gateway/diagnostics.ts',
        'src/gateway/targets/model/cdp-identity.ts',
        'src/gateway/targets/model/target-contract.ts',
        'src/gateway/targets/model/chrome-profile-argument.ts',
        'src/gateway/targets/model/chromium-features.ts',
        'src/gateway/targets/model/isolation.ts',
        'src/gateway/targets/model/launch-command.ts',
        'src/shared/environment-key.ts',
        'src/gateway/official/release-evidence.ts',
        'src/shared/payload-path.ts',
        'src/domains/control-contract.ts',
        'src/domains/mcp-http.ts',
        'src/adapters/mcp-request-handler.ts',
        'src/application/host-plugin-manager.ts',
        'src/host-plugins/payload-integrity.ts',
        'src/adapters/verified-plugin-files.ts',
        'src/adapters/native-host-plugins.ts',
        'src/adapters/managed-plugin-receipts.ts',
    ])
        assert.ok(
            actualInputs.some((name) => name.replaceAll('\\', '/').endsWith(input)),
            input,
        );
    assert.equal(
        actualInputs.some((name) => name.replaceAll('\\', '/').endsWith('src/shared/diagnostics.ts')),
        false,
    );
    assert.equal(
        actualInputs.some((name) => name.replaceAll('\\', '/').endsWith('src/domains/cdp-target.ts')),
        false,
    );
    for (const oldInput of [
        'src/application/plugin-runtime.ts',
        'src/application/target-controller.ts',
        'tooling/build-plugin.ts',
        'tooling/distribution/build-plugin.ts',
        'tooling/distribution/audit-plugins.ts',
        'tooling/distribution/host-metadata.ts',
        'tooling/distribution/host-descriptors.ts',
        'tooling/distribution/payload-inventory.ts',
        'tooling/distribution/artwork-policy.ts',
        'tooling/distribution/regular-file-tree.ts',
        'tooling/distribution/version-agreement.ts',
        'tooling/runtime-license-policy.ts',
        'tooling/vendored-licenses.json',
        'src/application/connection-owner.ts',
        'src/application/connection-directory.ts',
        'src/domains/chrome-profile.ts',
        'src/domains/chromium-features.ts',
        'src/domains/data-isolation.ts',
        'src/domains/launch-command.ts',
    ])
        assert.equal(
            actualInputs.some((name) => name.replaceAll('\\', '/').endsWith(oldInput)),
            false,
            oldInput,
        );
    for (const name of [
        'windows-deployment-authority.ps1',
        'windows-deployment-authority.cs',
        'macos-deployment-authority.jxa',
    ]) {
        assert.ok(files.has(name), `Missing fixed deployment helper: ${name}`);
        assert.ok(files.get(name)?.equals(await readFile(new URL(`../src/adapters/${name}`, import.meta.url))));
        assert.ok(actualInputs.includes(`src/adapters/${name}`), `Missing helper source input: ${name}`);
    }
    for (const name of ['semver', 'smol-toml'])
        assert.ok(
            actualInputs.some((input) => input.replaceAll('\\', '/').includes(`/node_modules/${name}/`)),
            name,
        );
    for (const [name, bytes] of files) {
        if (!/\.(?:mjs|cjs|js)$/.test(name) || name.startsWith('node_modules/')) continue;
        const checked = spawnSync(
            process.execPath,
            ['--check', '--input-type', name.endsWith('.cjs') ? 'commonjs' : 'module'],
            {
                input: bytes,
                windowsHide: true,
                encoding: 'utf8',
            },
        );
        assert.equal(checked.status, 0, `${name}: ${checked.stderr}`);
    }
    const bootstrap = files.get('app-bootstrap.mjs')?.toString('utf8') ?? '';
    assert.match(bootstrap, /setPath\("userData"/);
    assert.match(bootstrap, /import\("\.\/app-main\.mjs"\)/);
    assert.ok(bootstrap.indexOf('setPath("sessionData"') < bootstrap.indexOf('import("./app-main.mjs")'));
    assert.doesNotMatch(bootstrap, /class Protocol|function createGatewayCore|requestSingleInstanceLock/);
    assert.match(files.get('app-preload.cjs')?.toString('utf8') ?? '', /exposeInMainWorld/);
    assert.doesNotMatch(files.get('app-renderer.js')?.toString('utf8') ?? '', /node:|from "electron"/);
    const notices = files.get('THIRD-PARTY-NOTICES.txt')?.toString('utf8') ?? '';
    for (const dependency of [
        'react',
        'react-dom',
        '@modelcontextprotocol/node',
        'fs-native-extensions',
        'semver',
        'smol-toml',
    ])
        assert.ok(notices.includes(dependency));
    for (const file of [
        'LICENSE',
        'app.html',
        'app.css',
        'icon.png',
        'distribution.json',
        'delivery/app-release-inputs.json',
        'delivery/app-native-release.json',
        'delivery/official-server-release.json',
    ])
        assert.ok(files.has(file), file);
});

test('actual App bundles include all six reviewed SDK vendor notices and exclude unused browser vendor', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const files = await generateAppFiles({ root, kind: 'portable', platform: 'win32', architecture: 'x64' });
    const notices = files.get('THIRD-PARTY-NOTICES.txt')?.toString();
    assert.ok(notices);
    for (const identity of [
        'ajv@8.18.0',
        'ajv-formats@3.0.1',
        'content-type@1.0.5',
        'fast-deep-equal@3.1.3',
        'fast-uri@3.1.0',
        'json-schema-traverse@1.0.0',
    ]) {
        assert.equal(notices.split(`${identity} — LICENSE (vendored)`).length - 1, 1, identity);
    }
    assert.doesNotMatch(notices, /@cfworker\/json-schema/);
});

test('App delivery copies every official published file at its complete relative path', async () => {
    const release: unknown = JSON.parse(
        await readFile(new URL('../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release) && Array.isArray(release.files));
    const files = await readAppOfficialFiles(fileURLToPath(new URL('..', import.meta.url)));
    for (const record of release.files) {
        assert.ok(isRecord(record) && typeof record.path === 'string');
        const bytes = await readFile(new URL(`../node_modules/chrome-devtools-mcp/${record.path}`, import.meta.url));
        assert.ok(files.get(record.path)?.equals(bytes), record.path);
    }
    assert.equal(files.size, release.files.length);
});
