import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parse } from 'yaml';

const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);
const source = await readFile(workflowUrl, 'utf8');
const workflow = parse(source);

test('CI workflow has read-only triggers, concurrency, and exact job display names', () => {
    assert.equal(Object.hasOwn(workflow.on, 'push'), true);
    assert.deepEqual(workflow.on.pull_request.branches, ['main']);
    assert.equal(Object.hasOwn(workflow.on, 'workflow_dispatch'), true);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.concurrency['cancel-in-progress'], true);
    assert.deepEqual(
        Object.values(workflow.jobs).map((job) => job.name),
        ['Commit messages', 'Quality', 'Windows tests'],
    );
    assert.equal(workflow.jobs['windows-tests'].needs, 'quality');
});

test('CI workflow uses only the approved action pins and uploads no artifacts', () => {
    const approved = new Set([
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
    ]);
    const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.map((step) => step.uses).filter(Boolean));
    assert.equal(uses.length, 9);
    assert.deepEqual(new Set(uses), approved);
    assert.match(source, /# v7\.0\.1/);
    assert.match(source, /# v7\.0\.0/);
    assert.match(source, /# v6\.0\.10/);
    assert.doesNotMatch(source, /upload-artifact/i);
});

test('CI jobs run their required frozen-install and verification commands', () => {
    const commands = (job) =>
        job.steps
            .map((step) => step.run)
            .filter(Boolean)
            .join('\n');
    assert.match(commands(workflow.jobs['commit-messages']), /pnpm install --frozen-lockfile/);
    assert.match(commands(workflow.jobs['commit-messages']), /pnpm check:commits/);

    const quality = commands(workflow.jobs.quality);
    for (const command of [
        'pnpm check:repo',
        'pnpm format:check',
        'pnpm lint',
        'pnpm check:scripts',
        'pnpm test:coverage',
        'pnpm check:distribution',
    ]) {
        assert.match(quality, new RegExp(command.replace(':', '\\:')));
    }

    const windows = commands(workflow.jobs['windows-tests']);
    assert.match(windows, /pnpm test/);
    assert.match(windows, /pnpm check:scripts/);
    assert.match(windows, /RUNNER_TEMP/);
    assert.match(windows, /pnpm check:distribution/);
});
