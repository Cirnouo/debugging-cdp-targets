import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import test from 'node:test';
import { validateTextStyle, validateYamlFilename } from '../../../tooling/quality/text-policy.ts';

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

test('accepts lowercase YAML and only the exact GitHub yml filename exception', () => {
    for (const file of ['ordinary.yaml', '.github/ISSUE_TEMPLATE/config.yml', 'ordinary.md']) {
        assert.deepEqual(validateYamlFilename(file), [], file);
    }
    for (const file of [
        'legacy.yml',
        'upper.YAML',
        'mixed.YaMl',
        'short.YML',
        'config.yml',
        '.github/issue_template/config.yml',
        '.github/ISSUE_TEMPLATE/CONFIG.yml',
        'other/.github/ISSUE_TEMPLATE/config.yml',
    ]) {
        assert.match(
            validateYamlFilename(file).join('\n'),
            /maintained YAML filenames must use lowercase \.yaml/,
            file,
        );
    }
});

test('imports pure text policy without repository walking or parser dependencies', () => {
    const policy = new URL('../../../tooling/quality/text-policy.ts', import.meta.url).href;
    const source = [
        "import assert from 'node:assert/strict';",
        "import { registerHooks } from 'node:module';",
        'registerHooks({ resolve(specifier, context, nextResolve) {',
        "    if (['@babel/parser', 'node:fs', 'node:child_process'].includes(specifier)) throw new Error('Forbidden policy dependency: ' + specifier);",
        '    return nextResolve(specifier, context);',
        '} });',
        `const policy = await import(${JSON.stringify(policy)});`,
        "assert.deepEqual(policy.validateTextStyle('sample.yaml', 'name:\\n    value: true\\n'), []);",
        "assert.notDeepEqual(policy.validateTextStyle('sample.yaml', 'name:\\n  value: true\\n'), []);",
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
