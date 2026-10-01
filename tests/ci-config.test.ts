import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parse } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';

interface WorkflowStep {
    uses?: string;
    run?: string;
    'continue-on-error'?: boolean;
}
interface WorkflowJob {
    name: string;
    steps: WorkflowStep[];
    needs?: string;
    env?: Record<string, string>;
    'continue-on-error'?: boolean;
}
interface Workflow {
    on: { push: unknown; pull_request: { branches: string[]; types: string[] }; workflow_dispatch: unknown };
    permissions: Record<string, string>;
    concurrency: { 'cancel-in-progress': boolean };
    jobs: Record<
        'supply-chain-security' | 'commit-messages' | 'quality' | 'windows-tests' | 'portable-tests',
        WorkflowJob
    >;
}
function readWorkflow(source: string): Workflow {
    const value: unknown = parse(source);
    assert.ok(
        isRecord(value) &&
            isRecord(value.jobs) &&
            isRecord(value.on) &&
            isRecord(value.permissions) &&
            isRecord(value.concurrency),
    );
    assert.ok(
        isRecord(value.on.pull_request) &&
            Array.isArray(value.on.pull_request.branches) &&
            Array.isArray(value.on.pull_request.types),
    );
    for (const job of Object.values(value.jobs)) {
        assert.ok(isRecord(job) && typeof job.name === 'string' && Array.isArray(job.steps));
        for (const step of job.steps as unknown[]) {
            assert.ok(isRecord(step));
            assert.ok(step.run === undefined || typeof step.run === 'string');
            assert.ok(step.uses === undefined || typeof step.uses === 'string');
        }
        assert.ok(job.env === undefined || isRecord(job.env));
    }
    return {
        on: value.on as Workflow['on'],
        permissions: value.permissions as Workflow['permissions'],
        concurrency: value.concurrency as Workflow['concurrency'],
        jobs: value.jobs as Workflow['jobs'],
    };
}

const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);
const source = await readFile(workflowUrl, 'utf8');
const workflow = readWorkflow(source);

test('CI workflow has read-only triggers, concurrency, and exact job display names', () => {
    assert.equal(Object.hasOwn(workflow.on, 'push'), true);
    assert.deepEqual(workflow.on.pull_request.branches, ['main']);
    assert.deepEqual(workflow.on.pull_request.types, ['opened', 'reopened', 'synchronize', 'edited']);
    assert.equal(Object.hasOwn(workflow.on, 'workflow_dispatch'), true);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.concurrency['cancel-in-progress'], true);
    assert.deepEqual(
        Object.values(workflow.jobs).map((job) => job.name),
        ['Supply chain security', 'Commit messages', 'Quality', 'Windows tests', `Portable tests (\${{ matrix.os }})`],
    );
    assert.equal(workflow.jobs['commit-messages'].needs, 'supply-chain-security');
    assert.equal(workflow.jobs.quality.needs, 'supply-chain-security');
    assert.equal(workflow.jobs['windows-tests'].needs, 'quality');
});

test('CI workflow uses only the approved action pins and uploads no artifacts', () => {
    const approved = new Set([
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
    ]);
    const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.map((step) => step.uses).filter(Boolean));
    assert.equal(uses.length, 15);
    assert.deepEqual(new Set(uses), approved);
    assert.match(source, /# v7\.0\.1/);
    assert.match(source, /# v7\.0\.0/);
    assert.match(source, /# v6\.0\.10/);
    assert.doesNotMatch(source, /upload-artifact/i);
});

test('security gate audits before any reviewed dependency builds and cannot ignore failures', () => {
    const security = workflow.jobs['supply-chain-security'];
    assert.ok(security);
    assert.equal(security.env?.PNPM_CONFIG_IGNORE_PNPMFILE, 'true');
    assert.equal(security.env?.PNPM_CONFIG_CONFIG_DEPENDENCIES, '{}');
    const runs = security.steps.map((step) => step.run).filter(Boolean);
    assert.deepEqual(runs, [
        'node tooling/security/dist/check-security.mjs --phase lockfile --root .',
        'pnpm install --frozen-lockfile --ignore-scripts',
        'pnpm check:security',
        'pnpm check:security:build',
    ]);
    assert.equal(Object.hasOwn(security, 'continue-on-error'), false);
    assert.equal(
        security.steps.some((step) => step['continue-on-error'] === true),
        false,
    );
    assert.doesNotMatch(runs.join('\n'), /ignore-registry-errors|audit.*--prod|audit.*--fix/);
});

test('CI jobs run their required frozen-install and verification commands', () => {
    const commands = (job: WorkflowJob) =>
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

test('every execution platform performs independent type checking before tests', () => {
    for (const name of ['quality', 'windows-tests', 'portable-tests'] as const) {
        const job = workflow.jobs[name];
        assert.ok(job);
        const commands = job.steps
            .map((step) => step.run)
            .filter((run): run is string => typeof run === 'string')
            .join('\n');
        assert.match(commands, /pnpm typecheck/);
        assert.ok(commands.indexOf('pnpm typecheck') < commands.indexOf('pnpm test'));
    }
});
