import { open, readlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { effectiveChromeProfileArgument } from '../domains/chrome-profile.ts';
import { errorCode } from '../shared/errors.ts';
import { beginFixtureStage, emitFixtureEvent, type FixtureFields } from './fixture-diagnostics.ts';
import { probeProcessExists } from './platform-process.ts';

const claims = new Set<string>();

export async function profileAvailable(
    directory: string,
    dependencies: {
        platform?: NodeJS.Platform;
        hostname?: () => string;
        readlink?: (file: string) => Promise<string>;
        probeProcessExists?: (pid: number) => boolean;
        openLock?: (file: string) => Promise<{ close(): Promise<void> }>;
    } = {},
): Promise<boolean> {
    const decision = (available: boolean, reason: NonNullable<FixtureFields['reason']>, pid?: number) => {
        emitFixtureEvent('profile-check', 'decision', {
            available,
            reason,
            ...(pid === undefined ? {} : { pid }),
        });
        return available;
    };
    if ((dependencies.platform ?? process.platform) === 'win32') {
        const finish = beginFixtureStage('profile-check');
        try {
            // Chrome holds lockfile with FILE_SHARE_READ: a write-capable open fails while owned.
            const handle = await (dependencies.openLock ?? ((file) => open(file, 'r+')))(
                path.join(directory, 'lockfile'),
            );
            await handle.close();
            finish('succeeded');
            return decision(true, 'lock-accessible');
        } catch (error) {
            finish('failed', {}, error);
            if (errorCode(error) === 'ENOENT') return decision(true, 'missing-lock');
            if (['EACCES', 'EPERM', 'EBUSY'].includes(errorCode(error) ?? '')) return decision(false, 'lock-refused');
            emitFixtureEvent('profile-check', 'decision', { reason: 'lock-access-failed', outcome: 'failed' }, error);
            throw error;
        }
    }
    let lock: string;
    const finishLock = beginFixtureStage('profile-check');
    try {
        lock = await (dependencies.readlink ?? readlink)(path.join(directory, 'SingletonLock'));
        finishLock('succeeded');
    } catch (error) {
        finishLock('failed', {}, error);
        if (errorCode(error) === 'ENOENT') return decision(true, 'missing-lock');
        emitFixtureEvent('profile-check', 'decision', { reason: 'lock-access-failed', outcome: 'failed' }, error);
        throw error;
    }
    const split = lock.lastIndexOf('-');
    if (split < 1) return decision(false, 'invalid-lock');
    const host = lock.slice(0, split);
    const pid = Number(lock.slice(split + 1));
    if (!Number.isSafeInteger(pid) || pid < 1) return decision(false, 'invalid-lock');
    if (host !== (dependencies.hostname ?? os.hostname)()) return decision(false, 'foreign-host', pid);
    const finishProbe = beginFixtureStage('profile-check', { pid });
    try {
        const exists = (dependencies.probeProcessExists ?? probeProcessExists)(pid);
        finishProbe('succeeded');
        return decision(!exists, exists ? 'live-lock-owner' : 'process-absent', pid);
    } catch (error) {
        finishProbe('failed', { reason: 'process-probe-failed' }, error);
        throw error;
    }
}

async function canonicalDirectory(directory: string): Promise<string> {
    try {
        return await realpath(directory);
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        const parent = path.dirname(directory);
        if (parent === directory) throw error;
        return path.join(await canonicalDirectory(parent), path.basename(directory));
    }
}

export async function reserveProfile(directory: string, available = profileAvailable): Promise<() => void> {
    const occupied = () =>
        new Error('Chrome profile is occupied or unverifiable; explicitly choose another --user-data-dir.');
    let canonical: string;
    try {
        canonical = await canonicalDirectory(directory);
    } catch {
        throw occupied();
    }
    const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (claims.has(identity)) {
        emitFixtureEvent('profile-check', 'decision', { reason: 'profile-claimed', available: false });
        throw occupied();
    }
    claims.add(identity);
    let released = false;
    const release = () => {
        if (!released) {
            released = true;
            claims.delete(identity);
        }
    };
    try {
        if (!(await available(canonical))) throw occupied();
    } catch (error) {
        emitFixtureEvent('profile-check', 'decision', { outcome: 'failed' }, error);
        release();
        throw occupied();
    }
    return release;
}

export function chromeProfileArgument(arguments_: string[]): string | undefined {
    return effectiveChromeProfileArgument(arguments_, process.platform);
}
