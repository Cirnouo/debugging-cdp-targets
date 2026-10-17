import { spawn } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { validateFixtureEvent } from '../../src/adapters/fixture-diagnostics.ts';
import { type BoundedLinuxRead, readLinuxStartupFile } from './linux-startup-wait.ts';

export interface ReadaheadIo {
    canonical(file: string): Promise<string>;
    metadata(file: string): Promise<{ dev: bigint; ino: bigint; regular: boolean }>;
    read(file: string): Promise<BoundedLinuxRead>;
    children(file: string): Promise<string[]>;
    write(file: string, value: number): { settled: Promise<void>; restorationSafe?: () => boolean };
    now(): number;
}
export interface ReadaheadIdentity {
    executable: string;
    dev: bigint;
    ino: bigint;
    device: string;
    queue: string;
    major: number;
    minor: number;
    queueMajor: number;
    queueMinor: number;
    storage: 'device' | 'partition';
}
export interface ReadaheadRecord {
    kind: 'linux-readahead-study';
    phase: 'initialization' | 'admission' | 'prelaunch' | 'application' | 'terminal' | 'observer' | 'restore';
    outcome: 'verified' | 'sampled' | 'overlapped' | 'unavailable' | 'pending' | 'failed';
    assignedKb: 128 | 1024;
    clock: 'parent' | 'gateway';
    storage?: 'device' | 'partition';
    startedMs: number;
    endedMs: number;
    elapsedMs?: number;
    reads?: number;
    bytes?: number;
    cost?: 'complete' | 'pending' | 'unavailable';
    metadataOps?: number;
    startCalls?: number;
    limitation?: 'timeout' | 'identity' | 'io' | 'proof';
    originalKb?: number;
    major?: number;
    minor?: number;
    queueMajor?: number;
    queueMinor?: number;
    rotational?: number;
    readsCompleted?: number;
    sectorsRead?: number;
    readMs?: number;
    pid?: number;
    readAheadKb?: number;
}
const numeric = [
    'elapsedMs',
    'reads',
    'bytes',
    'originalKb',
    'major',
    'minor',
    'queueMajor',
    'queueMinor',
    'rotational',
    'readsCompleted',
    'sectorsRead',
    'readMs',
    'pid',
    'readAheadKb',
    'metadataOps',
    'startCalls',
] as const;
const integer = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function member<T extends string>(values: readonly T[], value: unknown): value is T {
    return typeof value === 'string' && values.some((item) => item === value);
}
export function validateReadaheadRecord(value: unknown): Readonly<ReadaheadRecord> | undefined {
    try {
        if (!value || typeof value !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(value)))
            return;
        const fields: Record<string, unknown> = {};
        for (const key of Reflect.ownKeys(value)) {
            if (
                typeof key !== 'string' ||
                ![
                    'kind',
                    'phase',
                    'outcome',
                    'assignedKb',
                    'clock',
                    'storage',
                    'startedMs',
                    'endedMs',
                    'limitation',
                    'cost',
                    ...numeric,
                ].includes(key)
            )
                return;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor)) return;
            fields[key] = descriptor.value;
        }
        const { phase, outcome } = fields;
        if (
            fields.kind !== 'linux-readahead-study' ||
            !member(
                ['initialization', 'admission', 'prelaunch', 'application', 'terminal', 'observer', 'restore'],
                phase,
            ) ||
            !member(['verified', 'sampled', 'overlapped', 'unavailable', 'pending', 'failed'], outcome) ||
            (fields.assignedKb !== 128 && fields.assignedKb !== 1024)
        )
            return;
        const { startedMs, endedMs } = fields;
        if (fields.clock !== 'parent' && fields.clock !== 'gateway') return;
        if (
            typeof startedMs !== 'number' ||
            !Number.isFinite(startedMs) ||
            startedMs < 0 ||
            typeof endedMs !== 'number' ||
            !Number.isFinite(endedMs) ||
            endedMs < startedMs
        )
            return;
        for (const key of numeric)
            if (
                key in fields &&
                (key === 'elapsedMs'
                    ? typeof fields[key] !== 'number' || !Number.isFinite(fields[key]) || fields[key] < 0
                    : !integer(fields[key]))
            )
                return;
        const { limitation } = fields;
        const { storage } = fields;
        if ('storage' in fields && !member(['device', 'partition'], storage)) return;
        if ('limitation' in fields && !member(['timeout', 'identity', 'io', 'proof'], limitation)) return;
        if ('rotational' in fields && fields.rotational !== 0 && fields.rotational !== 1) return;
        if (typeof fields.reads === 'number' && fields.reads > 64) return;
        if (typeof fields.bytes === 'number' && fields.bytes > 64 * 4096) return;
        if (fields.pid === 0) return;
        const { cost } = fields;
        if ('cost' in fields && !member(['complete', 'pending', 'unavailable'], cost)) return;
        if ((cost === 'pending' || cost === 'unavailable') && fields.bytes !== undefined) return;
        if (cost === 'complete' && (fields.reads === undefined || fields.bytes === undefined)) return;
        if (typeof fields.reads === 'number' && typeof fields.bytes === 'number' && fields.bytes > fields.reads * 4096)
            return;
        if (fields.startCalls !== undefined && fields.startCalls !== 0 && fields.startCalls !== 1) return;
        // Reconstruct only validated primitives; no getters or input prototype survive.
        const optional: Partial<Record<(typeof numeric)[number], number>> = {};
        for (const key of numeric) {
            const value = fields[key];
            if (typeof value === 'number') optional[key] = value;
        }
        return Object.freeze({
            kind: 'linux-readahead-study',
            phase,
            outcome,
            assignedKb: fields.assignedKb,
            clock: fields.clock,
            startedMs,
            endedMs,
            ...optional,
            ...(member(['device', 'partition'], storage) ? { storage } : {}),
            ...(member(['timeout', 'identity', 'io', 'proof'], limitation) ? { limitation } : {}),
            ...(member(['complete', 'pending', 'unavailable'], cost) ? { cost } : {}),
        });
    } catch {
        return;
    }
}

export function privilegedReadaheadWrite(file: string, value: number) {
    const child = spawn('/usr/bin/sudo', ['-n', '--', '/usr/bin/tee', '--', file], {
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
    });
    let safe = false;
    let output = '';
    let overflow = false;
    child.stdout.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(output) + chunk.length > 64) overflow = true;
        else if (!overflow) output += chunk.toString('utf8');
    });
    const settled = new Promise<void>((resolve, reject) => {
        let failed = false;
        child.once('error', () => {
            failed = true;
        });
        child.stdin.on('error', () => {
            failed = true;
        });
        child.once('close', (code, signal) => {
            safe = code === 0 && signal === null && !failed;
            if (safe && !overflow && output === `${value}\n`) resolve();
            else reject(new Error('Readahead helper failed.'));
        });
        child.stdin.end(`${value}\n`);
    });
    return { settled, restorationSafe: () => safe };
}

/** Only intact bounded collector records can establish the native ownership barrier. */
export function readaheadExitProof(
    records: readonly unknown[],
    selected: { entryId: string; requestId: string },
    childClosed: boolean,
): boolean {
    if (!childClosed || records.length > 2000) return false;
    const events = [];
    for (const record of records) {
        if (!record || typeof record !== 'object') return false;
        if ('kind' in record && (record.kind === 'truncated' || record.kind === 'limitation')) return false;
        if ('kind' in record && record.kind === 'gateway') {
            const { kind: _kind, ...fields } = record;
            const event = validateFixtureEvent(fields);
            if (!event) return false;
            events.push(event);
        }
    }
    const start = events.find(
        (event) =>
            event.entryId === selected.entryId &&
            event.requestId === selected.requestId &&
            event.action === 'start' &&
            event.operationId &&
            event.connectionId &&
            event.sessionId,
    );
    if (!start) return false;
    const matched = events.filter(
        (event) => event.entryId === start.entryId && event.connectionId === start.connectionId,
    );
    const spawned = matched.filter(
        (event) =>
            event.stage === 'spawn' &&
            event.reason === 'acquired' &&
            event.sessionId === start.sessionId &&
            event.operationId === start.operationId,
    );
    if (spawned.some((event) => !event.pid) || new Set(spawned.map((event) => event.pid)).size > 1) return false;
    // A release checks every owner.exited and every pending resource. Normal Close
    // can race owner exit cleanup and legitimately omit target-exit-wait END.
    return matched.some(
        (event) =>
            event.stage === 'directory-lease' &&
            event.phase === 'resource-cleanup' &&
            event.event === 'end' &&
            event.outcome === 'released' &&
            event.originOperationId === start.operationId &&
            event.sessionId === undefined,
    );
}
export const nativeReadaheadIo: ReadaheadIo = {
    canonical: realpath,
    metadata: async (file) => {
        const metadata = await stat(file, { bigint: true });
        return { dev: metadata.dev, ino: metadata.ino, regular: metadata.isFile() };
    },
    read: (file) => readLinuxStartupFile(file, new AbortController().signal),
    children: readdir,
    write: privilegedReadaheadWrite,
    now: () => performance.now(),
};
function number(text: string): number {
    if (!/^\d+$/.test(text.trim()) || !integer(Number(text)))
        throw new Error('Readahead numeric evidence unavailable.');
    return Number(text);
}
function device(text: string): [number, number] {
    const parts = text.trim().split(':');
    if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined)
        throw new Error('Readahead device unavailable.');
    return [number(parts[0]), number(parts[1])];
}
async function readText(io: ReadaheadIo, file: string) {
    const result = await io.read(file);
    if (
        !integer(result.bytes) ||
        result.bytes >= 4096 ||
        result.text === undefined ||
        result.limitation ||
        Buffer.byteLength(result.text) !== result.bytes
    )
        throw new Error('Readahead read unavailable.');
    return result.text.trim();
}
export async function resolveReadaheadIdentity(
    executable: string,
    io: ReadaheadIo = nativeReadaheadIo,
): Promise<ReadaheadIdentity> {
    const canonical = await io.canonical(executable);
    const metadata = await io.metadata(canonical);
    if (!metadata.regular || !path.posix.isAbsolute(canonical))
        throw new Error('Readahead executable identity unavailable.');
    const major = Number(((metadata.dev >> 8n) & 0xfffn) | ((metadata.dev >> 32n) & 0xfffff000n));
    const minor = Number((metadata.dev & 0xffn) | ((metadata.dev >> 12n) & 0xffffff00n));
    const selected = await io.canonical(`/sys/dev/block/${major}:${minor}`);
    if (!selected.startsWith('/sys/devices/') || selected.includes('/virtual/'))
        throw new Error('Readahead unsupported device identity.');
    const actual = device(await readText(io, `${selected}/dev`));
    if (actual[0] !== major || actual[1] !== minor) throw new Error('Readahead device identity mismatch.');
    let queue = selected;
    let storage: 'device' | 'partition' = 'device';
    if ((await io.children(selected)).includes('partition')) {
        const partition = await readText(io, `${selected}/partition`);
        if (number(partition) < 1) throw new Error('Readahead partition identity mismatch.');
        queue = path.posix.dirname(selected);
        storage = 'partition';
    }
    const [queueMajor, queueMinor] = device(await readText(io, `${queue}/dev`));
    if ((await io.canonical(`/sys/dev/block/${queueMajor}:${queueMinor}`)) !== queue)
        throw new Error('Readahead queue identity mismatch.');
    if ((await io.children(`${queue}/slaves`)).length !== 0) throw new Error('Readahead stacked queue unsupported.');
    await readText(io, `${queue}/queue/read_ahead_kb`);
    return {
        executable: canonical,
        dev: metadata.dev,
        ino: metadata.ino,
        device: selected,
        queue,
        major,
        minor,
        queueMajor,
        queueMinor,
        storage,
    };
}
function same(a: ReadaheadIdentity, b: ReadaheadIdentity) {
    return Object.keys(a).every((key) => Reflect.get(a, key) === Reflect.get(b, key));
}
function safeIdentity(identity: ReadaheadIdentity) {
    return {
        major: identity.major,
        minor: identity.minor,
        queueMajor: identity.queueMajor,
        queueMinor: identity.queueMinor,
        storage: identity.storage,
    };
}
function bounded<T>(action: Promise<T>, budget: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        action,
        new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error('Readahead phase timeout.'));
            }, budget);
        }),
    ]).finally(() => clearTimeout(timer));
}
/** A bounded observation result and actual I/O ownership have separate lifetimes. */
function observation(source: ReadaheadIo) {
    const pending = new Set<Promise<unknown>>();
    let expired = false;
    let reads = 0;
    let bytes = 0;
    let metadataOps = 0;
    let unknownCost = false;
    function track<T>(work: Promise<T>): Promise<T> {
        pending.add(work);
        void work.then(
            () => pending.delete(work),
            () => pending.delete(work),
        );
        return work;
    }
    function check() {
        if (expired) throw new Error('Readahead phase timeout.');
    }
    const io: ReadaheadIo = {
        ...source,
        canonical: (file) => {
            check();
            metadataOps++;
            return track(source.canonical(file));
        },
        metadata: (file) => {
            check();
            metadataOps++;
            return track(source.metadata(file));
        },
        children: (file) => {
            check();
            metadataOps++;
            return track(source.children(file));
        },
        read: async (file) => {
            check();
            if (reads >= 64) throw new Error('Readahead read limit.');
            reads++;
            try {
                const result = await track(source.read(file));
                if (!integer(result.bytes) || result.bytes > 4096) {
                    unknownCost = true;
                    throw new Error('Readahead read cost unavailable.');
                }
                bytes += result.bytes;
                return result;
            } catch (error) {
                unknownCost = true;
                throw error;
            }
        },
    };
    return {
        io,
        track,
        check,
        expire: () => {
            expired = true;
        },
        async settled() {
            while (pending.size) await Promise.allSettled([...pending]);
        },
        cost(): Pick<ReadaheadRecord, 'cost' | 'reads' | 'bytes' | 'metadataOps'> {
            return {
                reads,
                metadataOps,
                cost: pending.size ? 'pending' : unknownCost ? 'unavailable' : 'complete',
                ...(pending.size || unknownCost ? {} : { bytes }),
            };
        },
    };
}
function phaseRecord(
    phase: ReadaheadRecord['phase'],
    outcome: ReadaheadRecord['outcome'],
    clock: ReadaheadRecord['clock'],
    assignedKb: 128 | 1024,
    startedMs: number,
    source: ReadaheadIo,
    context: ReturnType<typeof observation>,
    extra: Partial<ReadaheadRecord> = {},
): ReadaheadRecord {
    const endedMs = source.now();
    return {
        kind: 'linux-readahead-study',
        phase,
        outcome,
        clock,
        assignedKb,
        startedMs,
        endedMs,
        elapsedMs: endedMs - startedMs,
        ...context.cost(),
        ...extra,
    };
}
export function createReadaheadInitialization(
    executable: string,
    assignedKb: 128 | 1024,
    emit: (record: ReadaheadRecord) => void,
    io: ReadaheadIo = nativeReadaheadIo,
    budget = 250,
) {
    const context = observation(io);
    const startedMs = io.now();
    const actual = context.track(resolveReadaheadIdentity(executable, context.io));
    const result = bounded(actual, budget).then(
        (identity) => {
            emit(
                phaseRecord(
                    'initialization',
                    'verified',
                    'gateway',
                    assignedKb,
                    startedMs,
                    io,
                    context,
                    safeIdentity(identity),
                ),
            );
            return identity;
        },
        () => {
            context.expire();
            emit(
                phaseRecord('initialization', 'unavailable', 'gateway', assignedKb, startedMs, io, context, {
                    limitation: io.now() - startedMs >= budget ? 'timeout' : 'io',
                }),
            );
            return undefined;
        },
    );
    return { result, settled: () => context.settled(), cost: () => context.cost() };
}
export function createReadaheadLease(
    executable: string,
    assignedKb: 128 | 1024,
    emit: (record: ReadaheadRecord) => void,
    sourceIo: ReadaheadIo = nativeReadaheadIo,
    budget = 250,
) {
    let identity: ReadaheadIdentity | undefined;
    let original: number | undefined;
    let responsibility = false;
    let admitted = false;
    let starts = 0;
    let unsafeHelper = false;
    const contexts = new Set<ReturnType<typeof observation>>();
    function context() {
        const value = observation(sourceIo);
        contexts.add(value);
        return value;
    }
    function record(
        phase: ReadaheadRecord['phase'],
        outcome: ReadaheadRecord['outcome'],
        start: number,
        work: ReturnType<typeof observation>,
        extra: Partial<ReadaheadRecord> = {},
    ) {
        emit(
            phaseRecord(phase, outcome, 'parent', assignedKb, start, sourceIo, work, {
                ...(identity ? safeIdentity(identity) : {}),
                ...(original === undefined ? {} : { originalKb: original }),
                ...(phase === 'restore' ? { startCalls: starts } : {}),
                ...extra,
            }),
        );
    }
    async function verify(io: ReadaheadIo) {
        if (!identity || !same(identity, await resolveReadaheadIdentity(executable, io)))
            throw new Error('Readahead identity changed.');
    }
    async function write(value: number, work: ReturnType<typeof observation>) {
        await verify(work.io);
        // A timeout before this boundary cannot start a new privileged write.
        work.check();
        const selected = identity;
        if (!selected) throw new Error('Readahead identity unavailable.');
        responsibility = true;
        const helper = work.io.write(`${selected.queue}/queue/read_ahead_kb`, value);
        try {
            await work.track(helper.settled);
        } finally {
            if (helper.restorationSafe?.() === false) unsafeHelper = true;
        }
        await verify(work.io);
        const actual = number(await readText(work.io, `${selected.queue}/queue/read_ahead_kb`));
        if (actual !== value) throw new Error('Readahead readback mismatch.');
        return actual;
    }
    async function settleAll() {
        for (const work of contexts) await work.settled();
    }
    return {
        async admit() {
            const start = sourceIo.now();
            const work = context();
            const actual = work.track(
                (async () => {
                    identity = await resolveReadaheadIdentity(executable, work.io);
                    original = number(await readText(work.io, `${identity.queue}/queue/read_ahead_kb`));
                    return write(assignedKb, work);
                })(),
            );
            try {
                const readAheadKb = await bounded(actual, budget);
                admitted = true;
                record('admission', 'verified', start, work, { readAheadKb });
            } catch (error) {
                work.expire();
                record('admission', 'unavailable', start, work, {
                    limitation: sourceIo.now() - start >= budget ? 'timeout' : 'io',
                });
                throw error;
            }
        },
        identity() {
            if (!identity) throw new Error('Readahead identity unavailable.');
            return identity;
        },
        async verifyApplication(pid: number) {
            const start = sourceIo.now();
            const work = context();
            const actual = work.track(
                (async () => {
                    await verify(work.io);
                    const metadata = await work.io.metadata(`/proc/${pid}/exe`);
                    if (!metadata.regular || metadata.dev !== identity?.dev || metadata.ino !== identity?.ino)
                        throw new Error('Readahead application identity mismatch.');
                })(),
            );
            try {
                await bounded(actual, budget);
                record('application', 'verified', start, work, { pid });
            } catch (error) {
                work.expire();
                record('application', 'unavailable', start, work, {
                    pid,
                    limitation: sourceIo.now() - start >= budget ? 'timeout' : 'identity',
                });
                throw error;
            }
        },
        launch() {
            if (!admitted || starts !== 0) throw new Error('Readahead single launch admission required.');
            starts++;
        },
        launches: () => starts,
        settled: settleAll,
        async restore(provenExitAndResources: boolean) {
            // No terminal throw may abandon actual assignment/association resources.
            await settleAll();
            const start = sourceIo.now();
            const work = context();
            if (starts > 0 && !provenExitAndResources) {
                record('restore', 'pending', start, work, { limitation: 'proof' });
                throw new Error('Readahead restore pending actual exit/resource proof.');
            }
            if (unsafeHelper) {
                record('restore', 'pending', start, work, { limitation: 'proof' });
                throw new Error('Readahead restore pending actual writer settlement proof.');
            }
            if (!responsibility || original === undefined) {
                record('restore', 'unavailable', start, work, { limitation: 'io' });
                return;
            }
            // The observation deadline does not cancel the actual restoration or
            // suppress its independent readback. Never issue a replacement write.
            let readAheadKb: number | undefined;
            const actual = work.track(
                write(original, work).then((value) => {
                    readAheadKb = value;
                    return value;
                }),
            );
            try {
                await bounded(actual, budget);
                responsibility = false;
                record('restore', 'verified', start, work, { readAheadKb: await actual });
            } catch (error) {
                const timedOut = sourceIo.now() - start >= budget;
                await Promise.allSettled([actual]);
                await work.settled();
                record('restore', unsafeHelper ? 'pending' : 'failed', start, work, {
                    limitation: unsafeHelper ? 'proof' : timedOut ? 'timeout' : 'io',
                    ...(readAheadKb === undefined ? {} : { readAheadKb }),
                });
                throw error;
            }
        },
    };
}
export function createReadaheadObserver(
    identity: ReadaheadIdentity,
    emit: (record: ReadaheadRecord) => void,
    io: ReadaheadIo = nativeReadaheadIo,
    assignedKb: 128 | 1024 = 128,
    clock: 'parent' | 'gateway' = 'parent',
    budget = 250,
) {
    let cleanupAt: number | undefined;
    let terminalStarted = false;
    const contexts = new Set<ReturnType<typeof observation>>();
    const pending = new Set<Promise<void>>();
    function context() {
        const value = observation(io);
        contexts.add(value);
        return value;
    }
    async function sample(phase: 'prelaunch' | 'terminal') {
        const start = io.now();
        const work = context();
        const actual = work.track(
            (async () => {
                const deviceId = device(await readText(work.io, `${identity.device}/dev`));
                if (deviceId[0] !== identity.major || deviceId[1] !== identity.minor)
                    throw new Error('Readahead observation identity changed.');
                const queueId = device(await readText(work.io, `${identity.queue}/dev`));
                if (queueId[0] !== identity.queueMajor || queueId[1] !== identity.queueMinor)
                    throw new Error('Readahead observation queue identity changed.');
                const readAheadKb = number(await readText(work.io, `${identity.queue}/queue/read_ahead_kb`));
                const fields = (await readText(work.io, `${identity.device}/stat`)).split(/\s+/).map(number);
                const [readsCompleted, , sectorsRead, readMs] = fields;
                if (
                    fields.length < 11 ||
                    readsCompleted === undefined ||
                    sectorsRead === undefined ||
                    readMs === undefined
                )
                    throw new Error('Readahead counters unavailable.');
                const rotational = number(await readText(work.io, `${identity.queue}/queue/rotational`));
                if (rotational !== 0 && rotational !== 1) throw new Error('Readahead queue class unavailable.');
                return { readsCompleted, sectorsRead, readMs, rotational, readAheadKb };
            })(),
        );
        let details: Partial<ReadaheadRecord> = {};
        let outcome: ReadaheadRecord['outcome'] = 'sampled';
        try {
            details = await bounded(actual, budget);
        } catch {
            work.expire();
            outcome = 'unavailable';
        }
        const ended = io.now();
        const limitation =
            outcome === 'unavailable' ? ({ limitation: ended - start >= budget ? 'timeout' : 'io' } as const) : {};
        if (phase === 'terminal' && cleanupAt !== undefined && cleanupAt <= ended) outcome = 'overlapped';
        emit(
            phaseRecord(phase, outcome, clock, assignedKb, start, io, work, {
                ...safeIdentity(identity),
                ...details,
                ...limitation,
            }),
        );
    }
    function track(work: Promise<void>) {
        pending.add(work);
        void work.then(
            () => pending.delete(work),
            () => pending.delete(work),
        );
        return work;
    }
    return {
        prelaunch: () => track(sample('prelaunch')),
        terminal() {
            if (!terminalStarted) {
                terminalStarted = true;
                void track(sample('terminal'));
            }
        },
        cleanup() {
            cleanupAt ??= io.now();
        },
        async settled() {
            while (pending.size) await Promise.allSettled([...pending]);
            for (const work of contexts) await work.settled();
        },
        cost(): Pick<ReadaheadRecord, 'cost' | 'reads' | 'bytes' | 'metadataOps'> {
            const costs = [...contexts].map((work) => work.cost());
            const complete = costs.every((cost) => cost.cost === 'complete');
            return {
                cost: complete ? 'complete' : costs.some((cost) => cost.cost === 'pending') ? 'pending' : 'unavailable',
                reads: costs.reduce((sum, cost) => sum + (cost.reads ?? 0), 0),
                metadataOps: costs.reduce((sum, cost) => sum + (cost.metadataOps ?? 0), 0),
                ...(complete ? { bytes: costs.reduce((sum, cost) => sum + (cost.bytes ?? 0), 0) } : {}),
            };
        },
        observe(value: unknown) {
            const event = validateFixtureEvent(value);
            if (!event) return;
            if (event.stage === 'readiness' && event.phase === 'waiting-cdp' && event.event === 'end') this.terminal();
            if (
                (event.stage === 'target-close' ||
                    event.stage === 'gateway-cleanup' ||
                    (event.stage === 'directory-lease' && event.phase === 'resource-cleanup')) &&
                event.event === 'begin'
            ) {
                this.cleanup();
                this.terminal();
            }
            if (event.stage === 'spawn' && event.reason === 'acquired' && event.pid) {
                const pid = event.pid;
                const start = io.now();
                const work = context();
                const actual = work.track(
                    work.io.metadata(`/proc/${pid}/exe`).then((metadata) => {
                        if (!metadata.regular || metadata.dev !== identity.dev || metadata.ino !== identity.ino)
                            throw new Error('Readahead application identity mismatch.');
                    }),
                );
                void track(
                    (async () => {
                        let outcome: ReadaheadRecord['outcome'] = 'verified';
                        try {
                            await bounded(actual, budget);
                        } catch {
                            work.expire();
                            outcome = 'unavailable';
                        }
                        emit(
                            phaseRecord('application', outcome, clock, assignedKb, start, io, work, {
                                pid,
                                ...safeIdentity(identity),
                                ...(outcome === 'unavailable'
                                    ? { limitation: io.now() - start >= budget ? 'timeout' : 'identity' }
                                    : {}),
                            }),
                        );
                    })(),
                );
            }
        },
    };
}
