import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { isAlias, isNode, parse, parseDocument, visit } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';

interface WorkflowStep {
    name?: string;
    id?: string;
    with?: Record<string, unknown>;
    uses?: string;
    run?: string;
    if?: string;
    shell?: string;
    env?: Record<string, string>;
    'continue-on-error'?: boolean;
}
interface WorkflowJob {
    name: string;
    'runs-on': string;
    steps: WorkflowStep[];
    if?: string;
    needs?: string | string[];
    outputs?: Record<string, string>;
    'timeout-minutes'?: number;
    env?: Record<string, string>;
    strategy?: {
        'fail-fast'?: boolean;
        matrix: {
            include?: ({ os: string; chrome: string } | { slot: number; block: number; readaheadKb: number })[];
            block?: number[];
            fileLogging?: string[];
        };
    };
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
    concurrency: { group: string; 'cancel-in-progress': boolean | string };
    jobs: Record<
        | 'supply-chain-security'
        | 'commit-messages'
        | 'quality'
        | 'node-compatibility'
        | 'windows-tests'
        | 'portable-tests'
        | 'real-chrome-tests'
        | 'ubuntu-startup-study'
        | 'ubuntu-readahead-study'
        | `ubuntu-first-start-assessment-${1 | 2 | 3 | 4 | 5 | 6}`,
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

const workflowUrl = new URL('../.github/workflows/ci.yaml', import.meta.url);
const source = await readFile(workflowUrl, 'utf8');
const workflow = readWorkflow(source);

const assessmentIds = [
    'ubuntu-first-start-assessment-1',
    'ubuntu-first-start-assessment-2',
    'ubuntu-first-start-assessment-3',
    'ubuntu-first-start-assessment-4',
    'ubuntu-first-start-assessment-5',
    'ubuntu-first-start-assessment-6',
] as const;

function evaluate(condition: string | undefined, context: Record<string, unknown>): unknown {
    assert.ok(condition);
    const expression = condition
        .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
        .replace(/\.([a-zA-Z_][\w-]*)/g, (_match, key: string) => `[${JSON.stringify(key)}]`);
    return runInNewContext(expression, {
        success: () => true,
        failure: () => false,
        cancelled: () => false,
        ...context,
    });
}

test('assessment dispatch has six literal serial positions and final predecessor result gates', () => {
    visit(parseDocument(source), (_key, node) => {
        if (!isNode(node)) return;
        assert.equal(isAlias(node), false);
        if ('anchor' in node) assert.equal(node.anchor, undefined);
    });
    assert.deepEqual(
        Object.keys(workflow.jobs).filter((id) => id.startsWith('ubuntu-first-start-assessment-')),
        assessmentIds,
    );
    for (const [index, id] of assessmentIds.entries()) {
        const job = workflow.jobs[id];
        assert.ok(job, id);
        const predecessor = assessmentIds[index - 1];
        assert.deepEqual(job.needs, predecessor ? ['quality', predecessor] : 'quality');
        assert.equal(job['runs-on'], 'ubuntu-24.04');
        assert.equal(job['timeout-minutes'], 20);
        assert.equal(job.strategy, undefined);
        assert.equal(job['continue-on-error'], undefined);
        assert.doesNotMatch(job.if ?? '', /always\(/);
        const context = {
            github: { event_name: 'workflow_dispatch', run_attempt: 1 },
            inputs: {
                'ubuntu-first-start-assessment': true,
                'ubuntu-startup-study': false,
                'ubuntu-readahead-study': false,
            },
            needs: {
                quality: { result: 'success' },
                ...(predecessor
                    ? { [predecessor]: { result: 'success', outputs: { 'safe-to-continue': 'true' } } }
                    : {}),
            },
        };
        assert.equal(evaluate(job.if, context), true, id);
        for (const event_name of ['push', 'pull_request', 'workflow_call', 'schedule']) {
            assert.equal(evaluate(job.if, { ...context, github: { event_name, run_attempt: 1 } }), false);
        }
        assert.equal(
            evaluate(job.if, { ...context, github: { event_name: 'workflow_dispatch', run_attempt: 2 } }),
            false,
        );
        for (const selector of ['ubuntu-first-start-assessment', 'ubuntu-startup-study', 'ubuntu-readahead-study']) {
            assert.equal(
                evaluate(job.if, {
                    ...context,
                    inputs: { ...context.inputs, [selector]: selector !== 'ubuntu-first-start-assessment' },
                }),
                false,
            );
        }
        for (const result of ['failure', 'cancelled', 'skipped']) {
            assert.equal(evaluate(job.if, { ...context, needs: { ...context.needs, quality: { result } } }), false);
            if (predecessor)
                assert.equal(
                    evaluate(job.if, {
                        ...context,
                        needs: { ...context.needs, [predecessor]: { result, outputs: { 'safe-to-continue': 'true' } } },
                    }),
                    false,
                );
        }
        if (predecessor) {
            for (const output of [undefined, '', 'false', 'TRUE']) {
                assert.equal(
                    evaluate(job.if, {
                        ...context,
                        needs: {
                            ...context.needs,
                            [predecessor]: { result: 'success', outputs: { 'safe-to-continue': output } },
                        },
                    }),
                    false,
                );
            }
        }
    }
});

test('assessment selectors and exact source are validated by Quality before dependent Chrome', () => {
    const quality = workflow.jobs.quality;
    const gate = quality.steps.find((step) => step.run === 'node tests/smoke/first-start-assessment-ci.ts quality');
    assert.ok(gate);
    assert.equal(gate.if, undefined);
    assert.equal(gate['continue-on-error'], undefined);
    assert.ok(
        quality.steps.findIndex((step) => step.uses?.startsWith('actions/checkout@')) < quality.steps.indexOf(gate),
    );
    assert.equal(gate.env?.DCT_ASSESSMENT_ENABLED, `\${{ toJSON(inputs['ubuntu-first-start-assessment'] == true) }}`);
    assert.equal(gate.env?.DCT_ASSESSMENT_STARTUP_STUDY, `\${{ toJSON(inputs['ubuntu-startup-study'] == true) }}`);
    assert.equal(gate.env?.DCT_ASSESSMENT_READAHEAD_STUDY, `\${{ toJSON(inputs['ubuntu-readahead-study'] == true) }}`);
    assert.equal(gate.env?.DCT_ASSESSMENT_SOURCE_SHA, `\${{ inputs['assessment-source-sha'] }}`);
    assert.equal(gate.env?.DCT_ASSESSMENT_SOURCE_TREE, `\${{ inputs['assessment-source-tree'] }}`);
    assert.equal(gate.env?.DCT_ASSESSMENT_ROUND_ID, `\${{ inputs['assessment-round-id'] }}`);
    assert.equal(gate.env?.GITHUB_WORKFLOW_REF, undefined);
    const dispatch = workflow.on.workflow_dispatch;
    assert.ok(isRecord(dispatch) && isRecord(dispatch.inputs));
    assert.deepEqual(dispatch.inputs['ubuntu-first-start-assessment'], {
        description: 'Run the bounded current-version first-start assessment (six serial fresh runners)',
        type: 'boolean',
        required: false,
        default: false,
    });
    for (const input of ['assessment-round-id', 'assessment-source-sha', 'assessment-source-tree']) {
        const value: unknown = dispatch.inputs[input];
        assert.ok(isRecord(value));
        assert.equal(value.type, 'string');
        assert.equal(value.required, false);
        assert.equal(value.default, '');
    }
    assert.doesNotMatch(gate.run ?? '', /\$\{\{/);
});

test('assessment concurrency isolates its run without changing ordinary or legacy study cancellation', () => {
    const format = (template: string, ...values: unknown[]) =>
        template.replace(/\{(\d+)\}/g, (_match, index: string) => String(values[Number(index)]));
    for (const event_name of ['workflow_dispatch', 'push', 'pull_request', 'schedule', 'workflow_call']) {
        for (const assessment of [false, true]) {
            for (const study of [false, true]) {
                const context = {
                    github: { event_name, workflow: 'CI', run_id: '1234', ref: 'refs/heads/fix/chrome-startup-stall' },
                    inputs: {
                        'ubuntu-first-start-assessment': assessment,
                        'ubuntu-startup-study': study,
                        'ubuntu-readahead-study': false,
                    },
                    format,
                };
                const selected = event_name === 'workflow_dispatch' && assessment;
                assert.equal(
                    evaluate(workflow.concurrency.group, context),
                    selected
                        ? 'ci-first-start-assessment-CI-1234'
                        : event_name === 'workflow_dispatch' && study
                          ? 'ci-startup-study-CI-1234'
                          : 'ci-CI-refs/heads/fix/chrome-startup-stall',
                );
                assert.equal(
                    typeof workflow.concurrency['cancel-in-progress'] === 'string'
                        ? evaluate(workflow.concurrency['cancel-in-progress'], context)
                        : workflow.concurrency['cancel-in-progress'],
                    !selected,
                );
            }
        }
    }
});

test('assessment complete upload and successor output require every prior step success', () => {
    const files = [
        'job-index.json',
        'official-server.events.ndjson',
        'official-server.summary.json',
        'entry-recovery.events.ndjson',
        'entry-recovery.summary.json',
    ];
    for (const [index, id] of assessmentIds.entries()) {
        const job = workflow.jobs[id];
        assert.ok(job, id);
        const steps = Object.fromEntries(job.steps.filter((step) => step.id).map((step) => [step.id, step]));
        const ordered = ['assessment', 'pre-upload', 'fixture-artifact', 'fixture-index', 'postcheck'];
        const positions = ordered.map((stepId) => job.steps.findIndex((step) => step.id === stepId));
        assert.ok(
            positions.every(
                (position, index) => position >= 0 && (index === 0 || position > (positions[index - 1] ?? Infinity)),
            ),
        );
        const contextSteps = Object.fromEntries(
            ['fixture-initialization', ...ordered].map((step) => [
                step,
                {
                    outcome: 'success',
                    conclusion: 'success',
                    outputs: {
                        initialized: 'true',
                        'metadata-token': 'a'.repeat(64),
                        'safe-to-continue': 'true',
                        'artifact-id': '123',
                        'artifact-url': 'https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/1/artifacts/123',
                    },
                },
            ]),
        );
        for (const [position, stepId] of ordered.entries()) {
            const step = steps[stepId];
            assert.ok(step, `${id}/${stepId}`);
            assert.equal(step['continue-on-error'], undefined);
            assert.equal(evaluate(step.if, { steps: contextSteps }), true);
            assert.equal(evaluate(step.if, { steps: contextSteps, success: () => false }), false);
            assert.equal(evaluate(step.if, { steps: contextSteps, cancelled: () => true }), false);
            for (const prior of ['fixture-initialization', ...ordered.slice(0, position)]) {
                for (const field of ['outcome', 'conclusion']) {
                    for (const status of ['failure', 'cancelled', 'skipped']) {
                        assert.equal(
                            evaluate(step.if, {
                                steps: { ...contextSteps, [prior]: { ...contextSteps[prior], [field]: status } },
                            }),
                            false,
                            `${id}/${stepId}/${prior}/${field}/${status}`,
                        );
                    }
                }
            }
        }
        const preflight = steps['pre-upload'];
        const postcheck = steps.postcheck;
        assert.equal(
            preflight?.run,
            `node tests/smoke/first-start-assessment-ci.ts pre-upload "$RUNNER_TEMP/dct-fixture-diagnostics" --assessment-slot ${index + 1}`,
        );
        assert.equal(
            postcheck?.run,
            `node tests/smoke/first-start-assessment-ci.ts postcheck "$RUNNER_TEMP/dct-fixture-diagnostics" --assessment-slot ${index + 1}`,
        );
        assert.equal(postcheck?.env?.DCT_ASSESSMENT_METADATA_TOKEN, `\${{ steps.pre-upload.outputs.metadata-token }}`);
        assert.deepEqual(job.outputs, {
            'safe-to-continue': `\${{ steps.assessment.outcome == 'success' && steps.assessment.conclusion == 'success' && steps.pre-upload.outcome == 'success' && steps.pre-upload.conclusion == 'success' && steps.fixture-artifact.outcome == 'success' && steps.fixture-artifact.conclusion == 'success' && steps.fixture-index.outcome == 'success' && steps.fixture-index.conclusion == 'success' && steps.postcheck.outcome == 'success' && steps.postcheck.conclusion == 'success' && steps.postcheck.outputs.safe-to-continue == 'true' && 'true' || 'false' }}`,
        });
        for (const uploadId of ['fixture-artifact', 'partial-artifact']) {
            const upload = steps[uploadId];
            assert.equal(upload?.uses, 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9');
            assert.equal(
                upload?.with?.path,
                `${files.map((file) => `\${{ runner.temp }}/dct-fixture-diagnostics/${file}`).join('\n')}\n`,
            );
            assert.equal(upload?.with?.['retention-days'], 7);
            assert.equal(upload?.with?.['include-hidden-files'], false);
            assert.equal(upload?.with?.overwrite, false);
            assert.equal(upload?.with?.['if-no-files-found'], 'error');
        }
        // GitHub expressions evaluate an absent output property as the empty string.
        assert.equal(
            evaluate(steps['fixture-artifact']?.if, {
                steps: {
                    ...contextSteps,
                    'pre-upload': { ...contextSteps['pre-upload'], outputs: { 'metadata-token': '' } },
                },
            }),
            false,
        );
        assert.equal(evaluate(job.outputs?.['safe-to-continue'], { steps: contextSteps }), 'true');
        for (const stepId of ordered) {
            for (const field of ['outcome', 'conclusion']) {
                for (const status of ['failure', 'cancelled', 'skipped']) {
                    assert.equal(
                        evaluate(job.outputs?.['safe-to-continue'], {
                            steps: { ...contextSteps, [stepId]: { ...contextSteps[stepId], [field]: status } },
                        }),
                        'false',
                    );
                }
            }
        }
        for (const output of ['', 'false', 'TRUE']) {
            assert.equal(
                evaluate(job.outputs?.['safe-to-continue'], {
                    steps: {
                        ...contextSteps,
                        postcheck: { ...contextSteps.postcheck, outputs: { 'safe-to-continue': output } },
                    },
                }),
                'false',
            );
        }
        for (const field of ['artifact-id', 'artifact-url']) {
            for (const stepId of ['fixture-index', 'postcheck']) {
                assert.equal(
                    evaluate(steps[stepId]?.if, {
                        steps: {
                            ...contextSteps,
                            'fixture-artifact': {
                                ...contextSteps['fixture-artifact'],
                                outputs: { ...contextSteps['fixture-artifact']?.outputs, [field]: '' },
                            },
                        },
                    }),
                    false,
                    `missing upload ${field} cannot reach ${stepId}`,
                );
            }
        }
        const commands = job.steps.map((step) => step.run ?? '').join('\n');
        assert.equal(commands.match(/node tests\/smoke\/official-server\.ts/g)?.length, 1);
        assert.match(
            steps.assessment?.run ?? '',
            new RegExp(`--first-start-assessment --assessment-slot ${index + 1} `),
        );
        assert.doesNotMatch(
            commands,
            /entry-recovery\.ts|\$\{\{|--startup-study|--readahead-kb|--version|sha256|warmup|retry|kill|apt-get|download/,
        );
        assert.equal(job.env?.GITHUB_WORKFLOW_REF, undefined);
        assert.equal(
            job.env?.DCT_ASSESSMENT_ENABLED,
            `\${{ toJSON(inputs['ubuntu-first-start-assessment'] == true) }}`,
        );
        assert.equal(job.env?.DCT_ASSESSMENT_SOURCE_SHA, `\${{ inputs['assessment-source-sha'] }}`);
        assert.equal(job.env?.DCT_ASSESSMENT_SOURCE_TREE, `\${{ inputs['assessment-source-tree'] }}`);
        assert.equal(job.env?.DCT_ASSESSMENT_ROUND_ID, `\${{ inputs['assessment-round-id'] }}`);
        assert.equal(
            steps.assessment?.env?.DCT_ASSESSMENT_COLLECTION_ID,
            `\${{ steps.fixture-initialization.outputs.collection-id }}`,
        );
    }
});

test('failed assessment evidence uses separate bounded ownership and never enables continuation', () => {
    for (const [index, id] of assessmentIds.entries()) {
        const job = workflow.jobs[id];
        assert.ok(job, id);
        const steps = Object.fromEntries(job.steps.filter((step) => step.id).map((step) => [step.id, step]));
        const context = {
            failure: () => true,
            success: () => false,
            steps: {
                'fixture-initialization': {
                    outcome: 'success',
                    conclusion: 'success',
                    outputs: { initialized: 'true' },
                },
                assessment: { outcome: 'failure', conclusion: 'failure' },
                'pre-upload': { outcome: 'skipped', conclusion: 'skipped' },
                'partial-upload': {
                    outcome: 'success',
                    conclusion: 'success',
                    outputs: { 'partial-eligible': 'true' },
                },
                'partial-artifact': { outcome: 'success', conclusion: 'success' },
            },
        };
        for (const stepId of ['partial-upload', 'partial-artifact', 'partial-index']) {
            assert.equal(evaluate(steps[stepId]?.if, context), true);
            assert.equal(evaluate(steps[stepId]?.if, { ...context, cancelled: () => true }), false);
            assert.equal(evaluate(steps[stepId]?.if, { ...context, failure: () => false }), false);
        }
        assert.equal(
            steps['partial-upload']?.run,
            `node tests/smoke/first-start-assessment-ci.ts partial-upload "$RUNNER_TEMP/dct-fixture-diagnostics" --assessment-slot ${index + 1}`,
        );
        assert.equal(
            evaluate(steps['partial-artifact']?.if, {
                ...context,
                steps: {
                    ...context.steps,
                    'partial-upload': {
                        outcome: 'failure',
                        conclusion: 'failure',
                        outputs: { 'partial-eligible': 'true' },
                    },
                },
            }),
            false,
        );
        assert.equal(
            evaluate(steps['partial-index']?.if, {
                ...context,
                steps: { ...context.steps, 'partial-artifact': { outcome: 'failure', conclusion: 'failure' } },
            }),
            false,
        );
        assert.doesNotMatch(job.outputs?.['safe-to-continue'] ?? '', /partial/);
    }
});

test('assessment partial acquisition refuses every attempted complete preflight', () => {
    for (const id of assessmentIds) {
        const job = workflow.jobs[id];
        const steps = Object.fromEntries(job.steps.filter((step) => step.id).map((step) => [step.id, step]));
        for (const assessment of ['success', 'failure', 'skipped', 'cancelled']) {
            for (const preflight of ['success', 'failure', 'cancelled', 'skipped']) {
                for (const token of ['', 'a'.repeat(64)]) {
                    const context = {
                        failure: () => true,
                        success: () => false,
                        steps: {
                            'fixture-initialization': {
                                outcome: 'success',
                                conclusion: 'success',
                                outputs: { initialized: 'true' },
                            },
                            assessment: { outcome: assessment, conclusion: assessment },
                            'pre-upload': {
                                outcome: preflight,
                                conclusion: preflight,
                                outputs: { 'metadata-token': token },
                            },
                            'partial-upload': {
                                outcome: 'success',
                                conclusion: 'success',
                                outputs: { 'partial-eligible': 'true' },
                            },
                            'partial-artifact': { outcome: 'success', conclusion: 'success' },
                        },
                    };
                    for (const stepId of ['partial-upload', 'partial-artifact', 'partial-index']) {
                        assert.equal(
                            evaluate(steps[stepId]?.if, context),
                            assessment === 'failure' && preflight === 'skipped',
                            `${id}/${stepId}/assessment=${assessment}/preflight=${preflight}/token=${token !== ''}; failed preflight includes late GITHUB_OUTPUT write failure after JSON acquisition`,
                        );
                    }
                }
            }
        }
    }
});

test('assessment index wrapper rejects successful-exit fallback and accepts existing known limitations', () => {
    const index = workflow.jobs['ubuntu-first-start-assessment-1']?.steps.find((step) => step.id === 'fixture-index');
    assert.ok(index?.run);
    const directory = mkdtempSync(path.join(os.tmpdir(), 'dct-ci-index-'));
    const summary = path.join(directory, 'step-summary');
    const calls = path.join(directory, 'calls');
    const bash =
        process.platform === 'win32'
            ? path.resolve(
                  execFileSync('git', ['--exec-path'], { encoding: 'utf8', shell: false }).trim(),
                  '../../../bin/bash.exe',
              )
            : 'bash';
    const valid = [
        'Controlled Chrome diagnostics',
        '',
        'Job stage: official-server.',
        '',
        'official-server: passed; official-server.summary.json; official-server.events.ndjson',
        '',
        'Diagnostic limitation: unavailable, incomplete or truncated evidence.',
        '',
        'Failed first-start capture: retained=0; omitted=0; limitations=self-report-write-unavailable.',
        '',
        'entry-recovery: not-run; entry-recovery.summary.json; entry-recovery.events.ndjson',
        '',
        'Files: job-index.json, official-server.events.ndjson, official-server.summary.json, entry-recovery.events.ndjson, entry-recovery.summary.json',
    ].join('\n');
    const boundary = `node() {
    printf 'call\\n' >> "$DCT_TEST_INDEX_CALLS"
    if [ "$#" -ne 4 ] || [ "$1" != 'tests/smoke/fixture-ci.ts' ] || [ "$2" != 'summary' ] || [ "$3" != "$RUNNER_TEMP/dct-fixture-diagnostics" ] || [ "$4" != "$DCT_ASSESSMENT_COLLECTION_ID" ]; then return 99; fi
    if [ -n "$GITHUB_STEP_SUMMARY" ]; then printf '%s\\n' "$DCT_TEST_INDEX_TEXT" >> "$GITHUB_STEP_SUMMARY"; else printf '%s\\n' "$DCT_TEST_INDEX_TEXT"; fi
    return "$DCT_TEST_INDEX_STATUS"
}
`;
    const run = (text: string, status = 0, destination = summary, wrapper = index.run) => {
        writeFileSync(summary, 'existing summary\n');
        writeFileSync(calls, '');
        const result = spawnSync(bash, ['--noprofile', '--norc', '-c', boundary + wrapper], {
            env: {
                ...process.env,
                RUNNER_TEMP: directory,
                GITHUB_STEP_SUMMARY: destination,
                DCT_ASSESSMENT_COLLECTION_ID: 'literal-$(never-evaluate)-collection',
                DCT_TEST_INDEX_TEXT: text,
                DCT_TEST_INDEX_STATUS: String(status),
                DCT_TEST_INDEX_CALLS: calls,
            },
            encoding: 'utf8',
            timeout: 10_000,
        });
        assert.equal(result.error, undefined);
        assert.equal(readFileSync(calls, 'utf8'), 'call\n', 'one existing summary invocation');
        return result;
    };
    try {
        // Exact held presentation from the unchanged CLI with transient EMFILE at
        // official-server.events.ndjson open; all five source files stayed unchanged.
        const eventReadFallback = [
            'Controlled Chrome diagnostics',
            '',
            'Job stage: official-server.',
            '',
            'official-server: passed; official-server.summary.json; official-server.events.ndjson',
            '',
            'Runtime boundary: unavailable; operation: unavailable; gateway events: 0.',
            '',
            'Stream evidence is incomplete or limited.',
            '',
            'Failed first-start capture: retained=0; omitted=0; limitations=selection-missing,outcome-missing,terminal-missing,self-report-write-unavailable,writer-cost-missing.',
            '',
            'This presentation rereads completed evidence; its analysis I/O is separate from startup collector cost.',
            '',
            'Diagnostic limitation: unavailable, incomplete or truncated evidence.',
            '',
            'entry-recovery: not-run; entry-recovery.summary.json; entry-recovery.events.ndjson',
            '',
            'Files: job-index.json, official-server.events.ndjson, official-server.summary.json, entry-recovery.events.ndjson, entry-recovery.summary.json',
            '',
        ].join('\n');
        for (const id of assessmentIds) {
            const wrapper = workflow.jobs[id].steps.find((step) => step.id === 'fixture-index')?.run;
            assert.ok(wrapper);
            for (const fallback of [
                eventReadFallback,
                ...[
                    'selection-missing',
                    'outcome-missing',
                    'terminal-missing',
                    'writer-cost-missing',
                    'unsupported',
                ].map((limitation) =>
                    valid.replace('limitations=self-report-write-unavailable.', `limitations=${limitation}.`),
                ),
                valid.replace('Failed first-start capture:', 'Missing capture:'),
                `${valid}\nFailed first-start capture: retained=0; omitted=0; limitations=none.`,
            ]) {
                assert.notEqual(run(fallback, 0, summary, wrapper).status, 0, `${id}: unavailable capture rejected`);
                assert.equal(readFileSync(summary, 'utf8'), 'existing summary\n');
            }
            for (const allowed of [
                valid,
                valid.replace('limitations=self-report-write-unavailable.', 'limitations=none.'),
            ]) {
                assert.equal(run(allowed, 0, summary, wrapper).status, 0, `${id}: known capture presentation accepted`);
                assert.equal(readFileSync(summary, 'utf8'), `existing summary\n${allowed}\n`);
            }
        }
        assert.equal(run(valid).status, 0);
        assert.equal(readFileSync(summary, 'utf8'), `existing summary\n${valid}\n`);
        assert.equal(
            run(
                `${valid}\n\n[Diagnostic artifact](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/1/artifacts/2)`,
            ).status,
            0,
        );
        for (const fallback of [
            'Diagnostic limitation: current collection unavailable; prior evidence was preserved and is excluded.',
            valid.replace('Job stage: official-server.', 'Job index unavailable.'),
            `${valid}\nofficial-server: diagnostic file unavailable; not-run state unverified.`,
            `${valid}\nentry-recovery: diagnostic file unavailable; not-run state unverified.`,
            ...[
                'Controlled Chrome diagnostics',
                'Job stage: official-server.',
                'official-server: passed;',
                'entry-recovery: not-run;',
                'Files: job-index.json,',
            ].map((marker) => valid.replace(marker, 'missing')),
        ]) {
            const result = run(fallback);
            assert.notEqual(result.status, 0);
            assert.equal(readFileSync(summary, 'utf8'), 'existing summary\n');
            assert.equal(result.stdout, '');
        }
        assert.notEqual(run(valid, 7).status, 0);
        assert.equal(readFileSync(summary, 'utf8'), 'existing summary\n');
        assert.notEqual(run(valid, 0, directory).status, 0, 'append failure blocks continuation');
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('Ubuntu startup study requires explicit manual opt-in and cannot cancel ordinary CI', () => {
    const dispatch = workflow.on.workflow_dispatch;
    assert.ok(isRecord(dispatch) && isRecord(dispatch.inputs));
    assert.deepEqual(
        {
            inputs: Object.fromEntries(
                Object.entries(dispatch.inputs).filter(
                    ([name]) => name === 'ubuntu-startup-study' || name === 'ubuntu-readahead-study',
                ),
            ),
        },
        {
            inputs: {
                'ubuntu-startup-study': {
                    description: 'Run the bounded Ubuntu first-start file-logging study (six fresh runners)',
                    type: 'boolean',
                    required: false,
                    default: false,
                },
                'ubuntu-readahead-study': {
                    description: 'Run the bounded Ubuntu queue readahead study (six fresh runners)',
                    type: 'boolean',
                    required: false,
                    default: false,
                },
            },
        },
    );
    assert.equal(
        workflow.jobs['ubuntu-startup-study']?.if,
        "github.event_name == 'workflow_dispatch' && inputs['ubuntu-startup-study'] == true && inputs['ubuntu-readahead-study'] != true && inputs['ubuntu-first-start-assessment'] != true",
    );
    assert.deepEqual(workflow.concurrency, {
        group: `\${{ github.event_name == 'workflow_dispatch' && inputs['ubuntu-first-start-assessment'] == true && format('ci-first-start-assessment-{0}-{1}', github.workflow, github.run_id) || github.event_name == 'workflow_dispatch' && (inputs['ubuntu-startup-study'] == true || inputs['ubuntu-readahead-study'] == true) && format('ci-startup-study-{0}-{1}', github.workflow, github.run_id) || format('ci-{0}-{1}', github.workflow, github.ref) }}`,
        'cancel-in-progress': `\${{ !(github.event_name == 'workflow_dispatch' && inputs['ubuntu-first-start-assessment'] == true) }}`,
    });
    for (const [name, job] of Object.entries(workflow.jobs)) {
        if (
            name === 'ubuntu-startup-study' ||
            name === 'ubuntu-readahead-study' ||
            name.startsWith('ubuntu-first-start-assessment-')
        )
            continue;
        assert.equal(job.if, undefined, name);
    }
});

test('research inputs are exclusive and conflicting dispatch fails before either research job can start Chrome', () => {
    const reject = workflow.jobs.quality.steps[0];
    assert.equal(reject?.name, 'Reject conflicting research inputs');
    assert.equal(reject?.shell, 'bash');
    assert.equal(reject?.run, "printf 'Select only one Ubuntu research mode.\\n' >&2\nexit 1\n");
    assert.equal(reject?.['continue-on-error'], undefined);
    const selected = (
        condition: string | undefined,
        event: string,
        logging: boolean,
        readahead: boolean,
        assessment = false,
    ): unknown => {
        assert.ok(condition);
        return runInNewContext(condition, {
            github: { event_name: event },
            inputs: {
                'ubuntu-startup-study': logging,
                'ubuntu-readahead-study': readahead,
                'ubuntu-first-start-assessment': assessment,
            },
        });
    };
    for (const [event, logging, readahead, oldRuns, newRuns, rejected] of [
        ['workflow_dispatch', false, false, false, false, false],
        ['workflow_dispatch', true, false, true, false, false],
        ['workflow_dispatch', false, true, false, true, false],
        ['workflow_dispatch', true, true, false, false, true],
        ['push', true, true, false, false, false],
        ['pull_request', false, true, false, false, false],
        ['schedule', false, true, false, false, false],
        ['workflow_call', false, true, false, false, false],
    ] as const) {
        assert.equal(selected(workflow.jobs['ubuntu-startup-study']?.if, event, logging, readahead), oldRuns);
        assert.equal(selected(workflow.jobs['ubuntu-readahead-study']?.if, event, logging, readahead), newRuns);
        assert.equal(selected(reject?.if, event, logging, readahead), rejected);
    }
    for (const logging of [false, true]) {
        for (const readahead of [false, true]) {
            assert.equal(
                selected(workflow.jobs['ubuntu-startup-study']?.if, 'workflow_dispatch', logging, readahead, true),
                false,
            );
            assert.equal(
                selected(workflow.jobs['ubuntu-readahead-study']?.if, 'workflow_dispatch', logging, readahead, true),
                false,
            );
            assert.equal(selected(reject?.if, 'workflow_dispatch', logging, readahead, true), logging || readahead);
        }
    }
});

test('Ubuntu readahead study freezes six quality-gated single-start allocations and controlled evidence', () => {
    const job = workflow.jobs['ubuntu-readahead-study'];
    assert.ok(job, 'The separate opt-in queue study must be present.');
    assert.equal(job.needs, 'quality');
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.equal(
        job.if,
        "github.event_name == 'workflow_dispatch' && inputs['ubuntu-readahead-study'] == true && inputs['ubuntu-startup-study'] != true && inputs['ubuntu-first-start-assessment'] != true",
    );
    assert.deepEqual(job.strategy, {
        'fail-fast': false,
        matrix: {
            include: [
                { slot: 1, block: 1, readaheadKb: 128 },
                { slot: 2, block: 1, readaheadKb: 1024 },
                { slot: 3, block: 2, readaheadKb: 1024 },
                { slot: 4, block: 2, readaheadKb: 128 },
                { slot: 5, block: 3, readaheadKb: 128 },
                { slot: 6, block: 3, readaheadKb: 1024 },
            ],
        },
    });
    assert.deepEqual(job.env, { DCT_SMOKE_CHROME_EXECUTABLE: '/opt/google/chrome/chrome' });
    assert.equal(Object.hasOwn(job, 'permissions'), false);
    assert.equal(job['continue-on-error'], undefined);
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
    const old = workflow.jobs['ubuntu-startup-study'];
    assert.deepEqual(job.steps.slice(0, 6), old.steps.slice(0, 6));
    const smoke = job.steps[6];
    assert.equal(smoke?.if, undefined);
    assert.equal(smoke?.shell, 'bash');
    assert.equal(
        smoke?.run,
        old.steps[6]?.run?.replace(
            `--chrome-file-logging "\${{ matrix.fileLogging }}"`,
            `--chrome-file-logging on --readahead-kb "\${{ matrix.readaheadKb }}"`,
        ),
    );
    const commands = job.steps.map((step) => step.run ?? '').join('\n');
    assert.equal(commands.match(/node tests\/smoke\/official-server\.ts/g)?.length, 1);
    assert.doesNotMatch(
        commands,
        /entry-recovery\.ts|--version|sha256|shasum|warmup|retry|--no-sandbox|--headless|kill -9|pkill|download|apt-get|brew install/,
    );
    const summary = job.steps[8];
    assert.equal(summary?.if, "always() && steps.fixture-initialization.outputs.initialized == 'true'");
    assert.deepEqual(summary?.env, old.steps[8]?.env);
    assert.equal(summary?.run, old.steps[8]?.run);
    assert.equal(job.steps.length, 9);
});

test('Ubuntu startup study has exactly six quality-gated fresh runner slots without ignored failures', () => {
    const job = workflow.jobs['ubuntu-startup-study'];
    assert.ok(job, 'The manually authorized study must be present.');
    assert.equal(job.needs, 'quality');
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.deepEqual(job.strategy, {
        'fail-fast': false,
        matrix: { block: [1, 2, 3], fileLogging: ['on', 'off'] },
    });
    assert.deepEqual(job.env, { DCT_SMOKE_CHROME_EXECUTABLE: '/opt/google/chrome/chrome' });
    assert.equal(Object.hasOwn(job, 'permissions'), false);
    assert.equal(job['continue-on-error'], undefined);
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
    const setup = job.steps.filter((step) => step.uses !== undefined);
    assert.deepEqual(
        setup.map((step) => step.uses),
        [
            'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
            'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
            'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
            'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9',
        ],
    );
    assert.deepEqual(job.steps.slice(0, 3), setup.slice(0, 3));
    assert.deepEqual(
        job.steps.slice(3, 5).map((step) => step.run),
        ['pnpm install --frozen-lockfile', 'pnpm typecheck'],
    );
});

test('Ubuntu startup study initializes current evidence and runs only one first-start smoke', () => {
    const job = workflow.jobs['ubuntu-startup-study'];
    assert.ok(job);
    const init = job.steps.find((step) => step.id === 'fixture-initialization');
    const normalInit = workflow.jobs['real-chrome-tests'].steps.find((step) => step.id === 'fixture-initialization');
    assert.deepEqual(init, normalInit, 'Study must retain current collection initialization and refusal semantics.');
    const smoke = job.steps.find((step) => step.name === 'Run one Ubuntu Chrome startup study sample');
    assert.equal(smoke?.if, undefined);
    assert.equal(smoke?.shell, 'bash');
    assert.deepEqual(smoke?.run?.trim().split('\n'), [
        'set -euo pipefail',
        `collectionId="\${{ steps.fixture-initialization.outputs.collection-id }}"`,
        'test -x "$DCT_SMOKE_CHROME_EXECUTABLE"',
        'command -v lsof',
        'command -v getconf',
        'command -v Xvfb',
        'command -v xvfb-run',
        'command -v xauth',
        'if node tests/smoke/fixture-ci.ts stage "$RUNNER_TEMP/dct-fixture-diagnostics" official-server "$collectionId"; then :; fi',
        `xvfb-run -a node tests/smoke/official-server.ts --allow-gui --startup-study --chrome-file-logging "\${{ matrix.fileLogging }}" --diagnostics "$RUNNER_TEMP/dct-fixture-diagnostics" --collection-id "$collectionId"`,
    ]);
    assert.ok(init && smoke && job.steps.indexOf(init) < job.steps.indexOf(smoke));
    const commands = job.steps.map((step) => step.run ?? '').join('\n');
    assert.equal(commands.match(/node tests\/smoke\/official-server\.ts/g)?.length, 1);
    assert.doesNotMatch(
        commands,
        /entry-recovery\.ts|--version|sha256|shasum|warmup|retry|--no-sandbox|--headless|kill -9|pkill|download|apt-get|brew install/,
    );
    const summary = job.steps.find((step) => step.name === 'Index Ubuntu startup study diagnostics');
    assert.equal(summary?.if, "always() && steps.fixture-initialization.outputs.initialized == 'true'");
    assert.deepEqual(summary?.env, { DCT_FIXTURE_ARTIFACT_URL: `\${{ steps.fixture-artifact.outputs.artifact-url }}` });
    assert.equal(
        summary?.run,
        `node tests/smoke/fixture-ci.ts summary "$RUNNER_TEMP/dct-fixture-diagnostics" "\${{ steps.fixture-initialization.outputs.collection-id }}"`,
    );
    const upload = job.steps.find((step) => step.id === 'fixture-artifact');
    assert.ok(upload && summary && job.steps.indexOf(upload) < job.steps.indexOf(summary));
    assert.equal(job.steps.length, 9);
});

test('latest Node 24 compatibility runs mandatory Ubuntu checks after the canonical quality gate', () => {
    const job = workflow.jobs['node-compatibility'];
    assert.ok(job, 'Latest Node 24 compatibility must be part of reusable CI.');
    assert.equal(job.name, 'Node compatibility (24.x)');
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.equal(job.needs, 'quality');
    for (const key of ['if', 'continue-on-error', 'permissions', 'strategy']) {
        assert.equal(Object.hasOwn(job, key), false, key);
    }
    for (const step of job.steps) {
        assert.equal(Object.hasOwn(step, 'if'), false);
        assert.equal(Object.hasOwn(step, 'continue-on-error'), false);
    }
    const setup = job.steps.filter((step) => step.uses !== undefined);
    assert.deepEqual(
        setup.map((step) => step.uses),
        [
            'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
            'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
            'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        ],
    );
    assert.deepEqual(setup[1]?.with, { version: '12.4.2' });
    assert.deepEqual(setup[2]?.with, { 'node-version': '24.x', 'check-latest': true, cache: 'pnpm' });
    assert.deepEqual(job.steps.slice(0, 3), setup);
    assert.deepEqual(
        job.steps.slice(3).map((step) => step.run),
        [
            'pnpm install --frozen-lockfile',
            'pnpm typecheck',
            'pnpm test',
            'pnpm check:build',
            'pnpm check:security:build',
            'pnpm smoke:official',
        ],
    );
});

test('canonical CI jobs retain the exact Node baseline and pnpm version', () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
        if (name === 'node-compatibility') continue;
        const node = job.steps.filter((step) => step.uses?.startsWith('actions/setup-node@'));
        const pnpm = job.steps.filter((step) => step.uses?.startsWith('pnpm/action-setup@'));
        assert.equal(node.length, 1, name);
        assert.equal(pnpm.length, 1, name);
        assert.deepEqual(node[0]?.with, { 'node-version': '24.21.0', cache: 'pnpm' }, name);
        assert.deepEqual(pnpm[0]?.with, { version: '12.4.2' }, name);
    }
});

test('Windows CI requires separate default and interactive lanes unconditionally after typecheck', () => {
    const job = workflow.jobs['windows-tests'];
    assert.equal(job.name, 'Windows tests');
    assert.equal(job.needs, 'quality');
    assert.equal(Object.hasOwn(job, 'if'), false);
    assert.equal(Object.hasOwn(job, 'continue-on-error'), false);
    for (const step of job.steps) {
        assert.equal(Object.hasOwn(step, 'if'), false);
        assert.equal(Object.hasOwn(step, 'continue-on-error'), false);
    }
    const typecheck = job.steps.findIndex((step) => step.run === 'pnpm typecheck');
    assert.ok(typecheck >= 0);
    for (const command of ['pnpm test', 'pnpm test:windows:interactive --allow-gui']) {
        const matches = job.steps.flatMap((step, index) => (step.run === command ? [index] : []));
        assert.equal(matches.length, 1, command);
        assert.ok(matches[0] !== undefined && matches[0] > typecheck, command);
    }
});

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
    assert.equal(
        evaluate(String(workflow.concurrency['cancel-in-progress']), { github: { event_name: 'push' }, inputs: {} }),
        true,
    );
    assert.deepEqual(
        Object.values(workflow.jobs).map((job) => job.name),
        [
            'Supply chain security',
            'Commit messages',
            'Quality',
            'Node compatibility (24.x)',
            'Windows tests',
            `Portable tests (\${{ matrix.os }})`,
            `Real Chrome (\${{ matrix.os }})`,
            `Ubuntu startup study (block \${{ matrix.block }}, file logging \${{ matrix.fileLogging }})`,
            `Ubuntu readahead study (slot \${{ matrix.slot }}, block \${{ matrix.block }}, RA \${{ matrix.readaheadKb }} KiB)`,
            'Ubuntu first-start assessment (slot 1)',
            'Ubuntu first-start assessment (slot 2)',
            'Ubuntu first-start assessment (slot 3)',
            'Ubuntu first-start assessment (slot 4)',
            'Ubuntu first-start assessment (slot 5)',
            'Ubuntu first-start assessment (slot 6)',
        ],
    );
    assert.equal(workflow.jobs['commit-messages'].needs, 'supply-chain-security');
    assert.equal(workflow.jobs.quality.needs, 'supply-chain-security');
    assert.equal(workflow.jobs['windows-tests'].needs, 'quality');
});

test('release workflow publishes new stable and prerelease candidate tags after the same-commit reusable CI', async () => {
    const releaseSource = await readFile(new URL('../.github/workflows/release.yaml', import.meta.url), 'utf8');
    const release: unknown = parse(releaseSource);
    assert.ok(isRecord(release) && isRecord(release.on) && isRecord(release.jobs));
    assert.deepEqual(release.on, { push: { tags: ['v[0-9]+.[0-9]+.[0-9]+', 'v[0-9]+.[0-9]+.[0-9]+-*'] } });
    assert.deepEqual(release.permissions, { contents: 'read' });
    assert.deepEqual(release.concurrency, { group: `release-\${{ github.ref }}`, 'cancel-in-progress': false });
    const verify: unknown = release.jobs.verify;
    const publish: unknown = release.jobs.publish;
    assert.ok(isRecord(verify) && isRecord(publish) && Array.isArray(publish.steps));
    assert.equal(verify.uses, './.github/workflows/ci.yaml');
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

test('CI workflow uses reviewed pins and limits artifacts to controlled Chrome files', () => {
    const approved = new Set([
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
        'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9',
    ]);
    const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.map((step) => step.uses).filter(Boolean));
    assert.equal(uses.length, 60);
    assert.deepEqual(new Set(uses), approved);
    assert.match(source, /# v7\.0\.1/);
    assert.match(source, /# v7\.0\.0/);
    assert.match(source, /# v6\.0\.10/);
    for (const [name, job] of Object.entries(workflow.jobs)) {
        if (name.startsWith('ubuntu-first-start-assessment-')) continue;
        const uploads = job.steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));
        if (name !== 'real-chrome-tests' && name !== 'ubuntu-startup-study' && name !== 'ubuntu-readahead-study') {
            assert.deepEqual(uploads, []);
            continue;
        }
        assert.equal(uploads.length, 1);
        const upload = uploads[0];
        assert.equal(
            upload?.if,
            `${name === 'real-chrome-tests' ? 'failure()' : 'always()'} && steps.fixture-initialization.outputs.initialized == 'true'`,
        );
        assert.deepEqual(upload?.with, {
            name:
                name === 'ubuntu-readahead-study'
                    ? `ubuntu-readahead-study-slot-\${{ matrix.slot }}-block-\${{ matrix.block }}-ra-\${{ matrix.readaheadKb }}-\${{ github.run_id }}-\${{ github.run_attempt }}`
                    : name === 'ubuntu-startup-study'
                      ? `ubuntu-startup-study-block-\${{ matrix.block }}-logging-\${{ matrix.fileLogging }}-\${{ github.run_id }}-\${{ github.run_attempt }}`
                      : `controlled-chrome-\${{ matrix.os }}-\${{ github.run_id }}-\${{ github.run_attempt }}`,
            path: `${[
                `\${{ runner.temp }}/dct-fixture-diagnostics/job-index.json`,
                `\${{ runner.temp }}/dct-fixture-diagnostics/official-server.events.ndjson`,
                `\${{ runner.temp }}/dct-fixture-diagnostics/official-server.summary.json`,
                `\${{ runner.temp }}/dct-fixture-diagnostics/entry-recovery.events.ndjson`,
                `\${{ runner.temp }}/dct-fixture-diagnostics/entry-recovery.summary.json`,
            ].join('\n')}\n`,
            'retention-days': 7,
            'include-hidden-files': false,
            overwrite: false,
            'if-no-files-found': 'warn',
        });
    }
    assert.match(source, /# v7\.0\.2/);
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
    for (const name of ['quality', 'node-compatibility', 'windows-tests', 'portable-tests'] as const) {
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
    assert.doesNotMatch(linux.run, /command -v xdpyinfo/);
    for (const script of ['official-server', 'entry-recovery']) {
        assert.match(linux.run, new RegExp(`xvfb-run -a node tests/smoke/${script}\\.ts --allow-gui`));
        assert.match(mac.run, new RegExp(`node tests/smoke/${script}\\.ts --allow-gui`));
    }
    assert.doesNotMatch(mac.run, /xvfb/);
    for (const step of [linux, mac]) {
        assert.ok(step?.run);
        assert.ok(step.run.includes('fixture-ci.ts stage'));
        assert.ok(step.run.indexOf('fixture-ci.ts stage') < step.run.indexOf('node tests/smoke/official-server.ts'));
        assert.match(
            step.run,
            /official-server\.ts --allow-gui --diagnostics "\$RUNNER_TEMP\/dct-fixture-diagnostics"/,
        );
        assert.match(step.run, /entry-recovery\.ts --allow-gui --diagnostics "\$RUNNER_TEMP\/dct-fixture-diagnostics"/);
        assert.match(step.run, /--collection-id "\$collectionId"/);
        assert.match(step.run, /fixture-ci\.ts stage[^\n]+"\$collectionId"; then :; fi/);
    }
    const init = job.steps.find((step) => step.id === 'fixture-initialization');
    assert.ok(init);
    assert.ok(init.run);
    assert.ok(init.run.includes('fixture-ci.ts init'));
    assert.match(init.run, /if collectionId=/);
    assert.match(init.run, /initialized=true/);
    assert.match(init.run, /initialized=false/);
    assert.ok(job.steps.indexOf(init) < job.steps.indexOf(linux));
    assert.ok(job.steps.indexOf(init) < job.steps.indexOf(mac));
    const summary = job.steps.find((step) => step.name === 'Index controlled Chrome failure diagnostics');
    assert.equal(summary?.if, 'failure()');
    assert.equal(summary?.env?.DCT_FIXTURE_ARTIFACT_URL, `\${{ steps.fixture-artifact.outputs.artifact-url }}`);
    assert.match(summary?.run ?? '', /fixture-ci\.ts summary/);
    assert.match(summary?.run ?? '', /steps\.fixture-initialization\.outputs\.collection-id/);
    assert.ok(job.steps.every((step) => step['continue-on-error'] !== true));
    assert.doesNotMatch(commands, /--no-sandbox|--headless|kill -9|pkill|download|apt-get|brew install/);
});

test('failed first-start capture runs its identity gate only in ordinary Linux acceptance and scopes enablement to official smoke', () => {
    const job = workflow.jobs['real-chrome-tests'];
    const linux = job.steps.find((step) => step.if === "runner.os == 'Linux'");
    assert.ok(linux?.run);
    assert.match(linux.run, /captureAdmission="\$\(node tests\/smoke\/first-start-capture-ci\.ts\)"/);
    assert.match(linux.run, /if \[ "\$captureAdmission" = 'admitted' \]; then/);
    assert.match(
        linux.run,
        /DCT_SMOKE_FAILED_FIRST_START_CAPTURE=1 xvfb-run -a node tests\/smoke\/official-server\.ts/,
    );
    assert.doesNotMatch(linux.run, /export DCT_SMOKE_FAILED_FIRST_START_CAPTURE/);
    for (const other of Object.values(workflow.jobs)
        .flatMap((item) => item.steps)
        .filter((step) => step !== linux)) {
        assert.doesNotMatch(other.run ?? '', /first-start-capture-ci|DCT_SMOKE_FAILED_FIRST_START_CAPTURE/);
        assert.equal(other.env?.DCT_SMOKE_FAILED_FIRST_START_CAPTURE, undefined);
    }
});

test('ordinary Linux forwards its one acquired admission only through literal closed presentation values', () => {
    const linux = workflow.jobs['real-chrome-tests'].steps.find((step) => step.if === "runner.os == 'Linux'");
    assert.ok(linux?.run);
    assert.equal(linux.run.match(/node tests\/smoke\/first-start-capture-ci\.ts/g)?.length, 1);
    assert.match(linux.run, /if captureAdmission="\$\(node tests\/smoke\/first-start-capture-ci\.ts\)"; then/);
    assert.match(
        linux.run,
        /case "\$captureAdmission" in\n\s+admitted\) captureAdmission='admitted' ;;\n\s+ineligible\) captureAdmission='ineligible' ;;\n\s+unavailable\) captureAdmission='unavailable' ;;\n\s+\*\) captureAdmission='unavailable' ;;/,
    );
    assert.match(linux.run, /esac\n\s*else\n\s*captureAdmission='unavailable'\n\s*fi/);
    assert.deepEqual(
        [...linux.run.matchAll(/DCT_SMOKE_FIRST_START_CAPTURE_ADMISSION=([^ ]+)/g)].map((match) => match[1]),
        ['admitted', 'ineligible', 'unavailable'],
    );
    assert.match(
        linux.run,
        /DCT_SMOKE_FIRST_START_CAPTURE_ADMISSION=admitted DCT_SMOKE_FAILED_FIRST_START_CAPTURE=1 xvfb-run/,
    );
    assert.equal(linux.run.match(/DCT_SMOKE_FAILED_FIRST_START_CAPTURE=1/g)?.length, 1);
    assert.doesNotMatch(
        linux.run,
        /printf[^\n]*captureAdmission|echo[^\n]*captureAdmission|first-start-assessment-ci|git /,
    );
    for (const job of Object.values(workflow.jobs)) {
        const otherSteps: WorkflowStep[] = job.steps.filter((step) => step !== linux);
        for (const step of otherSteps) {
            assert.doesNotMatch(step.run ?? '', /DCT_SMOKE_FIRST_START_CAPTURE_ADMISSION/);
            assert.equal(step.env?.DCT_SMOKE_FIRST_START_CAPTURE_ADMISSION, undefined);
        }
    }
});
