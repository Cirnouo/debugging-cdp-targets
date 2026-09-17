import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SessionError, fail } from '../shared/errors.mjs';
import { createSessionRecord } from '../domains/managed-session/record.mjs';
import { closeServer } from '../shared/values.mjs';

export function getSkillRoot() {
    return path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
}

export function getLocalDataRoot(localAppData = process.env.LOCALAPPDATA) {
    if (typeof localAppData !== 'string' || !/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(localAppData) || /[\u0000-\u001f]/.test(localAppData)) {
        fail('LOCALAPPDATA_INVALID', 'LOCALAPPDATA must be a fully qualified Windows directory.');
    }
    return path.win32.join(localAppData, 'debugging-cdp-targets');
}

export function getDefaultStatePath({ localAppData = process.env.LOCALAPPDATA } = {}) {
    return path.win32.join(getLocalDataRoot(localAppData), 'state', 'session.json');
}

export function buildCliRuntimePaths({ localAppData = process.env.LOCALAPPDATA, baseDirectory = path.win32.join(getLocalDataRoot(localAppData), 'cache', 'chrome-devtools-cli') } = {}) {
    if (typeof baseDirectory !== 'string' || !path.isAbsolute(baseDirectory)) {
        fail('CLI_RUNTIME_INVALID', 'The CLI runtime directory must be absolute.');
    }
    const root = path.resolve(baseDirectory);
    return {
        root,
        workingDirectory: path.join(root, 'work'),
        cacheRoot: path.join(root, 'npm-cache'),
        userConfigPath: path.join(root, 'npmrc'),
        globalConfigPath: path.join(root, 'global-npmrc'),
    };
}

export function getDefaultLockEndpoint() {
    const identity = createHash('sha256')
        .update(`${os.userInfo().username}\0${getLocalDataRoot()}`)
        .digest('hex')
        .slice(0, 24);
    return `\\\\.\\pipe\\debugging-cdp-targets-${identity}`;
}

export function getChromeProfilePath() {
    const userProfile = process.env.USERPROFILE;
    if (!userProfile) fail('USERPROFILE_UNAVAILABLE', 'USERPROFILE is required to locate the dedicated Chrome profile.');
    return path.join(userProfile, '.cache', 'chrome-devtools-mcp', 'chrome-profile');
}

export async function readSessionRecord(statePath = getDefaultStatePath()) {
    try {
        const parsed = JSON.parse(await readFile(statePath, 'utf8'));
        return createSessionRecord(parsed);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        if (error instanceof SessionError) throw error;
        fail('STATE_READ_FAILED', 'The managed session state could not be read.', { cause: error.message });
    }
}

export async function writeSessionRecord(statePath, input) {
    const record = createSessionRecord(input);
    await mkdir(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    try {
        await rename(temporaryPath, statePath);
    } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
    }
    return record;
}

export async function removeSessionRecord(statePath) {
    await rm(statePath, { force: true });
    const directory = path.dirname(statePath);
    if (path.basename(directory).toLowerCase() !== 'state') return;
    try {
        await rmdir(directory);
    } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
}

export async function withSessionLock({
    lockEndpoint = getDefaultLockEndpoint(),
} = {}, operation) {
    if (typeof operation !== 'function') fail('SESSION_LOCK_INVALID', 'A locked operation is required.');
    if (typeof lockEndpoint !== 'string' || lockEndpoint.length === 0) fail('SESSION_LOCK_INVALID', 'A named-pipe lock endpoint is required.');
    const server = net.createServer();
    try {
        await new Promise((resolve, reject) => {
            const onError = (error) => {
                server.off('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                server.off('error', onError);
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(lockEndpoint);
        });
    } catch (error) {
        if (error?.code === 'EADDRINUSE') fail('SESSION_BUSY', 'Another session operation is active for this Windows user.');
        fail('SESSION_LOCK_UNVERIFIABLE', 'The per-user named-pipe lock could not be acquired.', { cause: error.message });
    }

    try {
        return await operation();
    } finally {
        await closeServer(server).catch(() => {});
    }
}

export async function assertFile(filePath, code, message) {
    try {
        const information = await stat(filePath);
        if (!information.isFile()) fail(code, message);
    } catch (error) {
        if (error instanceof SessionError) throw error;
        fail(code, message, { path: filePath });
    }
}

export async function assertDirectory(directoryPath, code, message) {
    try {
        const information = await stat(directoryPath);
        if (!information.isDirectory()) fail(code, message);
    } catch (error) {
        if (error instanceof SessionError) throw error;
        fail(code, message, { path: directoryPath });
    }
}
