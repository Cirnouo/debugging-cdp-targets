import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBranchName, validateCommitMessage } from '../tooling/governance.mjs';

const validScopes = [
    'skill',
    'session',
    'target',
    'devtools',
    'windows',
    'obsidian',
    'distribution',
    'testing',
    'tooling',
    'governance',
    'dependencies',
    'release',
];

test('accepts every approved Conventional Commit type and scope', () => {
    const types = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];

    for (const type of types) {
        for (const scope of validScopes) {
            assert.deepEqual(validateCommitMessage(`${type}(${scope}): describe change`), []);
        }
    }
});

test('accepts breaking commits by marker or footer', () => {
    assert.deepEqual(validateCommitMessage('feat(skill)!: change contract'), []);
    assert.deepEqual(
        validateCommitMessage('feat(skill): change contract\n\nBREAKING CHANGE: callers must migrate'),
        [],
    );
});

test('rejects malformed commit messages with actionable errors', () => {
    const invalid = [
        ['feature(skill): add feature', 'type'],
        ['feat: add feature', 'scope'],
        ['feat(Skill): add feature', 'scope'],
        ['feat(not-approved): add feature', 'scope'],
        ['feat(skill): ', 'subject'],
        ['feat(skill): add feature.', 'period'],
        [`feat(skill): ${'x'.repeat(88)}`, '100'],
        ['feat(skill): add feature\nbody without blank line', 'blank line'],
        ["Merge branch 'topic'", 'type'],
    ];

    for (const [message, expected] of invalid) {
        assert.match(validateCommitMessage(message).join('\n'), new RegExp(expected, 'i'));
    }
});

test('ignores a merge message only when Git topology says it is a merge', () => {
    assert.deepEqual(validateCommitMessage("Merge branch 'topic'", { isMerge: true }), []);
    assert.notDeepEqual(validateCommitMessage("Merge branch 'topic'"), []);
});

test('accepts main, approved topic branches, and SemVer release branches', () => {
    const valid = [
        'main',
        'feat/add-validator',
        'fix/windows-shell',
        'hotfix/reject-pwa',
        'chore/update-tools',
        'docs/explain-install',
        'refactor/split-policy',
        'test/cover-branch',
        'ci/pin-actions',
        'codex/task-three',
        'release/0.1.0',
        'release/1.2.3-alpha.1+build.9',
    ];

    for (const branch of valid) {
        assert.deepEqual(validateBranchName(branch), []);
    }
});

test('rejects branch names outside the approved grammar', () => {
    const invalid = [
        'master',
        'feature/add-validator',
        'feat/Add-validator',
        'feat/two/levels',
        'feat/-leading',
        'release/v1.2.3',
        'release/1.2',
        'release/01.2.3',
        'release/1-2-3',
    ];

    for (const branch of invalid) {
        assert.notDeepEqual(validateBranchName(branch), []);
    }
});
