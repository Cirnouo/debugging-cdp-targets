import { randomUUID } from 'node:crypto';
import {
    appendFileSync,
    closeSync,
    fstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    readSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const labels = ['official-server', 'entry-recovery'] as const;
const collectionUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
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
function currentCollection(value: unknown): string | undefined {
    return object(value) && typeof value.collectionId === 'string' && collectionUuid.test(value.collectionId)
        ? value.collectionId
        : undefined;
}
/** Authority precedes body acquisition; JSON flags never upgrade a default read. */
export function readFixtureSummary(file: string, authority: boolean | { collectionId: string } = false): unknown {
    const headerAuthority = typeof authority === 'object' ? authority.collectionId : undefined;
    const limit = authority === true || (headerAuthority && collectionUuid.test(headerAuthority)) ? 1024 * 1024 : 65536;
    const handle = openSync(file, 'r');
    try {
        const initial = fstatSync(handle);
        if (!initial.isFile() || !Number.isSafeInteger(initial.size) || initial.size < 0 || initial.size > limit)
            throw new Error('Controlled summary exceeds its bound.');
        const buffer = Buffer.alloc(initial.size);
        let offset = 0;
        function readThrough(end: number) {
            while (offset < end) {
                const count = readSync(handle, buffer, offset, end - offset, offset);
                if (count === 0) throw new Error('Controlled summary changed during acquisition.');
                offset += count;
            }
        }
        if (initial.size > 65536 && authority !== true) {
            readThrough(Math.min(initial.size, 256));
            const prefix = buffer.subarray(0, offset).toString('utf8');
            const match =
                /^\{"schemaVersion":1,"fixture":"official-server","collectionId":"([a-fA-F0-9-]{36})","firstStartCaptureArmed":true,/.exec(
                    prefix,
                );
            if (!match?.[1] || match[1] !== headerAuthority || !collectionUuid.test(match[1]))
                throw new Error('Controlled summary header is unavailable.');
        }
        readThrough(initial.size);
        const final = fstatSync(handle);
        if (
            !final.isFile() ||
            final.dev !== initial.dev ||
            final.ino !== initial.ino ||
            final.size !== initial.size ||
            final.mtimeMs !== initial.mtimeMs ||
            final.ctimeMs !== initial.ctimeMs
        )
            throw new Error('Controlled summary changed during acquisition.');
        const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        const value: unknown = JSON.parse(content);
        if (initial.size > 65536) {
            const canonical = JSON.stringify(value);
            if (
                !object(value) ||
                value.schemaVersion !== 1 ||
                value.fixture !== 'official-server' ||
                value.firstStartCaptureArmed !== true ||
                !currentCollection(value) ||
                (headerAuthority && value.collectionId !== headerAuthority) ||
                (content !== canonical && content !== `${canonical}\n`)
            )
                throw new Error('Invalid claimed-armed summary.');
        }
        return value;
    } finally {
        closeSync(handle);
    }
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
        collectorCost: null,
        linuxStartupWait: [],
        linuxStartupWaitOmitted: 0,
        firstStartCapture: [],
        firstStartCaptureArmed: false,
        firstStartCaptureOmitted: 0,
        firstStartCaptureLimitations: [],
        firstStartCaptureWriter: null,
        firstStartCaptureWriterChild: null,
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
        const selectedCollection = currentCollection(value);
        for (const fixture of labels) {
            fixtures[fixture] = value.fixtures[fixture] === 'running' ? 'running' : 'not-run';
            try {
                const summary = readFixtureSummary(
                    path.join(directory, `${fixture}.summary.json`),
                    selectedCollection ? { collectionId: selectedCollection } : false,
                );
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
    let text = 'Controlled Chrome diagnostics\n\n';
    let selectedCollection: string | undefined;
    try {
        const value = readFixtureIndex(file);
        selectedCollection = currentCollection(value);
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
            const value = readFixtureSummary(
                path.join(directory, `${label}.summary.json`),
                selectedCollection ? { collectionId: selectedCollection } : false,
            );
            const state =
                object(value) && ['not-run', 'running', 'passed', 'failed'].includes(String(value.state))
                    ? String(value.state)
                    : 'unavailable';
            text += `${label}: ${state}; ${label}.summary.json; ${label}.events.ndjson\n\n`;
            if (state !== 'not-run') {
                const progress = readFixtureProgress(
                    directory,
                    label,
                    object(value) && value.firstStartCaptureArmed === true,
                );
                text += `Runtime boundary: ${progress.lastStage ?? 'unavailable'}; operation: ${progress.lastOperationId ?? 'unavailable'}; gateway events: ${progress.gatewayEvents}.\n\n`;
                if (progress.incomplete || progress.writeFailed || progress.truncated || progress.invalidEvents > 0)
                    text += 'Stream evidence is incomplete or limited.\n\n';
                if (progress.collectorCost) {
                    const cost = progress.collectorCost;
                    text += `Synchronous diagnostic collector: callbacks=${cost.callbacks}; totalMs=${cost.totalMs}; maxMs=${cost.maxMs}.\n\n`;
                }
                for (const wait of progress.linuxStartupWait) {
                    text += `Linux wait sample: connection=${wait.connectionId}; session=${wait.sessionId}; pid=${wait.pid}; startTicks=${wait.rootStartTicks}; trigger=${wait.trigger}; outcome=${wait.outcome}; elapsedMs=${wait.elapsedMs}; reads=${wait.reads}; bytes=${wait.bytes}; limits=${wait.limitations.join(',') || 'none'}; wchan=${wait.wchan ?? 'unavailable'}.\n\n`;
                }
                if (progress.linuxStartupWaitOmitted > 0)
                    text += `Linux wait summary omitted ${progress.linuxStartupWaitOmitted} earlier records; consult the bounded stream.\n\n`;
                if (progress.firstStartCaptureArmed) {
                    text += `Failed first-start capture: retained=${progress.firstStartCapture.length}; omitted=${progress.firstStartCaptureOmitted}; limitations=${progress.firstStartCaptureLimitations.join(',') || 'none'}.\n\n`;
                    text +=
                        'This presentation rereads completed evidence; its analysis I/O is separate from startup collector cost.\n\n';
                    const cost = progress.firstStartCaptureWriterChild;
                    if (cost)
                        text += `First-start writer receipt before terminal writes: attempts=${cost.attempts}; metadataReserved=${cost.metadataReserved}; scannedBytes=${cost.scannedBytes}; selfReportWriteUnavailable=${cost.selfReportWriteUnavailable}.\n\n`;
                }
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
        text += `\n[Diagnostic artifact](${artifact})\n`;
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
            const envelope = readFixtureSummary(
                path.join(directory, `${labelOrCollection}.summary.json`),
                collectionId ? { collectionId } : false,
            );
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
