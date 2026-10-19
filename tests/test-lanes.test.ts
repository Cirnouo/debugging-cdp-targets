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
    'interactive/windows-normal-close.test.ts': [
        'normal Close selects the first ordinary owned GUI for event',
        'normal Close selects the first ordinary owned GUI for normal',
        'normal Close selects the first ordinary owned GUI for minimized',
        'normal Close selects the first ordinary owned GUI for transparent',
        'normal Close selects the first ordinary owned GUI for frameless',
        'normal Close selects the first ordinary owned GUI for zero-area',
        'normal Close selects the first ordinary owned GUI for tool',
        'normal Close selects the first ordinary owned GUI for disabled',
        'normal Close selects the first ordinary owned GUI for owned',
        'normal Close selects the first ordinary owned GUI for multiple',
    ],
};

const toolingCases = [
    'tests/tooling/distribution/thin-plugin-payloads.test.ts',
    'tests/tooling/governance/commit-events.test.ts',
    'tests/tooling/governance/commit-grammar.test.ts',
    'tests/tooling/governance/commit-history.test.ts',
    'tests/tooling/governance/commit-validation.test.ts',
    'tests/tooling/licenses/bundled-notices.test.ts',
    'tests/tooling/quality/text-policy.test.ts',
    'tests/tooling/releases/publication.test.ts',
    'tests/tooling/releases/release-notes.test.ts',
    'tests/tooling/submissions/issue-forms.test.ts',
    'tests/tooling/submissions/markdown.test.ts',
    'tests/tooling/submissions/pull-requests.test.ts',
];

const gatewayCases = [
    'tests/gateway/connections/directory-lifetime.test.ts',
    'tests/gateway/connections/directory-operation-evidence.test.ts',
    'tests/gateway/owned-tool-arguments.test.ts',
    'tests/gateway/targets/chrome-launch.test.ts',
    'tests/gateway/targets/chrome-profile-argument.test.ts',
    'tests/gateway/targets/chrome-profile.test.ts',
    'tests/gateway/targets/chromium-features.test.ts',
    'tests/gateway/targets/data-isolation.test.ts',
    'tests/gateway/targets/directory-admission.test.ts',
    'tests/gateway/targets/port-and-endpoint-admission.test.ts',
    'tests/gateway/targets/structured-launch.test.ts',
];
const hostCases = ['tests/host-plugins/payload-filesystem.test.ts', 'tests/host-plugins/payload-integrity.test.ts'];

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

test('every maintained test file belongs to an explicit safe default or interactive lane', async () => {
    const files = await testFiles();
    assert.ok(files.length > 0);
    assert.deepEqual(
        files.filter(
            (file) =>
                !/^tests\/(?:[^/]+|interactive\/[^/]+)\.test\.ts$/.test(file) &&
                !toolingCases.includes(file) &&
                !gatewayCases.includes(file) &&
                !hostCases.includes(file),
        ),
        [],
        'Nested or misplaced test files must be selected by a maintained test command.',
    );
    assert.deepEqual(
        files.filter((file) => file.startsWith('tests/tooling/')),
        toolingCases,
    );
    assert.deepEqual(
        files.filter((file) => file.startsWith('tests/gateway/')),
        gatewayCases,
    );
    assert.deepEqual(
        files.filter((file) => file.startsWith('tests/host-plugins/')),
        hostCases,
    );
    assert.deepEqual(
        files.filter((file) => file.startsWith('tests/interactive/')),
        Object.keys(interactiveCases).map((file) => `tests/${file}`),
    );
});

test('interactive lane retains every declared owned GUI case', async () => {
    const files = await testFiles();
    for (const [file, expected] of Object.entries(interactiveCases)) {
        assert.ok(files.includes(`tests/${file}`), `${file} must retain its migrated cases.`);
        const source = await readFile(new URL(file, testsUrl), 'utf8');
        const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
        assert.deepEqual(registeredCases(ast.program.body), expected, file);
    }
});
