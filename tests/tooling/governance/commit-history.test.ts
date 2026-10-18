import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isRecord } from '../../../src/shared/errors.ts';
import { validateCommitRecords } from '../../../tooling/governance/check-commits.ts';
import { buildCommitCheckRequest } from '../../../tooling/governance/commit-events.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const commitlintCli = fileURLToPath(new URL('../../../node_modules/@commitlint/cli/cli.js', import.meta.url));

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

async function wrappedBodyLabelFixture() {
    const fixture: unknown = JSON.parse(
        await readFile(new URL('../../fixtures/wrapped-body-label-squash.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(fixture));
    assert.ok(typeof fixture.number === 'number' && typeof fixture.title === 'string');
    assert.ok(typeof fixture.actualMessage === 'string' && typeof fixture.originalBody === 'string');
    return {
        number: fixture.number,
        title: fixture.title,
        actualMessage: fixture.actualMessage,
        originalBody: fixture.originalBody,
    };
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

test('PR headers exclude long descriptions while identity rejects missing or malformed bodies', () => {
    const pr = {
        title: 'fix(governance): validate squash messages',
        head: { ref: 'fix/squash-check', sha: 'head' },
        base: { sha: 'base' },
    };
    const request = buildCommitCheckRequest({
        eventName: 'pull_request',
        event: { number: 123, pull_request: { ...pr, body: 'x'.repeat(101) } },
    });
    assert.equal(
        request.directMessages.every(({ message }) => commitlintAccepts(message)),
        true,
    );
    for (const body of [undefined, false, 42, {}]) {
        assert.throws(
            () =>
                buildCommitCheckRequest({
                    eventName: 'pull_request',
                    event: { number: 123, pull_request: { ...pr, body } },
                }),
            /Invalid pull request/,
        );
    }
    const empty = buildCommitCheckRequest({
        eventName: 'pull_request',
        event: { number: 123, pull_request: { ...pr, body: null } },
    });
    assert.equal(
        empty.directMessages.every(({ message }) => commitlintAccepts(message)),
        true,
    );
});

test('PR squash headers include the actual number in the 100-character budget', () => {
    const boundaries: [number, number][] = [
        [1, 82],
        [123, 80],
        [12345, 78],
    ];
    for (const [number, subjectLength] of boundaries) {
        for (const excess of [0, 1]) {
            const request = buildCommitCheckRequest({
                eventName: 'pull_request',
                event: {
                    number,
                    pull_request: {
                        title: `fix(target): ${'x'.repeat(subjectLength + excess)}`,
                        body: null,
                        head: { ref: 'fix/header-budget', sha: 'head' },
                        base: { sha: 'base' },
                    },
                },
            });
            const [titleCheck, squashCheck] = request.directMessages;
            assert.ok(titleCheck);
            assert.ok(squashCheck);
            assert.deepEqual(recordErrors(titleCheck.message), []);
            assert.equal(squashCheck.message.length, excess === 0 ? 100 : 101);
            const errors = recordErrors(squashCheck.message);
            if (excess === 0) assert.deepEqual(errors, []);
            else assert.match(errors.join('\n'), /header.*100/i);
        }
    }
});

test('PR number suffixes do not hide invalid raw titles', () => {
    const pr = {
        body: null,
        head: { ref: 'fix/stale-identity', sha: 'head' },
        base: { sha: 'base' },
    };
    for (const title of ['fix(target): ', 'fix(target): reject stale identity.']) {
        const request = buildCommitCheckRequest({
            eventName: 'pull_request',
            event: { number: 123, pull_request: { ...pr, title } },
        });
        const [titleCheck] = request.directMessages;
        assert.ok(titleCheck);
        assert.equal(titleCheck.message, title);
        assert.notDeepEqual(recordErrors(titleCheck.message), []);
    }
});

test('non-merge commits reject unwrapped squash bodies regardless of commit identity', async () => {
    const message: unknown = JSON.parse(
        await readFile(new URL('../../fixtures/unwrapped-squash-message.json', import.meta.url), 'utf8'),
    );
    assert.ok(typeof message === 'string');
    assert.equal(commitlintAccepts(message), false);
    for (const sha of ['a5b7b8ba0006926df55beb81f17dc52f20767699', 'fixture']) {
        assert.match(validateCommitRecords([{ sha, message, parentCount: 1 }]).join('\n'), /body-max-line-length/);
    }
});

test('checks task-purpose branches at local, push and pull request entry points', async (context) => {
    const currentBody = await readFile(new URL('../../fixtures/current-pr-body.md', import.meta.url), 'utf8');
    const cases = [
        { eventName: '', localBranch: 'docs/branch-policy', sourceBranch: 'docs/branch-policy', status: 1 },
        { eventName: '', localBranch: 'chore/branch-policy', sourceBranch: 'chore/branch-policy', status: 0 },
        { eventName: 'push', localBranch: 'chore/branch-policy', sourceBranch: 'docs/branch-policy', status: 1 },
        { eventName: 'push', localBranch: 'docs/branch-policy', sourceBranch: 'chore/branch-policy', status: 0 },
        {
            eventName: 'pull_request',
            localBranch: 'chore/branch-policy',
            sourceBranch: 'docs/branch-policy',
            status: 1,
        },
        {
            eventName: 'pull_request',
            localBranch: 'docs/branch-policy',
            sourceBranch: 'chore/branch-policy',
            status: 0,
        },
    ];
    for (const { eventName, localBranch, sourceBranch, status } of cases) {
        await context.test(
            `${eventName || 'local'} ${status === 0 ? 'accepts' : 'rejects'} ${sourceBranch}`,
            async () => {
                const directory = await mkdtemp(path.join(os.tmpdir(), 'cdp-branch-policy-'));
                const environment = sanitizedGitEnvironment();
                const git = (args: string[]) => {
                    const result = spawnSync('git', args, {
                        cwd: directory,
                        encoding: 'utf8',
                        env: environment,
                        windowsHide: true,
                    });
                    assert.equal(result.status, 0, result.stdout + result.stderr);
                    return result.stdout.trim();
                };
                try {
                    git(['init', '--initial-branch=main']);
                    git(['config', 'user.name', 'Branch Fixture']);
                    git(['config', 'user.email', 'branch-fixture@example.invalid']);
                    git(['config', 'core.hooksPath', '.git/no-hooks']);
                    git(['config', 'commit.gpgSign', 'false']);
                    git(['commit', '--allow-empty', '-m', 'test(governance): create branch fixture']);
                    const before = git(['rev-parse', 'HEAD']);
                    git(['checkout', '-b', localBranch]);
                    git(['commit', '--allow-empty', '-m', 'docs(governance): explain branch policy']);
                    const after = git(['rev-parse', 'HEAD']);
                    const eventPath = path.join(directory, 'event.json');
                    const event =
                        eventName === 'pull_request'
                            ? {
                                  number: 123,
                                  pull_request: {
                                      title: 'docs(governance): explain branch policy',
                                      body: currentBody,
                                      base: { sha: before },
                                      head: { ref: sourceBranch, sha: after },
                                  },
                              }
                            : { ref: `refs/heads/${sourceBranch}`, before, after };
                    await writeFile(eventPath, `${JSON.stringify(event)}\n`, 'utf8');
                    const result = spawnSync(
                        process.execPath,
                        [path.join(repositoryRoot, 'tooling/governance/check-commits.ts')],
                        {
                            cwd: directory,
                            encoding: 'utf8',
                            env: eventName
                                ? { ...environment, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath }
                                : environment,
                            windowsHide: true,
                        },
                    );
                    assert.equal(result.status, status, result.stdout + result.stderr);
                    if (status === 0) {
                        assert.match(result.stdout, /Commit and branch audit passed/);
                        assert.equal(result.stderr, '');
                    } else {
                        const errors = result.stderr.trim().split(/\r?\n/);
                        assert.equal(errors.length, 1, result.stderr);
                        assert.match(errors[0] ?? '', /^- docs\/branch-policy: Branch must be main or /);
                    }
                } finally {
                    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
                    assert.ok(path.basename(directory).startsWith('cdp-branch-policy-'));
                    await rm(directory, { recursive: true, force: true });
                }
            },
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
            spawnSync(process.execPath, [path.join(repositoryRoot, 'tooling/governance/check-commits.ts')], {
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
    const root = fileURLToPath(new URL('../../../', import.meta.url));
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
        const checkerPath = path.join(root, 'tooling/governance/check-commits.ts');
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
                        return spawnSync(
                            process.execPath,
                            [path.join(repositoryRoot, 'tooling/governance/check-commits.ts')],
                            {
                                cwd,
                                encoding: 'utf8',
                                env: { ...fixtureEnvironment, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventPath },
                                windowsHide: true,
                            },
                        );
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
    for (const footer of [
        'Refs: #123',
        'refs: #123',
        'REFS: #123',
        'Closes #123',
        'Closes owner/repository#123',
        'Reviewed-by: Example <reviewer@example.com>',
        'BREAKING CHANGE: callers must migrate',
        'BREAKING-CHANGE: callers must migrate',
        'quick-start: run installation steps',
    ]) {
        const separated = `feat(tooling): describe validation\n\nbody details\n\n${footer}`;
        const unseparated = `feat(tooling): describe validation\n\nbody details\n${footer}`;

        assert.equal(commitlintAccepts(separated), true, footer);
        assert.deepEqual(recordErrors(separated), [], footer);
        assert.equal(commitlintAccepts(unseparated), false, footer);
        assert.notDeepEqual(recordErrors(unseparated), [], footer);
    }
});

test('accepts historical body label commits and excludes either original or wrapped descriptions from PR headers', async (context) => {
    const fixture = await wrappedBodyLabelFixture();
    assert.deepEqual(recordErrors(fixture.actualMessage), []);
    assert.equal(commitlintAccepts(fixture.actualMessage), true);
    const wrappedBody = fixture.actualMessage.slice(fixture.actualMessage.indexOf('\n\n') + 2);
    for (const [label, body] of [
        ['original PR description', fixture.originalBody],
        ['actual wrapped squash description', wrappedBody],
    ] as const) {
        await context.test(label, () => {
            const event = {
                number: fixture.number,
                pull_request: {
                    title: fixture.title,
                    body,
                    base: { sha: 'base' },
                    head: { ref: 'chore/commit-footer-boundaries', sha: 'head' },
                },
            };
            const eventBytes = Buffer.from(JSON.stringify(event));
            const request = buildCommitCheckRequest({
                eventName: 'pull_request',
                event,
            });
            const prediction = request.directMessages[1];
            assert.ok(prediction);
            assert.equal(prediction.message, `${fixture.title} (#${fixture.number})`);
            assert.deepEqual(recordErrors(prediction.message), []);
            assert.equal(commitlintAccepts(prediction.message), true);
            assert.deepEqual(Buffer.from(JSON.stringify(event)), eventBytes);
        });
    }
});

test('preserves footer separation for plain and bullet breaking change descriptions on either line', () => {
    for (const token of ['BREAKING CHANGE', 'BREAKING-CHANGE', '* BREAKING CHANGE']) {
        for (const separator of [' ', '\n']) {
            const footer = `${token}:${separator}Callers must migrate.`;
            const separated = `feat(tooling): describe validation\n\nbody details\n\n${footer}`;
            const unseparated = `feat(tooling): describe validation\n\nbody details\n${footer}`;
            assert.deepEqual(recordErrors(separated), [], token);
            assert.equal(commitlintAccepts(separated), true, token);
            assert.notDeepEqual(recordErrors(unseparated), [], token);
            assert.equal(commitlintAccepts(unseparated), false, token);
        }
    }
});

test('ordinary body labels remain prose without a blank and can begin a separated generic footer', async (context) => {
    for (const token of ['refinements', 'observations', 'Summary']) {
        await context.test(token, () => {
            for (const separator of ['\n\n', '\n']) {
                const message = `docs(tooling): explain validation\n\nDescribe the checks.${separator}${token}: the checks passed`;
                assert.deepEqual(recordErrors(message), []);
                assert.equal(commitlintAccepts(message), true);
            }
        });
    }
});

test('body labels cannot hide header separation or an unseparated explicit footer', () => {
    assert.notDeepEqual(recordErrors('docs(tooling): explain validation\nobservations: the checks passed'), []);
    for (const footer of ['Refs: #123', 'Closes owner/repository#123', 'BREAKING CHANGE: callers must migrate']) {
        const message = `docs(tooling): explain validation\n\nDescribe the checks.\nobservations: the checks passed\n${footer}`;
        assert.notDeepEqual(recordErrors(message), [], footer);
    }
});

test('separated generic footer groups accept adjacent explicit trailers after body labels', () => {
    const message =
        'feat(tooling): explain validation\n\nDescribe the checks.\nobservations: the checks passed\n\nValidation: passed\nRefs: #123\nReviewed-by: Example <reviewer@example.com>\nBREAKING CHANGE: callers must migrate';
    assert.deepEqual(recordErrors(message), []);
    assert.equal(commitlintAccepts(message), true);
});

test('preserved body label messages retain their bytes and current PRs require the template', async (context) => {
    const fixture = await wrappedBodyLabelFixture();
    const messageBytes = Buffer.from(fixture.actualMessage);
    const temporaryBase = await realpath(os.tmpdir());
    const directory = await realpath(await mkdtemp(path.join(temporaryBase, 'cdp-footer-boundaries-')));
    const fixtureEnvironment = sanitizedGitEnvironment();
    const git = (arguments_: string[]) => {
        const result = spawnSync('git', arguments_, {
            cwd: directory,
            env: fixtureEnvironment,
            windowsHide: true,
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stdout.toString() + result.stderr.toString());
        return result.stdout;
    };
    try {
        git(['init', '--initial-branch=main']);
        git(['config', 'user.name', 'CI Fixture']);
        git(['config', 'user.email', 'ci-fixture@example.invalid']);
        git(['config', 'core.hooksPath', '.git/no-hooks']);
        git(['config', 'commit.gpgSign', 'false']);
        git(['commit', '--allow-empty', '-m', 'test(tooling): create footer base']);
        const base = git(['rev-parse', 'HEAD']).toString().trim();
        const messagePath = path.join(directory, '.git', 'fixture-message');
        await writeFile(messagePath, messageBytes);
        git(['commit', '--allow-empty', '--cleanup=verbatim', '--file', messagePath]);
        const wrapped = git(['rev-parse', 'HEAD']).toString().trim();
        git(['commit', '--allow-empty', '-m', 'test(tooling): add valid footer head']);
        const head = git(['rev-parse', 'HEAD']).toString().trim();
        const eventPath = path.join(directory, '.git', 'event.json');
        const cases: [string, string, unknown][] = [
            ['ordinary push', 'push', { ref: 'refs/heads/main', before: base, after: wrapped }],
            ['complete ancestry', '', {}],
            [
                'PR direct message',
                'pull_request',
                {
                    number: fixture.number,
                    pull_request: {
                        title: fixture.title,
                        body: fixture.actualMessage.slice(fixture.actualMessage.indexOf('\n\n') + 2),
                        base: { sha: wrapped },
                        head: { ref: 'chore/commit-footer-boundaries', sha: head },
                    },
                },
            ],
        ];
        for (const [label, eventName, event] of cases) {
            await context.test(label, async () => {
                const object = git(['cat-file', 'commit', wrapped]);
                assert.deepEqual(object.subarray(object.indexOf('\n\n') + 2), messageBytes);
                const eventBytes = Buffer.from(`${JSON.stringify(event)}\n`);
                await writeFile(eventPath, eventBytes);
                const result = spawnSync(
                    process.execPath,
                    [path.join(repositoryRoot, 'tooling/governance/check-commits.ts')],
                    {
                        cwd: directory,
                        encoding: 'utf8',
                        env: {
                            ...fixtureEnvironment,
                            GITHUB_EVENT_NAME: eventName,
                            GITHUB_EVENT_PATH: eventName ? eventPath : '',
                        },
                        windowsHide: true,
                    },
                );
                const after = git(['cat-file', 'commit', wrapped]);
                assert.deepEqual(after.subarray(after.indexOf('\n\n') + 2), messageBytes);
                assert.deepEqual(await readFile(messagePath), messageBytes);
                assert.deepEqual(await readFile(eventPath), eventBytes);
                assert.equal(result.error, undefined);
                assert.equal(result.status, eventName === 'pull_request' ? 1 : 0, result.stdout + result.stderr);
                if (eventName === 'pull_request') assert.match(result.stderr, /pull request body/i);
                else assert.match(result.stdout, /audit passed/i);
            });
        }
    } finally {
        assert.equal(path.dirname(directory), temporaryBase);
        assert.ok(path.basename(directory).startsWith('cdp-footer-boundaries-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('accepts URL-only long body lines when commitlint accepts them', () => {
    const message = `docs(tooling): link validation reference\n\nhttps://example.com/${'a'.repeat(120)}`;

    assert.equal(commitlintAccepts(message), true);
    assert.deepEqual(recordErrors(message), []);
});

test('current PR CLI validates review descriptions independently of headers and actual topic commits', async (context) => {
    const compliantBody = await readFile(new URL('../../fixtures/current-pr-body.md', import.meta.url), 'utf8');
    const reviewNote = 'observations: the complete description supplies review context';
    const longProse = 'The review includes detailed behavior and verification evidence. '.repeat(4);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cdp-current-pr-'));
    const fixtureEnvironment = sanitizedGitEnvironment();
    const git = (args: string[]) => {
        const result = spawnSync('git', args, {
            cwd: directory,
            env: fixtureEnvironment,
            encoding: 'utf8',
            windowsHide: true,
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return result.stdout.trim();
    };
    try {
        git(['init', '--initial-branch=main']);
        git(['config', 'user.name', 'CI Fixture']);
        git(['config', 'user.email', 'ci-fixture@example.invalid']);
        git(['config', 'core.hooksPath', '.git/no-hooks']);
        git(['config', 'commit.gpgSign', 'false']);
        git(['commit', '--allow-empty', '-m', 'test(tooling): create current PR base']);
        const base = git(['rev-parse', 'HEAD']);
        git(['commit', '--allow-empty', '-m', 'chore(tooling): add current PR head']);
        const head = git(['rev-parse', 'HEAD']);
        const eventPath = path.join(directory, '.git', 'event.json');
        const audit = async (body: string | null, rangeBase = base, rangeHead = head) => {
            const event = {
                number: 219,
                pull_request: {
                    title: 'chore(tooling): validate current submissions',
                    body,
                    base: { sha: rangeBase },
                    head: { ref: 'chore/current-submissions', sha: rangeHead },
                },
            };
            const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
            await writeFile(eventPath, bytes);
            const result = spawnSync(
                process.execPath,
                [path.join(repositoryRoot, 'tooling/governance/check-commits.ts')],
                {
                    cwd: directory,
                    encoding: 'utf8',
                    env: { ...fixtureEnvironment, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath },
                    windowsHide: true,
                },
            );
            assert.equal(result.error, undefined);
            assert.deepEqual(await readFile(eventPath), bytes);
            return result;
        };
        for (const [label, body, status, diagnostic] of [
            ['compliant body', compliantBody, 0, /audit passed/i],
            ['null body', null, 1, /pull request body/i],
            ['empty body', '', 1, /pull request body/i],
            ['historical prose', 'An old PR description cannot waive the current template.', 1, /pull request body/i],
            ['missing section', compliantBody.replace('## Verification', '## Results'), 1, /pull request body/i],
            ['long prose', compliantBody.replace(reviewNote, longProse), 0, /audit passed/i],
            [
                'wide table',
                compliantBody.replace(reviewNote, `| Evidence | Details |\n| --- | --- |\n| Result | ${longProse} |`),
                0,
                /audit passed/i,
            ],
            [
                'long fenced evidence',
                compliantBody.replace(reviewNote, `\`\`\`text\n${'evidence='.repeat(30)}\n\`\`\``),
                0,
                /audit passed/i,
            ],
            [
                'adjacent reserved trailer-looking prose',
                compliantBody.replace(reviewNote, 'Review notes.\nRefs: #220\nBREAKING CHANGE: callers must migrate'),
                0,
                /audit passed/i,
            ],
            [
                'adjacent closing reference',
                compliantBody.replace(reviewNote, 'Review notes.\nCloses #219'),
                0,
                /audit passed/i,
            ],
        ] as const) {
            await context.test(label, async () => {
                const result = await audit(body);
                assert.equal(result.status, status, result.stdout + result.stderr);
                assert.match(result.stdout + result.stderr, diagnostic);
                if (status === 0) assert.equal(result.stderr, '');
            });
        }
        for (const [label, message, diagnostic] of [
            [
                'overlong actual commit body',
                `chore(tooling): describe validation\n\n${'x'.repeat(101)}\n`,
                /body-max-line-length/i,
            ],
            [
                'unseparated actual commit footer',
                'chore(tooling): describe validation\n\nReview notes.\nRefs: #220\n',
                /footer.*blank/i,
            ],
        ] as const) {
            await context.test(label, async () => {
                assert.equal(commitlintAccepts(message), false);
                assert.match(recordErrors(message).join('\n'), diagnostic);
                const rangeBase = git(['rev-parse', 'HEAD']);
                const messagePath = path.join(directory, '.git', 'topic-message');
                const messageBytes = Buffer.from(message);
                await writeFile(messagePath, messageBytes);
                git(['commit', '--allow-empty', '--cleanup=verbatim', '--file', messagePath]);
                const rangeHead = git(['rev-parse', 'HEAD']);
                const result = await audit(compliantBody.replace(reviewNote, longProse), rangeBase, rangeHead);
                assert.equal(result.status, 1, result.stdout + result.stderr);
                assert.match(result.stderr, diagnostic);
                assert.ok(result.stderr.includes(`${rangeHead}:`), result.stderr);
                assert.doesNotMatch(result.stderr, /pull request (?:body|title|squash)/i);
                assert.deepEqual(await readFile(messagePath), messageBytes);
            });
        }
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('cdp-current-pr-'));
        await rm(directory, { recursive: true, force: true });
    }
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

        const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'tooling/governance/check-commits.ts')], {
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
