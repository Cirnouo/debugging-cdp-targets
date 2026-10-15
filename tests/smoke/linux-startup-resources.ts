import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BoundedLinuxRead } from './linux-startup-wait.ts';

const kernels = [
    'filemap-fault',
    'buffered-read',
    'writeback',
    'dirty-throttling',
    'page-wait',
    'other',
    'unavailable',
] as const;
const numeric = [
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
    'readAheadKb',
    'rotational',
    'fileRefault',
    'pgscan',
    'pgsteal',
    'memoryHighEvents',
    'memoryMaxEvents',
    'nrThrottled',
    'throttledUs',
    'memoryHigh',
    'memoryMax',
    'cpuQuota',
    'cpuPeriod',
    'readBps',
    'writeBps',
    'readIops',
    'writeIops',
] as const;
const cpuCounterKeys = ['nrThrottled', 'throttledUs'] as const;
const memoryCounterKeys = ['fileRefault', 'pgscan', 'pgsteal', 'memoryHighEvents', 'memoryMaxEvents'] as const;
type Numeric = (typeof numeric)[number];
export type LinuxStartupResources = Readonly<
    {
        kernel: (typeof kernels)[number];
        storage: 'device' | 'partition' | 'unavailable';
        cgroup: 'visible-leaf-only' | 'unavailable';
        memoryHighLimit?: 'finite' | 'max' | 'unavailable';
        memoryMaxLimit?: 'finite' | 'max' | 'unavailable';
        cpuQuotaLimit?: 'finite' | 'max' | 'unavailable';
        memoryCounters?: 'available' | 'unavailable';
        cpuCounters?: 'available' | 'unavailable';
        ioMax?: 'unavailable' | 'device-unmapped' | 'no-visible-entry' | 'configured';
        ioLimitScope?: 'visible-leaf-queue-device';
        readBpsLimit?: 'finite' | 'max' | 'unavailable';
        writeBpsLimit?: 'finite' | 'max' | 'unavailable';
        readIopsLimit?: 'finite' | 'max' | 'unavailable';
        writeIopsLimit?: 'finite' | 'max' | 'unavailable';
    } & Partial<Record<Numeric, number>>
>;
export interface ResourceIo {
    statDevice?: (file: string) => Promise<bigint>;
    realpath?: (file: string) => Promise<string>;
    stack?: (pid: number, signal: AbortSignal) => Promise<BoundedLinuxRead>;
}
const stateKeys = [
    'memoryHighLimit',
    'memoryMaxLimit',
    'cpuQuotaLimit',
    'memoryCounters',
    'cpuCounters',
    'readBpsLimit',
    'writeBpsLimit',
    'readIopsLimit',
    'writeIopsLimit',
] as const;
const integer = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function number(text: string | undefined): number | undefined {
    if (text === undefined || !/^\d+$/.test(text)) return;
    const value = Number(text);
    return integer(value) ? value : undefined;
}
export function validateLinuxStartupResources(value: unknown): LinuxStartupResources | undefined {
    try {
        if (!value || typeof value !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(value)))
            return;
        const fields: Record<string, unknown> = {};
        for (const key of Reflect.ownKeys(value)) {
            if (
                typeof key !== 'string' ||
                !['kernel', 'storage', 'cgroup', 'ioMax', 'ioLimitScope', ...stateKeys, ...numeric].includes(key)
            )
                return;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor)) return;
            fields[key] = descriptor.value;
        }
        if (
            !kernels.some((item) => item === fields.kernel) ||
            !['device', 'partition', 'unavailable'].some((item) => item === fields.storage) ||
            !['visible-leaf-only', 'unavailable'].some((item) => item === fields.cgroup)
        )
            return;
        if (
            'ioMax' in fields &&
            !['unavailable', 'device-unmapped', 'no-visible-entry', 'configured'].some((item) => item === fields.ioMax)
        )
            return;
        if ('ioLimitScope' in fields && fields.ioLimitScope !== 'visible-leaf-queue-device') return;
        for (const key of stateKeys)
            if (
                key in fields &&
                !(key.endsWith('Counters') ? ['available', 'unavailable'] : ['finite', 'max', 'unavailable']).some(
                    (item) => item === fields[key],
                )
            )
                return;
        for (const key of numeric) if (key in fields && !integer(fields[key])) return;
        if (fields.rotational !== undefined && fields.rotational !== 0 && fields.rotational !== 1) return;
        if (fields.storage === 'unavailable' && numeric.slice(0, 14).some((key) => key in fields)) return;
        if (fields.storage !== 'unavailable' && numeric.slice(0, 14).some((key) => !(key in fields))) return;
        if (
            fields.cgroup === 'unavailable' &&
            ['ioMax', 'ioLimitScope', ...stateKeys, ...numeric.slice(14)].some((key) => key in fields)
        )
            return;
        for (const key of [
            'memoryHigh',
            'memoryMax',
            'cpuQuota',
            'readBps',
            'writeBps',
            'readIops',
            'writeIops',
        ] as const) {
            if (fields[`${key}Limit`] === 'finite' && !(key in fields)) return;
            if (key in fields && fields[`${key}Limit`] !== 'finite') return;
        }
        for (const [status, keys] of [
            ['cpuCounters', cpuCounterKeys],
            ['memoryCounters', memoryCounterKeys],
        ] as const) {
            const present = keys.filter((key) => key in fields).length;
            if (fields[status] === 'available' && present !== keys.length) return;
            if (fields[status] === 'unavailable' && present === keys.length) return;
            if (present > 0 && present < keys.length && fields[status] !== 'unavailable') return;
        }
        if (
            (fields.ioMax === 'no-visible-entry' || fields.ioMax === 'configured') &&
            (fields.storage === 'unavailable' || fields.ioLimitScope !== 'visible-leaf-queue-device')
        )
            return;
        if (fields.ioMax === 'device-unmapped' && fields.storage !== 'unavailable') return;
        const ioKeys = ['readBps', 'writeBps', 'readIops', 'writeIops'] as const;
        if (
            fields.ioMax === 'configured' &&
            ioKeys.some((key) => !['finite', 'max'].some((state) => state === fields[`${key}Limit`]))
        )
            return;
        if (fields.ioMax !== 'configured' && ioKeys.some((key) => key in fields || `${key}Limit` in fields)) return;
        return Object.freeze(fields) as LinuxStartupResources;
    } catch {
        return;
    }
}

/** Only exact Linux frame tokens count; suffixes, substrings and addresses cannot imply a wait path. */
export function classifyKernelStack(text: string | undefined): LinuxStartupResources['kernel'] {
    if (!text?.trim()) return 'unavailable';
    const frames = text
        .trim()
        .split('\n')
        .map((line) => /^\[<[0-9a-fA-F]+>\] ([a-zA-Z0-9_.$]+)\+0x[0-9a-fA-F]+\/0x[0-9a-fA-F]+$/.exec(line.trim())?.[1]);
    if (frames.some((frame) => frame === undefined)) return 'unavailable';
    for (const [symbols, kind] of [
        [['balance_dirty_pages', 'balance_dirty_pages_ratelimited_flags'], 'dirty-throttling'],
        [['filemap_fault'], 'filemap-fault'],
        [['filemap_read', 'filemap_get_pages'], 'buffered-read'],
        [['folio_wait_writeback', 'wait_on_page_writeback'], 'writeback'],
        [['folio_wait_bit_common', 'wait_on_page_bit_common'], 'page-wait'],
    ] as const)
        if (frames.some((frame) => symbols.some((symbol) => symbol === frame))) return kind;
    return 'other';
}

/** Fixed fixture helper only. Abort signals the helper, never Chrome; settlement waits for close. */
export function readPrivilegedKernelStack(pid: number, signal: AbortSignal): Promise<BoundedLinuxRead> {
    if (!integer(pid) || pid === 0 || signal.aborted) return Promise.resolve({ bytes: 0, limitation: 'read-failed' });
    return new Promise((resolve) => {
        const child = spawn('/usr/bin/sudo', ['-n', '/usr/bin/cat', `/proc/${pid}/stack`], {
            shell: false,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        let bytes = 0;
        let text = '';
        let limited = false;
        let helperMissing = false;
        const cancel = () => {
            limited = true;
            child.kill('SIGTERM');
        };
        signal.addEventListener('abort', cancel, { once: true });
        child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes >= 4096) cancel();
            else if (!limited) text += chunk.toString('utf8');
        });
        child.once('error', (error: unknown) => {
            limited = true;
            try {
                helperMissing =
                    !!error &&
                    typeof error === 'object' &&
                    Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ENOENT';
            } catch {
                /* No raw error inspection. */
            }
        });
        child.once('close', (code) => {
            signal.removeEventListener('abort', cancel);
            resolve(
                limited || code !== 0
                    ? {
                          bytes: Math.min(bytes, 4096),
                          limitation: signal.aborted
                              ? 'timeout'
                              : helperMissing
                                ? 'missing'
                                : bytes >= 4096
                                  ? 'overlong'
                                  : 'permission',
                      }
                    : { bytes, text },
            );
        });
        if (signal.aborted) cancel();
    });
}

function counters(text: string | undefined): Map<string, number> | undefined {
    if (text === undefined) return;
    const result = new Map<string, number>();
    for (const line of text.trim().split('\n')) {
        const match = /^([a-z_]+) (\d+)$/.exec(line);
        const value = number(match?.[2]);
        if (!match?.[1] || value === undefined || result.has(match[1])) return;
        result.set(match[1], value);
    }
    return result;
}
function cgroupDirectory(cgroup: string | undefined, mountinfo: string | undefined): string | undefined {
    const membership = /^0::(\/[^\n]*)\n?$/.exec(cgroup ?? '')?.[1];
    const safe = (value: string) =>
        value.startsWith('/') &&
        !value.includes('\\') &&
        !value.includes('\0') &&
        !/\s/.test(value) &&
        !value.split('/').some((part) => part === '..' || part === '.') &&
        !value.includes('//');
    if (!membership || !safe(membership)) return;
    const mounts = mountinfo
        ?.trim()
        .split('\n')
        .filter((line) => line.includes(' - cgroup2 '));
    if (mounts?.length !== 1) return;
    const fields = mounts[0]?.split(' ');
    const sections = mounts[0]?.split(' - ');
    const device = /^([0-9]+):([0-9]+)$/.exec(fields?.[2] ?? '');
    if (
        number(fields?.[0]) === undefined ||
        number(fields?.[1]) === undefined ||
        number(device?.[1]) === undefined ||
        number(device?.[2]) === undefined ||
        sections?.length !== 2 ||
        !/^cgroup2 [^ ]+ [^ ]+$/.test(sections[1] ?? '')
    )
        return;
    const root = fields?.[3];
    const mount = fields?.[4];
    if (
        !root ||
        mount !== '/sys/fs/cgroup' ||
        !safe(root) ||
        (root !== '/' && membership !== root && !membership.startsWith(`${root}/`))
    )
        return;
    return mount + (membership === root ? '' : root === '/' ? membership : membership.slice(root.length));
}

/** At most 14 shared file reads plus one capped helper and four metadata operations. */
export async function collectLinuxStartupResources(
    pid: number,
    signal: AbortSignal,
    read: (file: string) => Promise<string | undefined>,
    io: ResourceIo = {},
): Promise<LinuxStartupResources> {
    const result: { -readonly [Key in keyof LinuxStartupResources]: LinuxStartupResources[Key] } = {
        kernel: 'unavailable',
        storage: 'unavailable',
        cgroup: 'unavailable',
    };
    const deviceStat = io.statDevice ?? (async (file) => (await stat(file, { bigint: true })).dev);
    const resolve = io.realpath ?? realpath;
    if (signal.aborted || !integer(pid) || pid === 0) return result;
    const stack = await (io.stack ?? readPrivilegedKernelStack)(pid, signal);
    if (
        !signal.aborted &&
        !stack.limitation &&
        stack.bytes < 4096 &&
        typeof stack.text === 'string' &&
        Buffer.byteLength(stack.text) === stack.bytes
    )
        result.kernel = classifyKernelStack(stack.text);
    if (signal.aborted) return result;
    try {
        const dev = await deviceStat(`/proc/${pid}/exe`);
        const major = Number(((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n));
        const minor = Number((dev & 0xffn) | ((dev >> 12n) & 0xffffff00n));
        if (major > 0 && integer(major) && integer(minor) && !signal.aborted) {
            const link = `/sys/dev/block/${major}:${minor}`;
            const directory = await resolve(link);
            if (!/^\/sys\/devices\/[a-zA-Z0-9_/:.-]+$/.test(directory) || directory.split('/').includes('..'))
                throw Error();
            const partition = number((await read(`${directory}/partition`))?.trim());
            const queue = partition === undefined ? directory : path.posix.dirname(directory);
            const queueDev = /^([0-9]+):([0-9]+)\n?$/.exec((await read(`${queue}/dev`)) ?? '');
            const values = (await read(`${directory}/stat`))?.trim().split(/\s+/).map(number);
            const readAhead = number((await read(`${queue}/queue/read_ahead_kb`))?.trim());
            const rotational = number((await read(`${queue}/queue/rotational`))?.trim());
            if (
                values &&
                [11, 15, 17].includes(values.length) &&
                values.every((item) => item !== undefined) &&
                queueDev &&
                number(queueDev[1]) !== undefined &&
                number(queueDev[2]) !== undefined &&
                readAhead !== undefined &&
                (rotational === 0 || rotational === 1) &&
                (await deviceStat(`/proc/${pid}/exe`)) === dev &&
                (await resolve(link)) === directory &&
                !signal.aborted
            ) {
                result.storage = partition === undefined ? 'device' : 'partition';
                Object.assign(result, {
                    major,
                    minor,
                    queueMajor: Number(queueDev[1]),
                    queueMinor: Number(queueDev[2]),
                    readsCompleted: values[0],
                    sectorsRead: values[2],
                    readMs: values[3],
                    writesCompleted: values[4],
                    writeMs: values[7],
                    inFlight: values[8],
                    ioMs: values[9],
                    weightedIoMs: values[10],
                    readAheadKb: readAhead,
                    rotational,
                });
            }
        }
    } catch {
        /* Overlay/non-block/absent metadata remains unavailable. */
    }
    if (signal.aborted) return result;
    const directory = cgroupDirectory(await read(`/proc/${pid}/cgroup`), await read('/proc/self/mountinfo'));
    if (!directory || signal.aborted) return result;
    const memory = counters(await read(`${directory}/memory.stat`));
    const events = counters(await read(`${directory}/memory.events`));
    const cpu = counters(await read(`${directory}/cpu.stat`));
    const high = (await read(`${directory}/memory.high`))?.trim();
    const max = (await read(`${directory}/memory.max`))?.trim();
    const ioMax = await read(`${directory}/io.max`);
    const quota = (await read(`${directory}/cpu.max`))?.trim().split(' ');
    if (signal.aborted) return result;
    result.cgroup = 'visible-leaf-only';
    result.ioLimitScope = 'visible-leaf-queue-device';
    projectIoMax(result, ioMax);
    result.memoryHighLimit = high === 'max' ? 'max' : number(high) === undefined ? 'unavailable' : 'finite';
    result.memoryMaxLimit = max === 'max' ? 'max' : number(max) === undefined ? 'unavailable' : 'finite';
    result.cpuQuotaLimit =
        quota?.length !== 2 || number(quota[1]) === undefined
            ? 'unavailable'
            : quota[0] === 'max'
              ? 'max'
              : number(quota[0]) === undefined
                ? 'unavailable'
                : 'finite';
    for (const [key, value] of [
        ['fileRefault', memory?.get('workingset_refault_file')],
        ['pgscan', memory?.get('pgscan')],
        ['pgsteal', memory?.get('pgsteal')],
        ['memoryHighEvents', events?.get('high')],
        ['memoryMaxEvents', events?.get('max')],
        ['nrThrottled', cpu?.get('nr_throttled')],
        ['throttledUs', cpu?.get('throttled_usec')],
        ['memoryHigh', number(high)],
        ['memoryMax', number(max)],
        ['cpuQuota', result.cpuQuotaLimit === 'finite' ? number(quota?.[0]) : undefined],
        ['cpuPeriod', number(quota?.[1])],
    ] as const)
        if (value !== undefined) result[key] = value;
    result.memoryCounters = memoryCounterKeys.every((key) => result[key] !== undefined) ? 'available' : 'unavailable';
    result.cpuCounters = cpuCounterKeys.every((key) => result[key] !== undefined) ? 'available' : 'unavailable';
    return result;
}

function projectIoMax(
    result: { -readonly [Key in keyof LinuxStartupResources]: LinuxStartupResources[Key] },
    text: string | undefined,
): void {
    result.ioMax = 'unavailable';
    if (text === undefined) return;
    const entries = new Map<string, Map<string, string>>();
    for (const line of text.trim() ? text.trim().split('\n') : []) {
        const tokens = line.split(' ');
        const device = /^([0-9]+):([0-9]+)$/.exec(tokens[0] ?? '');
        if (!device || number(device[1]) === undefined || number(device[2]) === undefined || tokens.length !== 5)
            return;
        const identity = `${Number(device[1])}:${Number(device[2])}`;
        if (entries.has(identity)) return;
        const limits = new Map<string, string>();
        for (const token of tokens.slice(1)) {
            const match = /^(rbps|wbps|riops|wiops)=(max|[0-9]+)$/.exec(token);
            if (
                !match?.[1] ||
                !match[2] ||
                limits.has(match[1]) ||
                (match[2] !== 'max' && number(match[2]) === undefined)
            )
                return;
            limits.set(match[1], match[2]);
        }
        entries.set(identity, limits);
    }
    if (result.queueMajor === undefined || result.queueMinor === undefined) {
        result.ioMax = 'device-unmapped';
        return;
    }
    const selected = entries.get(`${result.queueMajor}:${result.queueMinor}`);
    if (!selected) {
        result.ioMax = 'no-visible-entry';
        return;
    }
    result.ioMax = 'configured';
    for (const [source, key] of [
        ['rbps', 'readBps'],
        ['wbps', 'writeBps'],
        ['riops', 'readIops'],
        ['wiops', 'writeIops'],
    ] as const) {
        const value = selected.get(source);
        result[`${key}Limit`] = value === 'max' ? 'max' : 'finite';
        const parsed = number(value);
        if (parsed !== undefined) result[key] = parsed;
    }
}
