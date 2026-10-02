import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
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
        return auditRepository(root).filter((error) => error.startsWith('.github'));
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
