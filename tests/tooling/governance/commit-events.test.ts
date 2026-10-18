import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import test from 'node:test';
import { buildCommitCheckRequest, resolveAuditBranch } from '../../../tooling/governance/commit-events.ts';

test('builds a pull request audit for raw title, squash header, source branch and commit range', () => {
    const event = {
        number: 123,
        pull_request: {
            title: 'ci(tooling): add quality gates',
            body: 'Explain the final behavior.\n\nCloses #220\nRefs: #221',
            base: { sha: 'base' },
            head: { ref: 'chore/quality-gates', sha: 'head' },
        },
    };
    assert.deepEqual(buildCommitCheckRequest({ eventName: 'pull_request', event }), {
        branches: ['chore/quality-gates'],
        directMessages: [
            {
                label: 'pull request title',
                message: 'ci(tooling): add quality gates',
            },
            {
                label: 'pull request squash header',
                message: 'ci(tooling): add quality gates (#123)',
            },
        ],
        range: 'base..head',
        includeAncestors: false,
    });
});

test('PR squash headers exclude empty descriptions and issue footers without changing the event', () => {
    const pr = {
        title: 'fix(target): reject stale identity',
        head: { ref: 'fix/stale-identity', sha: 'head' },
        base: { sha: 'base' },
    };
    const cases = [
        null,
        '',
        'Closes #220',
        'Validate the endpoint.\n\nFixes #220\nResolves owner/repository#221\nRefs: #222',
    ];
    for (const body of cases) {
        const event = { number: 123, pull_request: { ...pr, body } };
        const original = Buffer.from(JSON.stringify(event));
        const request = buildCommitCheckRequest({ eventName: 'pull_request', event });
        assert.equal(request.directMessages[1]?.message, 'fix(target): reject stale identity (#123)');
        assert.deepEqual(Buffer.from(JSON.stringify(event)), original);
    }
});

test('PR identity requires a positive safe integer number from the event root', () => {
    const pr = {
        number: 123,
        title: 'fix(target): reject stale identity',
        body: null,
        head: { ref: 'fix/stale-identity', sha: 'head' },
        base: { sha: 'base' },
    };
    for (const number of [undefined, null, '123', false, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, {}]) {
        assert.throws(
            () => buildCommitCheckRequest({ eventName: 'pull_request', event: { number, pull_request: pr } }),
            /pull request number.*positive safe integer/i,
        );
    }
    assert.throws(
        () => buildCommitCheckRequest({ eventName: 'pull_request', event: { pull_request: pr } }),
        /pull request number.*positive safe integer/i,
    );
    const maximum = buildCommitCheckRequest({
        eventName: 'pull_request',
        event: { number: Number.MAX_SAFE_INTEGER, pull_request: pr },
    });
    assert.equal(maximum.directMessages[1]?.message, 'fix(target): reject stale identity (#9007199254740991)');
});

test('PR titles reject their own trailing number instead of duplicating or stripping it', () => {
    const pr = {
        body: null,
        head: { ref: 'fix/stale-identity', sha: 'head' },
        base: { sha: 'base' },
    };
    for (const title of ['fix(target): reject stale identity (#123)', 'fix(target): reject stale identity (#123)   ']) {
        assert.throws(
            () =>
                buildCommitCheckRequest({
                    eventName: 'pull_request',
                    event: { number: 123, pull_request: { ...pr, title } },
                }),
            /remove.*\(#123\).*title/i,
        );
    }
    const reference = buildCommitCheckRequest({
        eventName: 'pull_request',
        event: { number: 123, pull_request: { ...pr, title: 'fix(target): follow issue (#220)' } },
    });
    assert.equal(reference.directMessages[0]?.message, 'fix(target): follow issue (#220)');
    assert.equal(reference.directMessages[1]?.message, 'fix(target): follow issue (#220) (#123)');
});

test('builds normal and first-push audits from GitHub push payloads', () => {
    assert.deepEqual(
        buildCommitCheckRequest({
            eventName: 'push',
            event: {
                ref: 'refs/heads/chore/quality-gates',
                before: 'before',
                after: 'after',
            },
        }),
        {
            branches: ['chore/quality-gates'],
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

test('imports supplied commit events without execution dependencies from an unrelated cwd', () => {
    const policy = new URL('../../../tooling/governance/commit-events.ts', import.meta.url).href;
    const source = [
        "import assert from 'node:assert/strict';",
        "import { registerHooks } from 'node:module';",
        'registerHooks({ resolve(specifier, context, nextResolve) {',
        "    if (['node:child_process', 'node:fs', 'node:fs/promises', 'node:process'].includes(specifier) || specifier.startsWith('@commitlint/')) throw new Error('Forbidden event dependency: ' + specifier);",
        '    return nextResolve(specifier, context);',
        '} });',
        `const policy = await import(${JSON.stringify(policy)});`,
        "const environment = { GITHUB_REF: 'refs/heads/main', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };",
        "const event = { ref: 'main' };",
        'const original = JSON.stringify({ environment, event });',
        "const currentBranch = policy.resolveAuditBranch({ environment, event, eventName: 'workflow_dispatch', localBranch: 'chore/unrelated' });",
        "assert.equal(currentBranch, 'main');",
        "assert.deepEqual(policy.buildCommitCheckRequest({ eventName: 'workflow_dispatch', event, currentBranch }), { branches: ['main'], directMessages: [], range: 'HEAD', includeAncestors: true });",
        'assert.equal(JSON.stringify({ environment, event }), original);',
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        cwd: os.tmpdir(),
        env: { ...process.env, GITHUB_REF: 'refs/tags/v1.2.3', GITHUB_REF_TYPE: 'tag' },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
