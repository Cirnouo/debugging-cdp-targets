import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    type FixtureError,
    serializeFixtureError,
    validateFixtureEvent,
} from '../../src/adapters/fixture-diagnostics.ts';
import { type BrowserStartupRecord, validateBrowserStartupRecord } from './chrome-startup.ts';
import { newFixtureEnvelope, readFixtureIndex } from './fixture-ci.ts';
import { createStdioClient } from './mcp-client.ts';

export type FixtureLabel = 'official-server' | 'entry-recovery';
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
}
const maxBytes = 1_048_576;
const maxRecordBytes = 4096;
const maxEvents = 2000;
const marker = `${JSON.stringify({ kind: 'truncated' })}\n`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Reconstruct child progress on demand, including interrupted BEGIN records. */
export function readFixtureProgress(directory: string, fixture: FixtureLabel) {
    const progress = {
        events: 0,
        gatewayEvents: 0,
        invalidEvents: 0,
        writeFailed: false,
        truncated: false,
        lastStage: null as string | null,
        lastOperationId: null as string | null,
        incomplete: false,
        browserStartup: [] as Readonly<BrowserStartupRecord>[],
    };
    const file = path.join(directory, `${fixture}.events.ndjson`);
    let cleanupEnded = false;
    try {
        if (existsSync(`${file}.lock`)) progress.writeFailed = true;
        if (statSync(file).size > maxBytes) {
            progress.truncated = true;
            progress.incomplete = true;
            return progress;
        }
        const lines = readFileSync(file, 'utf8').split('\n');
        for (const line of lines.slice(0, maxEvents + 1)) {
            if (!line) continue;
            if (Buffer.byteLength(line) > maxRecordBytes) {
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
            if (!record(value)) {
                progress.invalidEvents++;
                continue;
            }
            progress.events++;
            if (value.kind === 'gateway') {
                const { kind: _kind, ...fields } = value;
                const event = validateFixtureEvent(fields);
                if (!event) {
                    progress.invalidEvents++;
                    continue;
                }
                progress.gatewayEvents++;
                progress.lastStage = event.stage;
                progress.lastOperationId = event.operationId ?? null;
                if (event.stage === 'gateway-cleanup' && event.event === 'end') cleanupEnded = true;
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
            } else if (value.kind === 'truncated') progress.truncated = true;
            else if (value.kind === 'limitation') {
                if (value.reason === 'validation-rejected') progress.invalidEvents++;
                if (value.reason === 'write-failed') progress.writeFailed = true;
            }
        }
        if (lines.length > maxEvents + 2) progress.truncated = true;
    } catch {
        progress.writeFailed = true;
    }
    progress.incomplete = progress.writeFailed || (progress.gatewayEvents > 0 && !cleanupEnded);
    return progress;
}

/** Test-only streaming collector. No gateway stderr, tool content or raw Error is accepted. */
export function createFixtureArtifacts(
    directory: string | undefined,
    fixture: FixtureLabel,
    io: {
        append?: (file: string, record: string) => void;
        streamOnly?: boolean;
        collectionId?: string | null | undefined;
    } = {},
) {
    const summary: Summary = {
        ...newFixtureEnvelope(fixture, randomUUID()),
        state: 'running',
    };
    let eventsFile = directory ? path.join(directory, `${fixture}.events.ndjson`) : undefined;
    let summaryFile = directory ? path.join(directory, `${fixture}.summary.json`) : undefined;
    let knownSize = -1;
    let knownCount = 0;
    function persist() {
        if (!summaryFile || io.streamOnly) return;
        try {
            writeFileSync(summaryFile, `${JSON.stringify(summary)}\n`, 'utf8');
        } catch {
            summary.writeFailed = true;
        }
    }
    function append(value: unknown) {
        if (!eventsFile) return;
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
                const prior = readFixtureIndex(summaryFile);
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
    const collector = {
        begin(stage: SmokeStage) {
            summary.lastStage = stage;
            summary.smokeStage = stage;
            append({ kind: 'smoke', stage, event: 'begin' });
            persist();
        },
        gateway(value: unknown) {
            if (summary.collectionRejected) return;
            const event = validateFixtureEvent(value);
            if (!event) {
                collector.rejected();
                return;
            }
            summary.lastStage = event.stage;
            summary.gatewayEvents++;
            summary.lastOperationId = event.operationId ?? null;
            append({ kind: 'gateway', ...event });
            persist();
        },
        startup(value: unknown) {
            if (summary.collectionRejected || io.streamOnly) return;
            const safe = validateBrowserStartupRecord(value);
            if (!safe) {
                collector.rejected();
                return;
            }
            summary.browserStartup = summary.browserStartup.filter(
                (prior) =>
                    prior.phase !== safe.phase ||
                    (prior.phase === 'log' && safe.phase === 'log' && prior.launch !== safe.launch),
            );
            summary.browserStartup.push(safe);
            summary.browserStartup = summary.browserStartup.slice(-66);
            append(safe);
            persist();
        },
        rejected() {
            summary.invalidEvents++;
            append({ kind: 'limitation', reason: 'validation-rejected' });
            persist();
        },
        finishStream() {
            if (summary.writeFailed) append({ kind: 'limitation', reason: 'write-failed' });
        },
        failure(stage: SmokeStage, error: unknown, primary: boolean) {
            const event = lastGateway();
            const failure: Failure = {
                stage,
                error: serializeFixtureError(error),
                operationId: event?.operationId ?? null,
                runtimeStage: event?.stage ?? null,
            };
            if (primary && !summary.primary) summary.primary = failure;
            else if (summary.secondary.length < 32) summary.secondary.push(failure);
            else summary.droppedEvents++;
            append({ kind: 'failure', primary, ...failure });
            persist();
        },
        finish(failed: boolean) {
            summary.state = failed ? 'failed' : 'passed';
            // Child writes may have advanced the stream. Read only bounded safe records.
            if (eventsFile && directory) {
                const progress = readFixtureProgress(directory, fixture);
                summary.events = progress.events;
                summary.gatewayEvents = progress.gatewayEvents;
                summary.invalidEvents = progress.invalidEvents;
                summary.lastStage = progress.lastStage ?? summary.smokeStage;
                summary.lastOperationId = progress.lastOperationId;
                summary.writeFailed ||= progress.writeFailed;
                summary.truncated ||= progress.truncated;
                summary.incomplete ||= progress.incomplete;
                summary.browserStartup = progress.browserStartup;
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
): string[] {
    if (!directory || !collectionId || !uuid.test(collectionId)) return [entry];
    const preload = new URL('./fixture-preload.ts', import.meta.url);
    preload.searchParams.set('directory', directory);
    preload.searchParams.set('fixture', fixture);
    preload.searchParams.set('collectionId', collectionId);
    return ['--import', preload.href, entry];
}
export function fixtureGatewayEnvironment(inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(inherited).filter(([name]) => name.toUpperCase() !== 'NODE_OPTIONS'));
}
export function createFixtureGatewayClient(
    entry: string,
    directory: string | undefined,
    fixture: FixtureLabel,
    artifacts: FixtureArtifacts,
) {
    return createStdioClient(
        process.execPath,
        fixtureGatewayArguments(entry, directory, fixture, artifacts.snapshot().collectionId),
        { env: fixtureGatewayEnvironment() },
    );
}
