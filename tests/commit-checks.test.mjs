import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildCommitCheckRequest, validateCommitRecords } from '../tooling/check-commits.mjs';

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

test('builds a workflow dispatch audit from the checked-out branch', () => {
    assert.deepEqual(
        buildCommitCheckRequest({
            eventName: 'workflow_dispatch',
            event: {},
            currentBranch: 'main',
        }),
        {
            branches: ['main'],
            directMessages: [],
            range: 'HEAD',
            includeAncestors: true,
        },
    );
});

test('runs the commit checker for a workflow_dispatch event fixture', async () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'cdp-workflow-dispatch-'));
    const eventPath = path.join(temporaryDirectory, 'event.json');
    await writeFile(eventPath, '{}\n', 'utf8');
    try {
        const result = spawnSync(process.execPath, ['tooling/check-commits.mjs'], {
            cwd: root,
            encoding: 'utf8',
            env: {
                ...process.env,
                GITHUB_EVENT_NAME: 'workflow_dispatch',
                GITHUB_EVENT_PATH: eventPath,
            },
            windowsHide: true,
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /audit passed/i);
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
        /fake.*type/i,
    );
});
