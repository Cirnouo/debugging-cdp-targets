import {
    appendFileSync,
    closeSync,
    fstatSync,
    mkdirSync,
    openSync,
    readSync,
    rmdirSync,
    type Stats,
    statSync,
} from 'node:fs';
import { validateFixtureEvent } from '../../src/adapters/fixture-diagnostics.ts';
import { validateFirstStartCaptureRecord } from './linux-first-start-capture-record.ts';

/** Fixed semantic slots. Missing native events stay missing; duplicates use ordinary capacity. */
export const firstStartControlSlots = [
    'selection',
    'current-collection',
    'selected-operation',
    'spawn',
    'root-binding',
    'context-ready',
    'readiness-begin',
    'readiness-end',
    'rollback-decision',
    'operation-failed',
    'target-close-begin',
    'target-close-end',
    'native-close-begin',
    'native-close-end',
    'exit-wait-begin',
    'exit-wait-end',
    'resource-begin',
    'resource-end',
    'observed-exit',
    'pending-settled',
    'lease-release-begin',
    'lease-release-end',
    'profile-cleanup-begin',
    'profile-cleanup-end',
    'directory-cleanup-begin',
    'directory-cleanup-end',
    'gateway-begin',
    'gateway-end',
    'parent-child-close',
    'parent-primary',
    'parent-secondary',
    'observer-final',
] as const;
type Category = 'ordinary' | 'capture' | 'control' | 'marker';
type Origin = { entryId: string; operationId: string; requestId: string; connectionId?: string; sessionId?: string };
const limits = {
    ordinary: { events: 1900, bytes: 624 * 1024 },
    capture: { events: 64, bytes: 256 * 1024 },
    control: { events: 32, bytes: 128 * 1024 },
    marker: { events: 4, bytes: 16 * 1024 },
};
export interface FirstStartWriterCost {
    kind: 'first-start-writer-cost';
    attempts: number;
    dataAttempts: number;
    markerAttempts: number;
    metadataReserved: number;
    scannedBytes: number;
    exhausted: boolean;
    releaseFailed: boolean;
    writeFailed: boolean;
    selfReportWriteUnavailable: true;
}
export function validateFirstStartWriterCost(value: unknown): Readonly<FirstStartWriterCost> | undefined {
    try {
        if (!object(value)) return;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = [
            'kind',
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
        if (
            Reflect.ownKeys(value).length !== keys.length ||
            keys.some((key) => !descriptors[key] || !('value' in descriptors[key]))
        )
            return;
        const fields = Object.fromEntries(keys.map((key) => [key, descriptors[key]?.value]));
        if (fields.kind !== 'first-start-writer-cost' || fields.selfReportWriteUnavailable !== true) return;
        for (const key of ['attempts', 'dataAttempts', 'markerAttempts', 'metadataReserved', 'scannedBytes']) {
            if (typeof fields[key] !== 'number' || !Number.isSafeInteger(fields[key]) || fields[key] < 0) return;
        }
        for (const key of ['exhausted', 'releaseFailed', 'writeFailed']) if (typeof fields[key] !== 'boolean') return;
        if (
            fields.attempts > 64 ||
            fields.dataAttempts > 60 ||
            fields.markerAttempts > 4 ||
            fields.metadataReserved !== fields.attempts * 6 ||
            fields.scannedBytes > 1024 * 1024 ||
            fields.dataAttempts + fields.markerAttempts > fields.attempts
        )
            return;
        return Object.freeze({
            kind: 'first-start-writer-cost',
            attempts: fields.attempts,
            dataAttempts: fields.dataAttempts,
            markerAttempts: fields.markerAttempts,
            metadataReserved: fields.metadataReserved,
            scannedBytes: fields.scannedBytes,
            exhausted: fields.exhausted,
            releaseFailed: fields.releaseFailed,
            writeFailed: fields.writeFailed,
            selfReportWriteUnavailable: true,
        });
    } catch {
        return;
    }
}
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The same deterministic stream-order classification is used by every writer and decoder. */
export function createFixtureStreamQuota() {
    const counts = Object.fromEntries(Object.keys(limits).map((key) => [key, { events: 0, bytes: 0 }])) as Record<
        Category,
        { events: number; bytes: number }
    >;
    const used = new Set<string>();
    let origin: Origin | undefined;
    let events = 0;
    let bytes = 0;
    function control(value: unknown): string | undefined {
        if (!object(value)) return;
        if (value.kind === 'gateway') {
            const { kind: _kind, ...fields } = value;
            const event = validateFixtureEvent(fields);
            if (!event) return;
            if (
                !origin &&
                event.stage === 'operation' &&
                event.event === 'begin' &&
                event.action === 'start' &&
                event.entryId &&
                event.operationId &&
                event.requestId
            ) {
                origin = { entryId: event.entryId, operationId: event.operationId, requestId: event.requestId };
            }
            if (!origin || event.entryId !== origin.entryId) return;
            if (
                event.stage === 'gateway-cleanup' &&
                event.trigger === 'gateway-disconnect' &&
                (event.event === 'begin' || event.event === 'end')
            )
                return `gateway-${event.event}`;
            if ((event.originOperationId ?? event.operationId) !== origin.operationId) return;
            if (event.requestId && event.requestId !== origin.requestId && !event.originOperationId) return;
            if (origin.connectionId && event.connectionId && event.connectionId !== origin.connectionId) return;
            if (origin.sessionId && event.sessionId && event.sessionId !== origin.sessionId) return;
            if (event.stage === 'operation-route' && event.connectionId && event.sessionId) {
                origin.connectionId ??= event.connectionId;
                origin.sessionId ??= event.sessionId;
                return;
            }
            if (event.stage === 'operation' && event.event === 'begin') return 'selected-operation';
            if (event.stage === 'spawn' && event.event === 'decision' && event.reason === 'acquired') return 'spawn';
            if (
                event.stage === 'readiness' &&
                event.phase === 'waiting-cdp' &&
                (event.event === 'begin' || event.event === 'end')
            )
                return `readiness-${event.event}`;
            if (event.stage === 'readiness' && event.phase === 'rollback-request' && event.event === 'decision')
                return 'rollback-decision';
            if (event.stage === 'operation-error' && event.event === 'decision' && event.outcome === 'failed')
                return 'operation-failed';
            if (
                ((event.stage === 'native-close' && !event.phase) ||
                    (event.stage === 'target-close' && (!event.phase || event.phase === 'rollback-request'))) &&
                (event.event === 'begin' || event.event === 'end')
            )
                return `${event.stage}-${event.event}`;
            if (
                event.stage === 'target-exit-wait' &&
                (!event.phase || event.phase === 'rollback-exit') &&
                (event.event === 'begin' || event.event === 'end')
            )
                return `exit-wait-${event.event}`;
            if (
                event.stage === 'resource-disposal' &&
                !event.phase &&
                (event.event === 'begin' || event.event === 'end')
            )
                return `resource-${event.event}`;
            if (
                event.stage === 'directory-lease' &&
                event.phase === 'resource-cleanup' &&
                (event.event === 'begin' || event.event === 'end')
            )
                return `lease-release-${event.event}`;
            if (
                event.stage === 'data-directory-cleanup' &&
                event.phase === 'remove' &&
                (event.event === 'begin' || event.event === 'end')
            )
                return `directory-cleanup-${event.event}`;
        } else if (origin && value.kind === 'failure' && (value.primary === true || value.primary === false)) {
            return value.primary ? 'parent-primary' : 'parent-secondary';
        } else if (origin && value.kind === 'smoke' && value.stage === 'gateway-close' && value.event === 'begin') {
            return 'parent-child-close';
        }
        return;
    }
    function classify(value: unknown): { category: Category; slot?: string } {
        if (object(value) && value.kind === 'linux-first-start-capture' && validateFirstStartCaptureRecord(value))
            return { category: 'capture' };
        if (
            object(value) &&
            (value.kind === 'truncated' ||
                value.kind === 'limitation' ||
                (value.kind === 'first-start-writer-cost' && validateFirstStartWriterCost(value)))
        )
            return { category: 'marker' };
        const slot = control(value);
        return slot && firstStartControlSlots.some((item) => item === slot) && !used.has(slot)
            ? { category: 'control', slot }
            : { category: 'ordinary' };
    }
    return {
        accept(value: unknown, size: number, commit = true) {
            const prior = origin ? { ...origin } : undefined;
            const selected = classify(value);
            const count = counts[selected.category];
            const limit = limits[selected.category];
            const accepted =
                Number.isSafeInteger(size) &&
                size > 0 &&
                size <= 4096 &&
                events < 2000 &&
                bytes + size <= 1024 * 1024 &&
                count.events < limit.events &&
                count.bytes + size <= limit.bytes;
            if (accepted && commit) {
                events++;
                bytes += size;
                count.events++;
                count.bytes += size;
                if (selected.slot) used.add(selected.slot);
            } else origin = prior;
            return { accepted, category: selected.category };
        },
        snapshot() {
            return { events, bytes, counts: structuredClone(counts), controlSlots: [...used] };
        },
    };
}

/** Two fixed owners share the added budget without another transport or state file. */
export function createArmedFixtureWriter(
    file: string,
    child: boolean,
    io: {
        append?: (file: string, line: string) => void;
        release?: (directory: string) => void;
        admitted?: (value: unknown, start: number, end: number) => void;
        limited?: () => void;
    } = {},
) {
    const quota = createFixtureStreamQuota();
    const attemptLimit = child ? 64 : 4;
    const dataLimit = child ? 60 : 4;
    let attempts = 0;
    let dataAttempts = 0;
    let markerAttempts = 0;
    let scannedBytes = 0;
    let offset = 0;
    let frontier = 0;
    let observationLimited = false;
    let identity: { dev: number; ino: number; birthtimeMs: number } | undefined;
    function limitObservation() {
        observationLimited = true;
        try {
            io.limited?.();
        } catch {}
    }
    function observe(value: unknown, start: number, end: number) {
        if (end <= frontier || observationLimited) return;
        if (start !== frontier) {
            limitObservation();
            return;
        }
        try {
            io.admitted?.(value, start, end);
            frontier = end;
        } catch {
            limitObservation();
        }
    }
    function continuous(metadata: Stats, minimum: number) {
        if (metadata.size < minimum || !metadata.isFile()) return false;
        if (
            identity &&
            (metadata.dev !== identity.dev ||
                metadata.ino !== identity.ino ||
                metadata.birthtimeMs !== identity.birthtimeMs)
        )
            return false;
        identity ??= { dev: metadata.dev, ino: metadata.ino, birthtimeMs: metadata.birthtimeMs };
        return true;
    }
    let stopped = false;
    let exhausted = false;
    let ordinaryMarker = false;
    let releaseFailed = false;
    let writeFailed = false;
    let lastGateway: ReturnType<typeof validateFixtureEvent>;
    function remember(value: unknown) {
        if (object(value) && value.kind === 'gateway') {
            const { kind: _kind, ...fields } = value;
            lastGateway = validateFixtureEvent(fields) ?? lastGateway;
        }
    }
    function append(
        value: unknown,
        fallback = false,
        create?: (event: ReturnType<typeof validateFixtureEvent>) => unknown,
    ): boolean {
        if (stopped) return false;
        if (attempts >= attemptLimit) {
            stopped = true;
            exhausted = true;
            return false;
        }
        const capture =
            !!value && typeof value === 'object' && 'kind' in value && value.kind === 'linux-first-start-capture';
        const marker =
            !!value &&
            typeof value === 'object' &&
            'kind' in value &&
            (value.kind === 'truncated' || value.kind === 'limitation' || value.kind === 'first-start-writer-cost');
        const added = capture || marker;
        // Six operations cover lock/stat/scan-open/scan-close/append/unlock. Reserve
        // them before the first operation, even when the eventual scan is empty.
        if (added && ((capture && dataAttempts >= dataLimit) || (marker && markerAttempts >= 4))) {
            exhausted = true;
            return false;
        }
        attempts++;
        if (added) {
            if (capture) dataAttempts++;
            if (marker) markerAttempts++;
        }
        let ownsLock = false;
        let failed = false;
        let needOrdinaryMarker = false;
        let ordinaryKnown = false;
        let captureTail = false;
        try {
            mkdirSync(`${file}.lock`);
            ownsLock = true;
            const metadata = statSync(file);
            const size = metadata.size;
            if (!continuous(metadata, Math.max(offset, frontier))) limitObservation();
            if (size < offset || size > 1024 * 1024) {
                stopped = true;
                exhausted = true;
                return false;
            }
            const length = size - offset;
            if (length > 0) {
                // A foreign append may contain capture evidence. Reserve before
                // opening it; an ordinary-only tail releases this reservation.
                if (scannedBytes + length > 1024 * 1024) {
                    stopped = true;
                    exhausted = true;
                    return false;
                }
                const buffer = Buffer.alloc(length);
                const descriptor = openSync(file, 'r');
                let read = 0;
                try {
                    while (read < length) {
                        const count = readSync(descriptor, buffer, read, length - read, offset + read);
                        scannedBytes += count;
                        if (count === 0) throw new Error('Incomplete controlled stream.');
                        read += count;
                    }
                } finally {
                    closeSync(descriptor);
                }
                // Observation rejects undecodable bytes without changing writer admission.
                try {
                    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
                } catch {
                    limitObservation();
                }
                const tail = buffer.toString('utf8');
                if (!tail.endsWith('\n')) throw new Error('Incomplete controlled stream.');
                let lineOffset = offset;
                for (const line of tail.slice(0, -1).split('\n')) {
                    const parsed: unknown = JSON.parse(line);
                    if (
                        object(parsed) &&
                        ['linux-first-start-capture', 'truncated', 'limitation', 'first-start-writer-cost'].includes(
                            String(parsed.kind),
                        )
                    )
                        captureTail = true;
                    if (!quota.accept(parsed, Buffer.byteLength(line) + 1).accepted) {
                        stopped = true;
                        exhausted = true;
                        limitObservation();
                        return false;
                    }
                    remember(parsed);
                    const end = lineOffset + Buffer.byteLength(line) + 1;
                    observe(parsed, lineOffset, end);
                    lineOffset = end;
                }
                offset = size;
            }
            ordinaryKnown = true;
            if (create) value = create(lastGateway);
            const line = `${JSON.stringify(value)}\n`;
            const admission = quota.accept(value, Buffer.byteLength(line), false);
            if (!admission.accepted) {
                exhausted = true;
                if (admission.category === 'ordinary' && !ordinaryMarker) {
                    ordinaryMarker = true;
                    needOrdinaryMarker = true;
                }
                return false;
            }
            (fallback ? appendFileSync : (io.append ?? appendFileSync))(file, line);
            quota.accept(value, Buffer.byteLength(line));
            remember(value);
            observe(value, offset, offset + Buffer.byteLength(line));
            offset += Buffer.byteLength(line);
            return true;
        } catch {
            failed = true;
            writeFailed = true;
            return false;
        } finally {
            if (ownsLock) {
                try {
                    (io.release ?? rmdirSync)(`${file}.lock`);
                } catch {
                    releaseFailed = true;
                    writeFailed = true;
                    stopped = true;
                }
            }
            // Release only after an ordinary-only transaction, including its
            // necessary unlock, has completed. Unknown/failed tails retain it.
            if (!added && ordinaryKnown && !captureTail && !failed && !releaseFailed) attempts--;
            if (needOrdinaryMarker && !stopped) append({ kind: 'truncated', scope: 'ordinary' });
            // A fallback is another admitted attempt, never a free append under
            // the failed attempt's lock or a release-budget exemption.
            if (failed && ownsLock && !fallback && !stopped)
                append({ kind: 'limitation', reason: 'write-failed' }, true);
        }
    }
    return {
        append,
        appendFromGateway(create: (event: ReturnType<typeof validateFixtureEvent>) => unknown) {
            return append(undefined, false, create);
        },
        lastGateway() {
            return lastGateway;
        },
        finishObservation() {
            const result = {
                acquired: false,
                incomplete: observationLimited,
                writeFailed: false,
                truncated: false,
                scanBudget: false,
                discontinuity: false,
            };
            if (stopped || attempts >= attemptLimit) {
                exhausted = true;
                result.incomplete = true;
                result.scanBudget = true;
                return result;
            }
            attempts++;
            let ownsLock = false;
            let descriptor: number | undefined;
            try {
                // One reservation: lock, path stat, open, handle stat, close, unlock.
                // Cooperative append-only writers are required; an after-open pathname
                // rebind with an unchanged opened handle is not observable here.
                mkdirSync(`${file}.lock`);
                ownsLock = true;
                const metadata = statSync(file);
                if (!continuous(metadata, Math.max(offset, frontier)) || offset !== frontier || observationLimited) {
                    result.discontinuity = true;
                    result.incomplete = true;
                    limitObservation();
                    return result;
                }
                const length = metadata.size - frontier;
                if (metadata.size > 1024 * 1024 || length > 1024 * 1024 - scannedBytes) {
                    result.scanBudget = true;
                    result.truncated = true;
                    result.incomplete = true;
                    return result;
                }
                const buffer = Buffer.alloc(length);
                descriptor = openSync(file, 'r');
                let read = 0;
                while (read < length) {
                    const count = readSync(descriptor, buffer, read, length - read, frontier + read);
                    scannedBytes += count;
                    if (count === 0) throw new Error('Incomplete controlled stream.');
                    read += count;
                }
                const handle = fstatSync(descriptor);
                if (
                    !continuous(handle, metadata.size) ||
                    handle.size !== metadata.size ||
                    handle.mtimeMs !== metadata.mtimeMs ||
                    handle.ctimeMs !== metadata.ctimeMs
                ) {
                    result.discontinuity = true;
                    result.incomplete = true;
                    limitObservation();
                    return result;
                }
                const tail = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
                if (tail && !tail.endsWith('\n')) throw new Error('Incomplete controlled stream.');
                let lineOffset = frontier;
                for (const line of tail ? tail.slice(0, -1).split('\n') : []) {
                    const value: unknown = JSON.parse(line);
                    const end = lineOffset + Buffer.byteLength(line) + 1;
                    if (!quota.accept(value, end - lineOffset).accepted) {
                        result.truncated = true;
                        result.incomplete = true;
                        limitObservation();
                        return result;
                    }
                    remember(value);
                    observe(value, lineOffset, end);
                    lineOffset = end;
                }
                offset = metadata.size;
                result.acquired = true;
                result.incomplete ||= observationLimited;
            } catch {
                result.incomplete = true;
                result.writeFailed = true;
                writeFailed = true;
            } finally {
                if (descriptor !== undefined) {
                    try {
                        closeSync(descriptor);
                    } catch {
                        result.incomplete = true;
                        result.writeFailed = true;
                        writeFailed = true;
                    }
                }
                if (ownsLock) {
                    try {
                        (io.release ?? rmdirSync)(`${file}.lock`);
                    } catch {
                        releaseFailed = true;
                        writeFailed = true;
                        result.incomplete = true;
                        result.writeFailed = true;
                        stopped = true;
                    }
                }
            }
            return result;
        },
        reserveReconstruction() {
            if (stopped || attempts >= attemptLimit) {
                exhausted = true;
                return;
            }
            attempts++;
            return 1024 * 1024 - scannedBytes;
        },
        settleReconstruction(bytes: number) {
            scannedBytes += bytes;
        },
        cost() {
            return {
                kind: 'first-start-writer-cost' as const,
                attempts,
                dataAttempts,
                markerAttempts,
                metadataReserved: attempts * 6,
                scannedBytes,
                exhausted,
                releaseFailed,
                writeFailed,
                selfReportWriteUnavailable: true as const,
            };
        },
        snapshot() {
            return {
                attempts,
                dataAttempts,
                markerAttempts,
                metadataReserved: attempts * 6,
                scannedBytes,
                exhausted,
                releaseFailed,
                writeFailed,
                selfReportWriteUnavailable: true,
                ...quota.snapshot(),
            };
        },
    };
}
