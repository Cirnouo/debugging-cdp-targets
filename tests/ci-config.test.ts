import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parse } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';

interface WorkflowStep {
    uses?: string;
    run?: string;
    if?: string;
    shell?: string;
    env?: Record<string, string>;
    'continue-on-error'?: boolean;
}
interface WorkflowJob {
    name: string;
    steps: WorkflowStep[];
    needs?: string;
    env?: Record<string, string>;
    strategy?: { 'fail-fast'?: boolean; matrix: { include: { os: string; chrome: string }[] } };
    'continue-on-error'?: boolean;
}
interface Workflow {
    on: {
        push: unknown;
        pull_request: { branches: string[]; types: string[] };
        workflow_dispatch: unknown;
        schedule: { cron: string }[];
    };
    permissions: Record<string, string>;
    concurrency: { 'cancel-in-progress': boolean };
    jobs: Record<
        | 'supply-chain-security'
        | 'commit-messages'
        | 'quality'
        | 'windows-tests'
        | 'portable-tests'
        | 'real-chrome-tests',
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

test('weekly CI runs the same supply-chain-first gates on the default branch', () => {
    assert.deepEqual(workflow.on.schedule, [{ cron: '17 1 * * 1' }]);
    assert.equal(workflow.jobs.quality.needs, 'supply-chain-security');
    assert.equal(workflow.jobs['commit-messages'].needs, 'supply-chain-security');
});

test('CI workflow has read-only triggers, concurrency, and exact job display names', () => {
    assert.equal(Object.hasOwn(workflow.on, 'push'), true);
    assert.deepEqual(workflow.on.push, { branches: ['**'] });
    assert.equal(Object.hasOwn(workflow.on, 'workflow_call'), true);
    assert.deepEqual(workflow.on.pull_request.branches, ['main']);
    assert.deepEqual(workflow.on.pull_request.types, ['opened', 'reopened', 'synchronize', 'edited']);
    assert.equal(Object.hasOwn(workflow.on, 'workflow_dispatch'), true);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.concurrency['cancel-in-progress'], true);
    assert.deepEqual(
        Object.values(workflow.jobs).map((job) => job.name),
        [
            'Supply chain security',
            'Commit messages',
            'Quality',
            'Windows tests',
            `Portable tests (\${{ matrix.os }})`,
            `Real Chrome (\${{ matrix.os }})`,
        ],
    );
    assert.equal(workflow.jobs['commit-messages'].needs, 'supply-chain-security');
    assert.equal(workflow.jobs.quality.needs, 'supply-chain-security');
    assert.equal(workflow.jobs['windows-tests'].needs, 'quality');
});

test('release workflow publishes new stable and prerelease candidate tags after the same-commit reusable CI', async () => {
    const releaseSource = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    const release: unknown = parse(releaseSource);
    assert.ok(isRecord(release) && isRecord(release.on) && isRecord(release.jobs));
    assert.deepEqual(release.on, { push: { tags: ['v[0-9]+.[0-9]+.[0-9]+', 'v[0-9]+.[0-9]+.[0-9]+-*'] } });
    assert.deepEqual(release.permissions, { contents: 'read' });
    assert.deepEqual(release.concurrency, { group: `release-\${{ github.ref }}`, 'cancel-in-progress': false });
    const verify: unknown = release.jobs.verify;
    const publish: unknown = release.jobs.publish;
    assert.ok(isRecord(verify) && isRecord(publish) && Array.isArray(publish.steps));
    assert.equal(verify.uses, './.github/workflows/ci.yml');
    assert.equal(verify.if, 'github.event.created && !github.event.deleted && !github.event.forced');
    assert.deepEqual(verify.permissions, { contents: 'read' });
    assert.equal(publish.needs, 'verify');
    assert.equal(publish['runs-on'], 'ubuntu-latest');
    assert.deepEqual(publish.permissions, { contents: 'write' });
    assert.equal(publish['continue-on-error'], undefined);
    const steps: Record<string, unknown>[] = [];
    for (const value of publish.steps) {
        assert.ok(isRecord(value));
        assert.equal(value['continue-on-error'], undefined);
        steps.push(value);
    }
    const checkout = steps.find((step) => String(step.uses).startsWith('actions/checkout@'));
    assert.deepEqual(checkout?.with, { 'fetch-depth': 0, ref: `\${{ github.sha }}`, 'persist-credentials': false });
    const approved = new Set([
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
    ]);
    for (const step of steps.filter((step) => step.uses !== undefined)) assert.ok(approved.has(String(step.uses)));
    assert.deepEqual(steps.find((step) => String(step.uses).startsWith('pnpm/action-setup@'))?.with, {
        version: '12.4.2',
    });
    assert.deepEqual(steps.find((step) => String(step.uses).startsWith('actions/setup-node@'))?.with, {
        'node-version': '24.21.0',
        cache: 'pnpm',
    });
    const install = steps.findIndex((step) => step.run === 'pnpm install --frozen-lockfile');
    const publishStep = steps.findIndex((step) => step.run === 'node tooling/release.ts');
    assert.ok(install >= 0 && publishStep > install);
    assert.deepEqual(steps[publishStep]?.env, { GH_TOKEN: `\${{ github.token }}` });
    assert.doesNotMatch(
        releaseSource,
        /immutable-releases|upload-artifact|upload-release|secrets\.|always\(|continue-on-error/,
    );
    assert.match(releaseSource, /PNPM_CONFIG_IGNORE_PNPMFILE: "true"/);
    assert.match(releaseSource, /PNPM_CONFIG_CONFIG_DEPENDENCIES: "\{\}"/);
});

test('CI workflow uses only the approved action pins and uploads no artifacts', () => {
    const approved = new Set([
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
    ]);
    const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.map((step) => step.uses).filter(Boolean));
    assert.equal(uses.length, 18);
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

test('real Chrome CI requires both actual desktop browsers and preserves the audit-first boundary', () => {
    const job = workflow.jobs['real-chrome-tests'];
    assert.ok(job, 'Real Chrome acceptance must be part of reusable CI.');
    assert.equal(job.needs, 'quality');
    assert.equal(job['continue-on-error'], undefined);
    assert.equal(job.strategy?.['fail-fast'], false);
    assert.deepEqual(job.strategy?.matrix.include, [
        { os: 'ubuntu-24.04', chrome: '/opt/google/chrome/chrome' },
        { os: 'macos-15', chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    ]);
    assert.equal(job.env?.DCT_SMOKE_CHROME_EXECUTABLE, `\${{ matrix.chrome }}`);
    const commands = job.steps.map((step) => step.run ?? '').join('\n');
    assert.match(commands, /pnpm install --frozen-lockfile/);
    assert.match(commands, /pnpm typecheck/);
    assert.ok(commands.indexOf('pnpm typecheck') < commands.indexOf('node tests/smoke/official-server.ts'));
    const linux = job.steps.find((step) => step.if === "runner.os == 'Linux'");
    const mac = job.steps.find((step) => step.if === "runner.os == 'macOS'");
    assert.ok(linux?.run && mac?.run);
    for (const script of ['official-server', 'entry-recovery']) {
        assert.match(linux.run, new RegExp(`xvfb-run -a node tests/smoke/${script}\\.ts`));
        assert.match(mac.run, new RegExp(`node tests/smoke/${script}\\.ts`));
    }
    assert.doesNotMatch(mac.run, /xvfb/);
    assert.ok(job.steps.every((step) => step['continue-on-error'] !== true));
    assert.doesNotMatch(commands, /--no-sandbox|--headless|kill -9|pkill|download|apt-get|brew install/);
});
