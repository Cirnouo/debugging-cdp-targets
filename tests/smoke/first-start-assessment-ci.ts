import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
    type BigIntStats,
    closeSync,
    constants,
    fstatSync,
    lstatSync,
    openSync,
    readSync,
    realpathSync,
    writeSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { types } from 'node:util';
import { type FirstStartControlSource, projectFirstStartTerminal } from './first-start-control.ts';

export interface AssessmentAdmission {
    readonly result: 'admitted' | 'ineligible' | 'unavailable';
    readonly source: FirstStartControlSource | null;
}
export interface AssessmentAdmissionIo {
    readEvent(file: string): unknown;
    checkout(expectedSha: string): unknown;
}
export interface AssessmentFileIo {
    lstat(file: string): BigIntStats;
    realpath(file: string): string;
    open(file: string): number;
    fstat(fd: number): BigIntStats;
    read(fd: number, buffer: Buffer): number;
    close(fd: number): void;
}
export interface AssessmentPostflight {
    readonly eligibility: 'complete' | 'partial' | 'unavailable';
    readonly metadataToken: string | null;
    readonly files: readonly string[];
    readonly metadataCalls: number;
    readonly acquiredBytes: number;
}
const repository = 'Cirnouo/debugging-cdp-targets';
const ref = 'refs/heads/fix/chrome-startup-stall';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) && value !== '0'.repeat(40);
const slotNames = ['1', '2', '3', '4', '5', '6'] as const;
const filenames = Object.freeze([
    'job-index.json',
    'official-server.events.ndjson',
    'official-server.summary.json',
    'entry-recovery.events.ndjson',
    'entry-recovery.summary.json',
]);
const limits = [65_536, 1_048_576, 1_048_576, 1_048_576, 65_536] as const;
const eventLimit = 262_144;
const sourceKeys = ['eventSha', 'sourceSha', 'sourceTree', 'roundId', 'runId', 'slot'];
const environmentNames = {
    eventName: 'GITHUB_EVENT_NAME',
    repository: 'GITHUB_REPOSITORY',
    ref: 'GITHUB_REF',
    sha: 'GITHUB_SHA',
    workflow: 'GITHUB_WORKFLOW',
    workflowRef: 'GITHUB_WORKFLOW_REF',
    runnerOs: 'RUNNER_OS',
    runId: 'GITHUB_RUN_ID',
    runAttempt: 'GITHUB_RUN_ATTEMPT',
    job: 'GITHUB_JOB',
    enabled: 'DCT_ASSESSMENT_ENABLED',
    startupStudy: 'DCT_ASSESSMENT_STARTUP_STUDY',
    readaheadStudy: 'DCT_ASSESSMENT_READAHEAD_STUDY',
    roundId: 'DCT_ASSESSMENT_ROUND_ID',
    sourceSha: 'DCT_ASSESSMENT_SOURCE_SHA',
    sourceTree: 'DCT_ASSESSMENT_SOURCE_TREE',
} as const;
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value))
        throw Error('Unavailable.');
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw Error('Unavailable.');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 128) throw Error('Unavailable.');
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
        if (typeof key !== 'string' || key.length > 256) throw Error('Unavailable.');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) throw Error('Unavailable.');
        result[key] = descriptor.value;
    }
    return result;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    const fields = record(value);
    if (Object.keys(fields).length !== keys.length || keys.some((key) => !Object.hasOwn(fields, key)))
        throw Error('Unavailable.');
    return fields;
}
function own(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object' || types.isProxy(value)) throw Error('Unavailable.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!('value' in descriptor)) throw Error('Unavailable.');
    return descriptor.value;
}
function positive(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function positiveText(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value) && positive(Number(value));
}
function sourceValue(value: unknown): FirstStartControlSource {
    const fields = exact(value, sourceKeys);
    if (
        !sha(fields.eventSha) ||
        !sha(fields.sourceSha) ||
        fields.eventSha !== fields.sourceSha ||
        !sha(fields.sourceTree) ||
        typeof fields.roundId !== 'string' ||
        !uuid.test(fields.roundId) ||
        !positive(fields.runId) ||
        !Number.isInteger(fields.slot) ||
        Number(fields.slot) < 1 ||
        Number(fields.slot) > 6
    )
        throw Error('Unavailable.');
    return Object.freeze({
        eventSha: fields.eventSha,
        sourceSha: fields.sourceSha,
        sourceTree: fields.sourceTree,
        roundId: fields.roundId,
        runId: fields.runId,
        slot: Number(fields.slot),
    });
}
function bindingValue(value: unknown) {
    const fields = exact(value, ['source', 'collectionId']);
    if (typeof fields.collectionId !== 'string' || !uuid.test(fields.collectionId)) throw Error('Unavailable.');
    return Object.freeze({ source: sourceValue(fields.source), collectionId: fields.collectionId });
}
function contextValue(input: unknown, slot: unknown) {
    const value = exact(input, Object.keys(environmentNames));
    if (
        value.eventName !== 'workflow_dispatch' ||
        value.repository !== repository ||
        value.ref !== ref ||
        value.workflow !== 'CI' ||
        value.workflowRef !== `${repository}/.github/workflows/ci.yaml@${ref}` ||
        value.runnerOs !== 'Linux' ||
        value.runAttempt !== '1' ||
        !positiveText(value.runId) ||
        value.enabled !== 'true' ||
        value.startupStudy !== 'false' ||
        value.readaheadStudy !== 'false' ||
        !sha(value.sha) ||
        value.sha !== value.sourceSha ||
        !sha(value.sourceTree) ||
        typeof value.roundId !== 'string' ||
        !uuid.test(value.roundId) ||
        (!(slot === 'quality' && value.job === 'quality') &&
            !(
                typeof slot === 'string' &&
                slotNames.some((name) => name === slot) &&
                value.job === `ubuntu-first-start-assessment-${slot}`
            ))
    )
        throw Error('Ineligible.');
    return value;
}
// Bound traversal validates hostile pure inputs without invoking accessors/iterators/stringification.
function safeEvent(input: unknown) {
    let remaining = eventLimit;
    const seen = new Set<object>();
    function visit(value: unknown, depth: number) {
        if (--remaining < 0 || depth > 32) throw Error('Unavailable.');
        if (value === null || typeof value === 'boolean') return;
        if (typeof value === 'number' && Number.isFinite(value)) return;
        if (typeof value === 'string') {
            remaining -= Buffer.byteLength(value);
            if (remaining < 0) throw Error('Unavailable.');
            return;
        }
        if (!value || typeof value !== 'object' || seen.has(value) || types.isProxy(value)) throw Error('Unavailable.');
        seen.add(value);
        if (Array.isArray(value)) {
            if (
                Object.getPrototypeOf(value) !== Array.prototype ||
                value.length > 4096 ||
                Reflect.ownKeys(value).length !== value.length + 1
            )
                throw Error('Unavailable.');
            for (let index = 0; index < value.length; index++) visit(own(value, String(index)), depth + 1);
        } else {
            for (const [key, child] of Object.entries(record(value))) {
                remaining -= Buffer.byteLength(key);
                visit(child, depth + 1);
            }
        }
    }
    visit(input, 0);
    return record(input);
}
function admittedSource(context: Record<string, unknown>, slot: unknown): FirstStartControlSource | null {
    return slot === 'quality'
        ? null
        : sourceValue({
              eventSha: context.sha,
              sourceSha: context.sourceSha,
              sourceTree: context.sourceTree,
              roundId: context.roundId,
              runId: Number(context.runId),
              slot: Number(slot),
          });
}
/** Verified data only: this cannot supply human authorization or enforce a global one-use round. */
export function evaluateFirstStartAssessmentAdmission(input: unknown): AssessmentAdmission {
    try {
        const fields = exact(input, ['context', 'event', 'checkout', 'slot']);
        const context = contextValue(fields.context, fields.slot);
        const event = safeEvent(fields.event);
        const checkout = exact(fields.checkout, ['sha', 'tree', 'objectTree', 'clean']);
        if (
            checkout.sha !== context.sourceSha ||
            checkout.tree !== context.sourceTree ||
            checkout.objectTree !== context.sourceTree ||
            checkout.clean !== true
        )
            throw Error('Ineligible.');
        if (Object.hasOwn(event, 'ref') && event.ref !== ref && event.ref !== ref.slice('refs/heads/'.length))
            throw Error('Ineligible.');
        if (Object.hasOwn(event, 'repository') && record(event.repository).full_name !== repository)
            throw Error('Ineligible.');
        if (
            Object.hasOwn(event, 'workflow') &&
            (typeof event.workflow !== 'string' ||
                !['CI', 'ci.yaml', '.github/workflows/ci.yaml'].includes(event.workflow))
        )
            throw Error('Ineligible.');
        if (Object.hasOwn(event, 'inputs')) {
            const inputs = record(event.inputs);
            const pairs = {
                'ubuntu-first-start-assessment': context.enabled,
                'ubuntu-startup-study': context.startupStudy,
                'ubuntu-readahead-study': context.readaheadStudy,
                'assessment-round-id': context.roundId,
                'assessment-source-sha': context.sourceSha,
                'assessment-source-tree': context.sourceTree,
            };
            for (const [key, expected] of Object.entries(pairs)) {
                if (Object.hasOwn(inputs, key) && inputs[key] !== expected) throw Error('Ineligible.');
            }
        }
        return Object.freeze({ result: 'admitted', source: admittedSource(context, fields.slot) });
    } catch {
        return Object.freeze({ result: 'ineligible', source: null });
    }
}
function environmentContext(environment: unknown) {
    return Object.fromEntries(Object.entries(environmentNames).map(([key, name]) => [key, own(environment, name)]));
}
const nativeFiles: AssessmentFileIo = {
    lstat: (file) => lstatSync(file, { bigint: true }),
    realpath: realpathSync,
    open: (file) => openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)),
    fstat: (fd) => fstatSync(fd, { bigint: true }),
    read: (fd, buffer) => readSync(fd, buffer, 0, buffer.length, 0),
    close: closeSync,
};
function identity(metadata: BigIntStats): string[] {
    return [
        metadata.dev,
        metadata.ino,
        metadata.mode,
        metadata.nlink,
        metadata.uid,
        metadata.gid,
        metadata.size,
        metadata.mtimeNs,
        metadata.ctimeNs,
    ].map((value) => value.toString());
}
function same(left: BigIntStats, right: BigIntStats) {
    return identity(left).join(':') === identity(right).join(':');
}
function boundedBody(fd: number, metadata: BigIntStats, maximum: number, io: AssessmentFileIo): Buffer {
    if (!metadata.isFile() || metadata.size < 0n || metadata.size > BigInt(maximum)) throw Error('Unavailable.');
    const buffer = Buffer.alloc(Number(metadata.size) + 1);
    const count = io.read(fd, buffer);
    if (count !== Number(metadata.size)) throw Error('Unavailable.');
    return buffer.subarray(0, count);
}
function json(buffer: Buffer): unknown {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
}
const nativeAdmission: AssessmentAdmissionIo = {
    readEvent(file) {
        const before = nativeFiles.lstat(file);
        if (!before.isFile() || before.isSymbolicLink()) throw Error('Unavailable.');
        const fd = nativeFiles.open(file);
        try {
            const initial = nativeFiles.fstat(fd);
            if (!same(before, initial)) throw Error('Unavailable.');
            const body = boundedBody(fd, initial, eventLimit, nativeFiles);
            if (!same(initial, nativeFiles.fstat(fd)) || !same(initial, nativeFiles.lstat(file)))
                throw Error('Unavailable.');
            return body;
        } finally {
            nativeFiles.close(fd);
        }
    },
    checkout(expectedSha) {
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
        const git = (args: string[]) =>
            execFileSync('git', args, {
                encoding: 'utf8',
                shell: false,
                windowsHide: true,
                timeout: 2_000,
                maxBuffer: 8_192,
                stdio: ['ignore', 'pipe', 'pipe'],
                env,
            }).trim();
        return {
            sha: git(['rev-parse', '--verify', 'HEAD']),
            tree: git(['rev-parse', '--verify', 'HEAD^{tree}']),
            objectTree: git(['rev-parse', '--verify', `${expectedSha}^{tree}`]),
            clean: git(['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']) === '',
        };
    },
};
/** Invalid context is rejected before bounded dispatch/git I/O; no target resources are acquired here. */
export function readFirstStartAssessmentAdmission(
    slot: unknown,
    environment: unknown = process.env,
    io: AssessmentAdmissionIo = nativeAdmission,
): AssessmentAdmission {
    let context: Record<string, unknown>;
    try {
        context = contextValue(environmentContext(environment), slot);
    } catch {
        return { result: 'ineligible', source: null };
    }
    try {
        const file = own(environment, 'GITHUB_EVENT_PATH');
        if (
            typeof file !== 'string' ||
            !path.isAbsolute(file) ||
            file.length > 4096 ||
            file.includes('\0') ||
            !sha(context.sourceSha)
        )
            throw Error('Unavailable.');
        const bytes = io.readEvent(file);
        if (!Buffer.isBuffer(bytes) || bytes.length > eventLimit) throw Error('Unavailable.');
        const event = json(bytes);
        return evaluateFirstStartAssessmentAdmission({
            context,
            event,
            checkout: io.checkout(context.sourceSha),
            slot,
        });
    } catch {
        return { result: 'unavailable', source: null };
    }
}
function metadataBudget(maximum: number) {
    let calls = 0;
    return {
        call<T>(action: () => T): T {
            if (calls >= maximum) throw Error('Unavailable.');
            calls++;
            return action();
        },
        count: () => calls,
    };
}
function realDirectory(directory: string, io: AssessmentFileIo, budget: ReturnType<typeof metadataBudget>) {
    if (
        typeof directory !== 'string' ||
        directory.length > 4096 ||
        !path.isAbsolute(directory) ||
        directory.includes('\0')
    )
        throw Error('Unavailable.');
    const metadata = budget.call(() => io.lstat(directory));
    if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        budget.call(() => io.realpath(directory)) !== path.resolve(directory)
    )
        throw Error('Unavailable.');
    return metadata;
}
function regular(metadata: BigIntStats, index: number) {
    if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size < 0n ||
        metadata.size > BigInt(limits[index] ?? 0)
    )
        throw Error('Unavailable.');
}
function digest(binding: ReturnType<typeof bindingValue>, directory: BigIntStats, tokens: string[][]) {
    return createHash('sha256')
        .update(
            JSON.stringify({
                source: binding.source,
                attempt: 1,
                collectionId: binding.collectionId,
                directory: [directory.dev.toString(), directory.ino.toString()],
                files: filenames.map((name, index) => [name, tokens[index]]),
            }),
        )
        .digest('hex');
}
function summaryOwnership(value: unknown, fixture: string, binding: ReturnType<typeof bindingValue>) {
    const fields = record(value);
    if (
        fields.schemaVersion !== 1 ||
        fields.fixture !== fixture ||
        fields.collectionId !== binding.collectionId ||
        fields.run !== binding.source.runId ||
        fields.attempt !== 1 ||
        fields.commit !== binding.source.sourceSha ||
        fields.platform !== 'linux' ||
        fields.collectionRejected !== false
    )
        throw Error('Unavailable.');
    return fields;
}
function indexOwnership(value: unknown, binding: ReturnType<typeof bindingValue>, mode: 'complete' | 'partial') {
    const index = exact(value, ['schemaVersion', 'collectionId', 'stage', 'fixtures', 'files']);
    const fixtures = exact(index.fixtures, ['official-server', 'entry-recovery']);
    if (
        index.schemaVersion !== 1 ||
        index.collectionId !== binding.collectionId ||
        fixtures['entry-recovery'] !== 'not-run' ||
        (!(index.stage === 'official-server' && fixtures['official-server'] === 'running') &&
            !(mode === 'partial' && index.stage === 'prerequisites' && fixtures['official-server'] === 'not-run')) ||
        !Array.isArray(index.files) ||
        index.files.length !== filenames.length
    )
        throw Error('Unavailable.');
    const indexedFiles = index.files;
    if (filenames.some((name, position) => indexedFiles[position] !== name)) throw Error('Unavailable.');
}
function structuralSuccess(summary: unknown, binding: ReturnType<typeof bindingValue>) {
    // Parent expectations and cleanup are caller facts, absent from persisted summaries.
    // Validate the capture without fabricating those facts or calling terminal qualification.
    const projected = projectFirstStartTerminal(summary, {
        expected: { collectionId: binding.collectionId },
        source: binding.source,
    });
    if (!projected.valid) return false;
    const fields = projected.record;
    const creation = record(fields.creation);
    const writer = record(fields.writer);
    const reduction = record(fields.reduction);
    const retention = record(fields.retention);
    const cleanWriter = (value: unknown) => {
        const state = record(value);
        return (
            state.available === true &&
            state.exhausted === false &&
            state.releaseFailed === false &&
            state.writeFailed === false
        );
    };
    return (
        fields.collection === 'available' &&
        fields.configured === true &&
        fields.selection === 'armed' &&
        fields.firstOutcome === 'succeeded' &&
        retention.state === 'discarded' &&
        fields.observerTerminal === 'complete' &&
        Array.isArray(fields.slots) &&
        fields.slots.length === 6 &&
        !fields.slots.includes('not-observed') &&
        creation.stats === 'available' &&
        Number(creation.sourceAttempts) > 0 &&
        Number(creation.comparisons) > 0 &&
        cleanWriter(writer.parent) &&
        cleanWriter(writer.child) &&
        writer.observerSinkFailed === 0 &&
        reduction.writeFailed === false &&
        reduction.truncated === false &&
        reduction.invalidEvents === 0 &&
        reduction.droppedEvents === 0 &&
        reduction.captureOmitted === 0 &&
        reduction.diagnosticAbsent === false &&
        reduction.linuxStartupWaitOmitted === 0 &&
        reduction.readaheadStudyOmitted === 0 &&
        Array.isArray(fields.limitations) &&
        fields.limitations.every((item) => item === 'self-report-write-unavailable') &&
        (reduction.incomplete === false || fields.limitations.includes('self-report-write-unavailable')) &&
        fields.fixtureOutcome === 'passed'
    );
}
/** Pre-upload fixed-path ownership and bounded body acquisition, with a reserved 30-call allowance. */
export function checkFirstStartAssessmentFiles(
    directory: string,
    input: unknown,
    mode: 'complete' | 'partial',
    io: AssessmentFileIo = nativeFiles,
): AssessmentPostflight {
    const budget = metadataBudget(30);
    let acquiredBytes = 0;
    try {
        const binding = bindingValue(input);
        if (mode !== 'complete' && mode !== 'partial') throw Error('Unavailable.');
        const root = realDirectory(directory, io, budget);
        const tokens: string[][] = [];
        const bodies = new Map<string, unknown>();
        for (const [index, name] of filenames.entries()) {
            const file = path.join(directory, name);
            const initial = budget.call(() => io.lstat(file));
            regular(initial, index);
            const fd = io.open(file);
            try {
                const before = budget.call(() => io.fstat(fd));
                regular(before, index);
                if (!same(initial, before)) throw Error('Unavailable.');
                if (name.endsWith('.json')) {
                    // Reserve metadata.size+1 bytes before the sole body read, even when it fails.
                    acquiredBytes += Number(before.size) + 1;
                    if (acquiredBytes > 1_179_651) throw Error('Unavailable.');
                    const body = boundedBody(fd, before, limits[index] ?? 0, io);
                    bodies.set(name, json(body));
                }
                const after = budget.call(() => io.fstat(fd));
                if (!same(before, after)) throw Error('Unavailable.');
            } finally {
                io.close(fd);
            }
            tokens.push(identity(initial));
        }
        for (const [index, name] of filenames.entries()) {
            const final = budget.call(() => io.lstat(path.join(directory, name)));
            regular(final, index);
            if (tokens[index]?.join(':') !== identity(final).join(':')) throw Error('Unavailable.');
        }
        if (!same(root, realDirectory(directory, io, budget))) throw Error('Unavailable.');
        indexOwnership(bodies.get('job-index.json'), binding, mode);
        const official = summaryOwnership(bodies.get('official-server.summary.json'), 'official-server', binding);
        const entry = summaryOwnership(bodies.get('entry-recovery.summary.json'), 'entry-recovery', binding);
        if (
            entry.state !== 'not-run' ||
            entry.firstStartCaptureArmed !== false ||
            !Array.isArray(entry.firstStartCapture) ||
            entry.firstStartCapture.length !== 0 ||
            tokens[3]?.[6] !== '0'
        )
            throw Error('Unavailable.');
        if (mode === 'complete') {
            if (tokens[1]?.[6] === '0' || !structuralSuccess(official, binding)) throw Error('Unavailable.');
            return Object.freeze({
                eligibility: 'complete',
                metadataToken: digest(binding, root, tokens),
                files: filenames,
                metadataCalls: budget.count(),
                acquiredBytes,
            });
        }
        // A running summary cannot prove that the writer has closed. Missing files have no invented ownership.
        if (official.state !== 'passed' && official.state !== 'failed' && official.state !== 'not-run')
            throw Error('Unavailable.');
        return Object.freeze({
            eligibility: 'partial',
            metadataToken: null,
            files: filenames,
            metadataCalls: budget.count(),
            acquiredBytes,
        });
    } catch {
        return Object.freeze({
            eligibility: 'unavailable',
            metadataToken: null,
            files: Object.freeze([]),
            metadataCalls: budget.count(),
            acquiredBytes,
        });
    }
}
/** Separate metadata-only 18-call allowance: aggregate pre/post cannot exceed 48. */
export function postcheckFirstStartAssessmentFiles(
    directory: string,
    input: unknown,
    token: unknown,
    io: AssessmentFileIo = nativeFiles,
): boolean {
    const budget = metadataBudget(18);
    try {
        const binding = bindingValue(input);
        if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
        const root = realDirectory(directory, io, budget);
        const tokens: string[][] = [];
        for (const [index, name] of filenames.entries()) {
            const file = path.join(directory, name);
            const before = budget.call(() => io.lstat(file));
            regular(before, index);
            tokens.push(identity(before));
        }
        for (const [index, name] of filenames.entries()) {
            const after = budget.call(() => io.lstat(path.join(directory, name)));
            regular(after, index);
            if (tokens[index]?.join(':') !== identity(after).join(':')) return false;
        }
        if (!same(root, realDirectory(directory, io, budget))) return false;
        return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(digest(binding, root, tokens), 'hex'));
    } catch {
        return false;
    }
}
/** Exactly one existing-output-file write; validation/partial/error paths do not retry. */
export function writeAssessmentOutput(field: unknown, value: unknown, write: (line: string) => number): boolean {
    if (
        !(field === 'metadata-token' && typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) &&
        !(field === 'safe-to-continue' && value === 'true') &&
        !(field === 'partial-eligible' && value === 'true')
    )
        return false;
    const line = `${field}=${value}\n`;
    if (Buffer.byteLength(line) > 128) return false;
    try {
        return write(line) === Buffer.byteLength(line);
    } catch {
        return false;
    }
}
function writeOutput(environment: unknown, field: string, value: string) {
    const file = own(environment, 'GITHUB_OUTPUT');
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.length > 4096 || file.includes('\0')) return false;
    const fd = openSync(
        file,
        constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
        return writeAssessmentOutput(field, value, (line) => writeSync(fd, line));
    } finally {
        closeSync(fd);
    }
}
function cli() {
    try {
        const [command, ...args] = process.argv.slice(2);
        if (command === 'quality' && args.length === 0) {
            const enabled = own(process.env, 'DCT_ASSESSMENT_ENABLED');
            const startup = own(process.env, 'DCT_ASSESSMENT_STARTUP_STUDY');
            const readahead = own(process.env, 'DCT_ASSESSMENT_READAHEAD_STUDY');
            if (
                !['true', 'false'].includes(String(enabled)) ||
                !['true', 'false'].includes(String(startup)) ||
                !['true', 'false'].includes(String(readahead)) ||
                [enabled, startup, readahead].filter((value) => value === 'true').length > 1
            )
                throw Error('Unavailable.');
            if (enabled === 'false') return;
            if (readFirstStartAssessmentAdmission('quality').result !== 'admitted') throw Error('Unavailable.');
            return;
        }
        if (
            !['pre-upload', 'partial-upload', 'postcheck'].includes(command ?? '') ||
            args.length !== 3 ||
            args[1] !== '--assessment-slot'
        )
            throw Error('Unavailable.');
        const [directory, , slot] = args;
        if (!directory) throw Error('Unavailable.');
        const context = contextValue(environmentContext(process.env), slot);
        const binding = bindingValue({
            source: admittedSource(context, slot),
            collectionId: own(process.env, 'DCT_ASSESSMENT_COLLECTION_ID'),
        });
        if (command === 'postcheck') {
            if (
                !postcheckFirstStartAssessmentFiles(
                    directory,
                    binding,
                    own(process.env, 'DCT_ASSESSMENT_METADATA_TOKEN'),
                ) ||
                !writeOutput(process.env, 'safe-to-continue', 'true')
            )
                throw Error('Unavailable.');
        } else {
            const result = checkFirstStartAssessmentFiles(
                directory,
                binding,
                command === 'pre-upload' ? 'complete' : 'partial',
            );
            if (command === 'pre-upload') {
                if (
                    result.eligibility !== 'complete' ||
                    !result.metadataToken ||
                    !writeOutput(process.env, 'metadata-token', result.metadataToken)
                )
                    throw Error('Unavailable.');
            } else if (result.eligibility !== 'partial' || !writeOutput(process.env, 'partial-eligible', 'true'))
                throw Error('Unavailable.');
        }
    } catch {
        console.error('First-start assessment evidence unavailable; continuation is refused.');
        process.exitCode = 1;
    }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) cli();
