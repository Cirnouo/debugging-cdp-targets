import { open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { type FixtureEvent, validateFixtureEvent } from '../../src/adapters/fixture-diagnostics.ts';

export type LinuxReadLimitation = 'missing' | 'permission' | 'read-failed' | 'overlong' | 'timeout';
export interface BoundedLinuxRead {
    bytes: number;
    text?: string;
    limitation?: LinuxReadLimitation;
}
export type LinuxStartupWaitLimitation =
    | LinuxReadLimitation
    | 'busy'
    | 'identity-mismatch'
    | 'stat-unknown'
    | 'counter-unknown'
    | 'wchan-unknown'
    | 'psi-unknown'
    | 'stale-session'
    | 'snapshot-ambiguous'
    | 'snapshot-unvalidated';
export interface LinuxStartupWaitRecord {
    readonly kind: 'linux-startup-wait';
    readonly entryId: string;
    readonly connectionId: string;
    readonly sessionId: string;
    readonly pid: number;
    readonly rootStartTicks: number;
    readonly trigger: 'baseline' | 'continuous-d' | 'first-owned-listener' | 'rollback-request';
    readonly outcome: 'sampled' | 'limited' | 'skipped' | 'stale';
    readonly elapsedMs: number;
    readonly reads: number;
    readonly bytes: number;
    readonly limitations: readonly LinuxStartupWaitLimitation[];
    readonly wchan?: 'futex' | 'pipe' | 'poll' | 'io' | 'scheduler' | 'unknown';
    readonly process?: Readonly<
        Partial<
            Record<
                | 'userTicks'
                | 'userTicksDelta'
                | 'systemTicks'
                | 'systemTicksDelta'
                | 'majorFaults'
                | 'majorFaultsDelta'
                | 'blockIoTicks'
                | 'blockIoTicksDelta'
                | 'readBytes'
                | 'writeBytes',
                number
            >
        >
    >;
    readonly systemPsi?: Readonly<
        { scope: 'system' } & Partial<
            Record<
                | 'cpuSomeTotalUs'
                | 'cpuFullTotalUs'
                | 'memorySomeTotalUs'
                | 'memoryFullTotalUs'
                | 'ioSomeTotalUs'
                | 'ioFullTotalUs',
                number
            >
        >
    >;
}
export interface LinuxStartupWaitDependencies {
    enabled?: boolean;
    platform?: NodeJS.Platform;
    now?: () => number;
    read?: (file: string, signal: AbortSignal) => Promise<BoundedLinuxRead>;
    setTimer?: (callback: () => void, delay: number) => unknown;
    clearTimer?: (timer: unknown) => void;
}
const fileBytes = 4096;
const budgetMs = 250;
const maximumObservationGapMs = 500;
const triggers = ['baseline', 'continuous-d', 'first-owned-listener', 'rollback-request'] as const;
const limitations = [
    'missing',
    'permission',
    'read-failed',
    'overlong',
    'timeout',
    'busy',
    'identity-mismatch',
    'stat-unknown',
    'counter-unknown',
    'wchan-unknown',
    'psi-unknown',
    'stale-session',
    'snapshot-ambiguous',
    'snapshot-unvalidated',
] as const;
const processKeys = [
    'userTicks',
    'userTicksDelta',
    'systemTicks',
    'systemTicksDelta',
    'majorFaults',
    'majorFaultsDelta',
    'blockIoTicks',
    'blockIoTicksDelta',
    'readBytes',
    'writeBytes',
] as const;
const psiKeys = [
    'cpuSomeTotalUs',
    'cpuFullTotalUs',
    'memorySomeTotalUs',
    'memoryFullTotalUs',
    'ioSomeTotalUs',
    'ioFullTotalUs',
] as const;
const wchanClasses = ['futex', 'pipe', 'poll', 'io', 'scheduler', 'unknown'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Trigger = LinuxStartupWaitRecord['trigger'];
type ProcessMetrics = NonNullable<LinuxStartupWaitRecord['process']>;
type PsiMetrics = NonNullable<LinuxStartupWaitRecord['systemPsi']>;
interface LinuxStartupFileHandle {
    read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
}
type FileOpener = (file: string, flags: 'r') => Promise<LinuxStartupFileHandle>;

function safeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function member<T extends string>(values: readonly T[], value: unknown): value is T {
    return typeof value === 'string' && values.some((item) => item === value);
}
function closed(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return;
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !keys.includes(key)) return;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return;
        copy[key] = descriptor.value;
    }
    return copy;
}
function closedLimitations(value: unknown): readonly LinuxStartupWaitLimitation[] | undefined {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
    const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!safeInteger(length) || length > limitations.length || Reflect.ownKeys(value).length !== length + 1) return;
    const result: LinuxStartupWaitLimitation[] = [];
    for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
            !descriptor ||
            !('value' in descriptor) ||
            !descriptor.enumerable ||
            !member(limitations, descriptor.value) ||
            result.includes(descriptor.value)
        )
            return;
        result.push(descriptor.value);
    }
    return Object.freeze(result);
}

/** The controlled fixture reader performs one bounded read, including on procfs (whose stat size is zero). */
export async function readLinuxStartupFile(
    file: string,
    signal: AbortSignal,
    opener: FileOpener = open,
): Promise<BoundedLinuxRead> {
    let handle: LinuxStartupFileHandle | undefined;
    let result: BoundedLinuxRead = { bytes: 0, limitation: 'read-failed' };
    try {
        if (signal.aborted) return { bytes: 0, limitation: 'timeout' };
        handle = await opener(file, 'r');
        if (signal.aborted) result = { bytes: 0, limitation: 'timeout' };
        else {
            const buffer = Buffer.alloc(fileBytes);
            const { bytesRead } = await handle.read(buffer, 0, fileBytes, 0);
            if (!safeInteger(bytesRead) || bytesRead > fileBytes) result = { bytes: 0, limitation: 'read-failed' };
            else if (signal.aborted) result = { bytes: bytesRead, limitation: 'timeout' };
            // A full buffer may be exactly full or truncated; both are conservatively unknown.
            else if (bytesRead === fileBytes) result = { bytes: bytesRead, limitation: 'overlong' };
            else result = { bytes: bytesRead, text: buffer.toString('utf8', 0, bytesRead) };
        }
    } catch (error) {
        let code: unknown;
        try {
            if (error && typeof error === 'object') code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
        } catch {
            /* Error objects remain untrusted; never inspect text. */
        }
        result = {
            bytes: 0,
            limitation: signal.aborted
                ? 'timeout'
                : code === 'ENOENT' || code === 'ESRCH'
                  ? 'missing'
                  : code === 'EACCES' || code === 'EPERM'
                    ? 'permission'
                    : 'read-failed',
        };
    } finally {
        if (handle) {
            try {
                await handle.close();
            } catch {
                result = { bytes: result.bytes, limitation: 'read-failed' };
            }
        }
    }
    return result;
}

/** Independently detach and validate the closed projection before accepting it into the capped stream. */
export function validateLinuxStartupWaitRecord(value: unknown): LinuxStartupWaitRecord | undefined {
    try {
        const selected = closed(value, [
            'kind',
            'entryId',
            'connectionId',
            'sessionId',
            'pid',
            'rootStartTicks',
            'trigger',
            'outcome',
            'elapsedMs',
            'reads',
            'bytes',
            'limitations',
            'wchan',
            'process',
            'systemPsi',
        ]);
        if (
            selected?.kind !== 'linux-startup-wait' ||
            !['entryId', 'connectionId', 'sessionId'].every(
                (key) => typeof selected[key] === 'string' && uuid.test(selected[key]),
            ) ||
            !safeInteger(selected.pid) ||
            selected.pid === 0 ||
            !safeInteger(selected.rootStartTicks) ||
            !member(triggers, selected.trigger) ||
            !member(['sampled', 'limited', 'skipped', 'stale'], selected.outcome) ||
            typeof selected.elapsedMs !== 'number' ||
            !Number.isFinite(selected.elapsedMs) ||
            selected.elapsedMs < 0 ||
            !safeInteger(selected.reads) ||
            selected.reads > 7 ||
            !safeInteger(selected.bytes) ||
            selected.bytes > selected.reads * fileBytes
        )
            return;
        const limits = closedLimitations(selected.limitations);
        if (!limits) return;
        if (selected.wchan !== undefined && !member(wchanClasses, selected.wchan)) return;
        let process: ProcessMetrics | undefined;
        if ('process' in selected) {
            const fields = closed(selected.process, processKeys);
            if (!fields || Object.keys(fields).length === 0 || !Object.values(fields).every(safeInteger)) return;
            for (const name of ['userTicks', 'systemTicks', 'majorFaults', 'blockIoTicks'] as const) {
                const delta = fields[`${name}Delta`];
                if (delta !== undefined && (fields[name] === undefined || Number(delta) > Number(fields[name]))) return;
            }
            process = Object.freeze(fields);
        }
        let systemPsi: PsiMetrics | undefined;
        if ('systemPsi' in selected) {
            const fields = closed(selected.systemPsi, ['scope', ...psiKeys]);
            if (
                fields?.scope !== 'system' ||
                Object.keys(fields).length < 2 ||
                psiKeys.some((key) => key in fields && !safeInteger(fields[key]))
            )
                return;
            systemPsi = Object.freeze({ ...fields, scope: 'system' });
        }
        const hasMetrics = process !== undefined || systemPsi !== undefined || selected.wchan !== undefined;
        if (
            (selected.outcome === 'sampled') !== (limits.length === 0) ||
            (selected.outcome === 'skipped' &&
                (limits.length !== 1 ||
                    !member(['busy', 'snapshot-ambiguous', 'snapshot-unvalidated'], limits[0]) ||
                    selected.reads !== 0 ||
                    selected.bytes !== 0)) ||
            (selected.outcome === 'stale' && (limits.length !== 1 || limits[0] !== 'stale-session')) ||
            ((selected.outcome === 'skipped' ||
                selected.outcome === 'stale' ||
                limits.some((item) => ['timeout', 'stat-unknown', 'identity-mismatch'].includes(item))) &&
                hasMetrics)
        )
            return;
        const result: LinuxStartupWaitRecord = Object.freeze({
            kind: 'linux-startup-wait',
            entryId: String(selected.entryId),
            connectionId: String(selected.connectionId),
            sessionId: String(selected.sessionId),
            pid: selected.pid,
            rootStartTicks: selected.rootStartTicks,
            trigger: selected.trigger,
            outcome: selected.outcome,
            elapsedMs: selected.elapsedMs,
            reads: selected.reads,
            bytes: selected.bytes,
            limitations: limits,
            ...(selected.wchan === undefined ? {} : { wchan: selected.wchan }),
            ...(process === undefined ? {} : { process }),
            ...(systemPsi === undefined ? {} : { systemPsi }),
        });
        return Buffer.byteLength(JSON.stringify(result)) <= fileBytes ? result : undefined;
    } catch {
        return;
    }
}

function counter(text: string | undefined): number | undefined {
    if (text === undefined || !/^\d+$/.test(text)) return;
    const value = Number(text);
    return safeInteger(value) ? value : undefined;
}
function parseStat(text: string | undefined, pid: number) {
    if (text === undefined || !text.startsWith(`${pid} (`)) return;
    const end = text.lastIndexOf(')');
    if (end < 0 || text[end + 1] !== ' ') return;
    const fields = text
        .slice(end + 2)
        .trim()
        .split(/\s+/);
    const start = counter(fields[19]);
    if (start === undefined) return;
    return {
        start,
        userTicks: counter(fields[11]),
        systemTicks: counter(fields[12]),
        majorFaults: counter(fields[9]),
        blockIoTicks: counter(fields[39]),
    };
}
function classifyWchan(text: string): LinuxStartupWaitRecord['wchan'] {
    const symbol = text.trim();
    if (['futex_wait_queue_me', 'futex_wait', 'do_futex', 'futex_wait_queue'].includes(symbol)) return 'futex';
    if (['pipe_read', 'pipe_write', 'wait_for_partner'].includes(symbol)) return 'pipe';
    if (['ep_poll', 'do_epoll_wait', 'do_poll', 'poll_schedule_timeout', 'do_select'].includes(symbol)) return 'poll';
    if (
        [
            'io_schedule',
            'io_schedule_timeout',
            'folio_wait_bit_common',
            'wait_on_page_bit_common',
            'wait_on_buffer',
            'wait_on_page_writeback',
            'blk_mq_get_tag',
        ].includes(symbol)
    )
        return 'io';
    if (['schedule', 'schedule_timeout', 'hrtimer_nanosleep', 'do_nanosleep'].includes(symbol)) return 'scheduler';
    return 'unknown';
}
function ioCounter(text: string | undefined, name: 'read_bytes' | 'write_bytes'): number | undefined {
    const values = text?.split('\n').filter((line) => line.startsWith(`${name}:`));
    return values?.length === 1 ? counter(values[0]?.slice(name.length + 1).trim()) : undefined;
}
function psiCounter(text: string | undefined, name: 'some' | 'full'): number | undefined {
    const lines = text?.split('\n').filter((line) => line.startsWith(`${name} `));
    if (lines?.length !== 1) return;
    const match = new RegExp(
        `^${name} avg10=(\\d+(?:\\.\\d+)?) avg60=(\\d+(?:\\.\\d+)?) avg300=(\\d+(?:\\.\\d+)?) total=(\\d+)$`,
    ).exec(lines[0] ?? '');
    if (!match || [match[1], match[2], match[3]].some((value) => value === undefined || Number(value) > 100)) return;
    return counter(match[4]);
}
interface Root {
    entryId: string;
    connectionId: string;
    sessionId: string;
    pid: number;
    rootStartTicks: number;
    busy: boolean;
    triggers: Set<Trigger>;
    priorCounters: Partial<Record<(typeof processKeys)[number], number>>;
    priorPsi: Partial<Record<(typeof psiKeys)[number], number>>;
    dStart?: number | undefined;
    lastObservation?: number | undefined;
}
interface Frame {
    beganAt: number;
    endedAt?: number;
    ambiguous: boolean;
    depth: number;
    decisionDebt: number;
    candidate?: FixtureEvent;
}
interface Connection {
    sessionId: string;
    retired: Set<string>;
    root?: Root | undefined;
    frames: Map<number, Frame>;
    listenerRoot?: Root | undefined;
    listenerValidatedAt?: number;
    snapshotBlock?: 'snapshot-ambiguous' | 'snapshot-unvalidated' | undefined;
}

/** Linux-only test observer. Inactive construction/observation touches no clocks, files or timers. */
export function createLinuxStartupWaitSampler(
    sink: (record: LinuxStartupWaitRecord) => void,
    dependencies: LinuxStartupWaitDependencies = {},
) {
    if (dependencies.enabled !== true || (dependencies.platform ?? process.platform) !== 'linux')
        return { observe(_event: unknown): void {} };
    const now = dependencies.now ?? (() => performance.now());
    const read = dependencies.read ?? readLinuxStartupFile;
    const setTimer =
        dependencies.setTimer ??
        ((callback, delay) => {
            const timer = setTimeout(callback, delay);
            timer.unref();
            return timer;
        });
    const clearTimer =
        dependencies.clearTimer ??
        ((timer) => {
            if (typeof timer === 'object' && timer !== null && Symbol.dispose in timer) {
                const disposer = Reflect.get(timer, Symbol.dispose);
                if (typeof disposer === 'function') Reflect.apply(disposer, timer, []);
            }
        });
    const connections = new Map<string, Connection>();
    function emit(record: LinuxStartupWaitRecord) {
        const safe = validateLinuxStartupWaitRecord(record);
        if (safe) {
            try {
                sink(safe);
            } catch {
                /* Diagnostic sink failure cannot reject host work. */
            }
        }
    }
    function resetD(connection: Connection) {
        if (connection.root) {
            connection.root.dStart = undefined;
            connection.root.lastObservation = undefined;
        }
        connection.listenerRoot = undefined;
    }
    function blockSnapshot(connection: Connection, frame?: Frame) {
        resetD(connection);
        connection.snapshotBlock = frame?.ambiguous ? 'snapshot-ambiguous' : 'snapshot-unvalidated';
    }
    function trigger(root: Root, selected: Trigger, connection: Connection, blocked = connection.snapshotBlock) {
        if (root.triggers.has(selected)) return;
        root.triggers.add(selected);
        const base = {
            kind: 'linux-startup-wait' as const,
            entryId: root.entryId,
            connectionId: root.connectionId,
            sessionId: root.sessionId,
            pid: root.pid,
            rootStartTicks: root.rootStartTicks,
            trigger: selected,
        };
        if (blocked || root.busy) {
            emit({ ...base, outcome: 'skipped', elapsedMs: 0, reads: 0, bytes: 0, limitations: [blocked ?? 'busy'] });
            return;
        }
        root.busy = true;
        const start = now();
        const controller = new AbortController();
        const limits = new Set<LinuxStartupWaitLimitation>();
        let reads = 0;
        let bytes = 0;
        let published = false;
        let timer: unknown;
        const stale = () => connection.root !== root || connection.sessionId !== root.sessionId;
        function publish(metrics: Pick<LinuxStartupWaitRecord, 'process' | 'systemPsi' | 'wchan'> = {}) {
            if (published) return;
            published = true;
            if (timer !== undefined) clearTimer(timer);
            const elapsedMs = Math.max(0, now() - start);
            if (stale()) emit({ ...base, outcome: 'stale', elapsedMs, reads, bytes, limitations: ['stale-session'] });
            else {
                if (metrics.process) Object.assign(root.priorCounters, metrics.process);
                if (metrics.systemPsi)
                    for (const key of psiKeys) {
                        const value = metrics.systemPsi[key];
                        if (value !== undefined) root.priorPsi[key] = value;
                    }
                emit({
                    ...base,
                    outcome: limits.size ? 'limited' : 'sampled',
                    elapsedMs,
                    reads,
                    bytes,
                    limitations: [...limits],
                    ...metrics,
                });
            }
        }
        function expired() {
            if (controller.signal.aborted || now() - start >= budgetMs) {
                limits.add('timeout');
                controller.abort();
                publish();
                return true;
            }
            if (stale()) {
                controller.abort();
                publish();
                return true;
            }
            return false;
        }
        async function readOne(file: string): Promise<string | undefined> {
            if (expired()) return;
            reads++;
            let result: BoundedLinuxRead;
            try {
                result = await read(file, controller.signal);
            } catch {
                result = { bytes: 0, limitation: 'read-failed' };
            }
            if (expired()) return;
            if (!safeInteger(result.bytes) || result.bytes > fileBytes) {
                limits.add('overlong');
                return;
            }
            bytes += result.bytes;
            if (result.limitation !== undefined) {
                limits.add(
                    member(['missing', 'permission', 'read-failed', 'overlong', 'timeout'], result.limitation)
                        ? result.limitation
                        : 'read-failed',
                );
                return;
            }
            if (
                result.bytes === fileBytes ||
                (typeof result.text === 'string' && Buffer.byteLength(result.text) >= fileBytes)
            ) {
                limits.add('overlong');
                return;
            }
            if (typeof result.text !== 'string' || Buffer.byteLength(result.text) !== result.bytes) {
                limits.add('read-failed');
                return;
            }
            return result.text;
        }
        async function sample() {
            const before = parseStat(await readOne(`/proc/${root.pid}/stat`), root.pid);
            if (expired()) return;
            if (!before || before.start !== root.rootStartTicks) {
                limits.add(before ? 'identity-mismatch' : 'stat-unknown');
                publish();
                return;
            }
            const wait = await readOne(`/proc/${root.pid}/wchan`);
            if (expired()) return;
            const io = await readOne(`/proc/${root.pid}/io`);
            if (expired()) return;
            const cpu = await readOne('/proc/pressure/cpu');
            if (expired()) return;
            const memory = await readOne('/proc/pressure/memory');
            if (expired()) return;
            const pressureIo = await readOne('/proc/pressure/io');
            if (expired()) return;
            const after = parseStat(await readOne(`/proc/${root.pid}/stat`), root.pid);
            if (expired()) return;
            if (!after || after.start !== root.rootStartTicks) {
                limits.add(after ? 'identity-mismatch' : 'stat-unknown');
                publish();
                return;
            }
            const process: Partial<Record<(typeof processKeys)[number], number>> = {};
            for (const key of ['userTicks', 'systemTicks', 'majorFaults', 'blockIoTicks'] as const) {
                const initial = before[key];
                const final = after[key];
                const prior = root.priorCounters[key];
                if (
                    initial === undefined ||
                    final === undefined ||
                    final < initial ||
                    (prior !== undefined && initial < prior)
                )
                    limits.add('counter-unknown');
                else {
                    process[key] = final;
                    process[`${key}Delta`] = final - initial;
                }
            }
            for (const [name, key] of [
                ['read_bytes', 'readBytes'],
                ['write_bytes', 'writeBytes'],
            ] as const) {
                const value = ioCounter(io, name);
                const prior = root.priorCounters[key];
                if (value === undefined || (prior !== undefined && value < prior)) limits.add('counter-unknown');
                else process[key] = value;
            }
            const systemPsi: { scope: 'system' } & Partial<Record<(typeof psiKeys)[number], number>> = {
                scope: 'system',
            };
            for (const [prefix, text] of [
                ['cpu', cpu],
                ['memory', memory],
                ['io', pressureIo],
            ] as const) {
                for (const [name, suffix] of [
                    ['some', 'SomeTotalUs'],
                    ['full', 'FullTotalUs'],
                ] as const) {
                    const value = psiCounter(text, name);
                    const prior = root.priorPsi[`${prefix}${suffix}`];
                    if (value !== undefined && (prior === undefined || value >= prior))
                        systemPsi[`${prefix}${suffix}`] = value;
                    else if (name === 'some' || text?.includes('full ')) limits.add('psi-unknown');
                }
            }
            const wchan = wait === undefined ? undefined : classifyWchan(wait);
            if (wchan === 'unknown') limits.add('wchan-unknown');
            publish({
                ...(Object.keys(process).length ? { process } : {}),
                ...(Object.keys(systemPsi).length > 1 ? { systemPsi } : {}),
                ...(wchan === undefined ? {} : { wchan }),
            });
        }
        timer = setTimer(() => {
            limits.add('timeout');
            controller.abort();
            publish();
        }, budgetMs);
        void sample()
            .catch(() => {
                limits.add('read-failed');
                publish();
            })
            .finally(() => {
                root.busy = false;
            });
    }
    function observe(value: unknown): void {
        try {
            const event = validateFixtureEvent(value);
            if (!event?.entryId || !event.connectionId || !event.sessionId || !event.pid) return;
            const key = `${event.entryId}/${event.connectionId}`;
            let connection = connections.get(key);
            if (!connection) {
                connection = { sessionId: event.sessionId, retired: new Set(), frames: new Map() };
                connections.set(key, connection);
            } else if (connection.sessionId !== event.sessionId) {
                if (connection.retired.has(event.sessionId)) return;
                connection.retired.add(connection.sessionId);
                connection.sessionId = event.sessionId;
                connection.root = undefined;
                connection.frames.clear();
                connection.listenerRoot = undefined;
                connection.snapshotBlock = undefined;
            }
            let frame = connection.frames.get(event.pid);
            if (event.stage === 'native-snapshot') {
                if (event.event === 'begin') {
                    if (frame) {
                        // An outstanding END or validation can belong to an earlier BEGIN.
                        // Forgetting either obligation could authorize that old work as this frame.
                        frame.depth++;
                        frame.ambiguous = true;
                        delete frame.candidate;
                        delete frame.endedAt;
                    } else
                        frame = {
                            beganAt: event.timestampMs,
                            depth: 1,
                            decisionDebt: 0,
                            ambiguous: event.outcome !== 'started' || event.error !== undefined,
                        };
                    connection.frames.set(event.pid, frame);
                    connection.listenerRoot = undefined;
                    if (frame.ambiguous) blockSnapshot(connection, frame);
                    else connection.snapshotBlock = 'snapshot-unvalidated';
                } else if (event.event === 'end') {
                    // Successful ENDs can have delayed validation, including valid:false.
                    // Contradictory ENDs retain debt conservatively. Actual failed ENDs
                    // without validation fields never reach validateNewRoot in the host.
                    const decisionExpected =
                        event.outcome === 'succeeded' ||
                        event.valid !== undefined ||
                        !member(['failed', 'cancelled'], event.outcome);
                    if (!frame) {
                        if (decisionExpected) {
                            frame = { beganAt: event.timestampMs, depth: 0, decisionDebt: 1, ambiguous: true };
                            connection.frames.set(event.pid, frame);
                        }
                        blockSnapshot(connection, frame);
                        return;
                    }
                    if (frame.depth > 0) frame.depth--;
                    else frame.ambiguous = true;
                    if (decisionExpected) frame.decisionDebt++;
                    if (
                        frame.ambiguous ||
                        frame.depth !== 0 ||
                        frame.decisionDebt !== 1 ||
                        frame.endedAt !== undefined ||
                        event.outcome !== 'succeeded' ||
                        event.valid !== true ||
                        event.error !== undefined ||
                        event.timestampMs < (frame.candidate?.timestampMs ?? frame.beganAt)
                    ) {
                        frame.ambiguous = true;
                        delete frame.candidate;
                        delete frame.endedAt;
                        blockSnapshot(connection, frame);
                        if (frame.depth === 0 && frame.decisionDebt === 0) connection.frames.delete(event.pid);
                        return;
                    }
                    frame.endedAt = event.timestampMs;
                } else {
                    if (!frame) {
                        blockSnapshot(connection);
                        return;
                    }
                    if (frame.decisionDebt > 0) frame.decisionDebt--;
                    else frame.ambiguous = true;
                    // Draining the final obligation discards quarantined candidates;
                    // only a later fresh BEGIN can establish another trusted frame.
                    if (frame.depth === 0 && frame.decisionDebt === 0) connection.frames.delete(event.pid);
                    const candidate = frame?.candidate;
                    if (
                        frame.ambiguous ||
                        frame.depth !== 0 ||
                        frame.decisionDebt !== 0 ||
                        frame.endedAt === undefined ||
                        !candidate ||
                        event.valid !== true ||
                        event.error !== undefined ||
                        !member(['observed', 'succeeded'], event.outcome) ||
                        event.timestampMs < frame.endedAt ||
                        candidate.rootStartTicks === undefined
                    ) {
                        frame.ambiguous = true;
                        delete frame.candidate;
                        blockSnapshot(connection, frame);
                        return;
                    }
                    let root = connection.root;
                    if (!root || root.pid !== event.pid || root.rootStartTicks !== candidate.rootStartTicks) {
                        root = {
                            entryId: event.entryId,
                            connectionId: event.connectionId,
                            sessionId: event.sessionId,
                            pid: event.pid,
                            rootStartTicks: candidate.rootStartTicks,
                            busy: false,
                            triggers: new Set(),
                            priorCounters: {},
                            priorPsi: {},
                        };
                        connection.root = root;
                    }
                    connection.listenerRoot = root;
                    connection.snapshotBlock = undefined;
                    connection.listenerValidatedAt = event.timestampMs;
                    const at = candidate.timestampMs;
                    if (candidate.rootProcessState !== 'disk-sleep') root.dStart = undefined;
                    else {
                        if (
                            root.lastObservation === undefined ||
                            at <= root.lastObservation ||
                            at - root.lastObservation > maximumObservationGapMs
                        )
                            root.dStart = at;
                        if (root.dStart === undefined) root.dStart = at;
                        if (at - root.dStart >= 1000) trigger(root, 'continuous-d', connection);
                    }
                    root.lastObservation = at;
                    trigger(root, 'baseline', connection);
                }
            } else if (event.stage === 'native-file' && event.event === 'decision' && event.command === 'proc-stat') {
                if (!frame || frame.ambiguous) return;
                if (
                    frame.candidate ||
                    frame.depth !== 1 ||
                    frame.decisionDebt !== 0 ||
                    frame.endedAt !== undefined ||
                    event.valid !== true ||
                    event.rootStartTicks === undefined ||
                    event.error !== undefined ||
                    !member(['observed', 'succeeded'], event.outcome) ||
                    event.timestampMs < frame.beganAt
                ) {
                    frame.ambiguous = true;
                    delete frame.candidate;
                    blockSnapshot(connection, frame);
                    return;
                }
                frame.candidate = event;
            } else if (event.stage === 'listener-ownership' && event.event === 'decision') {
                const validatedRoot = connection.listenerRoot;
                const root = validatedRoot ?? connection.root;
                connection.listenerRoot = undefined;
                if (
                    root?.pid === event.pid &&
                    event.reason === 'listener-owned' &&
                    event.error === undefined &&
                    member(['observed', 'succeeded'], event.outcome)
                ) {
                    if (
                        validatedRoot &&
                        connection.listenerValidatedAt !== undefined &&
                        event.timestampMs < connection.listenerValidatedAt
                    )
                        return;
                    trigger(
                        root,
                        'first-owned-listener',
                        connection,
                        validatedRoot ? connection.snapshotBlock : (connection.snapshotBlock ?? 'snapshot-unvalidated'),
                    );
                }
            } else if (
                event.phase === 'rollback-request' &&
                ((event.stage === 'readiness' && event.event === 'decision') ||
                    (event.stage === 'target-close' && event.event === 'begin'))
            ) {
                const root = connection.root;
                if (root?.pid === event.pid) trigger(root, 'rollback-request', connection);
            }
        } catch {
            /* Observation cannot affect readiness, rollback, Close or the primary failure. */
        }
    }
    return { observe };
}
