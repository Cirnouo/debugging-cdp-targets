import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const labels = ['official-server', 'entry-recovery'] as const;
const files = ['job-index.json', ...labels.flatMap((label) => [`${label}.events.ndjson`, `${label}.summary.json`])];
const smokeStages = [
    'prerequisites',
    'acceptance',
    'gateway-close',
    'target-cleanup',
    'profile-cleanup',
    'window-monitor',
];
const runtimeStages = [
    'operation',
    'operation-phase',
    'operation-route',
    'operation-error',
    'target-acquisition',
    'target-close',
    'target-exit-wait',
    'resource-disposal',
    'gateway-cleanup',
    'port-probe',
    'spawn',
    'readiness',
    'listener-ownership',
    'endpoint',
    'profile-check',
    'native-close',
    'native-command',
    'native-file',
    'native-snapshot',
    'data-directory-acquire',
    'data-directory-release',
    'data-directory-cleanup',
    'directory-lease',
];
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function readFixtureIndex(file: string): unknown {
    if (statSync(file).size > 65536) throw new Error('Controlled index exceeds its bound.');
    return JSON.parse(readFileSync(file, 'utf8'));
}
export function newFixtureEnvelope(fixture: 'official-server' | 'entry-recovery', collectionId: string) {
    const number = (value: string | undefined) => (value && /^\d{1,15}$/.test(value) ? Number(value) : null);
    return {
        schemaVersion: 1 as const,
        fixture,
        collectionId,
        state: 'not-run' as 'not-run' | 'running' | 'passed' | 'failed',
        run: number(process.env.GITHUB_RUN_ID),
        attempt: number(process.env.GITHUB_RUN_ATTEMPT),
        commit: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? (process.env.GITHUB_SHA ?? null) : null,
        platform: process.platform,
        lastStage: 'prerequisites',
        smokeStage: 'prerequisites' as const,
        primary: null,
        secondary: [],
        events: 0,
        droppedEvents: 0,
        invalidEvents: 0,
        writeFailed: false,
        truncated: false,
        gatewayEvents: 0,
        diagnosticAbsent: false,
        lastOperationId: null,
        incomplete: false,
        collectionRejected: false,
        browserStartup: [],
    };
}
export function fixtureJobIndex(command: string, directory: string, label?: string) {
    const file = path.join(directory, 'job-index.json');
    if (command === 'init') {
        mkdirSync(directory, { recursive: true });
        if (
            files.some((name) => {
                try {
                    statSync(path.join(directory, name));
                    return true;
                } catch (error) {
                    if (object(error) && error.code === 'ENOENT') return false;
                    throw error;
                }
            })
        )
            throw new Error(
                'Fixture diagnostics require a fresh invocation directory; previous evidence was preserved.',
            );
        const collectionId = randomUUID();
        for (const fixture of labels) {
            writeFileSync(path.join(directory, `${fixture}.events.ndjson`), '', { flag: 'wx' });
            writeFileSync(
                path.join(directory, `${fixture}.summary.json`),
                `${JSON.stringify(newFixtureEnvelope(fixture, collectionId))}\n`,
                { flag: 'wx' },
            );
        }
        writeFileSync(
            file,
            `${JSON.stringify({ schemaVersion: 1, collectionId, stage: 'prerequisites', fixtures: { 'official-server': 'not-run', 'entry-recovery': 'not-run' }, files })}\n`,
            { flag: 'wx' },
        );
        return collectionId;
    } else if (command === 'stage' && labels.some((item) => item === label)) {
        const value = readFixtureIndex(file);
        if (!object(value) || !object(value.fixtures)) throw new Error('Invalid controlled fixture job index.');
        const fixtures: Record<string, string> = {};
        for (const fixture of labels) {
            fixtures[fixture] = value.fixtures[fixture] === 'running' ? 'running' : 'not-run';
            try {
                const summary = readFixtureIndex(path.join(directory, `${fixture}.summary.json`));
                if (object(summary) && (summary.state === 'passed' || summary.state === 'failed'))
                    fixtures[fixture] = summary.state;
            } catch {}
        }
        fixtures[label ?? ''] = 'running';
        const collectionId =
            typeof value.collectionId === 'string' &&
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.collectionId)
                ? value.collectionId
                : null;
        writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, collectionId, stage: label, fixtures, files })}\n`);
    } else if (command === 'summary') {
        return writeFixtureJobSummary(directory, file);
    } else throw new Error('Invalid controlled fixture index command.');
}
async function writeFixtureJobSummary(directory: string, file: string) {
    // Loaded only for presentation; dependency-free init/stage imports no project module.
    const { readFixtureProgress } = await import('./fixture-artifacts.ts');
    let text = 'Controlled Chrome failure diagnostics\n\n';
    try {
        const value = readFixtureIndex(file);
        const stage =
            object(value) && (value.stage === 'prerequisites' || labels.some((label) => label === value.stage))
                ? value.stage
                : 'unavailable';
        text += `Job stage: ${String(stage)}.\n\n`;
    } catch {
        text += 'Job index unavailable.\n\n';
    }
    for (const label of labels) {
        try {
            const value = readFixtureIndex(path.join(directory, `${label}.summary.json`));
            const state =
                object(value) && ['not-run', 'running', 'passed', 'failed'].includes(String(value.state))
                    ? String(value.state)
                    : 'unavailable';
            text += `${label}: ${state}; ${label}.summary.json; ${label}.events.ndjson\n\n`;
            if (state !== 'not-run') {
                const progress = readFixtureProgress(directory, label);
                text += `Runtime boundary: ${progress.lastStage ?? 'unavailable'}; operation: ${progress.lastOperationId ?? 'unavailable'}; gateway events: ${progress.gatewayEvents}.\n\n`;
                if (progress.incomplete || progress.writeFailed || progress.truncated || progress.invalidEvents > 0)
                    text += 'Stream evidence is incomplete or limited.\n\n';
                for (const startup of progress.browserStartup) {
                    if (startup.phase === 'log') {
                        text += `Chrome startup slot ${startup.launch}: categories=${startup.reasons.join(',') || 'unknown'}; INFO=${startup.info}; WARNING=${startup.warning}; ERROR=${startup.error}; FATAL=${startup.fatal}; absent=${startup.absent}; readFailed=${startup.readFailed}; truncated=${startup.truncated}; incomplete=${startup.incomplete}.\n\n`;
                    } else if (startup.phase === 'display') {
                        text += `X display preflight: available=${startup.available}; responsive=${startup.responsive}; timedOut=${startup.timedOut}.\n\n`;
                    } else {
                        text += `Private startup scratch: retained=${startup.retained}; cleanupFailed=${startup.cleanupFailed}.\n\n`;
                    }
                }
            }
            if (object(value) && object(value.primary)) {
                const stage =
                    typeof value.primary.stage === 'string' && smokeStages.includes(value.primary.stage)
                        ? value.primary.stage
                        : 'unavailable';
                const operation =
                    typeof value.primary.operationId === 'string' &&
                    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.primary.operationId)
                        ? value.primary.operationId
                        : 'unavailable';
                text += `Primary stage: ${stage}; operation: ${operation}.\n\n`;
                const runtimeStage =
                    typeof value.primary.runtimeStage === 'string' && runtimeStages.includes(value.primary.runtimeStage)
                        ? value.primary.runtimeStage
                        : 'unavailable';
                text += `Primary runtime boundary: ${runtimeStage}.\n\n`;
            }
            if (
                object(value) &&
                (value.writeFailed === true ||
                    value.diagnosticAbsent === true ||
                    value.truncated === true ||
                    value.incomplete === true)
            )
                text += 'Diagnostic limitation: unavailable, incomplete or truncated evidence.\n\n';
        } catch {
            text += `${label}: diagnostic file unavailable; not-run state unverified.\n\n`;
        }
    }
    text += `Files: ${files.join(', ')}\n`;
    const artifact = process.env.DCT_FIXTURE_ARTIFACT_URL;
    if (
        artifact &&
        /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+\/artifacts\/\d+$/.test(artifact)
    )
        text += `\n[Failure artifact](${artifact})\n`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    else process.stdout.write(text);
}
function requireCurrentCollection(directory: string, collectionId: string | undefined) {
    if (!collectionId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(collectionId))
        throw new Error('Current collection unavailable.');
    const index = readFixtureIndex(path.join(directory, 'job-index.json'));
    if (!object(index) || index.collectionId !== collectionId) throw new Error('Current collection unavailable.');
}
async function runFixtureCli() {
    try {
        const [, , command, directory, labelOrCollection, collectionId] = process.argv;
        if (!command || !directory || !path.isAbsolute(directory)) throw new Error('Invalid controlled directory.');
        if (command === 'init') {
            const initialized = fixtureJobIndex(command, directory);
            if (typeof initialized !== 'string') throw new Error('Initialization unavailable.');
            process.stdout.write(`${initialized}\n`);
        } else if (command === 'stage') {
            requireCurrentCollection(directory, collectionId);
            if (!labels.some((label) => label === labelOrCollection)) throw new Error('Invalid fixture.');
            const envelope = readFixtureIndex(path.join(directory, `${labelOrCollection}.summary.json`));
            if (
                !object(envelope) ||
                envelope.collectionId !== collectionId ||
                envelope.state !== 'not-run' ||
                statSync(path.join(directory, `${labelOrCollection}.events.ndjson`)).size !== 0
            )
                throw new Error('Fixture already used.');
            fixtureJobIndex(command, directory, labelOrCollection);
        } else if (command === 'summary') {
            try {
                requireCurrentCollection(directory, labelOrCollection);
            } catch {
                const text =
                    'Diagnostic limitation: current collection unavailable; prior evidence was preserved and is excluded.\n';
                if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
                else process.stdout.write(text);
                return;
            }
            await fixtureJobIndex(command, directory);
        } else throw new Error('Invalid controlled fixture index command.');
    } catch {
        console.error('Controlled fixture collection unavailable; prior evidence was preserved.');
        process.exitCode = 1;
    }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    // Finish evaluating this module before summary dynamically loads its collector dependency.
    void runFixtureCli();
}
