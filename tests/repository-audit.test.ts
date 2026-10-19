import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGIN_HOSTS } from '../tooling/host-policy.ts';
import { PLUGIN_ROOT } from '../tooling/payload-policy.ts';
import { auditRepository, validateRuntimeSource } from '../tooling/repository-audit.ts';

function connectionDependencyForms(specifier: string) {
    return [
        { erased: false, source: `import { value } from '${specifier}';` },
        { erased: false, source: `import '${specifier}';` },
        { erased: true, source: `import type { Value } from '${specifier}';` },
        { erased: true, source: `import { type Value } from '${specifier}';` },
        { erased: false, source: `export { value } from '${specifier}';` },
        { erased: false, source: `export * from '${specifier}';` },
        { erased: true, source: `export type { Value } from '${specifier}';` },
        { erased: true, source: `export { type Value } from '${specifier}';` },
        { erased: true, source: `export type * from '${specifier}';` },
        { erased: true, source: `type Value = import('${specifier}').Value;` },
        { erased: true, source: `import type Value = require('${specifier}');` },
        { erased: false, source: `import Value = require('${specifier}');` },
        { erased: false, source: `const value = require('${specifier}');` },
        { erased: false, source: `const value = require?.('${specifier}');` },
        { erased: false, source: `const value = (require as (name: string) => unknown)?.('${specifier}');` },
        { erased: false, source: `const value = import('${specifier}');` },
    ];
}

test('connection resource roles accept only their exact adapter and erased contract capabilities', () => {
    for (const [file, dependency, onlyType] of [
        ['src/gateway/connections/directory-lease.ts', '../../adapters/data-directory.ts', false],
        ['src/gateway/connections/resource-owner.ts', '../targets/model/target-contract.ts', true],
        ['src/gateway/connections/directory-lease.ts', '../../adapters/fixture-diagnostics.ts', false],
        ['src/gateway/connections/directory-lease.ts', '../targets/model/isolation.ts', true],
        ['src/gateway/connections/directory-lease.ts', './resource-owner.ts', true],
    ] as const) {
        for (const { source, erased } of connectionDependencyForms(dependency)) {
            const errors = validateRuntimeSource(file, source);
            if (!onlyType || erased) assert.deepEqual(errors, [], `${file}: ${source}`);
            else assert.ok(errors.length, `${file}: ${source}`);
        }
    }
});

test('connection resource roles reject wrong dependencies across runtime and erased syntax', () => {
    for (const file of ['src/gateway/connections/resource-owner.ts', 'src/gateway/connections/directory-lease.ts']) {
        for (const dependency of [
            'node:fs',
            'node:net',
            'node:child_process',
            '@modelcontextprotocol/core',
            'ws',
            '../../application/target-controller.ts',
            '../../interface/app-main.ts',
            '../../adapters/target-host.ts',
            '../../domains/control-contract.ts',
            '../targets/model/unknown.ts',
            './unknown.ts',
            '../diagnostics.ts',
        ])
            for (const { source } of connectionDependencyForms(dependency))
                assert.ok(validateRuntimeSource(file, source).length, `${file}: ${source}`);
        for (const source of [
            'const value = import(moduleName);',
            'const value = require?.(moduleName);',
            'const value = (require as (name: string) => unknown)?.(moduleName);',
        ])
            assert.ok(
                validateRuntimeSource(file, source).some((error) => error.includes('computed module dependencies')),
                `${file}: ${source}`,
            );
    }
});

test('pure Gateway cannot acquire either mutable connection owner even through erased syntax', () => {
    for (const [file, prefix] of [
        ['src/gateway/owned-tool-arguments.ts', './connections'],
        ['src/gateway/targets/model/isolation.ts', '../../connections'],
        ['src/gateway/unreviewed.ts', './connections'],
        ['src/gateway/connections/unreviewed.ts', '.'],
    ] as const)
        for (const owner of ['resource-owner', 'directory-lease'])
            for (const { source } of connectionDependencyForms(`${prefix}/${owner}.ts`))
                assert.ok(
                    validateRuntimeSource(file, source).some((error) =>
                        error.includes('pure owners cannot depend on mutable connection owners'),
                    ),
                    `${file}: ${source}`,
                );
    for (const { source } of connectionDependencyForms('../../adapters/data-directory.ts'))
        assert.ok(validateRuntimeSource('src/gateway/connections/unreviewed.ts', source).length, source);
});

test('adapters cannot acquire mutable connection authorities through runtime or erased dependencies', () => {
    for (const owner of ['resource-owner', 'directory-lease']) {
        for (const dependency of [
            `../gateway/connections/${owner}.ts`,
            `../gateway/connections/../connections/${owner}.ts`,
        ])
            for (const { source } of connectionDependencyForms(dependency))
                assert.ok(validateRuntimeSource('src/adapters/example.ts', source).length, source);
        for (const caller of ['src/application/example.ts', 'src/interface/example.ts'])
            for (const { source } of connectionDependencyForms(`../gateway/connections/${owner}.ts`))
                assert.deepEqual(validateRuntimeSource(caller, source), [], `${caller}: ${source}`);
    }
    for (const dependency of [
        '../gateway/targets/model/target-contract.ts',
        '../gateway/diagnostics.ts',
        '../gateway/owned-tool-arguments.ts',
    ])
        for (const { source } of connectionDependencyForms(dependency))
            assert.deepEqual(validateRuntimeSource('src/adapters/example.ts', source), [], source);
});

test('mutable connection roles retain ambient guards and harmless declaration keys', () => {
    for (const file of ['src/gateway/connections/resource-owner.ts', 'src/gateway/connections/directory-lease.ts']) {
        assert.deepEqual(
            validateRuntimeSource(
                file,
                'interface RecordValue { performance(): number; Date(): number; process(): string; }',
            ),
            [],
        );
        for (const source of [
            'const value = process.env;',
            'const value = process?.env;',
            'const value = (process as {env: unknown})["env"];',
            'const {env} = process;',
            'const value = Date.now();',
            'const value = new Date();',
            'const value = performance.now();',
            'const clock = performance;',
            'const {now} = performance;',
            'const value = globalThis.global.process.env;',
            'const value = global?.globalThis?.Date.now();',
            'const value = globalThis?.["globalThis"]?.["performance"]?.now();',
            'const ambient = globalThis.global; const value = ambient.process.env;',
            'const {performance: clock} = globalThis.globalThis;',
            'const value = fetch(url);',
            'const value = new WebSocket(url);',
            'const value = new XMLHttpRequest();',
            'const value = globalThis.global["fetch"](url);',
            'interface RecordValue { [performance](): number; }',
            'const record = { performance() { return process.env; } };',
        ])
            assert.ok(validateRuntimeSource(file, source).length, `${file}: ${source}`);
    }
});

test('connection resource roles accept both complete actual lifetime sources', async () => {
    for (const file of ['src/gateway/connections/resource-owner.ts', 'src/gateway/connections/directory-lease.ts']) {
        const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.deepEqual(validateRuntimeSource(file, source), [], file);
    }
});

test('runtime parser approvals belong only to their exact reviewed consumers', () => {
    assert.deepEqual(
        validateRuntimeSource('src/domains/software-version.ts', "import parse from 'semver/functions/parse.js';"),
        [],
    );
    assert.deepEqual(
        validateRuntimeSource('src/adapters/host-user-intent.ts', "import { parse } from 'smol-toml';"),
        [],
    );
    for (const [file, specifier] of [
        ['src/domains/other.ts', 'semver/functions/parse.js'],
        ['src/domains/software-version.ts', 'semver'],
        ['src/domains/software-version.ts', 'node:fs'],
        ['src/adapters/other.ts', 'smol-toml'],
        ['src/domains/other.ts', 'smol-toml'],
    ])
        assert.ok(validateRuntimeSource(file ?? '', `import x from '${specifier}';`).length);
});

test('gateway imports only public split SDK entry points', () => {
    for (const specifier of [
        '@modelcontextprotocol/client',
        '@modelcontextprotocol/server',
        '@modelcontextprotocol/core',
        '@modelcontextprotocol/client/stdio',
        '@modelcontextprotocol/server/stdio',
    ]) {
        assert.deepEqual(validateRuntimeSource('src/adapters/mcp-gateway.ts', `import x from '${specifier}';`), []);
    }
    for (const specifier of [
        '@modelcontextprotocol/unofficial',
        '@modelcontextprotocol/client/dist/index.mjs',
        '@modelcontextprotocol/server/internal',
        '@modelcontextprotocol/core/types',
        '@modelcontextprotocol/sdk/server/index.js',
    ]) {
        assert.ok(validateRuntimeSource('src/adapters/mcp-gateway.ts', `import x from '${specifier}';`).length);
    }
});

test('only the verified App native loader may load its reviewed advisory module', () => {
    const source = "const extension = require('fs-native-extensions');";
    assert.deepEqual(validateRuntimeSource('src/adapters/app-native.ts', source), []);
    for (const file of ['src/interface/app-main.ts', 'src/adapters/platform-process.ts', 'src/domains/app-release.ts'])
        assert.ok(validateRuntimeSource(file, source).length);
    assert.ok(validateRuntimeSource('src/adapters/app-native.ts', "require('unreviewed-native-addon');").length);
});

test('Electron and React imports stay restricted to their explicit App interface surfaces', () => {
    const surfaces = [
        ['src/interface/app-bootstrap.ts', 'electron'],
        ['src/interface/app-main.ts', 'electron'],
        ['src/interface/app-window.ts', 'electron'],
        ['src/interface/app-preload.ts', 'electron'],
        ['src/interface/app-renderer.ts', 'react'],
        ['src/interface/app-renderer.ts', 'react-dom/client'],
        ['src/interface/app-manager.ts', 'react'],
    ];
    for (const [file, dependency] of surfaces) {
        if (!file || !dependency) throw new Error('Invalid literal interface fixture.');
        assert.deepEqual(validateRuntimeSource(file, `import x from '${dependency}';`), []);
        for (const outside of [
            'src/domains/app-ui.ts',
            'src/adapters/app-native.ts',
            'src/application/plugin-runtime.ts',
        ])
            assert.ok(validateRuntimeSource(outside, `import x from '${dependency}';`).length);
    }
    assert.ok(validateRuntimeSource('src/interface/app-preload.ts', "import x from 'react-dom/client';").length);
    assert.ok(validateRuntimeSource('src/interface/app-renderer.ts', "import x from 'electron';").length);
    assert.ok(validateRuntimeSource('src/interface/app-manager.ts', "import x from 'electron';").length);
    assert.ok(validateRuntimeSource('src/interface/app-manager.ts', "import x from 'react-dom/client';").length);
});

test('repository audit accepts the supported Node range and contributor entry point', async (context) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-agents-')));
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        const license = 'Copyright (c) 2026 Cirnouo\n';
        const files = {
            'AGENTS.md': '# Contributor entry point\n',
            'README.md': '# Repository\n',
            LICENSE: license,
            '.gitignore': '.idea/\nnode_modules/\n.env*\n',
            'CHANGELOG.md': '## [Unreleased]\n',
            'package.json': `${JSON.stringify({ version: '2.3.4', engines: { node: '^24.21.0' }, packageManager: 'pnpm@12.4.2' }, null, 4)}\n`,
            'docs/README.md': '# Documentation\n',
            'docs/reference/README.md': '# Reference\n',
            'docs/reference/domain-language.md': '# Domain language\n',
            'plugins/README.md': '# Plugins\n',
            'plugins/codex/README.md': '# Codex\n',
            'packaging/README.md': '# Packaging\n',
            'packaging/codex/README.md': '# Codex inputs\n',
            'packaging/shared/README.md': '# Shared inputs\n',
            [`${PLUGIN_ROOT}/README.md`]: '# Plugin\n',
            [`${PLUGIN_ROOT}/LICENSE`]: license,
            'packaging/codex/.codex-plugin/README.md': '# Manifest\n',
            'packaging/codex/.codex-plugin/plugin.json': `${JSON.stringify({ name: 'debugging-cdp-targets', version: '0.1.0', license: 'MIT' }, null, 4)}\n`,
            'packaging/shared/skills/README.md': '# Skills\n',
            'packaging/shared/skills/debugging-cdp-targets/README.md': '# Instructions\n',
            'packaging/shared/skills/debugging-cdp-targets/SKILL.md':
                '---\nname: debugging-cdp-targets\nlicense: MIT\ndescription: Debug CDP targets.\nmetadata:\n    version: 0.1.0\n---\n',
        };
        const entries = new Map(Object.entries(files));
        for (const host of PLUGIN_HOSTS) {
            entries.set(`plugins/${host.id}/README.md`, '# Host\n');
            entries.set(`${host.inputRoot}/README.md`, '# Host inputs\n');
            entries.set(`${host.payloadRoot}/README.md`, '# Plugin\n');
            entries.set(`${host.payloadRoot}/LICENSE`, license);
            entries.set(`${host.inputRoot}/${path.posix.dirname(host.manifest)}/README.md`, '# Manifest\n');
            entries.set(`${host.payloadRoot}/${path.posix.dirname(host.manifest)}/README.md`, '# Manifest\n');
            const manifest = `${JSON.stringify({ name: 'debugging-cdp-targets', version: '0.1.0', license: 'MIT' }, null, 4)}\n`;
            entries.set(`${host.inputRoot}/${host.manifest}`, manifest);
            entries.set(`${host.payloadRoot}/${host.manifest}`, manifest);
        }
        for (const [file, source] of entries) {
            const target = path.join(root, file);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, source);
        }
        assert.deepEqual(await auditRepository(root), []);
        const glossary = path.join(root, 'docs/reference/domain-language.md');
        const retiredGlossary = path.join(root, 'docs/domain-language.md');
        const glossarySource = await readFile(glossary, 'utf8');
        await context.test('rejects a missing canonical glossary', async () => {
            await rm(glossary);
            assert.ok((await auditRepository(root)).some((error) => /only glossary/.test(error)));
        });
        await context.test('rejects the retired glossary as the only glossary', async () => {
            await writeFile(retiredGlossary, glossarySource);
            assert.ok((await auditRepository(root)).some((error) => /only glossary/.test(error)));
        });
        await context.test('rejects the retired glossary alongside the canonical glossary', async () => {
            await writeFile(glossary, glossarySource);
            assert.ok((await auditRepository(root)).some((error) => /only glossary/.test(error)));
            await rm(retiredGlossary);
        });
        await context.test('rejects CONTEXT.md alongside the canonical glossary', async () => {
            await writeFile(path.join(root, 'CONTEXT.md'), '# Duplicate vocabulary\n');
            assert.ok((await auditRepository(root)).some((error) => /only glossary/.test(error)));
            await rm(path.join(root, 'CONTEXT.md'));
        });
        assert.deepEqual(await auditRepository(root), []);
        for (const host of PLUGIN_HOSTS) {
            for (const base of [host.inputRoot, host.payloadRoot]) {
                const file = path.join(root, base, host.manifest);
                const original = await readFile(file, 'utf8');
                await writeFile(file, original.replace('0.1.0', '0.2.0'));
                assert.ok((await auditRepository(root)).some((error) => /version/i.test(error)));
                await writeFile(file, original);
            }
        }
        const skillFile = path.join(root, 'packaging/shared/skills/debugging-cdp-targets/SKILL.md');
        const originalSkill = await readFile(skillFile, 'utf8');
        await writeFile(skillFile, originalSkill.replace('0.1.0', '0.2.0'));
        assert.ok((await auditRepository(root)).some((error) => /version/i.test(error)));
        await writeFile(skillFile, originalSkill);
        const manifest = { version: '2.3.4', engines: { node: '^24.21.0' }, packageManager: 'pnpm@12.4.2' };
        async function auditManifest(value: unknown) {
            await writeFile(path.join(root, 'package.json'), `${JSON.stringify(value, null, 4)}\n`);
            return auditRepository(root);
        }
        for (const node of ['24.21.0', '^24.12.0', '>=24.21.0', '^25.0.0', undefined]) {
            await context.test(`rejects Node declaration ${node ?? '(absent)'}`, async () => {
                assert.deepEqual(await auditManifest({ ...manifest, engines: { node } }), [
                    'Node supported range drifted: engines.node must be ^24.21.0.',
                ]);
            });
        }
        await context.test('rejects absent Node engines', async () => {
            assert.deepEqual(await auditManifest({ ...manifest, engines: undefined }), [
                'Node supported range drifted: engines.node must be ^24.21.0.',
            ]);
        });
        for (const packageManager of ['pnpm@^12.4.2', 'pnpm@12', 'pnpm@12.4.1', undefined]) {
            await context.test(`rejects pnpm declaration ${packageManager ?? '(absent)'}`, async () => {
                assert.deepEqual(await auditManifest({ ...manifest, packageManager }), [
                    'pnpm pin drifted: packageManager must be pnpm@12.4.2.',
                ]);
            });
        }
        await context.test('reports Node range and pnpm pin drift independently', async () => {
            assert.deepEqual(await auditManifest({ ...manifest, engines: {}, packageManager: 'pnpm@latest' }), [
                'Node supported range drifted: engines.node must be ^24.21.0.',
                'pnpm pin drifted: packageManager must be pnpm@12.4.2.',
            ]);
        });
        assert.deepEqual(await auditManifest(manifest), []);
        const asset = path.join(root, 'packaging/shared/assets');
        await mkdir(asset);
        await writeFile(path.join(asset, 'README.md'), '# Approved icons\n');
        const approved = await readFile(new URL('../packaging/shared/assets/icon-light.png', import.meta.url));
        await writeFile(path.join(asset, 'icon-light.png'), approved);
        assert.deepEqual(await auditRepository(root), []);
        await writeFile(path.join(asset, 'unknown.png'), approved);
        assert.ok((await auditRepository(root)).some((error) => /unknown.png/.test(error)));
        await rm(path.join(asset, 'unknown.png'));
        await writeFile(path.join(asset, 'icon-light.png'), approved.subarray(0, 40));
        assert.ok((await auditRepository(root)).some((error) => /PNG|icon/.test(error)));
        await rm(path.join(asset, 'icon-light.png'));
        const outside = path.join(root, 'icon-source.png');
        await writeFile(outside, approved);
        await symlink(outside, path.join(asset, 'icon-light.png'));
        assert.ok((await auditRepository(root)).some((error) => /icon-light.png.*link/.test(error)));
    } finally {
        assert.equal(path.dirname(root), await realpath(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('dct-agents-'));
        await rm(root, { recursive: true, force: true });
    }
});

async function auditGithubDocumentation(files: readonly string[]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-readme-'));
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        for (const file of files) {
            const target = path.join(root, file);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, '');
        }
        // These fixtures isolate directory documentation from unrelated metadata requirements.
        return (await auditRepository(root)).filter((error) => error.startsWith('.github'));
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('dct-readme-'));
        await rm(root, { recursive: true, force: true });
    }
}

test('GitHub directory documentation uses INDEX.md without overriding the root README', async () => {
    assert.deepEqual(
        await auditGithubDocumentation(['README.md', '.github/INDEX.md', '.github/workflows/README.md']),
        [],
    );
});

test('repository audit enforces YAML filenames before generated formatting exemptions', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-yaml-names-')));
    const cases: [string, boolean][] = [
        ['example.yaml', true],
        ['nested/example.yaml', true],
        ['example.yml.md', true],
        ['.github/ISSUE_TEMPLATE/config.yml', true],
        ['example.yml', false],
        ['example.YML', false],
        ['example.YAML', false],
        ['example.YaMl', false],
        ['nested/config.yml', false],
        ['.hidden/legacy.yml', false],
        ['.github/ISSUE_TEMPLATE/nested/config.yml', false],
        ['.github/ISSUE_TEMPLATE/config.YML', false],
    ];
    for (const host of PLUGIN_HOSTS) {
        cases.push(
            [`${host.payloadRoot}/dist/valid.yaml`, true],
            [`${host.payloadRoot}/dist/legacy.yml`, false],
            [`${host.payloadRoot}/dist/upper.YAML`, false],
        );
    }
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        // Test one path at a time: case variants alias on Windows filesystems.
        for (const [file, accepted] of cases) {
            const target = path.join(root, file);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, 'enabled: true\n');
            const errors = await auditRepository(root);
            const diagnostics = errors.filter((error) => error.startsWith(`${file}:`));
            assert.equal(diagnostics.length > 0, !accepted, `${file}: ${diagnostics.join('\n')}`);
            if (!accepted) assert.match(diagnostics.join('\n'), /\.yaml/);
            await rm(target);
        }
    } finally {
        assert.equal(path.dirname(root), await realpath(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('dct-yaml-names-'));
        await rm(root, { recursive: true, force: true });
    }
});

test('thin plugin runtime leftovers receive ordinary repository checks and no upstream exemption', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-retired-repo-')));
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        const file = `${PLUGIN_ROOT}/dist/official-server/unexpected.yml`;
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), 'enabled: true\n');
        const errors = await auditRepository(root);
        assert.ok(errors.some((error) => error.startsWith(`${file}:`) && error.includes('.yaml')));
        assert.ok(errors.some((error) => error.includes('/dist/official-server: add README.md')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('GitHub directory READMEs are rejected even when INDEX.md is present', async () => {
    for (const name of ['README.md', 'readme.md', 'ReadMe.rst', 'README']) {
        const errors = await auditGithubDocumentation(['README.md', '.github/INDEX.md', `.github/${name}`]);
        assert.ok(
            errors.some((error) => error.startsWith(`.github/${name}:`) && error.includes('root README')),
            `${name}: ${errors.join('\n')}`,
        );
    }
});

test('GitHub directory still requires its INDEX.md documentation', async () => {
    const errors = await auditGithubDocumentation(['README.md', '.github/workflows/README.md']);
    assert.ok(errors.some((error) => error.startsWith('.github:') && error.includes('INDEX.md')));
});

test('the GitHub INDEX.md exception does not exempt nested workflow documentation', async () => {
    const errors = await auditGithubDocumentation(['README.md', '.github/INDEX.md', '.github/workflows/INDEX.md']);
    assert.ok(errors.some((error) => error.startsWith('.github/workflows:') && error.includes('README.md')));
});

test('AST audit rejects boundary violations through imports, exports, require, and escaped specifiers', () => {
    for (const source of [
        "import fs from 'node:fs';",
        "export {x} from '../adapters/x.ts';",
        "const fs = require('node:fs');",
        "const fs = import('node:fs');",
        "import fs from '\\u006eode:fs';",
        'const fs = import(variable);',
    ])
        assert.ok(validateRuntimeSource('src/domains/example.ts', source).length, source);
    assert.ok(validateRuntimeSource('src/adapters/example.ts', "import x from '../application/x.ts';").length);
    assert.deepEqual(
        validateRuntimeSource('src/domains/example.ts', "import { x } from '../shared/constants.ts';"),
        [],
    );
});

test('runtime audit rejects force termination, persistent sessions, extra entry points, and PWA mode', () => {
    for (const source of [
        'process.kill(pid);',
        "process.kill(pid, 'SIGKILL');",
        "child.kill('SIGTERM');",
        "const file = 'session.json';",
        "const flag = '--categoryPwa';",
        'console.log(process.argv);',
    ])
        assert.ok(validateRuntimeSource('src/adapters/example.ts', source).length, source);
    assert.deepEqual(
        validateRuntimeSource('src/adapters/example.ts', '// process.kill(pid)\nconst x = /taskkill/;'),
        [],
    );
    assert.deepEqual(validateRuntimeSource('src/adapters/platform-process.ts', "process.kill(pid, 'SIGTERM');"), []);
    assert.deepEqual(validateRuntimeSource('src/adapters/platform-process.ts', 'process.kill(pid, 0);'), []);
    assert.ok(validateRuntimeSource('src/adapters/example.ts', 'process.kill(pid, 0);').length);
    assert.ok(validateRuntimeSource('src/adapters/platform-process.ts', 'process.kill(pid, signal);').length);
});

const ownedOfficialBridge = `
import { spawn } from 'node:child_process';
import { resolveServerBin } from './official-server.ts';
export async function createOfficialConnection(browserUrl: string, options: { bin?: string; args?: string[] } = {}) {
    const arguments_ = options.args ?? [];
    const bin = options.bin ?? (await resolveServerBin());
    const child = spawn(process.execPath, [bin, ...arguments_], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    async function reapOwnedChild() {
        child.kill('SIGTERM');
        child.kill('SIGKILL');
    }
    return { close: reapOwnedChild };
}
`;

test('runtime audit permits TERM and KILL only for the official bridge owned Server child', async () => {
    assert.deepEqual(validateRuntimeSource('src/adapters/mcp-bridge.ts', ownedOfficialBridge), []);
    const maintained = await readFile(new URL('../src/adapters/mcp-bridge.ts', import.meta.url), 'utf8');
    assert.deepEqual(validateRuntimeSource('src/adapters/mcp-bridge.ts', maintained), []);
});

test('official owned-child proof accepts only the explicit ordinary-Node construction seam', () => {
    const injected = ownedOfficialBridge.replace(
        'spawn(process.execPath,',
        'spawn(options.nodeExecutable ?? process.execPath,',
    );
    assert.deepEqual(validateRuntimeSource('src/adapters/mcp-bridge.ts', injected), []);
    for (const replacement of [
        'options.targetExecutable ?? process.execPath',
        'options.nodeExecutable || process.execPath',
        'options.nodeExecutable ?? targetPath',
        'options.nodeExecutable',
    ])
        assert.ok(
            validateRuntimeSource(
                'src/adapters/mcp-bridge.ts',
                ownedOfficialBridge.replace('spawn(process.execPath,', `spawn(${replacement},`),
            ).some((error) => error.includes('termination API')),
        );
    assert.ok(
        validateRuntimeSource(
            'src/adapters/mcp-bridge.ts',
            injected.replace("child.kill('SIGTERM');", "{ const options = target; child.kill('SIGTERM'); }"),
        ).some((error) => error.includes('termination API')),
    );
});

test('owned Server reclamation cannot authorize arbitrary, Target or global process termination', () => {
    for (const file of ['src/adapters/target-host.ts', 'src/adapters/example.ts', 'src/adapters/platform-process.ts']) {
        assert.ok(
            validateRuntimeSource(file, ownedOfficialBridge).some((error) => error.includes('termination API')),
            file,
        );
    }
    for (const source of [
        "child.kill('SIGTERM');",
        "child.kill('SIGKILL');",
        "target.child.kill('SIGKILL');",
        'process.kill(pid, 0);',
        "process.kill(pid, 'SIGTERM');",
        "process.kill(pid, 'SIGKILL');",
    ]) {
        assert.ok(
            validateRuntimeSource('src/adapters/mcp-bridge.ts', source).some((error) =>
                error.includes('termination API'),
            ),
            source,
        );
    }
});

test('official child termination allowance rejects dynamic signals and unproven or shadowed ownership', () => {
    for (const source of [
        ownedOfficialBridge.replace("child.kill('SIGTERM');", 'child.kill();'),
        ownedOfficialBridge.replace("child.kill('SIGTERM');", "child.kill('SIGINT');"),
        ownedOfficialBridge.replace("child.kill('SIGTERM');", 'child.kill(signal);'),
        ownedOfficialBridge.replace("child.kill('SIGTERM');", "child.kill('SIGTERM', true);"),
        ownedOfficialBridge.replace("child.kill('SIGTERM');", "process.kill(pid, 'SIGTERM');"),
        ownedOfficialBridge.replace("child.kill('SIGTERM');", "target.child.kill('SIGKILL');"),
        ownedOfficialBridge.replace("from 'node:child_process'", "from 'node:worker_threads'"),
        ownedOfficialBridge.replace('{ spawn }', '{ spawn as anotherSpawn }'),
        ownedOfficialBridge.replace(
            'spawn(process.execPath, [bin, ...arguments_]',
            'spawn(targetPath, [bin, ...arguments_]',
        ),
        ownedOfficialBridge.replace('[bin, ...arguments_]', '[targetPath]'),
        ownedOfficialBridge.replace('shell: false', 'shell: true'),
        ownedOfficialBridge.replace('const child = spawn', 'let child = spawn'),
        ownedOfficialBridge.replace(
            "spawn(process.execPath, [bin, ...arguments_], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })",
            'target',
        ),
        ownedOfficialBridge.replace(
            'return { close: reapOwnedChild };',
            "child.kill('SIGKILL'); return { close: reapOwnedChild };",
        ),
        ownedOfficialBridge.replace('async function reapOwnedChild()', 'async function closeTarget()'),
        ownedOfficialBridge.replace('async function reapOwnedChild()', 'async function reapOwnedChild(child)'),
        ownedOfficialBridge.replace('async function reapOwnedChild()', 'async function reapOwnedChild(spawn)'),
        ownedOfficialBridge.replace('async function reapOwnedChild()', 'async function reapOwnedChild(process)'),
        ownedOfficialBridge.replace('async function reapOwnedChild()', 'async function reapOwnedChild(bin)'),
        ownedOfficialBridge.replace('async function reapOwnedChild()', 'async function reapOwnedChild(arguments_)'),
        ownedOfficialBridge.replace("child.kill('SIGTERM');", "child = target; child.kill('SIGTERM');"),
        ownedOfficialBridge.replace("child.kill('SIGTERM');", "child.kill = target.kill; child.kill('SIGTERM');"),
        ownedOfficialBridge.replace("child.kill('SIGTERM');", "{ const child = target; child.kill('SIGTERM'); }"),
    ]) {
        assert.ok(
            validateRuntimeSource('src/adapters/mcp-bridge.ts', source).some((error) =>
                error.includes('termination API'),
            ),
            source,
        );
    }
});

for (const mutation of [
    'Object.assign(child, { kill: target.child.kill.bind(target.child) });',
    'Object.assign(child, { kill: replacementFn });',
    "Object.defineProperty(child, 'kill', { value: target.child.kill.bind(target.child) });",
    'Object.defineProperties(child, { kill: { value: replacementFn } });',
    "Reflect.set(child, 'kill', replacementFn);",
    'for (child.kill of [target.child.kill.bind(target.child)]) {}',
    'for (child.kill in replacements) {}',
    'for ([child.kill] of replacements) {}',
    'for ({ kill: child.kill } of replacements) {}',
    'const alias = child; alias.kill = target.child.kill.bind(target.child);',
]) {
    test(`official child ownership proof rejects mutation: ${mutation}`, () => {
        const source = ownedOfficialBridge.replace("child.kill('SIGTERM');", `${mutation}\nchild.kill('SIGTERM');`);
        assert.ok(
            validateRuntimeSource('src/adapters/mcp-bridge.ts', source).some((error) =>
                error.includes('termination API'),
            ),
            source,
        );
    });
}

for (const override of ["['shell']: true", 'get shell() { return true; }', 'shell() { return true; }']) {
    test(`official child spawn proof rejects computed or method options: ${override}`, () => {
        const source = ownedOfficialBridge.replace('shell: false, stdio:', `shell: false, ${override}, stdio:`);
        assert.ok(
            validateRuntimeSource('src/adapters/mcp-bridge.ts', source).some((error) =>
                error.includes('termination API'),
            ),
            source,
        );
    });
}

test('AST audit accepts erasable TypeScript without erasing its dependency evidence', () => {
    assert.deepEqual(
        validateRuntimeSource(
            'src/domains/example.ts',
            "import type { Port } from '../shared/constants.ts';\nconst value: number = 9222;",
        ),
        [],
    );
    for (const source of [
        "import type { Host } from '../adapters/target-host.ts';",
        "export type { Host } from '../application/target-controller.ts';",
        "type Host = import('../adapters/target-host.ts').Host;",
    ]) {
        const errors = validateRuntimeSource('src/domains/example.ts', source);
        assert.ok(
            errors.some((error) => error.includes('domains may depend')),
            errors.join('\n'),
        );
    }
});

test('TypeScript expression wrappers cannot conceal forbidden process access or termination', () => {
    assert.ok(
        validateRuntimeSource('src/domains/example.ts', 'const value = (process as { env: unknown }).env;').length,
    );
    assert.ok(validateRuntimeSource('src/adapters/example.ts', '(process.kill as (pid: number) => void)(42);').length);
});

test('type-only import-equals declarations obey the same dependency boundaries', () => {
    for (const source of [
        "import type Host = require('../adapters/target-host.ts');",
        "import type fs = require('node:fs');",
    ]) {
        const errors = validateRuntimeSource('src/domains/example.ts', source);
        assert.ok(
            errors.some((error) => error.includes('domains may depend')),
            source,
        );
    }
    assert.ok(
        validateRuntimeSource(
            'src/adapters/example.ts',
            "import type Controller = require('../application/target-controller.ts');",
        ).some((error) => error.includes('upper layer')),
    );
    assert.deepEqual(
        validateRuntimeSource('src/domains/example.ts', "import type Shared = require('../shared/constants.ts');"),
        [],
    );
});

test('optional require calls retain literal and computed dependency enforcement', () => {
    for (const source of [
        "const fs = require?.('node:fs');",
        "const fs = (require as (name: string) => unknown)?.('node:fs');",
        'const fs = require?.(moduleName);',
    ]) {
        const errors = validateRuntimeSource('src/domains/example.ts', source);
        assert.ok(
            errors.some((error) => /domains may depend|computed module/.test(error)),
            source,
        );
    }
    assert.deepEqual(
        validateRuntimeSource('src/domains/example.ts', "const shared = require?.('../shared/constants.ts');"),
        [],
    );
});

test('domain consumers accept only the two supplied target value owners across dependency roles', () => {
    const rejected: string[] = [];
    for (const owner of ['isolation', 'launch-command']) {
        const parser = owner === 'isolation' ? 'parseDataIsolation' : 'parseApplicationLaunch';
        const value = owner === 'isolation' ? 'DataIsolation' : 'ApplicationLaunch';
        for (const dependency of [
            `../gateway/targets/model/${owner}.ts`,
            `../gateway/targets/model/../model/${owner}.ts`,
        ]) {
            for (const source of [
                `import { ${parser} } from '${dependency}'; ${parser}(input);`,
                `import type { ${value} } from '${dependency}';`,
                `export type { ${value} } from '${dependency}';`,
                `export { ${parser} } from '${dependency}';`,
                `export * from '${dependency}';`,
                `type Value = import('${dependency}').${value};`,
                `const value = import('${dependency}');`,
                `const value = require('${dependency}');`,
                `import Value = require('${dependency}');`,
                `import type Value = require('${dependency}');`,
            ])
                for (const error of validateRuntimeSource('src/domains/control-contract.ts', source))
                    rejected.push(`${source}: ${error}`);
        }
    }
    assert.deepEqual(rejected, []);
});

test('target value dependency permission retains importer, exact path and boundary error restrictions', () => {
    const roles = (dependency: string) => [
        `import { value } from '${dependency}';`,
        `import type { Value } from '${dependency}';`,
        `export { value } from '${dependency}';`,
        `export type { Value } from '${dependency}';`,
        `type Value = import('${dependency}').Value;`,
        `const value = import('${dependency}');`,
        `const value = require('${dependency}');`,
        `import type Value = require('${dependency}');`,
    ];
    for (const [file, boundary] of [
        ['src/host-plugins/payload-integrity.ts', 'domains may depend only'],
        ['src/shared/example.ts', 'shared cannot depend on other layers'],
    ] as const) {
        for (const owner of ['isolation', 'launch-command'])
            for (const source of roles(`../gateway/targets/model/${owner}.ts`))
                assert.ok(
                    validateRuntimeSource(file, source).some((error) => error.includes(boundary)),
                    source,
                );
    }
    for (const dependency of [
        '../gateway/targets/model/unknown.ts',
        '../gateway/targets/model/target-contract.ts',
        '../gateway/targets/model/cdp-identity.ts',
        '../gateway/targets/model/../../diagnostics.ts',
        '../gateway/targets/lifecycle.ts',
        '../gateway/targets/model/../../../adapters/target-host.ts',
        '../application/plugin-runtime.ts',
        '../gateway/targets/model/../isolation.ts',
        'node:fs',
        '@modelcontextprotocol/core',
    ]) {
        for (const source of roles(dependency))
            assert.ok(
                validateRuntimeSource('src/domains/control-contract.ts', source).some((error) =>
                    error.includes('domains may depend only'),
                ),
                source,
            );
    }
    for (const file of ['src/domains/control-contract.ts', 'src/shared/example.ts', 'src/host-plugins/example.ts'])
        for (const source of ['const value = import(moduleName);', 'const value = require(moduleName);'])
            assert.ok(
                validateRuntimeSource(file, source).some((error) => error.includes('computed module dependencies')),
                source,
            );
});

test('pure Gateway argument owner rejects filesystem imports', () => {
    assert.ok(
        validateRuntimeSource('src/gateway/owned-tool-arguments.ts', "import fs from 'node:fs';").some((error) =>
            error.includes('gateway may depend'),
        ),
    );
});

test('pure Gateway argument owner rejects process state', () => {
    assert.ok(
        validateRuntimeSource('src/gateway/owned-tool-arguments.ts', 'const value = process.env;').some((error) =>
            error.includes('gateway cannot access process state'),
        ),
    );
});

test('pure Gateway dependencies retain original TypeScript and indirect import evidence', () => {
    for (const [file, parent] of [
        ['src/gateway/owned-tool-arguments.ts', '..'],
        ['src/gateway/targets/model/cdp-identity.ts', '../../..'],
        ['src/gateway/targets/model/target-contract.ts', '../../..'],
        ['src/gateway/targets/model/chrome-profile-argument.ts', '../../..'],
        ['src/gateway/targets/model/chromium-features.ts', '../../..'],
        ['src/gateway/targets/model/isolation.ts', '../../..'],
        ['src/gateway/targets/model/launch-command.ts', '../../..'],
    ] as const) {
        for (const source of [
            "import net from 'node:net';",
            "import x from '@modelcontextprotocol/core';",
            "import x from 'ws';",
            "import x from '../adapters/x.ts';",
            "import x from '../application/x.ts';",
            "import x from '../interface/x.ts';",
            "export { x } from '../adapters/x.ts';",
            "export * from '../adapters/x.ts';",
            "const fs = require('node:fs');",
            "const fs = import('node:fs');",
            "import fs from '\\u006eode:fs';",
            'const fs = import(variable);',
            "import type { Host } from '../adapters/target-host.ts';",
            "export type { Host } from '../application/target-controller.ts';",
            "type Host = import('../adapters/target-host.ts').Host;",
            "import type Host = require('../adapters/target-host.ts');",
            "import type fs = require('node:fs');",
            "const fs = require?.('node:fs');",
            "const fs = (require as (name: string) => unknown)?.('node:fs');",
            'const fs = require?.(moduleName);',
        ]) {
            const errors = validateRuntimeSource(file, source.replaceAll('../', `${parent}/`));
            assert.ok(
                errors.some((error) => /gateway may depend|computed module/.test(error)),
                source,
            );
        }
        for (const source of [
            'const value = process.env;',
            'const value = process["env"];',
            'const value = (process as { env: unknown }).env;',
            'const value = process?.env;',
        ])
            assert.ok(
                validateRuntimeSource(file, source.replaceAll('../', `${parent}/`)).some((error) =>
                    error.includes('gateway cannot access process state'),
                ),
                source,
            );
        for (const source of [
            "import { isRecord } from '../shared/errors.ts';",
            "import { type ConnectionRoute, parseConnectionRoute } from '../domains/control-contract.ts';",
            "export type { Route } from './route.ts';",
            "type Route = import('../domains/control-contract.ts').ConnectionRoute;",
            "import type Shared = require('../shared/errors.ts');",
            "const shared = require?.('../shared/errors.ts');",
        ])
            assert.deepEqual(validateRuntimeSource(file, source.replaceAll('../', `${parent}/`)), [], source);
    }
});

test('target identity and resource contracts accept their supplied-evidence model dependencies', () => {
    for (const [file, sources] of [
        [
            'src/gateway/targets/model/cdp-identity.ts',
            [
                "import type { ListenerEvidence } from './target-contract.ts';",
                "import type { TargetKind } from '../../../domains/control-contract.ts';",
                "import { isRecord } from '../../../shared/errors.ts';",
            ],
        ],
        [
            'src/gateway/targets/model/target-contract.ts',
            [
                "import type { TargetKind } from '../../../domains/control-contract.ts';",
                "import type { LaunchDefinition } from './launch-command.ts';",
                "import { DetailedError } from '../../../shared/errors.ts';",
            ],
        ],
    ] as const)
        for (const source of sources) assert.deepEqual(validateRuntimeSource(file, source), [], `${file}: ${source}`);
});

test('Host payload proof enforces pure imports and process-state boundaries at its actual owner', () => {
    const file = 'src/host-plugins/payload-integrity.ts';
    for (const source of [
        "import fs from 'node:fs';",
        "import fs from 'node:fs/promises';",
        "import child from 'node:child_process';",
        "import http from 'node:http';",
        "import net from 'node:net';",
        "import x from '../application/host-plugin-manager.ts';",
        "import x from '../adapters/verified-plugin-files.ts';",
        "import x from '../interface/app-main.ts';",
        'const value = process.env;',
        'const value = (process as { env: unknown }).env;',
        "const fs = import('node:fs');",
        'const fs = import(moduleName);',
        "const fs = require('node:fs');",
        'const fs = require?.(moduleName);',
        "import fs from '\\u006eode:fs';",
        "export { x } from '../adapters/x.ts';",
        "export * from 'node:fs';",
        "import type { Stats } from 'node:fs';",
        "export type { Stats } from 'node:fs';",
        "type Stats = import('node:fs').Stats;",
        "import type Stats = require('node:fs');",
    ])
        assert.ok(validateRuntimeSource(file, source).length, source);
    for (const source of [
        "import { isDeepStrictEqual } from 'node:util';",
        "import { x } from '../domains/host-management.ts';",
        "import type { X } from '../shared/errors.ts';",
        "import { x } from './payload-integrity.ts';",
    ])
        assert.deepEqual(validateRuntimeSource(file, source), [], source);
    assert.ok(validateRuntimeSource('src/host-plugins/other.ts', "import x from 'node:util';").length);
});

test('Host payload source requires its local instructions and immediate directory map', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-host-instructions-')));
    const file = 'src/host-plugins/payload-integrity.ts';
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        await mkdir(path.join(root, 'src/host-plugins'), { recursive: true });
        await writeFile(path.join(root, file), 'export const value = 1;\n');
        const before = await auditRepository(root);
        assert.ok(before.includes(`${file}: source directory requires local AGENTS.md.`));
        assert.ok(before.includes('src/host-plugins: add README.md describing immediate contents.'));
        await writeFile(path.join(root, 'src/host-plugins/AGENTS.md'), '# Pure Host payload proof\n');
        await writeFile(path.join(root, 'src/host-plugins/README.md'), '# Host payload proof\n');
        const after = await auditRepository(root);
        assert.ok(!after.some((error) => error.startsWith(`${file}:`)));
        assert.ok(!after.some((error) => error.startsWith('src/host-plugins:')));
    } finally {
        await rm(root, { recursive: true });
    }
});

test('pure runtime owners reject ambient clock and process references through original AST forms', () => {
    for (const file of [
        'src/host-plugins/payload-integrity.ts',
        'src/domains/example.ts',
        'src/shared/example.ts',
        'src/shared/environment-key.ts',
        'src/gateway/owned-tool-arguments.ts',
        'src/gateway/unreviewed.ts',
        'src/gateway/targets/model/cdp-identity.ts',
        'src/gateway/targets/model/target-contract.ts',
        'src/gateway/targets/model/chrome-profile-argument.ts',
        'src/gateway/targets/model/chromium-features.ts',
        'src/gateway/targets/model/isolation.ts',
        'src/gateway/targets/model/launch-command.ts',
    ])
        for (const source of [
            'const value = performance.now();',
            'const value = (performance as Performance)?.["now"]();',
            'const { now } = performance;',
            'const clock = performance;',
            'const value = Date.now();',
            'const value = new Date();',
            'const value = globalThis.performance.now();',
            'const value = (globalThis as typeof globalThis)?.["Date"].now();',
            'const { performance: clock } = globalThis;',
            'const value = process.env;',
            'const { env } = process;',
            'const value = globalThis["process"]?.env;',
            'const value = global.process.env;',
            'const value = global["performance"].now();',
            'const ambient = global;',
            'const ambient = globalThis; const value = ambient[key];',
        ])
            assert.ok(
                validateRuntimeSource(file, source).some((error) => /ambient clock|process state/.test(error)),
                `${file}: ${source}`,
            );
    for (const source of [
        'const value = { performance: 1, Date: 2, process: 3 };',
        'const value = record.performance;',
        'const value = Math.round(input.elapsedMs * 100) / 100;',
    ])
        assert.deepEqual(validateRuntimeSource('src/gateway/unreviewed.ts', source), [], source);
});

test('pure owners cannot import the Gateway clock through runtime reexport or erased dependencies', () => {
    for (const file of [
        'src/host-plugins/payload-integrity.ts',
        'src/domains/control-contract.ts',
        'src/shared/example.ts',
        'src/shared/environment-key.ts',
        'src/gateway/owned-tool-arguments.ts',
        'src/gateway/unreviewed.ts',
        'src/gateway/targets/model/cdp-identity.ts',
        'src/gateway/targets/model/target-contract.ts',
        'src/gateway/targets/model/chrome-profile-argument.ts',
        'src/gateway/targets/model/chromium-features.ts',
        'src/gateway/targets/model/isolation.ts',
        'src/gateway/targets/model/launch-command.ts',
    ])
        for (const dependency of [
            file.startsWith('src/gateway/targets/model/')
                ? '../../diagnostics.ts'
                : file.startsWith('src/gateway/')
                  ? './diagnostics.ts'
                  : '../gateway/diagnostics.ts',
            'node:perf_hooks',
        ])
            for (const source of [
                "import { measured } from './diagnostics.ts';",
                "export { measured } from './diagnostics.ts';",
                "export * from './diagnostics.ts';",
                "import type { Diagnose } from './diagnostics.ts';",
                "export type { Diagnose } from './diagnostics.ts';",
                "type Clock = import('./diagnostics.ts').Diagnose;",
                "import type Clock = require('./diagnostics.ts');",
                "const clock = require?.('./diagnostics.ts');",
                "const clock = import('./diagnostics.ts');",
                'const clock = import(moduleName);',
            ])
                assert.ok(
                    validateRuntimeSource(file, source.replaceAll('./diagnostics.ts', dependency)).some((error) =>
                        error.includes(
                            source.includes('moduleName')
                                ? 'computed module dependencies'
                                : 'pure owners cannot depend on the diagnostic clock',
                        ),
                    ),
                    `${file}: ${source}`,
                );
});

test('Gateway diagnostic clock permission is exact and imports only its pure contract', () => {
    const file = 'src/gateway/diagnostics.ts';
    assert.deepEqual(
        validateRuntimeSource(
            file,
            "import type { Diagnostic, Diagnose } from '../domains/control-contract.ts'; const started = performance.now();",
        ),
        [],
    );
    for (const source of [
        "import { isRecord } from '../shared/errors.ts';",
        "import { parseOfficialToolArguments } from './owned-tool-arguments.ts';",
        "import type { ApplicationLaunch } from './targets/model/launch-command.ts';",
        "export * from '../adapters/cdp-router.ts';",
        "import fs from 'node:fs';",
        "import type fs = require('node:fs');",
        'const clock = import(moduleName);',
        'const value = process.env;',
        'const value = globalThis.process.env;',
        'const value = Date.now();',
        'const value = performance.timeOrigin;',
        'const clock = performance;',
        'const value = fetch(url);',
        'const value = new WebSocket(url);',
        'const value = globalThis["fetch"](url);',
    ])
        assert.ok(validateRuntimeSource(file, source).length, source);
});

test('nested ambient roots cannot expose clock process network or global aliases', () => {
    for (const file of [
        'src/host-plugins/payload-integrity.ts',
        'src/domains/example.ts',
        'src/shared/example.ts',
        'src/shared/environment-key.ts',
        'src/gateway/owned-tool-arguments.ts',
        'src/gateway/unreviewed.ts',
        'src/gateway/targets/model/cdp-identity.ts',
        'src/gateway/targets/model/target-contract.ts',
        'src/gateway/targets/model/chrome-profile-argument.ts',
        'src/gateway/targets/model/chromium-features.ts',
        'src/gateway/targets/model/isolation.ts',
        'src/gateway/targets/model/launch-command.ts',
        'src/gateway/diagnostics.ts',
    ])
        for (const source of [
            'const value = globalThis.global.process.env;',
            'const value = globalThis.globalThis.performance.now();',
            'const value = global.globalThis.Date.now();',
            'const value = globalThis.global.fetch(url);',
            'const value = globalThis.global["performance"].now();',
            'const value = globalThis["global"]?.process.env;',
            'const value = globalThis.globalThis["process"].env;',
            'const value = (globalThis as typeof globalThis).global?.performance.now();',
            'const value = global?.globalThis?.Date.now();',
            'const value = globalThis?.["globalThis"]?.["performance"]?.now();',
            'const value = globalThis.global.globalThis.process?.env;',
            'const ambient = globalThis.global; const value = ambient.process.env;',
            'const { performance: clock } = globalThis.globalThis;',
            'const { env } = global.globalThis.process;',
            'const ambient = globalThis["global"]; const value = ambient.performance.now();',
            'const ambient = globalThis.global;',
        ])
            assert.ok(
                validateRuntimeSource(file, source).some((error) =>
                    /ambient clock|process state|network I\/O/.test(error),
                ),
                `${file}: ${source}`,
            );
});

test('TypeScript method-signature declaration keys remain pure record names', () => {
    for (const file of [
        'src/host-plugins/payload-integrity.ts',
        'src/domains/example.ts',
        'src/gateway/unreviewed.ts',
        'src/gateway/targets/model/cdp-identity.ts',
        'src/gateway/targets/model/target-contract.ts',
        'src/gateway/targets/model/chrome-profile-argument.ts',
        'src/gateway/targets/model/chromium-features.ts',
        'src/gateway/targets/model/isolation.ts',
        'src/gateway/targets/model/launch-command.ts',
        'src/gateway/diagnostics.ts',
    ])
        for (const source of [
            'interface RecordValue { performance(): number; Date(): number; process(): string; }',
            'type RecordValue = { performance(): number; Date(): number; process(): string; };',
            'type RecordValue = { performance<T>(): T; process<T>(): T; Date<T>(): T; };',
            'interface RecordValue { globalThis(): string; global(): string; }',
            'interface RecordValue { performance: () => number; process: () => string; }',
        ])
            assert.deepEqual(validateRuntimeSource(file, source), [], `${file}: ${source}`);
});

test('computed TypeScript method keys and method bodies retain actual ambient rejection', () => {
    for (const file of [
        'src/host-plugins/payload-integrity.ts',
        'src/domains/example.ts',
        'src/gateway/unreviewed.ts',
        'src/gateway/targets/model/cdp-identity.ts',
        'src/gateway/targets/model/target-contract.ts',
        'src/gateway/targets/model/chrome-profile-argument.ts',
        'src/gateway/targets/model/chromium-features.ts',
        'src/gateway/targets/model/isolation.ts',
        'src/gateway/targets/model/launch-command.ts',
        'src/gateway/diagnostics.ts',
    ])
        for (const source of [
            'interface RecordValue { [performance](): number; }',
            'type RecordValue = { [process.env.key](): string; };',
            'type RecordValue = { performance<T extends typeof process>(): T; };',
            'const record = { performance() { return process.env; } };',
        ])
            assert.ok(
                validateRuntimeSource(file, source).some((error) => /ambient clock|process state/.test(error)),
                `${file}: ${source}`,
            );
});
