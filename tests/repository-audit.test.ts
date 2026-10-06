import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGIN_HOSTS } from '../tooling/host-policy.ts';
import { OFFICIAL_RELEASE, PLUGIN_ROOT } from '../tooling/payload-policy.ts';
import { auditRepository, validateRuntimeSource, validateTextStyle } from '../tooling/repository-audit.ts';

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

test('repository audit accepts AGENTS.md as the contributor entry point', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-agents-'));
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        const license = 'Copyright (c) 2026 Cirnouo\n';
        const files = {
            'AGENTS.md': '# Contributor entry point\n',
            'README.md': '# Repository\n',
            LICENSE: license,
            '.gitignore': '.idea/\nnode_modules/\n.env*\n',
            'CHANGELOG.md': '## [Unreleased]\n',
            'package.json': `${JSON.stringify({ version: '0.1.0', engines: { node: '24.21.0' }, packageManager: 'pnpm@12.4.2' }, null, 4)}\n`,
            'docs/README.md': '# Documentation\n',
            'docs/domain-language.md': '# Domain language\n',
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
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
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

test('only the fully verified official output is exempt from directory documentation and owned-module rules', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-upstream-repo-')));
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        for (const host of PLUGIN_HOSTS) {
            const prefix = `${host.payloadRoot}/dist/official-server`;
            for (const file of OFFICIAL_RELEASE.files) {
                const target = path.join(root, prefix, file.path);
                await mkdir(path.dirname(target), { recursive: true });
                await writeFile(
                    target,
                    await readFile(new URL(`../node_modules/chrome-devtools-mcp/${file.path}`, import.meta.url)),
                );
            }
            assert.deepEqual(
                (await auditRepository(root)).filter(
                    (error) => error.includes(prefix) || /Official package/.test(error),
                ),
                [],
            );
            await writeFile(path.join(root, prefix, 'LICENSE'), 'changed');
            assert.ok((await auditRepository(root)).some((error) => /Official package.*changed/i.test(error)));
            await writeFile(
                path.join(root, prefix, 'LICENSE'),
                await readFile(new URL('../node_modules/chrome-devtools-mcp/LICENSE', import.meta.url)),
            );
        }
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

test('text audit enforces four spaces, LF, final newline, and no tabs', () => {
    assert.deepEqual(validateTextStyle('example.yaml', 'name:\n    value: true\n'), []);
    for (const text of ['name:\n  value: true\n', 'name:\r\n', '\tname\n', 'name']) {
        assert.ok(validateTextStyle('example.yaml', text).length, JSON.stringify(text));
    }
    assert.deepEqual(validateTextStyle('pnpm-lock.yaml', 'lockfileVersion:\n  generated: true\n'), []);
    assert.deepEqual(
        validateTextStyle('tooling/security/upstream-pnpm-lock.yaml', 'lockfileVersion:\n  generated: true\n'),
        [],
    );
    assert.ok(validateTextStyle('tooling/security/other-lock.yaml', 'lockfileVersion:\n  generated: true\n').length);
});

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
