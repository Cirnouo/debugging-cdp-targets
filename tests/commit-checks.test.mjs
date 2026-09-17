import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildCommitCheckRequest, resolveAuditBranch, validateCommitRecords } from '../tooling/check-commits.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const commitlintCli = fileURLToPath(new URL('../node_modules/@commitlint/cli/cli.js', import.meta.url));

function commitlintAccepts(message) {
    const result = spawnSync(process.execPath, [commitlintCli, '--config', 'commitlint.config.mjs'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        input: message,
        windowsHide: true,
    });
    assert.equal(result.error, undefined);
    return result.status === 0;
}

function recordErrors(message) {
    return validateCommitRecords([{ sha: 'fixture', message, parentCount: 1 }]);
}

function sanitizedGitEnvironment(environment = process.env, overrides = {}) {
    return {
        ...Object.fromEntries(
            Object.entries(environment).filter(
                ([key]) =>
                    !key.toUpperCase().startsWith('GITHUB_') &&
                    !key.toUpperCase().startsWith('GIT_') &&
                    !key.toUpperCase().startsWith('NODE_TEST_'),
            ),
        ),
        ...overrides,
    };
}

test('builds a pull request audit for title, source branch, and commit range', () => {
    const event = {
        pull_request: {
            title: 'ci(tooling): add quality gates',
            base: { sha: 'base' },
            head: { ref: 'ci/quality-gates', sha: 'head' },
        },
    };
    assert.deepEqual(buildCommitCheckRequest({ eventName: 'pull_request', event }), {
        branches: ['ci/quality-gates'],
        directMessages: [
            {
                label: 'pull request title',
                message: 'ci(tooling): add quality gates',
            },
        ],
        range: 'base..head',
        includeAncestors: false,
    });
});

test('builds normal and first-push audits from GitHub push payloads', () => {
    assert.deepEqual(
        buildCommitCheckRequest({
            eventName: 'push',
            event: {
                ref: 'refs/heads/ci/quality-gates',
                before: 'before',
                after: 'after',
            },
        }),
        {
            branches: ['ci/quality-gates'],
            directMessages: [],
            range: 'before..after',
            includeAncestors: false,
        },
    );
    assert.deepEqual(
        buildCommitCheckRequest({
            eventName: 'push',
            event: {
                ref: 'refs/heads/feat/first-push',
                before: '0000000000000000000000000000000000000000',
                after: 'after',
            },
        }),
        {
            branches: ['feat/first-push'],
            directMessages: [],
            range: 'after',
            includeAncestors: true,
        },
    );
});

test('builds a local audit over current ancestry', () => {
    assert.deepEqual(buildCommitCheckRequest({ currentBranch: 'main' }), {
        branches: ['main'],
        directMessages: [],
        range: 'HEAD',
        includeAncestors: true,
    });
});

test('builds a workflow dispatch audit from its explicit event branch', () => {
    const currentBranch = resolveAuditBranch({
        environment: {
            GITHUB_REF: 'refs/heads/main',
            GITHUB_REF_NAME: 'main',
            GITHUB_REF_TYPE: 'branch',
        },
        event: {},
        eventName: 'workflow_dispatch',
    });
    assert.deepEqual(
        buildCommitCheckRequest({
            eventName: 'workflow_dispatch',
            event: {},
            currentBranch,
        }),
        {
            branches: ['main'],
            directMessages: [],
            range: 'HEAD',
            includeAncestors: true,
        },
    );
});

test('runs the workflow_dispatch checker from a detached GitHub checkout', async () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'cdp-workflow-dispatch-'));
    const eventPath = path.join(temporaryDirectory, 'event.json');
    await writeFile(eventPath, '{}\n', 'utf8');
    try {
        const fixtureEnvironment = sanitizedGitEnvironment();
        for (const arguments_ of [
            ['init', '--initial-branch=main'],
            ['config', 'user.name', 'CI Fixture'],
            ['config', 'user.email', 'ci-fixture@example.invalid'],
            [
                '-c',
                'commit.gpgSign=false',
                '-c',
                'core.hooksPath=.git/no-hooks',
                'commit',
                '--allow-empty',
                '--message',
                'test(tooling): create dispatch fixture',
            ],
            ['checkout', '--detach', 'HEAD'],
        ]) {
            const gitResult = spawnSync('git', arguments_, {
                cwd: temporaryDirectory,
                encoding: 'utf8',
                env: fixtureEnvironment,
                windowsHide: true,
            });
            assert.equal(gitResult.status, 0, `${gitResult.stdout}\n${gitResult.stderr}`);
        }
        const checkerPath = path.join(root, 'tooling/check-commits.mjs');
        const result = spawnSync(process.execPath, [checkerPath], {
            cwd: temporaryDirectory,
            encoding: 'utf8',
            env: {
                ...fixtureEnvironment,
                GITHUB_EVENT_NAME: 'workflow_dispatch',
                GITHUB_EVENT_PATH: eventPath,
                GITHUB_REF: 'refs/heads/main',
                GITHUB_REF_NAME: 'main',
                GITHUB_REF_TYPE: 'branch',
            },
            windowsHide: true,
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /audit passed/i);

        const missingRef = spawnSync(process.execPath, [checkerPath], {
            cwd: temporaryDirectory,
            encoding: 'utf8',
            env: {
                ...fixtureEnvironment,
                GITHUB_EVENT_NAME: 'workflow_dispatch',
                GITHUB_EVENT_PATH: eventPath,
            },
            windowsHide: true,
        });
        assert.equal(missingRef.status, 1, `${missingRef.stdout}\n${missingRef.stderr}`);
        assert.match(missingRef.stderr, /workflow_dispatch.*explicit branch ref.*detached/i);
    } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
});

test('validates ordinary commit records and skips only topology-proven merges', () => {
    assert.deepEqual(
        validateCommitRecords([
            { sha: 'good', message: 'fix(skill): preserve identity', parentCount: 1 },
            { sha: 'merge', message: "Merge branch 'topic'", parentCount: 2 },
        ]),
        [],
    );
    assert.match(
        validateCommitRecords([{ sha: 'fake', message: "Merge branch 'topic'", parentCount: 1 }]).join('\n'),
        /fake:[\s\S]*type/i,
    );
});

test('keeps ordinary footer separation in parity with commitlint', () => {
    for (const footer of ['Refs: #123', 'Closes #123', 'Reviewed-by: Example <reviewer@example.com>']) {
        const separated = `feat(tooling): describe validation\n\nbody details\n\n${footer}`;
        const unseparated = `feat(tooling): describe validation\n\nbody details\n${footer}`;

        assert.equal(commitlintAccepts(separated), true, footer);
        assert.deepEqual(recordErrors(separated), [], footer);
        assert.equal(commitlintAccepts(unseparated), false, footer);
        assert.notDeepEqual(recordErrors(unseparated), [], footer);
    }
});

test('accepts URL-only long body lines when commitlint accepts them', () => {
    const message = `docs(tooling): link validation reference\n\nhttps://example.com/${'a'.repeat(120)}`;

    assert.equal(commitlintAccepts(message), true);
    assert.deepEqual(recordErrors(message), []);
});

test('accepts backtick-leading subjects when commitlint accepts them', () => {
    const message = 'docs(tooling): `API` validation behavior';

    assert.equal(commitlintAccepts(message), true);
    assert.deepEqual(recordErrors(message), []);
});

test('rejects trailing header whitespace when commitlint rejects it', () => {
    const message = 'fix(tooling): reject trailing whitespace   ';

    assert.equal(commitlintAccepts(message), false);
    assert.notDeepEqual(recordErrors(message), []);
});

test('preserves trailing header whitespace when reading Git history for commitlint', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'cdp-commit-whitespace-'));
    try {
        const fixtureEnvironment = sanitizedGitEnvironment();
        for (const arguments_ of [
            ['init', '--initial-branch=main'],
            ['config', 'user.name', 'CI Fixture'],
            ['config', 'user.email', 'ci-fixture@example.invalid'],
            [
                '-c',
                'commit.gpgSign=false',
                '-c',
                'core.hooksPath=.git/no-hooks',
                'commit',
                '--allow-empty',
                '--cleanup=verbatim',
                '--message',
                'fix(tooling): reject trailing whitespace   ',
            ],
        ]) {
            const gitResult = spawnSync('git', arguments_, {
                cwd: temporaryDirectory,
                encoding: 'utf8',
                env: fixtureEnvironment,
                windowsHide: true,
            });
            assert.equal(gitResult.status, 0, `${gitResult.stdout}\n${gitResult.stderr}`);
        }

        const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'tooling/check-commits.mjs')], {
            cwd: temporaryDirectory,
            encoding: 'utf8',
            env: {
                ...fixtureEnvironment,
                GITHUB_EVENT_NAME: '',
                GITHUB_EVENT_PATH: '',
            },
            windowsHide: true,
        });
        assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stderr, /header.*whitespace/i);
    } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
});

test('Git fixtures ignore inherited repository redirection variables', async () => {
    const sentinelDirectory = await mkdtemp(path.join(os.tmpdir(), 'cdp-git-sentinel-'));
    const cleanEnvironment = sanitizedGitEnvironment();
    try {
        for (const arguments_ of [
            ['init', '--initial-branch=main'],
            ['config', 'user.name', 'Sentinel User'],
            ['config', 'user.email', 'sentinel@example.invalid'],
            [
                '-c',
                'commit.gpgSign=false',
                '-c',
                'core.hooksPath=.git/no-hooks',
                'commit',
                '--allow-empty',
                '--message',
                'test(tooling): create sentinel repository',
            ],
        ]) {
            const result = spawnSync('git', arguments_, {
                cwd: sentinelDirectory,
                encoding: 'utf8',
                env: cleanEnvironment,
                windowsHide: true,
            });
            assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        }

        const nested = spawnSync(
            process.execPath,
            ['--test', '--test-name-pattern=^runs the workflow_dispatch checker', fileURLToPath(import.meta.url)],
            {
                cwd: repositoryRoot,
                encoding: 'utf8',
                env: {
                    ...cleanEnvironment,
                    GIT_DIR: path.join(sentinelDirectory, '.git'),
                    GIT_WORK_TREE: sentinelDirectory,
                },
                windowsHide: true,
            },
        );
        const sentinelName = spawnSync('git', ['config', 'user.name'], {
            cwd: sentinelDirectory,
            encoding: 'utf8',
            env: cleanEnvironment,
            windowsHide: true,
        }).stdout.trim();
        const sentinelCount = spawnSync('git', ['rev-list', '--count', 'HEAD'], {
            cwd: sentinelDirectory,
            encoding: 'utf8',
            env: cleanEnvironment,
            windowsHide: true,
        }).stdout.trim();

        assert.equal(nested.status, 0, `${nested.stdout}\n${nested.stderr}`);
        assert.match(nested.stdout, /runs the workflow_dispatch checker/);
        assert.equal(sentinelName, 'Sentinel User');
        assert.equal(sentinelCount, '1');
    } finally {
        await rm(sentinelDirectory, { force: true, recursive: true });
    }
});
