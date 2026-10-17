import {
    createLinuxFirstStartCapture,
    type FirstStartCaptureDependencies,
} from '../smoke/linux-first-start-capture.ts';
import type { CaptureIo } from '../smoke/linux-first-start-capture-io.ts';
import type { FirstStartCaptureRecord } from '../smoke/linux-first-start-capture-record.ts';

export const firstStartRoute = {
    entryId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    operationId: '44444444-4444-4444-8444-444444444444',
    requestId: '55555555-5555-4555-8555-555555555555',
    pid: 123,
};
export const captureTick = () => new Promise<void>((resolve) => setImmediate(resolve));
export function fakeCaptureStat(start = 900) {
    const fields = Array.from({ length: 40 }, () => '0');
    fields[0] = 'D';
    fields[19] = String(start);
    return `123 (private name) ${fields.join(' ')}\n`;
}
export function fakeFirstStartIo(textOverride?: (file: string, text: string) => string): Required<CaptureIo> {
    return {
        async stat() {
            return { dev: 2048n, ino: 1n };
        },
        async realpath(file) {
            return file.startsWith('/sys/dev/block') ? '/sys/devices/disk' : file;
        },
        async open(file) {
            if (file.endsWith('/partition')) throw Object.assign(Error(), { code: 'ENOENT' });
            const text =
                file === '/proc/123/stat'
                    ? fakeCaptureStat()
                    : file.endsWith('/dev')
                      ? '8:0\n'
                      : file.endsWith('/stat')
                        ? '10 0 80 2 0 0 0 0 0 2 2\n'
                        : file.endsWith('/cgroup')
                          ? '0::/leaf\n'
                          : file.endsWith('/mountinfo')
                            ? '1 0 0:1 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n'
                            : file.endsWith('/io')
                              ? 'read_bytes: 20\nwrite_bytes: 0\n'
                              : file.includes('/pressure/') || file.endsWith('io.pressure')
                                ? 'some avg10=0.00 avg60=0.00 avg300=0.00 total=1\n'
                                : file.endsWith('scheduler')
                                  ? '[none] mq-deadline\n'
                                  : file.endsWith('rotational')
                                    ? '0\n'
                                    : file.endsWith('cpu.max')
                                      ? 'max 100000\n'
                                      : file.endsWith('cpu.stat')
                                        ? 'nr_throttled 0\nthrottled_usec 0\n'
                                        : file.includes('memory.events')
                                          ? 'high 0\nmax 0\n'
                                          : file.endsWith('io.max') || file.endsWith('io.stat')
                                            ? ''
                                            : file.endsWith('/wchan')
                                              ? 'futex_wait_queue_me\n'
                                              : '128\n';
            const data = Buffer.from(textOverride?.(file, text) ?? text);
            return {
                async read(buffer, offset, length, position) {
                    const chunk = data.subarray(position, position + length);
                    chunk.copy(buffer, offset);
                    return { bytesRead: chunk.length };
                },
                async close() {},
            };
        },
    };
}
export function createFirstStartHarness(
    override: CaptureIo = {},
    onRecord?: (record: FirstStartCaptureRecord) => void,
    diagnostic: Pick<FirstStartCaptureDependencies, 'revokeCreationIdentity' | 'creationIdentityStats'> = {},
) {
    let now = 0;
    let sequence = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const records: FirstStartCaptureRecord[] = [];
    const paths: string[] = [];
    const io = { ...fakeFirstStartIo(), ...override };
    const observer = createLinuxFirstStartCapture(
        (record) => {
            records.push(record);
            onRecord?.(record);
        },
        {
            ...diagnostic,
            enabled: true,
            platform: 'linux',
            now: () => now,
            setTimer(callback, delay) {
                const id = ++sequence;
                timers.set(id, { at: now + delay, callback });
                return id;
            },
            clearTimer(id) {
                if (typeof id === 'number') timers.delete(id);
            },
            io: {
                ...io,
                async open(file, flags) {
                    paths.push(file);
                    return io.open(file, flags);
                },
            },
        },
    );
    function event(stage: string, event: string, fields: Record<string, unknown> = {}) {
        const message: Record<string, unknown> = {
            ...firstStartRoute,
            action: 'start',
            stage,
            event,
            timestampMs: now,
            durationMs: 0,
            outcome: event === 'begin' ? 'started' : event === 'end' ? 'succeeded' : 'observed',
            ...fields,
        };
        for (const key of Object.keys(message)) if (message[key] === undefined) delete message[key];
        observer.observe(message);
    }
    function snapshot(fields: Record<string, unknown> = {}) {
        event('native-snapshot', 'begin', fields);
        event('native-file', 'decision', { command: 'proc-stat', valid: true, rootStartTicks: 900, ...fields });
        event('native-snapshot', 'end', { valid: true, ...fields });
        event('native-snapshot', 'decision', { valid: true, ...fields });
    }
    return {
        ...observer,
        records,
        paths,
        event,
        snapshot,
        begin() {
            event('spawn', 'begin');
            event('spawn', 'decision', { reason: 'acquired' });
            event('readiness', 'begin', { phase: 'waiting-cdp' });
        },
        bind() {
            this.begin();
            snapshot();
        },
        advance(time: number) {
            now = time;
            for (const [id, timer] of [...timers])
                if (timer.at <= now) {
                    timers.delete(id);
                    timer.callback();
                }
        },
    };
}
export async function drainFirstStart(h: ReturnType<typeof createFirstStartHarness>, start = 21000) {
    for (let index = 0; index < 12; index++) {
        h.advance(start + index);
        await captureTick();
    }
}
