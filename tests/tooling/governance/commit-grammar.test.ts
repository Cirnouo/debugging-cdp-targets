import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import test from 'node:test';
import { COMMIT_SCOPES, COMMIT_TYPES, validateBranchName } from '../../../tooling/governance/commit-grammar.ts';

const validScopes = [
    'skill',
    'session',
    'target',
    'devtools',
    'windows',
    'app',
    'distribution',
    'testing',
    'tooling',
    'governance',
    'dependencies',
    'release',
];

test('retains the approved commit types and scopes as independent literal expectations', () => {
    const types = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];
    assert.deepEqual(COMMIT_TYPES, types);
    assert.deepEqual(COMMIT_SCOPES, validScopes);
});

test('accepts main, approved topic branches, and SemVer release branches', () => {
    const valid = [
        'main',
        'feat/add-validator',
        'fix/windows-shell',
        'hotfix/reject-pwa',
        'chore/update-tools',
        'release/0.1.0',
        'release/1.2.3-alpha.1+build.9',
    ];

    for (const branch of valid) {
        assert.deepEqual(validateBranchName(branch), [], branch);
    }
});

test('rejects branch names outside the approved grammar', () => {
    const invalid = [
        'master',
        'docs/explain-install',
        'refactor/split-policy',
        'test/cover-branch',
        'ci/pin-actions',
        'codex/task-three',
        'feature/add-validator',
        'bugfix/windows-shell',
        'feat/',
        'feat/Add-validator',
        'feat/under_score',
        'feat/two/levels',
        'feat/-leading',
        'feat/trailing-',
        'feat/double--dash',
        'feat/1.2.3',
        'release/v1.2.3',
        'release/1.2',
        'release/01.2.3',
        'release/1-2-3',
        'release/1.2.3-01',
        'release/1.2.3-alpha..1',
        'release/1.2.3+',
    ];

    for (const branch of invalid) {
        assert.notDeepEqual(validateBranchName(branch), [], branch);
    }
});

test('imports branch grammar without commit execution dependencies from an unrelated cwd', () => {
    const policy = new URL('../../../tooling/governance/commit-grammar.ts', import.meta.url).href;
    const source = [
        "import assert from 'node:assert/strict';",
        "import { registerHooks } from 'node:module';",
        'registerHooks({ resolve(specifier, context, nextResolve) {',
        "    if (['node:child_process', '@commitlint/cli'].includes(specifier)) throw new Error('Forbidden policy dependency: ' + specifier);",
        '    return nextResolve(specifier, context);',
        '} });',
        `const policy = await import(${JSON.stringify(policy)});`,
        "assert.deepEqual(policy.validateBranchName('main'), []);",
        "assert.deepEqual(policy.validateBranchName('release/1.2.3-alpha.1+build.9'), []);",
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
