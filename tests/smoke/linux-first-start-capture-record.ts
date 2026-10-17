import {
    type CreationIdentity,
    linuxIdentityAccepted,
    validateCreationIdentity,
} from '../../src/adapters/fixture-diagnostics.ts';

/** Closed, path-free test evidence. Slots are immutable and have one owner. */
export const captureAuxiliarySlots = [
    'selection',
    'root-binding',
    'device-epoch',
    'cgroup-epoch',
    'first-start-outcome',
    'creation-first-comparison',
    'creation-first-rejected',
    'six-slot-status',
    'retention-decision',
    'limitations',
    'writer-state',
    'observer-terminal',
] as const;
export const captureStatuses = [
    'armed',
    'bound',
    'complete',
    'partial',
    'pending',
    'timeout',
    'unavailable',
    'busy',
    'skipped-late',
    'not-admitted',
    'identity-invalid',
    'counter-invalid',
    'overlapped',
    'succeeded',
    'failed',
    'cancelled',
    'discarded',
    'retained',
    'flushed',
    'no-close-gate',
    'depth-capped',
    'root-not-applicable',
    'controller-unavailable',
    'no-device-entry',
    'permission',
    'missing',
    'overlong',
    'incomplete',
    'read-failed',
    'namespace-invalid',
] as const;
export const captureMetricKeys = [
    'userTicks',
    'systemTicks',
    'majorFaults',
    'blockIoTicks',
    'readBytes',
    'writeBytes',
    'cpuSomeUs',
    'cpuFullUs',
    'memorySomeUs',
    'memoryFullUs',
    'ioSomeUs',
    'ioFullUs',
    'major',
    'minor',
    'queueMajor',
    'queueMinor',
    'readsCompleted',
    'sectorsRead',
    'readMs',
    'writesCompleted',
    'writeMs',
    'inFlight',
    'ioMs',
    'weightedIoMs',
    'queueReadsCompleted',
    'queueSectorsRead',
    'queueReadMs',
    'queueIoMs',
    'queueWeightedIoMs',
    'readAheadKb',
    'rotational',
    'maxSectorsKb',
    'cpuQuota',
    'cpuPeriod',
    'nrThrottled',
    'throttledUs',
    'memoryHigh',
    'memoryMax',
    'memoryHighEvents',
    'memoryMaxEvents',
    'memoryHighLocalEvents',
    'memoryMaxLocalEvents',
    'selectedReadBps',
    'selectedWriteBps',
    'selectedReadIops',
    'selectedWriteIops',
    'queueReadBps',
    'queueWriteBps',
    'queueReadIops',
    'queueWriteIops',
    'leafReadBytes',
    'leafWriteBytes',
    'leafReadIos',
    'leafWriteIos',
    'admitted',
    'completed',
    'skipped',
    'pending',
    'discarded',
    'records',
    'serializedBytes',
    'sinkCalls',
    'sinkFailed',
    'callbackMs',
    'legacyObserverReads',
    'executableDev',
    'executableIno',
] as const;
export type CaptureStatus = (typeof captureStatuses)[number];
export type CaptureFamily = 'process' | 'device' | 'cgroup';
export type CaptureMetrics = Partial<Record<(typeof captureMetricKeys)[number], number>>;
export const captureLimitKeys = [
    'cpuQuota',
    'memoryHigh',
    'memoryMax',
    'selectedReadBps',
    'selectedWriteBps',
    'selectedReadIops',
    'selectedWriteIops',
    'queueReadBps',
    'queueWriteBps',
    'queueReadIops',
    'queueWriteIops',
] as const;
export type CaptureLimits = Partial<
    Record<(typeof captureLimitKeys)[number], 'finite' | 'max' | 'unavailable' | 'no-device-entry' | 'deduplicated'>
>;
export interface CaptureCost {
    attempts: number;
    opens: number;
    readCalls: number;
    closes: number;
    bytes: number;
    metadata: number;
    completed: number;
    pending: number;
    handles: number;
    settled: boolean;
}
export interface FirstStartCaptureRecord {
    readonly kind: 'linux-first-start-capture';
    readonly slot: (typeof captureAuxiliarySlots)[number] | 'family' | 'cost';
    readonly status: CaptureStatus;
    readonly atMs: number;
    readonly entryId?: string;
    readonly connectionId?: string;
    readonly sessionId?: string;
    readonly operationId?: string;
    readonly requestId?: string;
    readonly pid?: number;
    readonly rootStartTicks?: number;
    readonly phase?: number;
    readonly family?: CaptureFamily;
    readonly scope?: number;
    readonly depth?: number;
    readonly startedMs?: number;
    readonly endedMs?: number;
    readonly closeStartedMs?: number;
    readonly epoch?: number;
    readonly scheduler?: 'none' | 'mq-deadline' | 'kyber' | 'bfq' | 'other' | 'unavailable';
    readonly wait?: 'futex' | 'pipe' | 'poll' | 'io' | 'scheduler' | 'unknown';
    readonly reason?: CaptureStatus;
    readonly outcomeReason?: 'budget-exhausted' | 'foreign-listener' | 'terminal-condition' | 'poll-interrupted';
    readonly metrics?: Readonly<CaptureMetrics>;
    readonly limits?: Readonly<CaptureLimits>;
    readonly cost?: Readonly<Partial<Record<CaptureFamily, Readonly<CaptureCost>>>>;
    readonly slots?: readonly CaptureStatus[];
    readonly creation?: CreationIdentity;
    readonly creationObservation?: Readonly<{
        stats: 'available' | 'unavailable';
        sourceAttempts?: number;
        comparisons?: number;
        tokens?: number;
        retained: number;
        omitted: number;
        capped?: boolean;
        disabled?: boolean;
        revoked?: boolean;
        producerCpu: 'unmeasured';
    }>;
}
export function captureClosed(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return;
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !keys.includes(key)) return;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) return;
        copy[key] = descriptor.value;
    }
    return copy;
}
const integer = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const member = (list: readonly string[], value: unknown): boolean => typeof value === 'string' && list.includes(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Reject unknown keys, exotic prototypes, getters, symbols and oversized records. */
export function validateFirstStartCaptureRecord(value: unknown): FirstStartCaptureRecord | undefined {
    try {
        const fields = captureClosed(value, [
            'kind',
            'slot',
            'status',
            'atMs',
            'entryId',
            'connectionId',
            'sessionId',
            'operationId',
            'requestId',
            'pid',
            'rootStartTicks',
            'phase',
            'family',
            'scope',
            'depth',
            'startedMs',
            'endedMs',
            'closeStartedMs',
            'epoch',
            'scheduler',
            'wait',
            'reason',
            'outcomeReason',
            'metrics',
            'limits',
            'cost',
            'slots',
            'creation',
            'creationObservation',
        ]);
        if (
            fields?.kind !== 'linux-first-start-capture' ||
            !member([...captureAuxiliarySlots, 'family', 'cost'], fields.slot) ||
            !member(captureStatuses, fields.status) ||
            !finite(fields.atMs)
        )
            return;
        const creationSlot = fields.slot === 'creation-first-comparison' || fields.slot === 'creation-first-rejected';
        if (creationSlot !== 'creation' in fields) return;
        if (creationSlot) {
            if (!member(['complete', 'identity-invalid'], fields.status)) return;
            if (
                Object.keys(fields).some(
                    (key) =>
                        ![
                            'kind',
                            'slot',
                            'status',
                            'atMs',
                            'entryId',
                            'connectionId',
                            'sessionId',
                            'operationId',
                            'requestId',
                            'pid',
                            'rootStartTicks',
                            'creation',
                        ].includes(key),
                )
            )
                return;
            const creation = validateCreationIdentity(fields.creation);
            if (!creation) return;
            if (fields.slot === 'creation-first-rejected' && fields.status !== 'identity-invalid') return;
            if (
                'model' in creation
                    ? (fields.status === 'complete') !== linuxIdentityAccepted(creation)
                    : fields.status === 'complete' &&
                      (creation.creationComparisonStatus !== 'reached' || creation.creationBranch?.endsWith('rejected'))
            )
                return;
            fields.creation = creation;
        }
        if ('creationObservation' in fields) {
            if (fields.slot !== 'limitations') return;
            const receipt = captureClosed(fields.creationObservation, [
                'stats',
                'sourceAttempts',
                'comparisons',
                'tokens',
                'retained',
                'omitted',
                'capped',
                'disabled',
                'revoked',
                'producerCpu',
            ]);
            if (
                !receipt ||
                !member(['available', 'unavailable'], receipt.stats) ||
                receipt.producerCpu !== 'unmeasured' ||
                !integer(receipt.retained) ||
                receipt.retained > 2 ||
                !integer(receipt.omitted) ||
                receipt.omitted > 128
            )
                return;
            const counters = ['sourceAttempts', 'comparisons', 'tokens'];
            const flags = ['capped', 'disabled', 'revoked'];
            if (receipt.stats === 'available') {
                if (
                    counters.some((key) => !integer(receipt[key]) || Number(receipt[key]) > 128) ||
                    flags.some((key) => typeof receipt[key] !== 'boolean') ||
                    Number(receipt.sourceAttempts) > Number(receipt.tokens) ||
                    Number(receipt.comparisons) > Number(receipt.tokens) ||
                    Number(receipt.retained) + Number(receipt.omitted) !== Number(receipt.comparisons)
                )
                    return;
            } else if ([...counters, ...flags].some((key) => key in receipt)) return;
            fields.creationObservation = Object.freeze(receipt);
        }
        for (const key of ['entryId', 'connectionId', 'sessionId', 'operationId', 'requestId'])
            if (key in fields && (typeof fields[key] !== 'string' || !uuid.test(fields[key]))) return;
        for (const key of ['pid', 'rootStartTicks', 'phase', 'scope', 'depth', 'epoch'])
            if (key in fields && !integer(fields[key])) return;
        if (
            fields.pid === 0 ||
            (typeof fields.phase === 'number' && fields.phase > 7) ||
            (typeof fields.scope === 'number' && fields.scope > 3)
        )
            return;
        for (const key of ['startedMs', 'endedMs', 'closeStartedMs']) if (key in fields && !finite(fields[key])) return;
        if ('family' in fields && !member(['process', 'device', 'cgroup'], fields.family)) return;
        if ('reason' in fields && !member(captureStatuses, fields.reason)) return;
        if (
            'outcomeReason' in fields &&
            !member(
                ['budget-exhausted', 'foreign-listener', 'terminal-condition', 'poll-interrupted'],
                fields.outcomeReason,
            )
        )
            return;
        if (
            'scheduler' in fields &&
            !member(['none', 'mq-deadline', 'kyber', 'bfq', 'other', 'unavailable'], fields.scheduler)
        )
            return;
        if ('wait' in fields && !member(['futex', 'pipe', 'poll', 'io', 'scheduler', 'unknown'], fields.wait)) return;
        if (fields.slot === 'family' && (!fields.family || !integer(fields.phase) || fields.phase > 5)) return;
        if (fields.slot === 'cost' && (!fields.cost || !integer(fields.phase))) return;
        if ('metrics' in fields) {
            const metrics = captureClosed(fields.metrics, captureMetricKeys);
            if (
                !metrics ||
                Object.entries(metrics).some(([key, item]) => (key === 'callbackMs' ? !finite(item) : !integer(item)))
            )
                return;
            if (fields.slot === 'family' && !member(['complete', 'partial'], fields.status)) return;
            if ('rotational' in metrics && metrics.rotational !== 0 && metrics.rotational !== 1) return;
            fields.metrics = Object.freeze(metrics);
        }
        if ('limits' in fields) {
            const limits = captureClosed(fields.limits, captureLimitKeys);
            if (
                !limits ||
                Object.values(limits).some(
                    (item) => !member(['finite', 'max', 'unavailable', 'no-device-entry', 'deduplicated'], item),
                )
            )
                return;
            if (fields.slot === 'family' && !member(['complete', 'partial'], fields.status)) return;
            for (const [key, state] of Object.entries(limits)) {
                const metric: unknown =
                    fields.metrics && typeof fields.metrics === 'object'
                        ? Object.getOwnPropertyDescriptor(fields.metrics, key)?.value
                        : undefined;
                if ((state === 'finite') !== (metric !== undefined)) return;
            }
            for (const key of captureLimitKeys) {
                const metric: unknown =
                    fields.metrics && typeof fields.metrics === 'object'
                        ? Object.getOwnPropertyDescriptor(fields.metrics, key)?.value
                        : undefined;
                if (metric !== undefined && limits[key] !== 'finite') return;
            }
            fields.limits = Object.freeze(limits);
        }
        if ('cost' in fields) {
            const costs = captureClosed(fields.cost, ['process', 'device', 'cgroup']);
            if (!costs) return;
            for (const family of Object.keys(costs)) {
                const cost = captureClosed(costs[family], [
                    'attempts',
                    'opens',
                    'readCalls',
                    'closes',
                    'bytes',
                    'metadata',
                    'completed',
                    'pending',
                    'handles',
                    'settled',
                ]);
                if (!cost || typeof cost.settled !== 'boolean' || Object.keys(cost).length !== 10) return;
                for (const [key, item] of Object.entries(cost)) if (key !== 'settled' && !integer(item)) return;
                if (
                    Number(cost.attempts) > 346 ||
                    Number(cost.opens) > Number(cost.attempts) ||
                    Number(cost.closes) > Number(cost.opens) ||
                    Number(cost.readCalls) > Number(cost.attempts) * 8 ||
                    Number(cost.bytes) > Number(cost.attempts) * 4096 ||
                    Number(cost.metadata) > 336 ||
                    Number(cost.handles) > 1 ||
                    Number(cost.pending) > 1 ||
                    Number(cost.completed) > Number(cost.attempts) ||
                    (cost.settled === true &&
                        (cost.pending !== 0 || cost.handles !== 0 || cost.completed !== cost.attempts))
                )
                    return;
                costs[family] = Object.freeze(cost);
            }
            if (fields.slot === 'cost') {
                if (!member(['complete', 'pending'], fields.status)) return;
                const settled = Object.values(costs).every(
                    (cost) =>
                        !!cost &&
                        typeof cost === 'object' &&
                        Object.getOwnPropertyDescriptor(cost, 'settled')?.value === true,
                );
                if ((fields.status === 'complete') !== settled) return;
            }
            fields.cost = Object.freeze(costs);
        }
        if ('slots' in fields) {
            if (
                !Array.isArray(fields.slots) ||
                Object.getPrototypeOf(fields.slots) !== Array.prototype ||
                fields.slots.length !== 6 ||
                Reflect.ownKeys(fields.slots).length !== 7
            )
                return;
            const slots: CaptureStatus[] = [];
            for (let index = 0; index < 6; index++) {
                const descriptor = Object.getOwnPropertyDescriptor(fields.slots, String(index));
                if (!descriptor?.enumerable || !('value' in descriptor) || !member(captureStatuses, descriptor.value))
                    return;
                slots.push(descriptor.value as CaptureStatus);
            }
            fields.slots = Object.freeze(slots);
        }
        if (Buffer.byteLength(JSON.stringify(fields)) + 1 > 4096) return;
        const required = {
            kind: 'linux-first-start-capture' as const,
            slot: fields.slot as FirstStartCaptureRecord['slot'],
            status: fields.status as CaptureStatus,
            atMs: fields.atMs,
        };
        return Object.freeze({ ...fields, ...required });
    } catch {
        return;
    }
}
