import { firstStartControlSlots, validateFirstStartWriterCost } from './fixture-stream-quota.ts';
import {
    type captureAuxiliarySlots,
    captureClosed,
    type FirstStartCaptureRecord,
    validateFirstStartCaptureRecord,
} from './linux-first-start-capture-record.ts';

type Phase = 'admission' | 'terminal';
type Availability = boolean | null;
export interface FirstStartControlSource {
    readonly eventSha: string;
    readonly sourceSha: string;
    readonly sourceTree: string;
    readonly roundId: string;
    readonly runId: number;
    readonly slot: number;
}
export interface FirstStartControlContext {
    readonly expected?: Readonly<{ entryId?: string | null; requestId?: string | null; collectionId?: string | null }>;
    readonly cleanup?: Readonly<{
        targetClosed: Availability;
        gatewayExited: Availability;
        profileDeleted: Availability;
    }>;
    readonly source?: FirstStartControlSource;
}
export interface FirstStartControlProjection {
    readonly phase: Phase;
    readonly valid: boolean;
    readonly record: Readonly<Record<string, unknown>>;
    readonly line: string;
}
const minted = new WeakMap<object, { phase: Phase; valid: boolean; line: string; qualified: boolean }>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{40}$/;
const identityKeys = ['entryId', 'connectionId', 'sessionId', 'operationId', 'requestId'] as const;
const limitationNames = [
    'selection-missing',
    'outcome-missing',
    'terminal-missing',
    'receipt-missing',
    'self-report-write-unavailable',
    'writer-cost-missing',
    'writer-scan-budget',
    'writer-stream-discontinuity',
    'writer-budget-or-capacity',
    'writer-release-failed',
    'collection-unavailable',
] as const;
const summaryKeys = [
    'schemaVersion',
    'fixture',
    'state',
    'collectionId',
    'collectionRejected',
    'run',
    'attempt',
    'commit',
    'platform',
    'lastStage',
    'smokeStage',
    'primary',
    'secondary',
    'events',
    'droppedEvents',
    'invalidEvents',
    'writeFailed',
    'truncated',
    'gatewayEvents',
    'diagnosticAbsent',
    'lastOperationId',
    'incomplete',
    'browserStartup',
    'collectorCost',
    'linuxStartupWait',
    'linuxStartupWaitOmitted',
    'readaheadStudy',
    'readaheadStudyOmitted',
    'firstStartCapture',
    'firstStartCaptureArmed',
    'firstStartCaptureOmitted',
    'firstStartCaptureLimitations',
    'firstStartCaptureWriter',
    'firstStartCaptureWriterChild',
] as const;
const integer = (value: unknown, maximum: number): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const member = (value: unknown, values: readonly string[]): value is string =>
    typeof value === 'string' && values.includes(value);

/** Copy arrays by data descriptors; never invoke element accessors or iterators. */
function array(value: unknown, maximum: number): unknown[] | undefined {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
    const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!integer(length, maximum) || Reflect.ownKeys(value).length !== length + 1) return;
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) return;
        result.push(descriptor.value);
    }
    return result;
}
function freeze(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
    for (const child of Object.values(value)) {
        if (Array.isArray(child)) Object.freeze(child);
        else if (child && typeof child === 'object') freeze(child as Record<string, unknown>);
    }
    return Object.freeze(value);
}
function projection(phase: Phase, record: Record<string, unknown>, qualified = false): FirstStartControlProjection {
    let line = `${JSON.stringify(record)}\n`;
    let valid = true;
    if (Buffer.byteLength(line) > 4096) {
        valid = false;
        record = { schemaVersion: 1, kind: 'first-start-control-unavailable', phase, reason: 'oversize' };
        line = `${JSON.stringify(record)}\n`;
    }
    const result = Object.freeze({ phase, valid, record: freeze(record), line });
    minted.set(result, { phase, valid, line, qualified: valid && qualified });
    return result;
}
function invalid(phase: Phase): FirstStartControlProjection {
    const record = Object.freeze({
        schemaVersion: 1,
        kind: 'first-start-control-unavailable',
        phase,
        reason: 'invalid',
    });
    const line = `${JSON.stringify(record)}\n`;
    const result = Object.freeze({ phase, valid: false, record, line });
    minted.set(result, { phase, valid: false, line, qualified: false });
    return result;
}
function context(value: unknown) {
    const fields = captureClosed(value ?? {}, ['expected', 'cleanup', 'source']);
    if (!fields) return;
    const expected = captureClosed(fields.expected ?? {}, ['entryId', 'requestId', 'collectionId']);
    const cleanup = captureClosed(
        fields.cleanup ?? {
            targetClosed: null,
            gatewayExited: null,
            profileDeleted: null,
        },
        ['targetClosed', 'gatewayExited', 'profileDeleted'],
    );
    if (!expected || !cleanup || Object.keys(cleanup).length !== 3) return;
    for (const item of Object.values(expected))
        if (item !== null && (typeof item !== 'string' || !uuid.test(item))) return;
    for (const item of Object.values(cleanup)) if (item !== null && typeof item !== 'boolean') return;
    let source: Record<string, unknown> | null = null;
    if ('source' in fields) {
        source =
            captureClosed(fields.source, ['eventSha', 'sourceSha', 'sourceTree', 'roundId', 'runId', 'slot']) ?? null;
        if (
            !source ||
            Object.keys(source).length !== 6 ||
            ['eventSha', 'sourceSha', 'sourceTree'].some(
                (key) => typeof source?.[key] !== 'string' || !sha.test(String(source[key])),
            ) ||
            typeof source.roundId !== 'string' ||
            !uuid.test(source.roundId) ||
            !integer(source.runId, Number.MAX_SAFE_INTEGER) ||
            source.runId === 0 ||
            !integer(source.slot, 6) ||
            source.slot === 0
        )
            return;
    }
    return { expected, cleanup, source };
}

/** Admission consumes only the already acquired closed result/context, without I/O. */
export function projectFirstStartAdmission(admission: unknown, input?: unknown): FirstStartControlProjection {
    try {
        const facts = context(input);
        if (!facts || !member(admission, ['admitted', 'ineligible', 'unavailable'])) return invalid('admission');
        return projection('admission', {
            schemaVersion: 1,
            kind: 'first-start-control',
            phase: 'admission',
            result: admission,
            source: facts.source,
        });
    } catch {
        return invalid('admission');
    }
}

function writer(value: unknown, parent: boolean) {
    if (value === null) return null;
    const costKeys = [
        'attempts',
        'dataAttempts',
        'markerAttempts',
        'metadataReserved',
        'scannedBytes',
        'exhausted',
        'releaseFailed',
        'writeFailed',
        'selfReportWriteUnavailable',
    ];
    const fields = captureClosed(
        value,
        parent ? [...costKeys, 'events', 'bytes', 'counts', 'controlSlots'] : ['kind', ...costKeys],
    );
    if (!fields || Object.keys(fields).length !== (parent ? 13 : 10)) return;
    if (!parent && fields.kind !== 'first-start-writer-cost') return;
    const cost: Record<string, unknown> = { kind: 'first-start-writer-cost' };
    for (const key of costKeys) cost[key] = fields[key];
    const validated = validateFirstStartWriterCost(cost);
    if (!validated || (parent && (validated.attempts > 4 || validated.dataAttempts > 4))) return;
    if (parent) {
        if (!integer(fields.events, 2000) || !integer(fields.bytes, 1_048_576)) return;
        const counts = captureClosed(fields.counts, ['ordinary', 'capture', 'control', 'marker']);
        if (!counts || Object.keys(counts).length !== 4) return;
        let totalEvents = 0;
        let totalBytes = 0;
        for (const [key, maxEvents, maxBytes] of [
            ['ordinary', 1900, 624 * 1024],
            ['capture', 64, 256 * 1024],
            ['control', 32, 128 * 1024],
            ['marker', 4, 16 * 1024],
        ] as const) {
            const count = captureClosed(counts[key], ['events', 'bytes']);
            if (
                !count ||
                Object.keys(count).length !== 2 ||
                !integer(count.events, maxEvents) ||
                !integer(count.bytes, maxBytes)
            )
                return;
            totalEvents += count.events;
            totalBytes += count.bytes;
        }
        if (totalEvents !== fields.events || totalBytes !== fields.bytes) return;
        const slots = array(fields.controlSlots, 32);
        if (
            !slots ||
            slots.some((slot) => !member(slot, firstStartControlSlots)) ||
            new Set(slots).size !== slots.length
        )
            return;
    }
    return {
        available: true,
        attempts: validated.attempts,
        dataAttempts: validated.dataAttempts,
        markerAttempts: validated.markerAttempts,
        metadataReserved: validated.metadataReserved,
        scannedBytes: validated.scannedBytes,
        exhausted: validated.exhausted,
        releaseFailed: validated.releaseFailed,
        writeFailed: validated.writeFailed,
        selfReportWriteUnavailable: true,
    };
}

/** Terminal projection uses only finished collector memory and caller-verified facts. */
export function projectFirstStartTerminal(summary: unknown, input: unknown): FirstStartControlProjection {
    try {
        const fields = captureClosed(summary, summaryKeys);
        const facts = context(input);
        if (
            !fields ||
            !facts ||
            fields.schemaVersion !== 1 ||
            fields.fixture !== 'official-server' ||
            !member(fields.state, ['not-run', 'running', 'passed', 'failed']) ||
            fields.platform !== 'linux'
        )
            return invalid('terminal');
        for (const key of [
            'firstStartCaptureArmed',
            'collectionRejected',
            'writeFailed',
            'truncated',
            'incomplete',
            'diagnosticAbsent',
        ])
            if (typeof fields[key] !== 'boolean') return invalid('terminal');
        for (const key of [
            'events',
            'gatewayEvents',
            'droppedEvents',
            'invalidEvents',
            'firstStartCaptureOmitted',
            'linuxStartupWaitOmitted',
            'readaheadStudyOmitted',
        ])
            if (!integer(fields[key], Number.MAX_SAFE_INTEGER)) return invalid('terminal');
        if (
            fields.collectionId !== null &&
            (typeof fields.collectionId !== 'string' || !uuid.test(fields.collectionId))
        )
            return invalid('terminal');
        if (facts.expected.collectionId && fields.collectionId !== facts.expected.collectionId)
            return invalid('terminal');
        const rawRecords = array(fields.firstStartCapture, 64);
        const limitations = array(fields.firstStartCaptureLimitations, limitationNames.length);
        if (
            !rawRecords ||
            !limitations ||
            limitations.some((item) => !member(item, limitationNames)) ||
            new Set(limitations).size !== limitations.length
        )
            return invalid('terminal');
        const records: FirstStartCaptureRecord[] = [];
        const used = new Set<string>();
        for (const raw of rawRecords) {
            const record = validateFirstStartCaptureRecord(raw);
            if (!record) return invalid('terminal');
            const key =
                record.slot === 'family'
                    ? `family:${record.phase}:${record.family}:${record.scope ?? 0}`
                    : record.slot === 'cost'
                      ? `cost:${record.phase}`
                      : record.slot;
            if (used.has(key)) return invalid('terminal');
            used.add(key);
            records.push(record);
        }
        const get = (slot: (typeof captureAuxiliarySlots)[number]) => records.find((record) => record.slot === slot);
        const selection = get('selection');
        let selected: Record<string, unknown> | null = null;
        if (selection) {
            if (
                !fields.firstStartCaptureArmed ||
                selection.status !== 'armed' ||
                identityKeys.some((key) => !selection[key])
            )
                return invalid('terminal');
            if (
                (facts.expected.entryId && selection.entryId !== facts.expected.entryId) ||
                (facts.expected.requestId && selection.requestId !== facts.expected.requestId)
            )
                return invalid('terminal');
            selected = {};
            for (const key of identityKeys) selected[key] = selection[key];
            for (const record of records)
                if (identityKeys.some((key) => record[key] !== selection[key])) return invalid('terminal');
        } else if (records.length) return invalid('terminal');
        const root = get('root-binding');
        if (root && root.status !== 'bound' && root.status !== 'unavailable') return invalid('terminal');
        if (root?.status === 'bound' && (!root.pid || root.rootStartTicks === undefined)) return invalid('terminal');
        for (const key of ['pid', 'rootStartTicks'] as const)
            if (new Set(records.map((record) => record[key]).filter((value) => value !== undefined)).size > 1)
                return invalid('terminal');
        const outcome = get('first-start-outcome');
        if (outcome && !member(outcome.status, ['succeeded', 'failed', 'cancelled'])) return invalid('terminal');
        const retained = get('retention-decision');
        if (retained && !member(retained.status, ['discarded', 'retained'])) return invalid('terminal');
        if (retained && outcome && (outcome.status === 'succeeded') !== (retained.status === 'discarded'))
            return invalid('terminal');
        const counts: Record<string, unknown> = {};
        for (const key of ['discarded', 'admitted', 'completed', 'pending', 'skipped'] as const) {
            const value = retained?.metrics?.[key];
            if (value !== undefined && !integer(value, key === 'discarded' ? 64 : 6)) return invalid('terminal');
            counts[key] = value ?? null;
        }
        if (
            retained &&
            (!retained.metrics ||
                Object.values(counts).some((value) => value === null) ||
                Number(counts.admitted) + Number(counts.skipped) !== 6)
        )
            return invalid('terminal');
        const slots = get('six-slot-status');
        if (slots && (slots.status !== 'complete' || !slots.slots)) return invalid('terminal');
        const observer = get('observer-terminal');
        if (observer && observer.status !== 'complete') return invalid('terminal');
        const receipt = get('limitations')?.creationObservation;
        const creation = {
            stats: receipt?.stats ?? 'unavailable',
            sourceAttempts: receipt?.sourceAttempts ?? null,
            comparisons: receipt?.comparisons ?? null,
            tokens: receipt?.tokens ?? null,
            retained: receipt?.retained ?? null,
            omitted: receipt?.omitted ?? null,
            capped: receipt?.capped ?? null,
            disabled: receipt?.disabled ?? null,
            revoked: receipt?.revoked ?? null,
            producerCpu: 'unmeasured',
        };
        const parent = writer(fields.firstStartCaptureWriter, true);
        const child = writer(fields.firstStartCaptureWriterChild, false);
        if (parent === undefined || child === undefined) return invalid('terminal');
        const observerWriter = get('writer-state');
        if (
            observerWriter &&
            (observerWriter.status !== 'partial' ||
                observerWriter.reason !== 'incomplete' ||
                !integer(observerWriter.metrics?.sinkCalls, 64) ||
                !integer(observerWriter.metrics?.sinkFailed, 64))
        )
            return invalid('terminal');
        let creationModel = 'unavailable';
        if ((outcome?.status === 'failed' || outcome?.status === 'cancelled') && retained?.status === 'retained') {
            const models = new Set(
                records
                    .filter((record) => record.creation)
                    .map((record) =>
                        record.creation && 'model' in record.creation ? record.creation.model : 'legacy-scalar',
                    ),
            );
            if (models.size === 1) creationModel = [...models][0] ?? 'unavailable';
        }
        if (
            outcome?.status === 'succeeded' &&
            records.some((record) => record.creation || record.slot === 'family' || record.slot.endsWith('epoch'))
        )
            return invalid('terminal');
        const cleanWriter = (value: typeof parent) =>
            !!value && !value.exhausted && !value.releaseFailed && !value.writeFailed;
        const qualified =
            !!facts.expected.entryId &&
            !!facts.expected.requestId &&
            !!facts.expected.collectionId &&
            fields.collectionId !== null &&
            !fields.collectionRejected &&
            fields.firstStartCaptureArmed === true &&
            !!selected &&
            outcome?.status === 'succeeded' &&
            retained?.status === 'discarded' &&
            !!slots &&
            observer?.status === 'complete' &&
            creation.stats === 'available' &&
            Number(creation.sourceAttempts) > 0 &&
            Number(creation.comparisons) > 0 &&
            cleanWriter(parent) &&
            cleanWriter(child) &&
            observerWriter?.metrics?.sinkFailed === 0 &&
            fields.writeFailed === false &&
            fields.truncated === false &&
            fields.invalidEvents === 0 &&
            fields.droppedEvents === 0 &&
            fields.firstStartCaptureOmitted === 0 &&
            fields.linuxStartupWaitOmitted === 0 &&
            fields.readaheadStudyOmitted === 0 &&
            fields.diagnosticAbsent === false &&
            limitations.every((item) => item === 'self-report-write-unavailable') &&
            (fields.incomplete === false || limitations.includes('self-report-write-unavailable')) &&
            fields.state === 'passed' &&
            Object.values(facts.cleanup).every((value) => value === true);
        return projection(
            'terminal',
            {
                schemaVersion: 1,
                kind: 'first-start-control',
                phase: 'terminal',
                collectionId: fields.collectionId,
                collection: fields.collectionRejected ? 'rejected' : fields.collectionId ? 'available' : 'unavailable',
                configured: fields.firstStartCaptureArmed,
                selection: selection ? 'armed' : 'not-observed',
                selected,
                parentBinding: selected && facts.expected.entryId && facts.expected.requestId ? 'bound' : 'unavailable',
                rootBinding: root?.status ?? 'not-observed',
                firstOutcome: outcome?.status ?? 'not-observed',
                outcomeReason: outcome?.outcomeReason ?? 'unavailable',
                retention: { state: retained?.status ?? 'not-observed', counts },
                slots: slots?.slots ? [...slots.slots] : Array(6).fill('not-observed'),
                observerTerminal: observer?.status ?? 'not-observed',
                creation,
                creationModel,
                nativeReadinessElapsedMs: null,
                writer: { parent, child, observerSinkFailed: observerWriter?.metrics?.sinkFailed ?? null },
                reduction: {
                    writeFailed: fields.writeFailed,
                    truncated: fields.truncated,
                    incomplete: fields.incomplete,
                    invalidEvents: fields.invalidEvents,
                    droppedEvents: fields.droppedEvents,
                    captureOmitted: fields.firstStartCaptureOmitted,
                    diagnosticAbsent: fields.diagnosticAbsent,
                    linuxStartupWaitOmitted: fields.linuxStartupWaitOmitted,
                    readaheadStudyOmitted: fields.readaheadStudyOmitted,
                },
                limitations: [...limitations],
                fixtureOutcome: fields.state,
                cleanup: facts.cleanup,
                source: facts.source,
            },
            qualified,
        );
    } catch {
        return invalid('terminal');
    }
}

/** Capture qualification is independent of stdout success and caller/global state. */
export function qualifyFirstStartTerminal(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const receipt = minted.get(value);
    return receipt?.phase === 'terminal' && receipt.valid && receipt.qualified;
}

/** One injected synchronous bounded write per phase. No retries, listeners or waits. */
export function createFirstStartControlEmitter(write: (line: string) => number) {
    const attempted = new Set<Phase>();
    return {
        emit(value: unknown): Readonly<{ attempted: boolean; writeOk: boolean }> {
            const receipt = value && typeof value === 'object' ? minted.get(value) : undefined;
            if (!receipt || attempted.has(receipt.phase)) return { attempted: false, writeOk: false };
            attempted.add(receipt.phase);
            try {
                const written = write(receipt.line);
                return { attempted: true, writeOk: receipt.valid && written === Buffer.byteLength(receipt.line) };
            } catch {
                return { attempted: true, writeOk: false };
            }
        },
    };
}
