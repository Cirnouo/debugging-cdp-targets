import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { type FixtureEvent, validateFixtureEvent } from '../../src/adapters/fixture-diagnostics.ts';
import {
    type CaptureBudget,
    type CaptureIdentity,
    type CaptureIo,
    captureCost,
    captureMetadata,
    captureNativeIo,
    createCaptureBudget,
    readFirstStartFile,
} from './linux-first-start-capture-io.ts';
import {
    type CaptureFamily,
    type CaptureLimits,
    type CaptureMetrics,
    type CaptureStatus,
    captureAuxiliarySlots,
    type FirstStartCaptureRecord,
    validateFirstStartCaptureRecord,
} from './linux-first-start-capture-record.ts';
export interface FirstStartCaptureDependencies {
    enabled?: boolean;
    platform?: NodeJS.Platform;
    now?: () => number;
    setTimer?: (callback: () => void, delay: number) => unknown;
    clearTimer?: (timer: unknown) => void;
    io?: CaptureIo;
}
const families = ['process', 'device', 'cgroup'] as const;
const schedule = [0, 4000, 8000, 12000, 16000, 19000] as const;
const number = (text: string | undefined): number | undefined => {
    if (text === undefined || !/^\d+$/.test(text)) return;
    const value = Number(text);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};
const same = (a: CaptureIdentity | undefined, b: CaptureIdentity | undefined): boolean =>
    !!a && !!b && a.dev === b.dev && a.ino === b.ino;
const safePath = (value: string): boolean =>
    value.startsWith('/') &&
    !/[\s\\\0]/.test(value) &&
    !value.split('/').some((part) => part === '.' || part === '..') &&
    !value.includes('//');
function processStat(text: string | undefined, pid: number): (CaptureMetrics & { start: number }) | undefined {
    const match = /^(\d+) \(.*\) ([RSDZTWXIPtKx] .*)\n?$/.exec(text ?? '');
    if (number(match?.[1]) !== pid) return;
    const fields = match?.[2]?.trim().split(/\s+/);
    const start = number(fields?.[19]);
    if (start === undefined) return;
    const result: CaptureMetrics & { start: number } = { start };
    for (const [key, index] of [
        ['majorFaults', 9],
        ['userTicks', 11],
        ['systemTicks', 12],
        ['blockIoTicks', 39],
    ] as const) {
        const value = number(fields?.[index]);
        if (value !== undefined) result[key] = value;
    }
    return result;
}
function pairs(text: string | undefined, colon = false): Map<string, number> | undefined {
    if (text === undefined) return;
    const result = new Map<string, number>();
    for (const line of text.trim().split('\n')) {
        const match = (colon ? /^([a-z_]+): (\d+)$/ : /^([a-z_]+) (\d+)$/).exec(line);
        const value = number(match?.[2]);
        if (!match?.[1] || value === undefined || result.has(match[1])) return;
        result.set(match[1], value);
    }
    return result;
}
interface DeviceContext {
    selected: string;
    queue: string;
    selectedIdentity: CaptureIdentity;
    queueIdentity: CaptureIdentity;
    link: string;
    key: string;
    queueKey: string;
    partition: boolean;
}
interface CgroupContext {
    membership: string;
    mountinfo: string;
    mount: string;
    directories: string[];
    identities: CaptureIdentity[];
    mountIdentity: CaptureIdentity;
    namespaces: CaptureIdentity[];
    depth: number;
    capped: boolean;
}
interface Group {
    busy: boolean;
    valid: boolean;
    discovery?: CaptureBudget;
    budget?: CaptureBudget;
    prior: CaptureMetrics;
    context?: DeviceContext | CgroupContext;
    cutoff?: () => void;
}
type FamilyResult = { -readonly [Key in keyof FirstStartCaptureRecord]?: FirstStartCaptureRecord[Key] };
interface Work {
    budget: CaptureBudget;
    allowed: () => boolean;
    read: (file: string) => Promise<string | undefined>;
    identity: (file: string) => Promise<CaptureIdentity | undefined>;
    resolve: (file: string) => Promise<string | undefined>;
    reason: CaptureStatus | undefined;
    lastRead: CaptureStatus | undefined;
}

/** Fixed six points, independent sequential owners, no lifecycle awaits or postfailure admission. */
export function createLinuxFirstStartCapture(
    sink: (record: FirstStartCaptureRecord) => void,
    deps: FirstStartCaptureDependencies = {},
) {
    if (deps.enabled !== true || (deps.platform ?? process.platform) !== 'linux')
        return { observe(_value: unknown): void {}, finish(): void {} };
    const now = deps.now ?? (() => performance.now());
    const setTimer =
        deps.setTimer ??
        ((callback: () => void, delay: number) => {
            const timer = setTimeout(callback, delay);
            timer.unref();
            return timer;
        });
    const clearTimer =
        deps.clearTimer ??
        ((timer: unknown) => {
            if (typeof timer === 'object' && timer !== null && 'hasRef' in timer) clearTimeout(timer as NodeJS.Timeout);
        });
    const io = captureNativeIo(deps.io);
    const queueFlush = (callback: () => void) => (deps.setTimer ? setTimer(callback, 0) : setImmediate(callback));
    const groups: Record<CaptureFamily, Group> = {
        process: { busy: false, valid: true, prior: {} },
        device: { busy: false, valid: true, prior: {} },
        cgroup: { busy: false, valid: true, prior: {} },
    };
    const cache = new Map<string, FirstStartCaptureRecord>();
    const timers: unknown[] = [];
    const slotStates: CaptureStatus[] = Array.from({ length: 6 }, () => 'not-admitted');
    const phaseBudgets: Array<Partial<Record<CaptureFamily, CaptureBudget>>> = Array.from({ length: 6 }, () => ({}));
    let selected: FixtureEvent | undefined;
    let launchSeen = false;
    let waitingAt: number | undefined;
    let rootStart: number | undefined;
    let executable: CaptureIdentity | undefined;
    let waiting = false;
    let stopped = false;
    let finished = false;
    let outcome: 'succeeded' | 'failed' | 'cancelled' | undefined;
    let failureReason: FirstStartCaptureRecord['outcomeReason'];
    let closeStarted: number | undefined;
    let closeGate = false;
    let flushStarted = false;
    let cacheBytes = 0;
    let completedPoints = 0;
    let pendingPoints = 0;
    let sinkCalls = 0;
    let sinkFailed = 0;
    let callbackMs = 0;
    let snapshot:
        | { began: number; depth: number; debt: number; ambiguous: boolean; candidate?: FixtureEvent; ended?: number }
        | undefined;
    let baseline = false;
    const identity = () =>
        selected
            ? {
                  entryId: selected.entryId,
                  connectionId: selected.connectionId,
                  sessionId: selected.sessionId,
                  operationId: selected.operationId,
                  requestId: selected.requestId,
                  ...(selected.pid === undefined ? {} : { pid: selected.pid }),
                  ...(rootStart === undefined ? {} : { rootStartTicks: rootStart }),
              }
            : {};
    function put(key: string, value: Omit<FirstStartCaptureRecord, 'kind' | 'atMs'> & { atMs?: number }): void {
        if (cache.has(key) || finished) return;
        const record = validateFirstStartCaptureRecord({
            kind: 'linux-first-start-capture',
            atMs: now(),
            ...identity(),
            ...value,
        });
        if (!record) return;
        const size = Buffer.byteLength(JSON.stringify(record)) + 1;
        if (cache.size >= 64 || cacheBytes + size > 256 * 1024) return;
        cache.set(key, record);
        cacheBytes += size;
    }
    function matches(event: FixtureEvent): boolean {
        return (
            !!selected &&
            event.entryId === selected.entryId &&
            event.connectionId === selected.connectionId &&
            event.sessionId === selected.sessionId &&
            (event.originOperationId ?? event.operationId) === selected.operationId &&
            (event.requestId === selected.requestId ||
                (event.originOperationId === selected.operationId && event.requestId === undefined)) &&
            (event.pid === undefined || selected.pid === undefined || event.pid === selected.pid)
        );
    }
    function admission(): boolean {
        return waiting && !stopped && !finished;
    }
    function work(budget: CaptureBudget, allowed: () => boolean): Work {
        const result: Work = {
            budget,
            allowed,
            reason: undefined,
            lastRead: undefined,
            async read(file) {
                const value = await readFirstStartFile(file, allowed, budget, io.open);
                result.lastRead = value.status;
                if (value.status !== 'complete') result.reason ??= value.status;
                return allowed() ? value.text : undefined;
            },
            identity(file) {
                return captureMetadata(allowed, budget, () => io.stat(file));
            },
            resolve(file) {
                return captureMetadata(allowed, budget, () => io.realpath(file));
            },
        };
        return result;
    }
    async function rootBefore(w: Work): Promise<boolean> {
        if (!selected?.pid || rootStart === undefined) return false;
        const state = processStat(await w.read(`/proc/${selected.pid}/stat`), selected.pid);
        const exe = await w.identity(`/proc/${selected.pid}/exe`);
        if (!state || state.start !== rootStart || !exe || !w.allowed()) return false;
        if (!executable) bindExecutable(exe);
        return same(executable, exe);
    }
    function bindExecutable(exe: CaptureIdentity): void {
        const dev = Number(exe.dev);
        const ino = Number(exe.ino);
        if (!Number.isSafeInteger(dev) || !Number.isSafeInteger(ino) || dev < 0 || ino <= 0) return;
        executable = exe;
        put('root-binding', {
            slot: 'root-binding',
            status: 'bound',
            metrics: { executableDev: dev, executableIno: ino },
        });
    }
    async function rootAfter(w: Work): Promise<boolean> {
        if (!selected?.pid) return false;
        const exe = await w.identity(`/proc/${selected.pid}/exe`);
        const state = processStat(await w.read(`/proc/${selected.pid}/stat`), selected.pid);
        return w.allowed() && state?.start === rootStart && same(executable, exe);
    }
    function discovery(family: 'device' | 'cgroup', deadline: number): void {
        const group = groups[family];
        group.busy = true;
        const budget = createCaptureBudget(family === 'device' ? 5 : 4, family === 'device' ? 18 : 30);
        group.discovery = budget;
        let expired = false;
        const allowed = () => admission() && !expired && now() < deadline;
        group.cutoff = () =>
            put(`family-0-${family}-0`, { slot: 'family', family, phase: 0, scope: 0, status: 'unavailable' });
        const w = work(budget, allowed);
        const timer = setTimer(
            () => {
                expired = true;
                group.cutoff?.();
                put(`${family}-epoch`, {
                    slot: family === 'device' ? 'device-epoch' : 'cgroup-epoch',
                    status: 'timeout',
                    epoch: 0,
                });
            },
            Math.max(0, deadline - now()),
        );
        timers.push(timer);
        void (async () => {
            if (!(await rootBefore(w))) return;
            if (family === 'device') {
                const exe = executable;
                if (!exe) return;
                const major = Number(((exe.dev >> 8n) & 0xfffn) | ((exe.dev >> 32n) & 0xfffff000n));
                const minor = Number((exe.dev & 0xffn) | ((exe.dev >> 12n) & 0xffffff00n));
                if (!major) return;
                const key = `${major}:${minor}`;
                const link = `/sys/dev/block/${key}`;
                const directory = await w.resolve(link);
                if (!directory?.startsWith('/sys/devices/') || !safePath(directory)) return;
                const partitionText = await w.read(`${directory}/partition`);
                const partition = number(partitionText?.trim()) !== undefined;
                if (!partition && w.lastRead !== 'missing') return;
                if (!partition && w.reason === 'missing') w.reason = undefined;
                const queue = partition ? path.posix.dirname(directory) : directory;
                const selectedDev = (await w.read(`${directory}/dev`))?.trim();
                const queueDev = queue === directory ? selectedDev : (await w.read(`${queue}/dev`))?.trim();
                const selectedIdentity = await w.identity(directory);
                const queueIdentity = queue === directory ? selectedIdentity : await w.identity(queue);
                const resolvedAgain = await w.resolve(link);
                const queueResolved = await w.resolve(queue);
                if (
                    selectedDev !== key ||
                    !queueDev ||
                    !/^\d+:\d+$/.test(queueDev) ||
                    queueDev.split(':').some((part) => number(part) === undefined) ||
                    !selectedIdentity ||
                    !queueIdentity ||
                    resolvedAgain !== directory ||
                    queueResolved !== queue ||
                    !(await rootAfter(w))
                )
                    return;
                group.context = {
                    selected: directory,
                    queue,
                    selectedIdentity,
                    queueIdentity,
                    link,
                    key,
                    queueKey: queueDev,
                    partition,
                };
            } else {
                const pid = selected?.pid;
                if (!pid) return;
                const membership = await w.read(`/proc/${pid}/cgroup`);
                const mountinfo = await w.read(`/proc/${pid}/mountinfo`);
                const member = /^0::(\/[^\n]*)\n?$/.exec(membership ?? '')?.[1];
                const mounts = mountinfo
                    ?.trim()
                    .split('\n')
                    .filter((line) => line.includes(' - cgroup2 '));
                const fields = mounts?.[0]?.split(' ');
                const sections = mounts?.[0]?.split(' - ');
                const root = fields?.[3];
                const mount = fields?.[4];
                if (
                    !membership ||
                    !mountinfo ||
                    !member ||
                    !safePath(member) ||
                    mounts?.length !== 1 ||
                    !root ||
                    !safePath(root) ||
                    !mount ||
                    !safePath(mount) ||
                    !/^\d+:\d+$/.test(fields?.[2] ?? '') ||
                    number(fields?.[0]) === undefined ||
                    number(fields?.[1]) === undefined ||
                    sections?.length !== 2 ||
                    !/^cgroup2 [^ ]+ [^ ]+$/.test(sections[1] ?? '') ||
                    (root !== '/' && member !== root && !member.startsWith(`${root}/`))
                )
                    return;
                const leaf = mount + (member === root ? '' : root === '/' ? member : member.slice(root.length));
                const directories: string[] = [];
                let directory = leaf;
                let depth = 0;
                while (true) {
                    if (directories.length < 4) directories.push(directory);
                    if (directory === mount) break;
                    directory = path.posix.dirname(directory);
                    depth++;
                    if (depth > 128 || (directory !== mount && !directory.startsWith(`${mount}/`))) return;
                }
                const identities: CaptureIdentity[] = [];
                for (const file of directories) {
                    if ((await w.resolve(file)) !== file) return;
                    const value = await w.identity(file);
                    if (!value) return;
                    identities.push(value);
                }
                if ((await w.resolve(mount)) !== mount) return;
                const mountIdentity = await w.identity(mount);
                if (!mountIdentity) return;
                if (identities.some((value) => value.dev !== mountIdentity.dev)) {
                    w.reason = 'identity-invalid';
                    return;
                }
                const namespaces: CaptureIdentity[] = [];
                for (const file of [
                    `/proc/${pid}/ns/cgroup`,
                    '/proc/self/ns/cgroup',
                    `/proc/${pid}/ns/mnt`,
                    '/proc/self/ns/mnt',
                ]) {
                    const value = await w.identity(file);
                    if (!value) return;
                    namespaces.push(value);
                }
                if (!same(namespaces[0], namespaces[1]) || !same(namespaces[2], namespaces[3])) {
                    w.reason = 'namespace-invalid';
                    return;
                }
                if (!(await rootAfter(w))) return;
                group.context = {
                    membership,
                    mountinfo,
                    mount,
                    directories,
                    identities,
                    mountIdentity,
                    namespaces,
                    depth,
                    capped: depth >= 4,
                };
            }
        })()
            .catch(() => {})
            .finally(() => {
                clearTimer(timer);
                group.busy = false;
                if (!allowed()) delete group.context;
                put(`${family}-epoch`, {
                    slot: family === 'device' ? 'device-epoch' : 'cgroup-epoch',
                    status: group.context ? 'bound' : expired ? 'timeout' : 'unavailable',
                    epoch: 0,
                    ...(w.reason ? { reason: w.reason } : {}),
                });
                if (group.context && allowed()) {
                    delete group.cutoff;
                    sample(0, family, deadline);
                } else {
                    group.cutoff?.();
                    delete group.cutoff;
                }
            });
    }
    function monotonic(group: Group, metrics: CaptureMetrics): boolean {
        for (const [key, value] of Object.entries(metrics)) {
            if (
                [
                    'inFlight',
                    'readAheadKb',
                    'rotational',
                    'maxSectorsKb',
                    'major',
                    'minor',
                    'queueMajor',
                    'queueMinor',
                    'cpuQuota',
                    'cpuPeriod',
                    'memoryHigh',
                    'memoryMax',
                ].includes(key) ||
                key.includes('Bps') ||
                key.includes('Iops')
            )
                continue;
            const prior = group.prior[key as keyof CaptureMetrics];
            if (prior !== undefined && value < prior) return false;
        }
        Object.assign(group.prior, metrics);
        return true;
    }
    async function processFamily(w: Work): Promise<FamilyResult[]> {
        const pid = selected?.pid;
        if (!pid) return [];
        const first = processStat(await w.read(`/proc/${pid}/stat`), pid);
        const exe = await w.identity(`/proc/${pid}/exe`);
        if (!first || first.start !== rootStart || !exe || (executable && !same(executable, exe)))
            return [{ status: 'identity-invalid' }];
        if (!executable) bindExecutable(exe);
        if (!same(executable, exe)) return [{ status: 'identity-invalid' }];
        const ioValues = pairs(await w.read(`/proc/${pid}/io`), true);
        const waitText = (await w.read(`/proc/${pid}/wchan`))?.trim();
        const metrics: CaptureMetrics = {};
        for (const [name, key] of [
            ['read_bytes', 'readBytes'],
            ['write_bytes', 'writeBytes'],
        ] as const) {
            const value = ioValues?.get(name);
            if (value !== undefined) metrics[key] = value;
        }
        for (const prefix of ['io', 'cpu', 'memory'] as const) {
            const text = await w.read(`/proc/pressure/${prefix}`);
            for (const name of ['some', 'full'] as const) {
                const matches = text?.split('\n').filter((line) => line.startsWith(`${name} `));
                const value = matches?.length === 1 ? number(/ total=(\d+)$/.exec(matches[0] ?? '')?.[1]) : undefined;
                if (value !== undefined) metrics[`${prefix}${name === 'some' ? 'Some' : 'Full'}Us`] = value;
            }
        }
        const final = processStat(await w.read(`/proc/${pid}/stat`), pid);
        const endExe = await w.identity(`/proc/${pid}/exe`);
        if (!final || final.start !== rootStart || !same(exe, endExe)) return [{ status: 'identity-invalid' }];
        for (const key of ['userTicks', 'systemTicks', 'majorFaults', 'blockIoTicks'] as const) {
            if (first[key] === undefined || final[key] === undefined || final[key] < first[key])
                return [{ status: 'counter-invalid' }];
            metrics[key] = final[key];
        }
        const wait = waitText?.startsWith('futex')
            ? 'futex'
            : waitText?.startsWith('pipe')
              ? 'pipe'
              : waitText?.includes('poll')
                ? 'poll'
                : waitText?.startsWith('io_')
                  ? 'io'
                  : waitText?.startsWith('schedule')
                    ? 'scheduler'
                    : 'unknown';
        return [
            {
                status: monotonic(groups.process, metrics) ? (w.reason ? 'partial' : 'complete') : 'counter-invalid',
                metrics,
                wait,
            },
        ];
    }
    async function deviceFamily(w: Work, context: DeviceContext): Promise<FamilyResult[]> {
        if (!(await rootBefore(w))) return [{ status: 'identity-invalid' }];
        const directories = context.selected === context.queue ? [context.selected] : [context.selected, context.queue];
        for (const directory of directories) {
            if (
                (await w.resolve(directory === context.selected ? context.link : directory)) !== directory ||
                !same(
                    await w.identity(directory),
                    directory === context.selected ? context.selectedIdentity : context.queueIdentity,
                ) ||
                (await w.read(`${directory}/dev`))?.trim() !==
                    (directory === context.selected ? context.key : context.queueKey)
            )
                return [{ status: 'identity-invalid' }];
        }
        const metrics: CaptureMetrics = {};
        const device = (text: string | undefined, queue: boolean): boolean => {
            const values = text?.trim().split(/\s+/).map(number);
            if (!values || ![11, 15, 17].includes(values.length) || values.some((item) => item === undefined))
                return false;
            for (const [key, index] of (queue
                ? [
                      ['queueReadsCompleted', 0],
                      ['queueSectorsRead', 2],
                      ['queueReadMs', 3],
                      ['queueIoMs', 9],
                      ['queueWeightedIoMs', 10],
                  ]
                : [
                      ['readsCompleted', 0],
                      ['sectorsRead', 2],
                      ['readMs', 3],
                      ['writesCompleted', 4],
                      ['writeMs', 7],
                      ['inFlight', 8],
                      ['ioMs', 9],
                      ['weightedIoMs', 10],
                  ]) as Array<[keyof CaptureMetrics, number]>) {
                const value = values[index];
                if (value !== undefined) metrics[key] = value;
            }
            return true;
        };
        if (!device(await w.read(`${context.selected}/stat`), false)) return [{ status: 'unavailable' }];
        if (context.queue !== context.selected && !device(await w.read(`${context.queue}/stat`), true))
            return [{ status: 'unavailable' }];
        for (const [name, key] of [
            ['read_ahead_kb', 'readAheadKb'],
            ['rotational', 'rotational'],
            ['max_sectors_kb', 'maxSectorsKb'],
        ] as const) {
            const value = number((await w.read(`${context.queue}/queue/${name}`))?.trim());
            if (value !== undefined && (key !== 'rotational' || value === 0 || value === 1)) metrics[key] = value;
            else w.reason ??= 'unavailable';
        }
        const schedulerText = await w.read(`${context.queue}/queue/scheduler`);
        const active = /\[([^[\] ]+)\]/g;
        const schedulers = schedulerText ? [...schedulerText.matchAll(active)] : [];
        const name = schedulers.length === 1 ? schedulers[0]?.[1] : undefined;
        if (name === undefined) w.reason ??= 'unavailable';
        const scheduler: FirstStartCaptureRecord['scheduler'] =
            name === undefined
                ? 'unavailable'
                : name === 'none' || name === 'mq-deadline' || name === 'kyber' || name === 'bfq'
                  ? name
                  : 'other';
        for (const directory of directories) {
            if (
                (await w.read(`${directory}/dev`))?.trim() !==
                    (directory === context.selected ? context.key : context.queueKey) ||
                (await w.resolve(directory === context.selected ? context.link : directory)) !== directory ||
                !same(
                    await w.identity(directory),
                    directory === context.selected ? context.selectedIdentity : context.queueIdentity,
                )
            )
                return [{ status: 'identity-invalid' }];
        }
        if (!(await rootAfter(w))) return [{ status: 'identity-invalid' }];
        const [major, minor] = context.key.split(':').map(Number);
        const [queueMajor, queueMinor] = context.queueKey.split(':').map(Number);
        Object.assign(metrics, { major, minor, queueMajor, queueMinor });
        return [
            {
                status: monotonic(groups.device, metrics) ? (w.reason ? 'partial' : 'complete') : 'counter-invalid',
                metrics,
                scheduler,
            },
        ];
    }
    async function cgroupFamily(w: Work, context: CgroupContext): Promise<FamilyResult[]> {
        const pid = selected?.pid;
        if (!pid || !(await rootBefore(w))) return [{ status: 'identity-invalid' }];
        async function bracket(): Promise<boolean> {
            if (
                (await w.read(`/proc/${pid}/cgroup`)) !== context.membership ||
                (await w.read(`/proc/${pid}/mountinfo`)) !== context.mountinfo
            )
                return false;
            for (let index = 0; index < context.directories.length; index++) {
                const directory = context.directories[index];
                if (
                    !directory ||
                    (await w.resolve(directory)) !== directory ||
                    !same(await w.identity(directory), context.identities[index])
                )
                    return false;
            }
            if (
                (await w.resolve(context.mount)) !== context.mount ||
                !same(await w.identity(context.mount), context.mountIdentity)
            )
                return false;
            const files = [
                `/proc/${pid}/ns/cgroup`,
                '/proc/self/ns/cgroup',
                `/proc/${pid}/ns/mnt`,
                '/proc/self/ns/mnt',
            ];
            for (let index = 0; index < files.length; index++) {
                const file = files[index];
                if (!file || !same(await w.identity(file), context.namespaces[index])) return false;
            }
            return true;
        }
        if (!(await bracket())) return [{ status: 'namespace-invalid' }];
        const results: FamilyResult[] = [];
        for (let index = 0; index < context.directories.length; index++) {
            const directory = context.directories[index];
            if (!directory) continue;
            const metrics: CaptureMetrics = {};
            const limits: CaptureLimits = {
                selectedReadBps: 'unavailable',
                selectedWriteBps: 'unavailable',
                selectedReadIops: 'unavailable',
                selectedWriteIops: 'unavailable',
                queueReadBps: 'unavailable',
                queueWriteBps: 'unavailable',
                queueReadIops: 'unavailable',
                queueWriteIops: 'unavailable',
            };
            const ioMax = await w.read(`${directory}/io.max`);
            const cpuMax = (await w.read(`${directory}/cpu.max`))?.trim().split(' ');
            const cpu = pairs(await w.read(`${directory}/cpu.stat`));
            const high = (await w.read(`${directory}/memory.high`))?.trim();
            const max = (await w.read(`${directory}/memory.max`))?.trim();
            const events = pairs(await w.read(`${directory}/memory.events`));
            const local = pairs(await w.read(`${directory}/memory.events.local`));
            for (const [key, value] of [
                ['cpuQuota', number(cpuMax?.[0])],
                ['cpuPeriod', number(cpuMax?.[1])],
                ['nrThrottled', cpu?.get('nr_throttled')],
                ['throttledUs', cpu?.get('throttled_usec')],
                ['memoryHigh', number(high)],
                ['memoryMax', number(max)],
                ['memoryHighEvents', events?.get('high')],
                ['memoryMaxEvents', events?.get('max')],
                ['memoryHighLocalEvents', local?.get('high')],
                ['memoryMaxLocalEvents', local?.get('max')],
            ] as const)
                if (value !== undefined) metrics[key] = value;
            for (const [key, text] of [
                ['cpuQuota', cpuMax?.[0]],
                ['memoryHigh', high],
                ['memoryMax', max],
            ] as const)
                limits[key] = text === 'max' ? 'max' : metrics[key] !== undefined ? 'finite' : 'unavailable';
            const device = groups.device.context as DeviceContext | undefined;
            let ioStatus: CaptureStatus | undefined;
            if (ioMax !== undefined && device) {
                const lines = ioMax.trim() ? ioMax.trim().split('\n') : [];
                for (const [key, prefix] of [
                    [device.key, 'selected'],
                    [device.queueKey, 'queue'],
                ] as const) {
                    if (prefix === 'queue' && device.key === device.queueKey) {
                        for (const suffix of ['ReadBps', 'WriteBps', 'ReadIops', 'WriteIops'] as const)
                            limits[`queue${suffix}`] = 'deduplicated';
                        continue;
                    }
                    const matching = lines.filter((line) => line.split(' ')[0] === key);
                    if (!matching.length) {
                        ioStatus ??= 'no-device-entry';
                        for (const suffix of ['ReadBps', 'WriteBps', 'ReadIops', 'WriteIops'] as const)
                            limits[`${prefix}${suffix}`] = 'no-device-entry';
                        continue;
                    }
                    if (matching.length !== 1) {
                        ioStatus = 'unavailable';
                        continue;
                    }
                    for (const [source, target] of [
                        ['rbps', 'ReadBps'],
                        ['wbps', 'WriteBps'],
                        ['riops', 'ReadIops'],
                        ['wiops', 'WriteIops'],
                    ] as const) {
                        const entries = matching[0]
                            ?.split(' ')
                            .slice(1)
                            .filter((entry) => entry.startsWith(`${source}=`));
                        const value = entries?.length === 1 ? number(entries[0]?.split('=')[1]) : undefined;
                        if (value !== undefined) metrics[`${prefix}${target}`] = value;
                        const text = entries?.length === 1 ? entries[0]?.split('=')[1] : undefined;
                        limits[`${prefix}${target}`] =
                            value !== undefined ? 'finite' : text === 'max' ? 'max' : 'unavailable';
                    }
                }
            }
            if (index === 0 && directory !== context.mount) {
                const ioStat = await w.read(`${directory}/io.stat`);
                const pressure = await w.read(`${directory}/io.pressure`);
                const matching = device
                    ? ioStat?.split('\n').filter((line) => line.startsWith(`${device.key} `))
                    : undefined;
                if (matching?.length === 1)
                    for (const [source, target] of [
                        ['rbytes', 'leafReadBytes'],
                        ['wbytes', 'leafWriteBytes'],
                        ['rios', 'leafReadIos'],
                        ['wios', 'leafWriteIos'],
                    ] as const) {
                        const value = number(new RegExp(`(?:^| )${source}=(\\d+)(?: |$)`).exec(matching[0] ?? '')?.[1]);
                        if (value !== undefined) metrics[target] = value;
                    }
                for (const name of ['some', 'full'] as const) {
                    const value = number(
                        new RegExp(`(?:^|\\n)${name} [^\\n]* total=(\\d+)(?:\\n|$)`).exec(pressure ?? '')?.[1],
                    );
                    if (value !== undefined) metrics[name === 'some' ? 'ioSomeUs' : 'ioFullUs'] = value;
                }
            }
            results.push({
                scope: index,
                depth: index,
                metrics,
                limits,
                status: w.reason ? 'partial' : 'complete',
                ...(context.capped && index === context.directories.length - 1
                    ? { reason: 'depth-capped' as const }
                    : directory === context.mount
                      ? { reason: 'root-not-applicable' as const }
                      : ioStatus
                        ? { reason: ioStatus }
                        : {}),
            });
        }
        if (!(await bracket()) || !(await rootAfter(w))) return [{ status: 'namespace-invalid' }];
        // Each scope owns its counters; never combine ancestors or device keys.
        for (const result of results) {
            const scopeGroup: Group = { ...groups.cgroup, prior: {} };
            const scope = result.scope ?? 0;
            for (const [key, value] of Object.entries(groups.cgroup.prior))
                if (key.startsWith(`${scope}:`)) scopeGroup.prior[key.slice(2) as keyof CaptureMetrics] = value;
            if (!monotonic(scopeGroup, result.metrics ?? {})) result.status = 'counter-invalid';
            for (const [key, value] of Object.entries(result.metrics ?? {}))
                Object.assign(groups.cgroup.prior, { [`${scope}:${key}`]: value });
        }
        return results;
    }
    function sample(phase: number, family: CaptureFamily, fixedDeadline?: number): void {
        const group = groups[family];
        const empty = (status: CaptureStatus) =>
            put(`family-${phase}-${family}-0`, { slot: 'family', family, phase, scope: 0, status });
        if (group.busy) {
            empty('busy');
            return;
        }
        if (!group.valid || (family !== 'process' && !group.context)) {
            empty('unavailable');
            return;
        }
        group.busy = true;
        const budget = createCaptureBudget(
            family === 'process' ? 8 : family === 'device' ? 12 : 36,
            family === 'process' ? 2 : family === 'device' ? 10 : 30,
        );
        group.budget = budget;
        const phaseBudget = phaseBudgets[phase];
        if (phaseBudget) phaseBudget[family] = budget;
        const began = now();
        const deadline = fixedDeadline ?? began + 250;
        let expired = false;
        let published = false;
        const allowed = () => admission() && !expired && now() < deadline;
        const w = work(budget, allowed);
        const publish = (results: FamilyResult[], status?: CaptureStatus) => {
            if (published || finished || outcome === 'succeeded') return;
            published = true;
            const ended = now();
            for (let index = 0; index < Math.min(family === 'cgroup' ? 4 : 1, results.length); index++) {
                const result = results[index];
                if (!result) continue;
                const actualStatus =
                    status ??
                    (ended >= deadline
                        ? 'timeout'
                        : closeStarted !== undefined && ended >= closeStarted
                          ? 'overlapped'
                          : (result.status ?? 'unavailable'));
                const clean = actualStatus === 'complete' || actualStatus === 'partial';
                const { metrics, limits, ...detail } = result;
                put(`family-${phase}-${family}-${index}`, {
                    ...detail,
                    ...(clean && metrics ? { metrics } : {}),
                    ...(clean && limits ? { limits } : {}),
                    ...(!detail.reason && w.reason ? { reason: w.reason } : {}),
                    slot: 'family',
                    family,
                    phase,
                    scope: index,
                    status: actualStatus,
                    startedMs: began,
                    endedMs: ended,
                    ...(closeStarted === undefined ? {} : { closeStartedMs: closeStarted }),
                    epoch: 0,
                });
                if (
                    actualStatus === 'identity-invalid' ||
                    actualStatus === 'namespace-invalid' ||
                    actualStatus === 'counter-invalid'
                )
                    group.valid = false;
            }
        };
        group.cutoff = () => publish([{}], budget.pending || budget.handles ? 'pending' : 'partial');
        const timer = setTimer(
            () => {
                expired = true;
                publish([{}], 'timeout');
            },
            Math.max(0, deadline - now()),
        );
        timers.push(timer);
        void (
            family === 'process'
                ? processFamily(w)
                : family === 'device'
                  ? deviceFamily(w, group.context as DeviceContext)
                  : cgroupFamily(w, group.context as CgroupContext)
        )
            .then((results) => publish(results.length ? results : [{}]))
            .catch(() => publish([{}], 'read-failed'))
            .finally(() => {
                clearTimer(timer);
                group.busy = false;
                delete group.cutoff;
            });
    }
    function point(phase: number, deadline?: number): void {
        if (!admission() || !selected) return;
        const planned = (waitingAt ?? selected.timestampMs) + (schedule[phase] ?? 0);
        if (phase !== 0 && now() - planned > 250) {
            slotStates[phase] = 'skipped-late';
            for (const family of families)
                put(`family-${phase}-${family}-0`, { slot: 'family', family, phase, scope: 0, status: 'skipped-late' });
            return;
        }
        slotStates[phase] = rootStart === undefined ? 'unavailable' : 'complete';
        for (const family of families) {
            if (phase === 0 && family !== 'process') continue;
            rootStart === undefined
                ? put(`family-${phase}-${family}-0`, { slot: 'family', family, phase, scope: 0, status: 'unavailable' })
                : sample(phase, family, deadline);
        }
    }
    function stop(): void {
        waiting = false;
        stopped = true;
        for (const timer of timers) clearTimer(timer);
        for (const family of families) groups[family].cutoff?.();
    }
    function finalRecords(): void {
        const finalSlots: CaptureStatus[] = slotStates.map((state, phase) => {
            if (state !== 'complete') return state;
            const records = [...cache.values()].filter((record) => record.slot === 'family' && record.phase === phase);
            if (
                families.every((family) => records.some((record) => record.family === family)) &&
                records.every((record) => record.status === 'complete')
            )
                return 'complete';
            if (records.some((record) => record.status === 'pending')) return 'pending';
            if (records.some((record) => record.status === 'timeout')) return 'timeout';
            return 'partial';
        });
        completedPoints = phaseBudgets.filter((budgets) =>
            families.every((family) => budgets[family] && captureCost(budgets[family]).settled),
        ).length;
        pendingPoints = phaseBudgets.filter((budgets, phase) =>
            families.some((family) => {
                const budget = budgets[family];
                const discoveryBudget = phase === 0 ? groups[family].discovery : undefined;
                return (
                    (budget && !captureCost(budget).settled) ||
                    (discoveryBudget && !captureCost(discoveryBudget).settled)
                );
            }),
        ).length;
        put('root-binding', { slot: 'root-binding', status: 'unavailable' });
        const discoveryCost: Partial<Record<CaptureFamily, ReturnType<typeof captureCost>>> = {};
        for (const family of families) {
            const budget = groups[family].discovery;
            if (budget) discoveryCost[family] = captureCost(budget);
            if (family !== 'process')
                put(`${family}-epoch`, {
                    slot: family === 'device' ? 'device-epoch' : 'cgroup-epoch',
                    status: budget && !captureCost(budget).settled ? 'pending' : 'unavailable',
                    epoch: 0,
                });
        }
        put('cost-discovery', {
            slot: 'cost',
            phase: 6,
            status: Object.values(discoveryCost).every((cost) => cost.settled) ? 'complete' : 'pending',
            cost: discoveryCost,
        });
        for (let phase = 0; phase < 6; phase++) {
            const cost: Partial<Record<CaptureFamily, ReturnType<typeof captureCost>>> = {};
            for (const family of families) {
                const budget = phaseBudgets[phase]?.[family];
                if (budget) cost[family] = captureCost(budget);
            }
            put(`cost-${phase}`, {
                slot: 'cost',
                phase,
                status: Object.values(cost).every((item) => item.settled) ? 'complete' : 'pending',
                cost,
            });
        }
        const finalCost: Partial<Record<CaptureFamily, ReturnType<typeof captureCost>>> = {};
        for (const family of families) {
            const budgets = [...phaseBudgets.map((phase) => phase[family]), groups[family].discovery].filter(
                (item): item is CaptureBudget => !!item,
            );
            const total = createCaptureBudget(346, 336);
            for (const budget of budgets)
                for (const key of [
                    'attempts',
                    'opens',
                    'readCalls',
                    'closes',
                    'bytes',
                    'metadata',
                    'completed',
                    'pending',
                    'handles',
                ] as const)
                    total[key] += budget[key];
            finalCost[family] = captureCost(total);
        }
        put('cost-final', {
            slot: 'cost',
            phase: 7,
            status: Object.values(finalCost).every((cost) => cost.settled) ? 'complete' : 'pending',
            cost: finalCost,
        });
        put('six-slot-status', { slot: 'six-slot-status', status: 'complete', slots: finalSlots });
        put('limitations', {
            slot: 'limitations',
            status: closeGate ? 'retained' : 'no-close-gate',
            metrics: { pending: Object.values(finalCost).reduce((sum, cost) => sum + cost.pending, 0) },
        });
    }
    function send(record: FirstStartCaptureRecord): void {
        const began = now();
        sinkCalls++;
        try {
            sink(record);
        } catch {
            sinkFailed++;
        }
        callbackMs += Math.max(0, now() - began);
    }
    function flush(): void {
        if (flushStarted || finished || !outcome || (outcome !== 'succeeded' && !closeGate)) return;
        flushStarted = true;
        finalRecords();
        const discarded =
            outcome === 'succeeded'
                ? [...cache.values()].filter((record) => record.slot === 'family' || record.slot.endsWith('epoch'))
                      .length
                : 0;
        if (outcome === 'succeeded')
            for (const [key, record] of cache)
                if (record.slot === 'family' || record.slot.endsWith('epoch')) {
                    cache.delete(key);
                    cacheBytes -= Buffer.byteLength(JSON.stringify(record)) + 1;
                }
        put('retention-decision', {
            slot: 'retention-decision',
            status: outcome === 'succeeded' ? 'discarded' : 'retained',
            metrics: {
                discarded,
                admitted: slotStates.filter((state) => state === 'complete').length,
                completed: completedPoints,
                pending: pendingPoints,
                skipped: slotStates.filter((state) => state !== 'complete').length,
            },
        });
        const records = [...cache.values()];
        const latestDevice = records
            .filter((record) => record.slot === 'family' && record.family === 'device' && record.status === 'complete')
            .sort((a, b) => (b.phase ?? 0) - (a.phase ?? 0))[0];
        const bindingOrder = ['selection', 'root-binding', 'device-epoch', 'cgroup-epoch', 'first-start-outcome'];
        const priority = (record: FirstStartCaptureRecord): number => {
            const binding = bindingOrder.indexOf(record.slot);
            if (binding >= 0) return binding;
            if (
                record.slot === 'family' &&
                record.family === 'device' &&
                record.phase === 0 &&
                record.status === 'complete'
            )
                return 5;
            if (record === latestDevice) return 6;
            if (record.slot === 'family') {
                const family =
                    record.family === 'process' ? 0 : record.family === 'device' ? 1 : 2 + (record.scope ?? 0);
                return 7 + (record.phase ?? 0) * 6 + family;
            }
            if (record.slot === 'cost')
                return 70 + (record.phase === 6 ? 0 : record.phase === 7 ? 7 : (record.phase ?? 0) + 1);
            return 50 + captureAuxiliarySlots.indexOf(record.slot);
        };
        records.sort((a, b) => priority(a) - priority(b));
        let offset = 0;
        function batch(): void {
            if (finished) return;
            let count = 0;
            while (offset < records.length && count++ < 8) {
                const record = records[offset++];
                if (record) send(record);
            }
            if (offset < records.length) {
                queueFlush(batch);
                return;
            }
            put('writer-state', {
                slot: 'writer-state',
                status: 'partial',
                reason: 'incomplete',
                metrics: { sinkCalls, sinkFailed, callbackMs, records: records.length, serializedBytes: cacheBytes },
            });
            put('observer-terminal', { slot: 'observer-terminal', status: 'complete' });
            queueFlush(() => {
                for (const key of ['writer-state', 'observer-terminal']) {
                    const record = cache.get(key);
                    if (record) send(record);
                }
                finished = true;
            });
        }
        queueFlush(batch);
    }
    function terminal(result: 'succeeded' | 'failed' | 'cancelled'): void {
        if (outcome) return;
        outcome = result;
        stop();
        put('first-start-outcome', {
            slot: 'first-start-outcome',
            status: result,
            ...(failureReason ? { outcomeReason: failureReason } : {}),
        });
        flush();
    }
    function observe(value: unknown): void {
        try {
            if (finished) return;
            const event = validateFixtureEvent(value);
            if (!event) return;
            if (!selected) {
                if (launchSeen || event.stage !== 'spawn' || event.event !== 'begin') return;
                launchSeen = true;
                if (
                    event.action !== 'start' ||
                    !event.entryId ||
                    !event.operationId ||
                    !event.requestId ||
                    !event.connectionId ||
                    !event.sessionId
                ) {
                    stopped = true;
                    return;
                }
                selected = event;
                put('selection', { slot: 'selection', status: 'armed' });
                return;
            }
            if (!matches(event)) return;
            if (
                event.stage === 'spawn' &&
                event.event === 'decision' &&
                event.reason === 'acquired' &&
                event.pid &&
                !stopped
            )
                selected = { ...selected, pid: event.pid };
            if (
                event.stage === 'readiness' &&
                event.event === 'begin' &&
                event.phase === 'waiting-cdp' &&
                waitingAt === undefined &&
                !stopped
            ) {
                if (!selected.pid || event.pid !== selected.pid) return;
                waitingAt = event.timestampMs;
                waiting = true;
                for (let phase = 1; phase < 6; phase++)
                    timers.push(
                        setTimer(() => point(phase), Math.max(0, (schedule[phase] ?? 0) + event.timestampMs - now())),
                    );
                return;
            }
            if (event.stage === 'operation' && event.event === 'end' && ['failed', 'cancelled'].includes(event.outcome))
                terminal(event.outcome === 'cancelled' ? 'cancelled' : 'failed');
            if (event.stage === 'readiness' && event.phase === 'rollback-request' && event.event === 'decision') {
                failureReason = event.readinessExitReason;
                terminal(event.outcome === 'cancelled' ? 'cancelled' : 'failed');
            } else if (event.stage === 'readiness' && event.phase === 'waiting-cdp' && event.event === 'end')
                terminal(
                    event.outcome === 'succeeded'
                        ? 'succeeded'
                        : event.outcome === 'cancelled'
                          ? 'cancelled'
                          : 'failed',
                );
            if ((event.stage === 'native-close' || event.stage === 'target-close') && event.event === 'begin')
                closeStarted ??= event.timestampMs;
            if (
                (event.stage === 'native-close' &&
                    event.event === 'end' &&
                    ['succeeded', 'failed', 'cancelled'].includes(event.outcome)) ||
                (event.stage === 'target-exit-wait' &&
                    event.event === 'end' &&
                    event.outcome === 'succeeded' &&
                    event.error === undefined) ||
                (event.exitObserved === true &&
                    (event.stage === 'readiness' || (event.stage === 'target-exit-wait' && event.event === 'end')))
            ) {
                closeGate = true;
                flush();
            }
            if (!admission() || baseline) return;
            if (event.stage === 'native-snapshot' && event.event === 'begin') {
                if (snapshot) {
                    snapshot.depth++;
                    snapshot.ambiguous = true;
                } else
                    snapshot = {
                        began: event.timestampMs,
                        depth: 1,
                        debt: 0,
                        ambiguous: event.outcome !== 'started' || event.error !== undefined,
                    };
            } else if (event.stage === 'native-file' && event.event === 'decision' && event.command === 'proc-stat') {
                if (
                    snapshot?.depth !== 1 ||
                    snapshot.debt ||
                    snapshot.candidate ||
                    snapshot.ambiguous ||
                    event.valid !== true ||
                    event.rootStartTicks === undefined ||
                    !['observed', 'succeeded'].includes(event.outcome) ||
                    event.timestampMs < snapshot.began ||
                    event.error
                ) {
                    if (snapshot) snapshot.ambiguous = true;
                    return;
                }
                snapshot.candidate = event;
            } else if (event.stage === 'native-snapshot' && event.event === 'end') {
                if (!snapshot) return;
                if (snapshot.depth) snapshot.depth--;
                else snapshot.ambiguous = true;
                if (event.outcome === 'succeeded' || event.valid !== undefined) snapshot.debt++;
                if (
                    snapshot.depth ||
                    snapshot.debt !== 1 ||
                    event.outcome !== 'succeeded' ||
                    event.valid !== true ||
                    event.error ||
                    event.timestampMs < (snapshot.candidate?.timestampMs ?? snapshot.began) ||
                    snapshot.ended !== undefined
                )
                    snapshot.ambiguous = true;
                snapshot.ended = event.timestampMs;
                if (!snapshot.depth && !snapshot.debt) snapshot = undefined;
            } else if (event.stage === 'native-snapshot' && event.event === 'decision') {
                const frame = snapshot;
                if (!frame) return;
                if (frame.debt) frame.debt--;
                else frame.ambiguous = true;
                if (!frame.depth && !frame.debt) snapshot = undefined;
                if (
                    frame.ambiguous ||
                    frame.depth ||
                    frame.debt ||
                    frame.ended === undefined ||
                    !frame.candidate ||
                    event.valid !== true ||
                    !['observed', 'succeeded'].includes(event.outcome) ||
                    event.error ||
                    event.timestampMs < frame.ended
                )
                    return;
                rootStart = frame.candidate.rootStartTicks;
                baseline = true;
                const deadline = now() + 250;
                discovery('device', deadline);
                discovery('cgroup', deadline);
                point(0, deadline);
            }
        } catch {
            /* Observers cannot replace a native lifecycle result. */
        }
    }
    function finish(): void {
        try {
            if (finished) return;
            if (!outcome) {
                stop();
                return;
            }
            // No synchronous write before normal close finishes, including beforeExit.
            flush();
        } catch {
            /* No lifecycle effect. */
        }
    }
    return { observe, finish };
}
