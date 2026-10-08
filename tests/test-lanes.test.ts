import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse } from '@babel/parser';
import * as t from '@babel/types';

const testsUrl = new URL('./', import.meta.url);
const interactiveCases = {
    'interactive/screenshot-background-anchor.test.ts': [
        'actual owned opaque anchor covers native target bounds and hands off foreground with normal exit cleanup',
    ],
    'interactive/window-evidence.test.ts': [
        'controlled native background records NOACTIVATE transitions and preserves Unicode stdout',
        'passive selected-tab observer preserves Unicode window title in actual PowerShell JSON stdout',
        'window evidence proves minimize and restore using long owned executable identity',
        'window evidence proves minimize and restore using short owned executable identity',
    ],
    'interactive/windows-native.test.ts': [
        'Windows GUI launch preserves visibility and waits past ten seconds for normal close; native manifest inspection distinguishes elevation',
        'native GUI discovery is verified against its real process, listener and endpoint',
        'Windows native close accepts short executable paths while rejecting changed path and creation time',
    ],
};

async function testFiles(): Promise<string[]> {
    const { stdout } = await promisify(execFile)(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        {
            cwd: fileURLToPath(new URL('../', testsUrl)),
            windowsHide: true,
        },
    );
    return stdout
        .split('\0')
        .map((file) => file.replaceAll('\\', '/'))
        .filter((file) => file.endsWith('.test.ts'))
        .sort();
}

function registeredCases(statements: t.Statement[], bindings: Record<string, string> = {}): string[] {
    const names: string[] = [];
    for (const statement of statements) {
        if (t.isForOfStatement(statement)) {
            const values = t.isTSAsExpression(statement.right) ? statement.right.expression : statement.right;
            assert.ok(t.isArrayExpression(values));
            assert.ok(t.isVariableDeclaration(statement.left));
            const binding = statement.left.declarations[0]?.id;
            assert.ok(t.isIdentifier(binding) && t.isBlockStatement(statement.body));
            for (const value of values.elements) {
                assert.ok(t.isStringLiteral(value));
                names.push(...registeredCases(statement.body.body, { ...bindings, [binding.name]: value.value }));
            }
        } else if (
            t.isExpressionStatement(statement) &&
            t.isCallExpression(statement.expression) &&
            t.isIdentifier(statement.expression.callee, { name: 'test' })
        ) {
            const name = statement.expression.arguments[0];
            if (t.isStringLiteral(name)) names.push(name.value);
            else {
                assert.ok(t.isTemplateLiteral(name));
                let expanded = '';
                for (const [index, quasi] of name.quasis.entries()) {
                    expanded += quasi.value.cooked;
                    const expression = name.expressions[index];
                    if (expression !== undefined) {
                        assert.ok(t.isIdentifier(expression) && typeof bindings[expression.name] === 'string');
                        expanded += bindings[expression.name];
                    }
                }
                names.push(expanded);
            }
        }
    }
    return names;
}

test('every maintained test file belongs to a runnable root or interactive lane', async () => {
    const files = await testFiles();
    assert.ok(files.length > 0);
    assert.deepEqual(
        files.filter((file) => !/^tests\/(?:[^/]+|interactive\/[^/]+)\.test\.ts$/.test(file)),
        [],
        'Nested or misplaced test files must be selected by a maintained test command.',
    );
    assert.deepEqual(
        files.filter((file) => file.startsWith('tests/interactive/')),
        Object.keys(interactiveCases).map((file) => `tests/${file}`),
    );
});

test('interactive lane retains exactly the eight migrated GUI cases in three files', async () => {
    const files = await testFiles();
    for (const [file, expected] of Object.entries(interactiveCases)) {
        assert.ok(files.includes(`tests/${file}`), `${file} must retain its migrated cases.`);
        const source = await readFile(new URL(file, testsUrl), 'utf8');
        const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
        assert.deepEqual(registeredCases(ast.program.body), expected, file);
    }
});
