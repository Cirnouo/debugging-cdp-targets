import { randomUUID } from 'node:crypto';
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    readSync,
    rmdirSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
    type FixtureError,
    serializeFixtureError,
    validateFixtureEvent,
} from '../../src/adapters/fixture-diagnostics.ts';
import { type BrowserStartupRecord, validateBrowserStartupRecord } from './chrome-startup.ts';
import { newFixtureEnvelope, readFixtureIndex, readFixtureSummary } from './fixture-ci.ts';
import {
    createArmedFixtureWriter,
    createFixtureStreamQuota,
    type FirstStartWriterCost,
    validateFirstStartWriterCost,
} from './fixture-stream-quota.ts';
import { type FirstStartCaptureRecord, validateFirstStartCaptureRecord } from './linux-first-start-capture-record.ts';
import { type ReadaheadRecord, readaheadExitProof, validateReadaheadRecord } from './linux-readahead-study.ts';
import { type LinuxStartupWaitRecord, validateLinuxStartupWaitRecord } from './linux-startup-wait.ts';
import { createStdioClient } from './mcp-client.ts';

export type FixtureLabel = 'official-server' | 'entry-recovery';
export interface CollectorCostRecord {
    kind: 'collector-cost';
    callbacks: number;
    totalMs: number;
    maxMs: number;
}

/** A closed projection; timing never goes back through the diagnostics channel. */
export function validateCollectorCost(value: unknown): Readonly<CollectorCostRecord> | undefined {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = ['kind', 'callbacks', 'totalMs', 'maxMs'];
        if (
            Reflect.ownKeys(value).length !== keys.length ||
            keys.some((key) => !descriptors[key] || !('value' in descriptors[key]))
        )
            return;
        const kind: unknown = descriptors.kind?.value;
        const callbacks: unknown = descriptors.callbacks?.value;
        const totalMs: unknown = descriptors.totalMs?.value;
        const maxMs: unknown = descriptors.maxMs?.value;
        if (
            kind !== 'collector-cost' ||
            typeof callbacks !== 'number' ||
            !Number.isSafeInteger(callbacks) ||
            callbacks < 0 ||
            typeof totalMs !== 'number' ||
            !Number.isFinite(totalMs) ||
            totalMs < 0 ||
            typeof maxMs !== 'number' ||
            !Number.isFinite(maxMs) ||
            maxMs < 0 ||
            maxMs > totalMs ||
            (callbacks === 0 && totalMs !== 0)
        )
            return;
        return Object.freeze({ kind, callbacks, totalMs, maxMs });
    } catch {
        return;
    }
}
export type SmokeStage =
    | 'prerequisites'
    | 'acceptance'
    | 'gateway-close'
    | 'target-cleanup'
    | 'profile-cleanup'
    | 'window-monitor';
interface Failure {
    stage: SmokeStage;
    error: FixtureError;
    operationId: string | null;
    runtimeStage: string | null;
}
interface Summary {
    firstStartCapture: Readonly<FirstStartCaptureRecord>[];
    firstStartCaptureArmed: boolean;
    firstStartCaptureOmitted: number;
    firstStartCaptureLimitations: string[];
    firstStartCaptureWriter: ReturnType<ReturnType<typeof createArmedFixtureWriter>['snapshot']> | null;
    firstStartCaptureWriterChild: Readonly<FirstStartWriterCost> | null;
    readaheadStudy: Readonly<ReadaheadRecord>[];
    readaheadStudyOmitted: number;
    schemaVersion: 1;
    fixture: FixtureLabel;
    state: 'not-run' | 'running' | 'passed' | 'failed';
    collectionId: string | null;
    collectionRejected: boolean;
    run: number | null;
    attempt: number | null;
    commit: string | null;
    platform: NodeJS.Platform;
    lastStage: string;
    smokeStage: SmokeStage;
    primary: Failure | null;
    secondary: Failure[];
    events: number;
    droppedEvents: number;
    invalidEvents: number;
    writeFailed: boolean;
    truncated: boolean;
    gatewayEvents: number;
    diagnosticAbsent: boolean;
    lastOperationId: string | null;
    incomplete: boolean;
    browserStartup: Readonly<BrowserStartupRecord>[];
    collectorCost: Readonly<CollectorCostRecord> | null;
    linuxStartupWait: Readonly<LinuxStartupWaitRecord>[];
    linuxStartupWaitOmitted: number;
}
const maxBytes = 1_048_576;
const maxRecordBytes = 4096;
const maxEvents = 2000;
const maxWaitSummary = 8;
const marker = `${JSON.stringify({ kind: 'truncated' })}\n`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createProgressReduction(firstStartCaptureArmed: boolean) {
    const progress = {
        firstStartCapture: [] as Readonly<FirstStartCaptureRecord>[],
        firstStartCaptureArmed,
        firstStartCaptureOmitted: 0,
        firstStartCaptureLimitations: [] as string[],
        firstStartCaptureWriterChild: null as Readonly<FirstStartWriterCost> | null,
        scannedBytes: 0,
        readaheadStudy: [] as Readonly<ReadaheadRecord>[],
        readaheadStudyOmitted: 0,
        events: 0,
        gatewayEvents: 0,
        invalidEvents: 0,
        writeFailed: false,
        truncated: false,
        lastStage: null as string | null,
        lastOperationId: null as string | null,
        incomplete: false,
        browserStartup: [] as Readonly<BrowserStartupRecord>[],
        collectorCost: null as Readonly<CollectorCostRecord> | null,
        linuxStartupWait: [] as Readonly<LinuxStartupWaitRecord>[],
        linuxStartupWaitOmitted: 0,
    };
    let cleanupEnded = false;
    function consume(value: unknown, admitted = true) {
        if (!record(value)) {
            progress.invalidEvents++;
            return;
        }
        progress.events++;
        if (!admitted) {
            progress.truncated = true;
            progress.invalidEvents++;
            return;
        }
        if (value.kind === 'gateway') {
            const { kind: _kind, ...fields } = value;
            const event = validateFixtureEvent(fields);
            if (!event) {
                progress.invalidEvents++;
                return;
            }
            progress.gatewayEvents++;
            progress.lastStage = event.stage;
            progress.lastOperationId = event.operationId ?? null;
            if (event.stage === 'gateway-cleanup' && event.event === 'end') cleanupEnded = true;
        } else if (value.kind === 'linux-first-start-capture') {
            const capture = validateFirstStartCaptureRecord(value);
            if (!capture || !firstStartCaptureArmed) progress.invalidEvents++;
            else {
                progress.firstStartCapture.push(capture);
                if (progress.firstStartCapture.length > 64) {
                    progress.firstStartCapture.shift();
                    progress.firstStartCaptureOmitted++;
                }
            }
        } else if (value.kind === 'first-start-writer-cost') {
            const cost = validateFirstStartWriterCost(value);
            if (!cost || !firstStartCaptureArmed || progress.firstStartCaptureWriterChild) progress.invalidEvents++;
            else progress.firstStartCaptureWriterChild = cost;
        } else if (value.kind === 'browser-startup') {
            const startup = validateBrowserStartupRecord(value);
            if (!startup) progress.invalidEvents++;
            else {
                progress.browserStartup = progress.browserStartup.filter(
                    (prior) =>
                        prior.phase !== startup.phase ||
                        (prior.phase === 'log' && startup.phase === 'log' && prior.launch !== startup.launch),
                );
                progress.browserStartup.push(startup);
                progress.browserStartup = progress.browserStartup.slice(-66);
            }
        } else if (value.kind === 'collector-cost') {
            const cost = validateCollectorCost(value);
            if (cost) progress.collectorCost = cost;
            else progress.invalidEvents++;
        } else if (value.kind === 'linux-startup-wait') {
            const wait = validateLinuxStartupWaitRecord(value);
            if (!wait) progress.invalidEvents++;
            else {
                progress.linuxStartupWait.push(wait);
                if (progress.linuxStartupWait.length > maxWaitSummary) {
                    progress.linuxStartupWait.shift();
                    progress.linuxStartupWaitOmitted++;
                }
            }
        } else if (value.kind === 'linux-readahead-study') {
            const study = validateReadaheadRecord(value);
            if (!study) progress.invalidEvents++;
            else {
                progress.readaheadStudy.push(study);
                if (progress.readaheadStudy.length > 8) {
                    progress.readaheadStudy.shift();
                    progress.readaheadStudyOmitted++;
                }
            }
        } else if (value.kind === 'truncated') progress.truncated = true;
        else if (value.kind === 'limitation') {
            if (value.reason === 'validation-rejected') progress.invalidEvents++;
            if (value.reason === 'write-failed') progress.writeFailed = true;
        } else if (value.kind !== 'smoke' && value.kind !== 'failure') progress.invalidEvents++;
    }
    function project() {
        const limitations = progress.firstStartCaptureLimitations;
        progress.firstStartCaptureLimitations = limitations.filter(
            (reason) =>
                ![
                    'selection-missing',
                    'outcome-missing',
                    'terminal-missing',
                    'self-report-write-unavailable',
                    'writer-cost-missing',
                ].includes(reason),
        );
        if (firstStartCaptureArmed) {
            for (const [slot, reason] of [
                ['selection', 'selection-missing'],
                ['first-start-outcome', 'outcome-missing'],
                ['observer-terminal', 'terminal-missing'],
            ]) {
                if (!progress.firstStartCapture.some((capture) => capture.slot === slot))
                    progress.firstStartCaptureLimitations.push(reason ?? 'receipt-missing');
            }
            progress.firstStartCaptureLimitations.push('self-report-write-unavailable');
            if (!progress.firstStartCaptureWriterChild)
                progress.firstStartCaptureLimitations.push('writer-cost-missing');
        }
        progress.incomplete ||=
            progress.truncated ||
            progress.writeFailed ||
            progress.linuxStartupWaitOmitted > 0 ||
            progress.readaheadStudyOmitted > 0 ||
            progress.firstStartCaptureOmitted > 0 ||
            progress.firstStartCaptureLimitations.length > 0 ||
            (progress.gatewayEvents > 0 && !cleanupEnded);
        return progress;
    }
    return { progress, consume, project };
}

/** Reconstruct child progress on demand, including interrupted BEGIN records. */
export function readFixtureProgress(
    directory: string,
    fixture: FixtureLabel,
    firstStartCaptureArmed = false,
    scanBudget = maxBytes,
) {
    const reduction = createProgressReduction(firstStartCaptureArmed);
    const { progress } = reduction;
    const file = path.join(directory, `${fixture}.events.ndjson`);
    const quota = firstStartCaptureArmed ? createFixtureStreamQuota() : undefined;
    if (firstStartCaptureArmed && scanBudget <= 0) {
        progress.incomplete = true;
        progress.firstStartCaptureLimitations.push(
            'writer-scan-budget',
            'selection-missing',
            'outcome-missing',
            'terminal-missing',
            'self-report-write-unavailable',
        );
        return progress;
    }
    try {
        if (existsSync(`${file}.lock`)) progress.writeFailed = true;
        const size = statSync(file).size;
        if (size > Math.min(maxBytes, scanBudget)) {
            progress.truncated = true;
            progress.incomplete = true;
            if (firstStartCaptureArmed) progress.firstStartCaptureLimitations.push('writer-scan-budget');
            return progress;
        }
        let content: string;
        if (firstStartCaptureArmed) {
            const buffer = Buffer.alloc(size);
            const descriptor = openSync(file, 'r');
            let read = 0;
            try {
                while (read < size) {
                    const count = readSync(descriptor, buffer, read, size - read, read);
                    progress.scannedBytes += count;
                    if (count === 0) {
                        progress.writeFailed = true;
                        break;
                    }
                    read += count;
                }
            } finally {
                closeSync(descriptor);
            }
            content = buffer.subarray(0, read).toString('utf8');
            if (content && !content.endsWith('\n')) progress.writeFailed = true;
        } else {
            content = readFileSync(file, 'utf8');
            progress.scannedBytes = Buffer.byteLength(content);
        }
        const lines = content.split('\n');
        for (const line of lines.slice(0, maxEvents + 1)) {
            if (!line) continue;
            if (Buffer.byteLength(line) + (firstStartCaptureArmed ? 1 : 0) > maxRecordBytes) {
                progress.invalidEvents++;
                continue;
            }
            let value: unknown;
            try {
                value = JSON.parse(line);
            } catch {
                progress.writeFailed = true;
                continue;
            }
            reduction.consume(
                value,
                !record(value) || !quota || quota.accept(value, Buffer.byteLength(line) + 1).accepted,
            );
        }
        if (lines.length > maxEvents + 2) progress.truncated = true;
    } catch {
        progress.writeFailed = true;
    }
    return reduction.project();
}

/** Test-only streaming collector. No gateway stderr, tool content or raw Error is accepted. */
export function createFixtureArtifacts(
    directory: string | undefined,
    fixture: FixtureLabel,
    io: {
        append?: (file: string, record: string) => void;
        streamOnly?: boolean;
        collectionId?: string | null | undefined;
        now?: () => number;
        firstStartCapture?: boolean;
    } = {},
) {
    const summary: Summary = {
        readaheadStudy: [],
        readaheadStudyOmitted: 0,
        ...newFixtureEnvelope(fixture, randomUUID()),
        firstStartCaptureArmed: io.firstStartCapture === true && fixture === 'official-server',
        state: 'running',
    };
    let eventsFile = directory ? path.join(directory, `${fixture}.events.ndjson`) : undefined;
    let summaryFile = directory ? path.join(directory, `${fixture}.summary.json`) : undefined;
    let knownSize = -1;
    let knownCount = 0;
    let callbacks = 0;
    let totalMs = 0;
    let maxMs = 0;
    let measuring = false;
    let costUnavailable = false;
    let costFlushed = false;
    let armedWriter: ReturnType<typeof createArmedFixtureWriter> | undefined;
    let reduction: ReturnType<typeof createProgressReduction> | undefined;
    function applyProgress(final = false) {
        if (!reduction) return;
        const progress = final ? reduction.project() : reduction.progress;
        const {
            scannedBytes: _scanned,
            firstStartCaptureArmed: _armed,
            lastStage,
            writeFailed,
            truncated,
            incomplete,
            firstStartCaptureLimitations,
            ...fields
        } = progress;
        Object.assign(summary, fields);
        summary.firstStartCaptureLimitations = [
            ...new Set([...summary.firstStartCaptureLimitations, ...firstStartCaptureLimitations]),
        ];
        summary.lastStage = lastStage ?? summary.smokeStage;
        summary.writeFailed ||= writeFailed;
        summary.truncated ||= truncated;
        summary.incomplete ||= incomplete;
    }
    function measure(action: () => void) {
        if (!eventsFile || measuring) {
            action();
            return;
        }
        const now = io.now ?? (() => performance.now());
        let start: number | undefined;
        try {
            start = now();
        } catch {
            costUnavailable = true;
        }
        measuring = true;
        try {
            action();
        } finally {
            measuring = false;
            callbacks++;
            try {
                const end = now();
                const elapsed = start === undefined ? Number.NaN : end - start;
                if (!Number.isFinite(elapsed) || elapsed < 0) costUnavailable = true;
                else {
                    totalMs += elapsed;
                    maxMs = Math.max(maxMs, elapsed);
                }
            } catch {
                costUnavailable = true;
            }
        }
    }
    function persist() {
        if (!summaryFile || io.streamOnly) return;
        try {
            let value = summary;
            if (summary.firstStartCaptureArmed) {
                const { schemaVersion, fixture, collectionId, firstStartCaptureArmed, ...body } = summary;
                value = { schemaVersion, fixture, collectionId, firstStartCaptureArmed, ...body };
            }
            writeFileSync(summaryFile, `${JSON.stringify(value)}\n`, 'utf8');
        } catch {
            summary.writeFailed = true;
        }
    }
    function append(value: unknown, create?: (event: ReturnType<typeof validateFixtureEvent>) => unknown) {
        if (!eventsFile) return;
        if (armedWriter) {
            const written = create ? armedWriter.appendFromGateway(create) : armedWriter.append(value);
            const state = armedWriter.snapshot();
            summary.firstStartCaptureWriter = state;
            if (written && !reduction) summary.events++;
            else if (!written) summary.droppedEvents++;
            summary.truncated ||= state.exhausted;
            summary.writeFailed ||= state.writeFailed;
            summary.incomplete ||= state.exhausted || state.writeFailed;
            if (state.exhausted && !summary.firstStartCaptureLimitations.includes('writer-budget-or-capacity'))
                summary.firstStartCaptureLimitations.push('writer-budget-or-capacity');
            if (state.releaseFailed && !summary.firstStartCaptureLimitations.includes('writer-release-failed'))
                summary.firstStartCaptureLimitations.push('writer-release-failed');
            applyProgress();
            return;
        }
        let ownsLock = false;
        try {
            if (summary.truncated) {
                summary.droppedEvents++;
                return;
            }
            // Parent and preload share this stream. One immediate lock attempt; no wait or queue.
            mkdirSync(`${eventsFile}.lock`);
            ownsLock = true;
            const record = `${JSON.stringify(value)}\n`;
            const size = statSync(eventsFile).size;
            if (size !== knownSize) {
                const existing = size <= maxBytes ? readFileSync(eventsFile, 'utf8') : '';
                if (existing.includes(marker.trim())) {
                    summary.truncated = true;
                    summary.droppedEvents++;
                    return;
                }
                knownCount = existing.split('\n').length - 1;
                knownSize = size;
            }
            if (
                Buffer.byteLength(record) > maxRecordBytes ||
                knownCount >= maxEvents ||
                size + Buffer.byteLength(record) > maxBytes - Buffer.byteLength(marker)
            ) {
                summary.truncated = true;
                summary.droppedEvents++;
                if (size + Buffer.byteLength(marker) <= maxBytes) (io.append ?? appendFileSync)(eventsFile, marker);
                return;
            }
            (io.append ?? appendFileSync)(eventsFile, record);
            knownSize = size + Buffer.byteLength(record);
            knownCount++;
            summary.events++;
        } catch {
            summary.writeFailed = true;
            summary.droppedEvents++;
            if (ownsLock) {
                // A failed injected writer or transient append may still permit safe limitation evidence.
                try {
                    const limitation = `${JSON.stringify({ kind: 'limitation', reason: 'write-failed' })}\n`;
                    if (statSync(eventsFile).size + Buffer.byteLength(limitation) <= maxBytes)
                        appendFileSync(eventsFile, limitation);
                } catch {}
            }
        } finally {
            if (ownsLock) {
                try {
                    rmdirSync(`${eventsFile}.lock`);
                } catch {
                    summary.writeFailed = true;
                }
            }
        }
    }
    function lastGateway() {
        if (!eventsFile) return;
        if (armedWriter) return armedWriter.lastGateway();
        try {
            if (statSync(eventsFile).size > maxBytes) return;
            for (const line of readFileSync(eventsFile, 'utf8').trim().split('\n').reverse()) {
                if (!line) continue;
                const value: unknown = JSON.parse(line);
                if (value && typeof value === 'object' && 'kind' in value && value.kind === 'gateway') {
                    const { kind: _kind, ...fields } = value;
                    const event = validateFixtureEvent(fields);
                    if (event) return event;
                }
            }
        } catch {
            summary.writeFailed = true;
        }
    }
    if (directory) {
        try {
            mkdirSync(directory, { recursive: true });
            if (summaryFile && eventsFile && existsSync(summaryFile)) {
                const prior = readFixtureSummary(summaryFile, summary.firstStartCaptureArmed);
                if (
                    !record(prior) ||
                    prior.fixture !== fixture ||
                    typeof prior.collectionId !== 'string' ||
                    !uuid.test(prior.collectionId)
                )
                    throw new Error('Invalid collection.');
                if (io.streamOnly) {
                    if (prior.state !== 'running' || prior.collectionId !== io.collectionId)
                        throw new Error('Unowned preload collection.');
                } else {
                    const index = readFixtureIndex(path.join(directory, 'job-index.json'));
                    if (
                        !record(index) ||
                        index.collectionId !== prior.collectionId ||
                        (io.collectionId !== undefined && io.collectionId !== prior.collectionId) ||
                        prior.state !== 'not-run' ||
                        statSync(eventsFile).size !== 0
                    )
                        throw new Error('Earlier collection.');
                }
                summary.collectionId = prior.collectionId;
            } else {
                if (io.streamOnly || (eventsFile && existsSync(eventsFile))) throw new Error('Unowned collection.');
                writeFileSync(eventsFile ?? '', '', { flag: 'wx' });
            }
        } catch {
            summary.writeFailed = true;
            summary.collectionRejected = true;
            summary.collectionId = null;
            summary.diagnosticAbsent = true;
            eventsFile = undefined;
            summaryFile = undefined;
            console.error('Fixture diagnostics require a fresh owned collection; existing evidence was preserved.');
        }
        persist();
    }
    if (eventsFile && summary.firstStartCaptureArmed) {
        if (!io.streamOnly) reduction = createProgressReduction(true);
        armedWriter = createArmedFixtureWriter(eventsFile, io.streamOnly === true, {
            ...io,
            ...(reduction
                ? {
                      admitted: (value: unknown) => reduction?.consume(value),
                      limited: () => {
                          if (reduction) reduction.progress.incomplete = true;
                      },
                  }
                : {}),
        });
    }
    if (!eventsFile && summary.firstStartCaptureArmed) {
        summary.incomplete = true;
        summary.firstStartCaptureLimitations.push('collection-unavailable');
    }
    const collector = {
        firstStartCapture(value: unknown) {
            if (!summary.firstStartCaptureArmed || summary.collectionRejected || !eventsFile) return;
            measure(() => {
                const safe = validateFirstStartCaptureRecord(value);
                if (!safe) {
                    collector.rejected();
                    return;
                }
                if (!reduction) summary.firstStartCapture.push(safe);
                if (summary.firstStartCapture.length > 64) {
                    summary.firstStartCapture.shift();
                    summary.firstStartCaptureOmitted++;
                    summary.incomplete = true;
                }
                append(safe);
                persist();
            });
        },
        readahead(value: unknown) {
            if (summary.collectionRejected) return;
            const safe = validateReadaheadRecord(value);
            if (!safe) {
                collector.rejected();
                return;
            }
            if (!reduction) summary.readaheadStudy.push(safe);
            if (summary.readaheadStudy.length > 8) {
                summary.readaheadStudy.shift();
                summary.readaheadStudyOmitted++;
                summary.incomplete = true;
            }
            append(safe);
            persist();
        },
        measure,
        begin(stage: SmokeStage) {
            summary.lastStage = stage;
            summary.smokeStage = stage;
            append({ kind: 'smoke', stage, event: 'begin' });
            persist();
        },
        gateway(value: unknown) {
            if (summary.collectionRejected) return;
            measure(() => {
                const event = validateFixtureEvent(value);
                if (!event) {
                    collector.rejected();
                    return;
                }
                summary.lastStage = event.stage;
                if (!reduction) summary.gatewayEvents++;
                summary.lastOperationId = event.operationId ?? null;
                append({ kind: 'gateway', ...event });
                persist();
            });
        },
        startup(value: unknown) {
            if (summary.collectionRejected || io.streamOnly) return;
            const safe = validateBrowserStartupRecord(value);
            if (!safe) {
                collector.rejected();
                return;
            }
            if (!reduction)
                summary.browserStartup = summary.browserStartup.filter(
                    (prior) =>
                        prior.phase !== safe.phase ||
                        (prior.phase === 'log' && safe.phase === 'log' && prior.launch !== safe.launch),
                );
            if (!reduction) summary.browserStartup.push(safe);
            summary.browserStartup = summary.browserStartup.slice(-66);
            append(safe);
            persist();
        },
        linuxWait(value: unknown) {
            if (summary.collectionRejected) return;
            measure(() => {
                const wait = validateLinuxStartupWaitRecord(value);
                if (!wait) {
                    collector.rejected();
                    return;
                }
                if (!reduction) summary.linuxStartupWait.push(wait);
                if (summary.linuxStartupWait.length > maxWaitSummary) {
                    summary.linuxStartupWait.shift();
                    summary.linuxStartupWaitOmitted++;
                    summary.incomplete = true;
                }
                append(wait);
                persist();
            });
        },
        rejected() {
            measure(() => {
                if (!reduction) summary.invalidEvents++;
                append({ kind: 'limitation', reason: 'validation-rejected' });
                persist();
            });
        },
        finishStream() {
            if (!costFlushed && armedWriter && io.streamOnly) append(armedWriter.cost());
            if (summary.writeFailed) append({ kind: 'limitation', reason: 'write-failed' });
            if (costFlushed || !eventsFile) return;
            costFlushed = true;
            const cost = validateCollectorCost({ kind: 'collector-cost', callbacks, totalMs, maxMs });
            if (costUnavailable || !cost) append({ kind: 'limitation', reason: 'collector-cost-unavailable' });
            else {
                if (!reduction) summary.collectorCost = cost;
                append(cost);
            }
        },
        failure(stage: SmokeStage, error: unknown, primary: boolean) {
            let constructed = false;
            const create = (event: ReturnType<typeof validateFixtureEvent>) => {
                constructed = true;
                const failure: Failure = {
                    stage,
                    error: serializeFixtureError(error),
                    operationId: event?.operationId ?? null,
                    runtimeStage: event?.stage ?? null,
                };
                if (primary && !summary.primary) summary.primary = failure;
                else if (summary.secondary.length < 32) summary.secondary.push(failure);
                else summary.droppedEvents++;
                return { kind: 'failure', primary, ...failure };
            };
            if (armedWriter) append(undefined, create);
            else append(create(lastGateway()));
            // Admission can fail before the callback. Preserve the original
            // failure without presenting an unrefreshed cached attribution.
            if (!constructed) create(undefined);
            persist();
        },
        finish(failed: boolean) {
            summary.state = failed ? 'failed' : 'passed';
            // Child writes may have advanced the stream. Read only bounded safe records.
            if (armedWriter && reduction) {
                const observation = armedWriter.finishObservation();
                reduction.progress.writeFailed ||= observation.writeFailed;
                reduction.progress.truncated ||= observation.truncated;
                reduction.progress.incomplete ||= observation.incomplete;
                if (observation.scanBudget) reduction.progress.firstStartCaptureLimitations.push('writer-scan-budget');
                if (observation.discontinuity)
                    reduction.progress.firstStartCaptureLimitations.push('writer-stream-discontinuity');
                applyProgress(true);
                summary.firstStartCaptureWriter = armedWriter.snapshot();
            } else if (eventsFile && directory) {
                const scanBudget = armedWriter ? (armedWriter.reserveReconstruction() ?? 0) : maxBytes;
                const progress = readFixtureProgress(directory, fixture, summary.firstStartCaptureArmed, scanBudget);
                armedWriter?.settleReconstruction(progress.scannedBytes);
                summary.firstStartCaptureWriter = armedWriter?.snapshot() ?? null;
                summary.events = progress.events;
                summary.gatewayEvents = progress.gatewayEvents;
                summary.invalidEvents = progress.invalidEvents;
                summary.lastStage = progress.lastStage ?? summary.smokeStage;
                summary.lastOperationId = progress.lastOperationId;
                summary.writeFailed ||= progress.writeFailed;
                summary.truncated ||= progress.truncated;
                summary.incomplete ||= progress.incomplete;
                summary.browserStartup = progress.browserStartup;
                summary.collectorCost = progress.collectorCost;
                summary.linuxStartupWait = progress.linuxStartupWait;
                summary.linuxStartupWaitOmitted = progress.linuxStartupWaitOmitted;
                summary.readaheadStudy = progress.readaheadStudy;
                summary.readaheadStudyOmitted = progress.readaheadStudyOmitted;
                summary.firstStartCapture = progress.firstStartCapture;
                summary.firstStartCaptureOmitted = progress.firstStartCaptureOmitted;
                summary.firstStartCaptureWriterChild = progress.firstStartCaptureWriterChild;
                summary.firstStartCaptureLimitations = [
                    ...new Set([...summary.firstStartCaptureLimitations, ...progress.firstStartCaptureLimitations]),
                ];
            }
            summary.diagnosticAbsent = !!directory && summary.gatewayEvents === 0;
            persist();
            if (summary.writeFailed)
                console.error('Fixture diagnostics unavailable or incomplete (safe writer failure).');
        },
        snapshot() {
            return structuredClone(summary);
        },
    };
    return collector;
}
export type FixtureArtifacts = ReturnType<typeof createFixtureArtifacts>;

export function fixtureReadaheadExitProof(
    directory: string,
    selected: { entryId: string; requestId: string },
    childClosed: boolean,
) {
    const progress = readFixtureProgress(directory, 'official-server');
    if (progress.truncated || progress.writeFailed || progress.invalidEvents > 0) return false;
    try {
        const file = path.join(directory, 'official-server.events.ndjson');
        if (statSync(file).size > maxBytes) return false;
        const records: unknown[] = readFileSync(file, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        return readaheadExitProof(records, selected, childClosed);
    } catch {
        return false;
    }
}

/** Each action is attempted once, in caller order; original first failure is rethrown. */
export function createSmokeFailures(artifacts: FixtureArtifacts) {
    let first: unknown;
    let failed = false;
    return {
        hasFailure() {
            return failed;
        },
        primary(error: unknown, stage: SmokeStage = 'acceptance') {
            artifacts.failure(stage, error, !failed);
            if (!failed) {
                first = error;
                failed = true;
            }
        },
        async cleanup(stage: SmokeStage, action: () => Promise<unknown>) {
            artifacts.begin(stage);
            try {
                await action();
            } catch (error) {
                artifacts.failure(stage, error, !failed);
                if (!failed) {
                    first = error;
                    failed = true;
                }
            }
        },
        finish() {
            artifacts.finish(failed);
            if (failed) throw first;
        },
    };
}
export function fixtureOutputDirectory(args = process.argv.slice(2)): string | undefined {
    if (args.length === 0) return;
    if (
        (args.length !== 2 && args.length !== 4) ||
        args[0] !== '--diagnostics' ||
        !args[1] ||
        !path.isAbsolute(args[1])
    )
        throw new Error('Expected --diagnostics with an absolute controlled output directory.');
    if (args.length === 4 && (args[2] !== '--collection-id' || !args[3] || !uuid.test(args[3]))) {
        console.error('Diagnostic limitation: current collection unavailable; collection disabled.');
        return;
    }
    return args[1];
}
export function fixtureOutputCollectionId(args = process.argv.slice(2)): string | undefined {
    return args.length === 4 && args[2] === '--collection-id' && args[3] && uuid.test(args[3]) ? args[3] : undefined;
}
export function fixtureGatewayArguments(
    entry: string,
    directory?: string,
    fixture: FixtureLabel = 'official-server',
    collectionId?: string | null,
    readahead?: { executable: string; assignedKb: 128 | 1024 },
    firstStartCapture = false,
): string[] {
    if (!directory || !collectionId || !uuid.test(collectionId)) return [entry];
    const preload = new URL('./fixture-preload.ts', import.meta.url);
    preload.searchParams.set('directory', directory);
    preload.searchParams.set('fixture', fixture);
    preload.searchParams.set('collectionId', collectionId);
    if (firstStartCapture && fixture === 'official-server' && !readahead)
        preload.searchParams.set('firstStartCapture', '1');
    if (readahead) {
        preload.searchParams.set('readaheadKb', String(readahead.assignedKb));
        preload.searchParams.set('readaheadExecutable', readahead.executable);
    }
    return ['--import', preload.href, entry];
}
export function fixtureGatewayEnvironment(inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(inherited).filter(
            ([name]) => !['NODE_OPTIONS', 'DCT_SMOKE_FAILED_FIRST_START_CAPTURE'].includes(name.toUpperCase()),
        ),
    );
}
export function createFixtureGatewayClient(
    entry: string,
    directory: string | undefined,
    fixture: FixtureLabel,
    artifacts: FixtureArtifacts,
    readahead?: { executable: string; assignedKb: 128 | 1024 },
) {
    return createStdioClient(
        process.execPath,
        fixtureGatewayArguments(
            entry,
            directory,
            fixture,
            artifacts.snapshot().collectionId,
            readahead,
            artifacts.snapshot().firstStartCaptureArmed,
        ),
        { env: fixtureGatewayEnvironment() },
    );
}
