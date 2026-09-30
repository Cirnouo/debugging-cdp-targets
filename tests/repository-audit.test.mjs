import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRuntimeSource, validateTextStyle } from '../tooling/repository-audit.mjs';

test('AST audit rejects boundary violations through imports, exports, require, and escaped specifiers', () => {
    for (const source of [
        "import fs from 'node:fs';",
        "export {x} from '../adapters/x.mjs';",
        "const fs = require('node:fs');",
        "const fs = import('node:fs');",
        "import fs from '\\u006eode:fs';",
        'const fs = import(variable);',
    ])
        assert.ok(validateRuntimeSource('src/domains/example.mjs', source).length, source);
    assert.ok(validateRuntimeSource('src/adapters/example.mjs', "import x from '../application/x.mjs';").length);
    assert.deepEqual(
        validateRuntimeSource('src/domains/example.mjs', "import { x } from '../shared/constants.mjs';"),
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
        assert.ok(validateRuntimeSource('src/adapters/example.mjs', source).length, source);
    assert.deepEqual(
        validateRuntimeSource('src/adapters/example.mjs', '// process.kill(pid)\nconst x = /taskkill/;'),
        [],
    );
    assert.deepEqual(validateRuntimeSource('src/adapters/platform-process.mjs', "process.kill(pid, 'SIGTERM');"), []);
});

test('text audit enforces four spaces, LF, final newline, and no tabs', () => {
    assert.deepEqual(validateTextStyle('example.yaml', 'name:\n    value: true\n'), []);
    for (const text of ['name:\n  value: true\n', 'name:\r\n', '\tname\n', 'name']) {
        assert.ok(validateTextStyle('example.yaml', text).length, JSON.stringify(text));
    }
    assert.deepEqual(validateTextStyle('pnpm-lock.yaml', 'lockfileVersion:\n  generated: true\n'), []);
});
