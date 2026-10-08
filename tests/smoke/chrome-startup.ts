import { spawnSync } from 'node:child_process';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

const reasons = [
    'x-display-unavailable',
    'sandbox-root-disallowed',
    'sandbox-unavailable',
    'sandbox-helper-invalid',
    'zygote-startup-failed',
    'singleton-startup-failed',
    'devtools-bind-failed',
] as const;
type StartupReason = (typeof reasons)[number];
export interface ChromeStartupLog {
    kind: 'browser-startup';
    phase: 'log';
    launch: number;
    reasons: readonly StartupReason[];
    info: number;
    warning: number;
    error: number;
    fatal: number;
    absent: boolean;
    readFailed: boolean;
    truncated: boolean;
    incomplete: boolean;
}
interface DisplayPreflight {
    kind: 'browser-startup';
    phase: 'display';
    available: boolean;
    responsive: boolean;
    timedOut: boolean;
}
interface StartupCleanup {
    kind: 'browser-startup';
    phase: 'cleanup';
    retained: boolean;
    cleanupFailed: boolean;
}
export type BrowserStartupRecord = ChromeStartupLog | DisplayPreflight | StartupCleanup;
const logKeys = [
    'kind',
    'phase',
    'launch',
    'reasons',
    'info',
    'warning',
    'error',
    'fatal',
    'absent',
    'readFailed',
    'truncated',
    'incomplete',
];

/** Rebuild a detached closed record without invoking accessors or accepting raw log text. */
export function validateBrowserStartupRecord(value: unknown): Readonly<BrowserStartupRecord> | undefined {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const phase = descriptors.phase?.value;
        const keys =
            phase === 'log'
                ? logKeys
                : phase === 'display'
                  ? ['kind', 'phase', 'available', 'responsive', 'timedOut']
                  : phase === 'cleanup'
                    ? ['kind', 'phase', 'retained', 'cleanupFailed']
                    : [];
        if (
            Reflect.ownKeys(value).length !== keys.length ||
            keys.some((key) => {
                const descriptor = descriptors[key];
                return !descriptor || !('value' in descriptor);
            })
        )
            return;
        if (descriptors.kind?.value !== 'browser-startup') return;
        const result: Record<string, unknown> = {};
        for (const key of keys) result[key] = descriptors[key]?.value;
        if (phase === 'log') {
            if (!Number.isInteger(result.launch) || Number(result.launch) < 1 || Number(result.launch) > 64) return;
            for (const key of ['info', 'warning', 'error', 'fatal'])
                if (!Number.isInteger(result[key]) || Number(result[key]) < 0 || Number(result[key]) > 4096) return;
            const list = result.reasons;
            if (!Array.isArray(list)) return;
            const items = Object.getOwnPropertyDescriptors(list);
            const length = Object.getOwnPropertyDescriptor(list, 'length')?.value;
            if (!Number.isInteger(length) || length < 0 || length > reasons.length) return;
            if (Reflect.ownKeys(list).length !== length + 1) return;
            const detached: StartupReason[] = [];
            for (let index = 0; index < length; index++) {
                const item = items[String(index)];
                if (
                    !item ||
                    !('value' in item) ||
                    !reasons.some((reason) => reason === item.value) ||
                    detached.includes(item.value)
                )
                    return;
                detached.push(item.value);
            }
            result.reasons = Object.freeze(detached);
        }
        const booleans =
            phase === 'log'
                ? ['absent', 'readFailed', 'truncated', 'incomplete']
                : phase === 'display'
                  ? ['available', 'responsive', 'timedOut']
                  : ['retained', 'cleanupFailed'];
        if (booleans.some((key) => typeof result[key] !== 'boolean')) return;
        if (phase === 'display' && result.responsive && (!result.available || result.timedOut)) return;
        if (phase === 'log')
            return Object.freeze({
                kind: 'browser-startup',
                phase: 'log',
                launch: Number(result.launch),
                reasons: Object.freeze(Array.from(result.reasons as StartupReason[])),
                info: Number(result.info),
                warning: Number(result.warning),
                error: Number(result.error),
                fatal: Number(result.fatal),
                absent: result.absent === true,
                readFailed: result.readFailed === true,
                truncated: result.truncated === true,
                incomplete: result.incomplete === true,
            });
        if (phase === 'display')
            return Object.freeze({
                kind: 'browser-startup',
                phase: 'display',
                available: result.available === true,
                responsive: result.responsive === true,
                timedOut: result.timedOut === true,
            });
        return Object.freeze({
            kind: 'browser-startup',
            phase: 'cleanup',
            retained: result.retained === true,
            cleanupFailed: result.cleanupFailed === true,
        });
    } catch {
        return;
    }
}

/** Message prefixes are evidenced by Chromium sources linked in the smoke documentation. */
export function projectChromeStartupText(text: string, launch: number): ChromeStartupLog {
    const projection: ChromeStartupLog = {
        kind: 'browser-startup',
        phase: 'log',
        launch,
        reasons: [],
        info: 0,
        warning: 0,
        error: 0,
        fatal: 0,
        absent: false,
        readFailed: false,
        truncated: false,
        incomplete: false,
    };
    const found = new Set<StartupReason>();
    // Only complete, bounded LOG lines are interpreted; ordinary stderr and stacks are ignored.
    const bounded = text.slice(0, 131072);
    const lines = bounded.split('\n').slice(0, -1);
    projection.incomplete =
        text.length > bounded.length || (bounded.length > 0 && !bounded.endsWith('\n')) || lines.length > 4096;
    for (const line of lines.slice(0, 4096)) {
        if (Buffer.byteLength(line) > 8192) {
            projection.incomplete = true;
            continue;
        }
        const parsed = /^\[\d+:\d+:[\d/.:]+:(INFO|WARNING|ERROR|FATAL):([^\]\r\n]+?)(?:\(\d+\)|:\d+)\] (.*)$/.exec(
            line,
        );
        if (!parsed) continue;
        const [, severity, filename, message = ''] = parsed;
        const source = filename?.split(/[\\/]/).at(-1);
        const count = severity?.toLowerCase();
        if (count === 'info' || count === 'warning' || count === 'error' || count === 'fatal') projection[count]++;
        if (severity !== 'ERROR' && severity !== 'FATAL') continue;
        if (source === 'ozone_platform_x11.cc' && message.startsWith('Missing X server or $DISPLAY'))
            found.add('x-display-unavailable');
        if (source === 'zygote_host_impl_linux.cc') {
            if (message.startsWith('Running as root without --no-sandbox is not supported.'))
                found.add('sandbox-root-disallowed');
            if (message.startsWith('No usable sandbox!')) found.add('sandbox-unavailable');
            if (
                /^(?:Zygote process exited prematurely|Check failed: process\.IsValid\(\)\. Failed to launch zygote process|Failed to receive (?:boot|hello) message from zygote)/.test(
                    message,
                )
            )
                found.add('zygote-startup-failed');
        }
        if (
            source === 'setuid_sandbox_host.cc' &&
            /^The SUID sandbox helper binary (?:is missing:|was found, but is not configured correctly\.)/.test(message)
        )
            found.add('sandbox-helper-invalid');
        if (
            source === 'process_singleton_posix.cc' &&
            /^(?:Failed to create (?:socket directory\.|symlinks\.)|Socket path too long:)/.test(message)
        )
            found.add('singleton-startup-failed');
        if (source === 'devtools_http_handler.cc' && message.startsWith('Cannot start http server for devtools.'))
            found.add('devtools-bind-failed');
    }
    projection.reasons = [...found];
    return projection;
}

/** Read bounded first/last ranges from the same regular file handle; never expose raw content. */
export async function readChromeStartupLog(
    file: string,
    launch: number,
    io: { inspect?: (file: string) => Promise<Stats> } = {},
): Promise<ChromeStartupLog> {
    const empty = projectChromeStartupText('', launch);
    let result = empty;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let observed = false;
    try {
        const before = await (io.inspect ?? lstat)(file);
        observed = true;
        if (
            !before.isFile() ||
            before.isSymbolicLink() ||
            before.nlink !== 1 ||
            path.relative(file, await realpath(file)) !== ''
        )
            throw new Error('Unsafe private file.');
        handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        const opened = await handle.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino)
            throw new Error('Private file changed.');
        const ranges =
            opened.size <= 131072
                ? [{ start: 0, size: opened.size }]
                : [
                      { start: 0, size: 65536 },
                      { start: opened.size - 65536, size: 65536 },
                  ];
        let text = '';
        let incomplete = false;
        for (const range of ranges) {
            if (!range.size) continue;
            const buffer = Buffer.alloc(range.size);
            const { bytesRead } = await handle.read(buffer, 0, range.size, range.start);
            incomplete ||= bytesRead !== range.size;
            let part = buffer.subarray(0, bytesRead).toString('utf8');
            if (range.start > 0) {
                const newline = part.indexOf('\n');
                part = newline < 0 ? '' : part.slice(newline + 1);
            }
            if (range.start + bytesRead < opened.size) part = part.slice(0, part.lastIndexOf('\n') + 1);
            text += part;
        }
        const after = await handle.stat();
        const named = await (io.inspect ?? lstat)(file);
        const projected = projectChromeStartupText(text, launch);
        projected.truncated = opened.size > 131072;
        projected.incomplete ||=
            incomplete ||
            opened.size !== after.size ||
            opened.mtimeMs !== after.mtimeMs ||
            named.dev !== opened.dev ||
            named.ino !== opened.ino ||
            named.isSymbolicLink() ||
            named.nlink !== 1 ||
            after.nlink !== 1;
        result = projected;
        return projected;
    } catch (error) {
        const code =
            error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
        empty.absent = !observed && code === 'ENOENT';
        empty.readFailed = !empty.absent;
        empty.incomplete = observed;
        return empty;
    } finally {
        try {
            await handle?.close();
        } catch {
            result.readFailed = true;
        }
    }
}

/** A private fixture log, never a profile or upload artifact. Diagnostic failures are nonfatal. */
export async function createChromeStartupCapture(
    enabled: boolean,
    profileParent: string,
    publish: (record: Readonly<BrowserStartupRecord>, firstSample: boolean) => void,
    io: { remove?: (directory: string) => Promise<unknown> } = {},
) {
    if (!enabled) return;
    const safelyPublish = (record: BrowserStartupRecord, firstSample = false) => {
        try {
            const safe = validateBrowserStartupRecord(record);
            if (safe) publish(safe, firstSample);
        } catch {}
    };
    let directory: string;
    let identity: Awaited<ReturnType<typeof lstat>>;
    try {
        directory = await realpath(await mkdtemp(path.join(path.dirname(profileParent), 'dct-chrome-startup-')));
        identity = await lstat(directory);
    } catch {
        safelyPublish({ ...projectChromeStartupText('', 1), readFailed: true }, true);
        return;
    }
    const logs: { file: string; first: boolean }[] = [];
    async function sample(selected?: string) {
        for (const [index, log] of logs.entries()) {
            if (selected && log.file !== selected) continue;
            const record = await readChromeStartupLog(log.file, index + 1);
            safelyPublish(record, log.first);
            log.first = false;
        }
    }
    return {
        directory,
        newLog() {
            if (logs.length >= 64) return;
            const file = path.join(directory, `launch-${logs.length + 1}.log`);
            logs.push({ file, first: true });
            return file;
        },
        async settled<T>(action: () => Promise<T>, restarting = false, selected?: string): Promise<T> {
            if (restarting) await sample();
            try {
                return await action();
            } finally {
                await sample(selected);
            }
        },
        async close(conclusive: boolean) {
            await sample();
            let cleanupFailed = false;
            if (conclusive) {
                try {
                    const current = await lstat(directory);
                    if (
                        (await realpath(directory)) !== directory ||
                        !current.isDirectory() ||
                        current.isSymbolicLink() ||
                        current.dev !== identity.dev ||
                        current.ino !== identity.ino
                    )
                        throw new Error('Private scratch identity changed.');
                    await (io.remove ?? ((owned) => rm(owned, { recursive: true, force: true })))(directory);
                } catch {
                    cleanupFailed = true;
                }
            }
            safelyPublish(
                { kind: 'browser-startup', phase: 'cleanup', retained: !conclusive || cleanupFailed, cleanupFailed },
                true,
            );
        },
    };
}

interface DisplayResult {
    status: number | null;
    available: boolean;
    timedOut: boolean;
}
export async function checkChromeSmokeDisplay(
    enabled: boolean,
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
    run: (
        executable: string,
        args: string[],
        options: { env: NodeJS.ProcessEnv; timeout: number; stdio: 'ignore' },
    ) => Promise<DisplayResult> = async (executable, args, options) => {
        const result = spawnSync(executable, args, options);
        const code = result.error && Object.getOwnPropertyDescriptor(result.error, 'code')?.value;
        return { status: result.status, available: code !== 'ENOENT', timedOut: code === 'ETIMEDOUT' };
    },
): Promise<DisplayPreflight | undefined> {
    if (!enabled || platform !== 'linux') return;
    try {
        const result = await run('xdpyinfo', [], { env: { ...environment }, timeout: 5000, stdio: 'ignore' });
        return {
            kind: 'browser-startup',
            phase: 'display',
            available: result.available,
            responsive: result.available && !result.timedOut && result.status === 0,
            timedOut: result.timedOut,
        };
    } catch {
        return { kind: 'browser-startup', phase: 'display', available: false, responsive: false, timedOut: false };
    }
}
