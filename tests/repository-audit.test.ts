import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRuntimeSource, validateTextStyle } from '../tooling/repository-audit.ts';

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
});

test('text audit enforces four spaces, LF, final newline, and no tabs', () => {
    assert.deepEqual(validateTextStyle('example.yaml', 'name:\n    value: true\n'), []);
    for (const text of ['name:\n  value: true\n', 'name:\r\n', '\tname\n', 'name']) {
        assert.ok(validateTextStyle('example.yaml', text).length, JSON.stringify(text));
    }
    assert.deepEqual(validateTextStyle('pnpm-lock.yaml', 'lockfileVersion:\n  generated: true\n'), []);
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
