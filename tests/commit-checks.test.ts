import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildCommitCheckRequest, resolveAuditBranch, validateCommitRecords } from '../tooling/check-commits.ts';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const commitlintCli = fileURLToPath(new URL('../node_modules/@commitlint/cli/cli.js', import.meta.url));

function commitlintAccepts(message: string) {
    const result = spawnSync(process.execPath, [commitlintCli, '--config', 'commitlint.config.ts'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        input: message,
        windowsHide: true,
    });
    assert.equal(result.error, undefined);
    return result.status === 0;
}

function recordErrors(message: string) {
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

test('builds a pull request audit for title, complete squash message, source branch and commit range', () => {
    const event = {
        pull_request: {
            title: 'ci(tooling): add quality gates',
            body: 'Explain the final behavior.',
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
            {
                label: 'pull request squash message',
                message: 'ci(tooling): add quality gates\n\nExplain the final behavior.',
            },
        ],
        range: 'base..head',
        includeAncestors: false,
    });
});

test('PR squash validation rejects long descriptions and missing or malformed body evidence', () => {
    const pr = {
        title: 'fix(governance): validate squash messages',
        head: { ref: 'codex/squash-check', sha: 'head' },
        base: { sha: 'base' },
    };
    const request = buildCommitCheckRequest({
        eventName: 'pull_request',
        event: { pull_request: { ...pr, body: 'x'.repeat(101) } },
    });
    assert.equal(
        request.directMessages.some(({ message }) => !commitlintAccepts(message)),
        true,
    );
    for (const body of [undefined, false, 42, {}]) {
        assert.throws(
            () => buildCommitCheckRequest({ eventName: 'pull_request', event: { pull_request: { ...pr, body } } }),
            /Invalid pull request/,
        );
    }
    const empty = buildCommitCheckRequest({
        eventName: 'pull_request',
        event: { pull_request: { ...pr, body: null } },
    });
    assert.equal(
        empty.directMessages.every(({ message }) => commitlintAccepts(message)),
        true,
    );
});

test('historical squash wrapping applies only to the exact immutable reviewed commit message', async () => {
    const message: unknown = JSON.parse(
        await readFile(new URL('./fixtures/pr2-squash-message.json', import.meta.url), 'utf8'),
    );
    assert.ok(typeof message === 'string');
    const sha = 'a5b7b8ba0006926df55beb81f17dc52f20767699';
    assert.equal(commitlintAccepts(message), false);
    assert.deepEqual(validateCommitRecords([{ sha, message, parentCount: 1 }]), []);
    assert.notDeepEqual(recordErrors(message), []);
    for (const changed of [
        { message: message.replace('fix(dependencies)', 'feat(unapproved)'), parentCount: 1 },
        { message: `${message}\nUnreviewed appended text.\n`, parentCount: 1 },
        { message, parentCount: 2 },
    ]) {
        assert.match(validateCommitRecords([{ sha, ...changed }]).join('\n'), /historical.*identity/i);
    }
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

test('builds a scheduled audit over the explicit branch and complete ancestry', () => {
    const currentBranch = resolveAuditBranch({
        environment: { GITHUB_REF: 'refs/heads/main', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' },
        event: { schedule: '17 1 * * 1' },
        eventName: 'schedule',
    });
    assert.deepEqual(buildCommitCheckRequest({ eventName: 'schedule', currentBranch }), {
        branches: ['main'],
        directMessages: [],
        range: 'HEAD',
        includeAncestors: true,
    });
});

test('scheduled audits reject missing and contradictory tag identities instead of local fallback', () => {
    for (const { environment, event } of [
        { environment: {}, event: { ref: 'main' } },
        {
            environment: { GITHUB_REF: 'refs/tags/v0.1.0', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' },
            event: {},
        },
        { environment: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'main' }, event: { ref: 'main' } },
        { environment: { GITHUB_REF: 'refs/heads/main', GITHUB_REF_TYPE: 'tag' }, event: {} },
        { environment: { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' }, event: { ref: 'refs/tags/v0.1.0' } },
        { environment: { GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'codex/other' }, event: {} },
    ]) {
        const currentBranch = resolveAuditBranch({
            environment,
            event,
            eventName: 'schedule',
            localBranch: 'main',
        });
        assert.equal(currentBranch, undefined);
        assert.throws(() => buildCommitCheckRequest({ eventName: 'schedule', currentBranch }), /branch identity/);
    }
});

test('scheduled branch evidence accepts explicit matching fallbacks without local inference', () => {
    for (const { environment, event } of [
        { environment: { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' }, event: {} },
        { environment: {}, event: { ref: 'refs/heads/main' } },
        { environment: { GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main' }, event: { ref: 'main' } },
    ]) {
        assert.equal(
            resolveAuditBranch({ environment, event, eventName: 'schedule', localBranch: 'codex/other' }),
            'main',
        );
    }
});

test('scheduled audit rejects shallow ancestry that hides an invalid earlier commit', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'cdp-scheduled-ancestry-'));
    const fixtureEnvironment = sanitizedGitEnvironment();
    const git = (cwd: string, args: string[]) => {
        const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: fixtureEnvironment, windowsHide: true });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return result.stdout.trim();
    };
    try {
        git(folder, ['init', '--initial-branch=main', 'source']);
        const source = path.join(folder, 'source');
        git(source, ['config', 'user.name', 'CI Fixture']);
        git(source, ['config', 'user.email', 'ci-fixture@example.invalid']);
        git(source, ['config', 'core.hooksPath', '.git/no-hooks']);
        git(source, ['config', 'commit.gpgSign', 'false']);
        git(source, ['commit', '--allow-empty', '-m', 'invalid hidden ancestor']);
        const ancestor = git(source, ['rev-parse', 'HEAD']);
        git(source, ['commit', '--allow-empty', '-m', 'test(tooling): add valid scheduled head']);
        git(folder, ['clone', '--no-local', '--depth', '1', source, 'shallow']);
        const eventPath = path.join(folder, 'event.json');
        await writeFile(eventPath, '{"schedule":"17 1 * * 1"}\n', 'utf8');
        const check = (cwd: string) =>
            spawnSync(process.execPath, [path.join(repositoryRoot, 'tooling/check-commits.ts')], {
                cwd,
                encoding: 'utf8',
                windowsHide: true,
                env: {
                    ...fixtureEnvironment,
                    GITHUB_EVENT_NAME: 'schedule',
                    GITHUB_EVENT_PATH: eventPath,
                    GITHUB_REF: 'refs/heads/main',
                    GITHUB_REF_TYPE: 'branch',
                },
            });
        const complete = check(source);
        assert.equal(complete.status, 1, complete.stdout + complete.stderr);
        assert.ok(complete.stderr.includes(ancestor));
        const shallow = check(path.join(folder, 'shallow'));
        assert.equal(shallow.status, 1, 'A valid visible head must not hide unexamined ancestors.');
        assert.match(shallow.stderr, /complete history/i);
    } finally {
        assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(folder).startsWith('cdp-scheduled-ancestry-'));
        await rm(folder, { recursive: true, force: true });
    }
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
        const checkerPath = path.join(root, 'tooling/check-commits.ts');
        for (const eventName of ['workflow_dispatch', 'schedule']) {
            const result = spawnSync(process.execPath, [checkerPath], {
                cwd: temporaryDirectory,
                encoding: 'utf8',
                env: {
                    ...fixtureEnvironment,
                    GITHUB_EVENT_NAME: eventName,
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
                    GITHUB_EVENT_NAME: eventName,
                    GITHUB_EVENT_PATH: eventPath,
                },
                windowsHide: true,
            });
            assert.equal(missingRef.status, 1, `${missingRef.stdout}\n${missingRef.stderr}`);
            assert.match(missingRef.stderr, new RegExp(`${eventName}.*explicit branch ref.*detached`, 'i'));
        }
    } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
});

test('audits all rewritten history when a forced push base is absent from the checkout', async (context) => {
    for (const invalidAncestor of [false, true]) {
        await context.test(
            invalidAncestor ? 'rejects an invalid ancestor' : 'accepts valid rewritten history',
            async () => {
                const directory = await mkdtemp(path.join(os.tmpdir(), 'cdp-rewritten-push-'));
                const fixtureEnvironment = sanitizedGitEnvironment();
                const git = (cwd: string, args: string[]) => {
                    const result = spawnSync('git', args, {
                        cwd,
                        encoding: 'utf8',
                        env: fixtureEnvironment,
                        windowsHide: true,
                    });
                    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
                    return result.stdout.trim();
                };
                try {
                    git(directory, ['init', '--initial-branch=main', 'source']);
                    const source = path.join(directory, 'source');
                    git(source, ['config', 'user.name', 'CI Fixture']);
                    git(source, ['config', 'user.email', 'ci-fixture@example.invalid']);
                    git(source, ['config', 'core.hooksPath', '.git/no-hooks']);
                    git(source, ['config', 'commit.gpgSign', 'false']);
                    git(source, [
                        'commit',
                        '--allow-empty',
                        '-m',
                        invalidAncestor ? 'invalid ancestor' : 'test(tooling): create base',
                    ]);
                    const ancestor = git(source, ['rev-parse', 'HEAD']);
                    git(source, ['commit', '--allow-empty', '-m', 'feat(session): original title']);
                    const before = git(source, ['rev-parse', 'HEAD']);
                    git(source, ['commit', '--amend', '--allow-empty', '-m', 'feat(session): revised title']);
                    const after = git(source, ['rev-parse', 'HEAD']);
                    // A transport clone contains reachable history, not the replaced loose object.
                    git(directory, ['clone', '--no-local', '--single-branch', '--branch', 'main', source, 'checkout']);
                    const checkout = path.join(directory, 'checkout');
                    git(checkout, ['checkout', '--detach', after]);
                    const missing = spawnSync('git', ['cat-file', '-e', `${before}^{commit}`], {
                        cwd: checkout,
                        env: fixtureEnvironment,
                        windowsHide: true,
                    });
                    assert.notEqual(missing.status, 0);
                    const eventPath = path.join(directory, 'event.json');
                    const check = async (forced: boolean, head = after, cwd = checkout) => {
                        await writeFile(
                            eventPath,
                            JSON.stringify({ ref: 'refs/heads/main', before, after: head, forced }),
                        );
                        return spawnSync(process.execPath, [path.join(repositoryRoot, 'tooling/check-commits.ts')], {
                            cwd,
                            encoding: 'utf8',
                            env: { ...fixtureEnvironment, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventPath },
                            windowsHide: true,
                        });
                    };
                    const result = await check(true);
                    assert.equal(result.status, invalidAncestor ? 1 : 0, `${result.stdout}\n${result.stderr}`);
                    if (invalidAncestor) {
                        assert.ok(result.stderr.includes(ancestor), result.stderr);
                        const availableBase = await check(true, after, source);
                        assert.equal(
                            availableBase.status,
                            0,
                            'An available base still limits the audit to new commits.',
                        );
                        git(directory, ['clone', '--no-local', '--depth', '1', source, 'shallow']);
                        const shallow = await check(true, after, path.join(directory, 'shallow'));
                        assert.equal(shallow.status, 1, 'Incomplete ancestry must not conceal the invalid ancestor.');
                        assert.match(shallow.stderr, /complete history/i);
                    } else {
                        assert.match(result.stdout, /audit passed/i);
                        assert.notEqual((await check(false)).status, 0, 'An ordinary push must still have its base.');
                        assert.notEqual(
                            (await check(true, '1'.repeat(40))).status,
                            0,
                            'A missing head must never pass.',
                        );
                    }
                } finally {
                    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
                    assert.ok(path.basename(directory).startsWith('cdp-rewritten-push-'));
                    await rm(directory, { recursive: true, force: true });
                }
            },
        );
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

        const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'tooling/check-commits.ts')], {
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
