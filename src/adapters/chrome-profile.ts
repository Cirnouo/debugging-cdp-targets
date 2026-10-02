import { open, readlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { errorCode } from '../shared/errors.ts';
import { probeProcessExists } from './platform-process.ts';

const claims = new Set<string>();

export async function profileAvailable(directory: string): Promise<boolean> {
    if (process.platform === 'win32') {
        try {
            // Chrome holds lockfile with FILE_SHARE_READ: a write-capable open fails while owned.
            const handle = await open(path.join(directory, 'lockfile'), 'r+');
            await handle.close();
            return true;
        } catch (error) {
            if (errorCode(error) === 'ENOENT') return true;
            if (['EACCES', 'EPERM', 'EBUSY'].includes(errorCode(error) ?? '')) return false;
            throw error;
        }
    }
    let lock: string;
    try {
        lock = await readlink(path.join(directory, 'SingletonLock'));
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return true;
        throw error;
    }
    const split = lock.lastIndexOf('-');
    const host = lock.slice(0, split);
    const pid = Number(lock.slice(split + 1));
    if (host !== os.hostname() || !Number.isSafeInteger(pid) || pid < 1) return false;
    return !probeProcessExists(pid);
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
        new Error(
            `Chrome profile is occupied or unverifiable; explicitly choose another --user-data-dir: ${directory}`,
        );
    let canonical: string;
    try {
        canonical = await canonicalDirectory(directory);
    } catch {
        throw occupied();
    }
    const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (claims.has(identity)) throw occupied();
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
    } catch {
        release();
        throw occupied();
    }
    return release;
}

export function chromeProfileArgument(arguments_: string[]): string | undefined {
    let directory: string | undefined;
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument !== '--user-data-dir' && !argument?.startsWith('--user-data-dir=')) continue;
        if (directory !== undefined) throw new Error('Duplicate Chrome --user-data-dir profile arguments.');
        directory = argument === '--user-data-dir' ? arguments_[++index] : argument.slice('--user-data-dir='.length);
        if (!directory || directory.startsWith('--'))
            throw new Error('Chrome --user-data-dir requires a profile directory.');
    }
    return directory;
}
