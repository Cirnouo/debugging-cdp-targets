import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { errorCode } from '../shared/errors.ts';

export type AppCoordinationPaths = Readonly<{ directory: string; lockFile: string; activation: string }>;
export type AppSingletonAdmission = Readonly<{ ownsSingleton: boolean; paths: AppCoordinationPaths }>;
export type AdvisoryLock = (descriptor: number) => boolean;

export function appCoordinationPaths(nativeAccountHome: string, platform: NodeJS.Platform): AppCoordinationPaths {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    if (!paths.isAbsolute(nativeAccountHome)) throw new Error('Native account home must be absolute.');
    const directory = paths.join(nativeAccountHome, '.debugging-cdp-targets', 'singleton');
    const identity = createHash('sha256')
        .update(platform === 'win32' ? nativeAccountHome.toLowerCase() : nativeAccountHome)
        .digest('hex')
        .slice(0, 32);
    return Object.freeze({
        directory,
        lockFile: paths.join(directory, 'owner.lock'),
        activation:
            platform === 'win32'
                ? `\\\\.\\pipe\\debugging-cdp-targets-${identity}`
                : paths.join(directory, 'activate.sock'),
    });
}

function privateDirectory(directory: string) {
    try {
        mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
    }
    const entry = lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error('Singleton namespace must be a regular directory.');
    if (process.platform !== 'win32' && (entry.uid !== userInfo().uid || (entry.mode & 0o077) !== 0))
        throw new Error('Singleton namespace is not private to the native account.');
}

export function acquireAppSingleton(options: {
    tryLock: AdvisoryLock;
    nativeAccountHome?: string;
}): AppSingletonAdmission {
    // os.userInfo is native-account evidence and does not consult HOME/USERPROFILE or selected App data.
    const home = realpathSync(options.nativeAccountHome ?? userInfo().homedir);
    const paths = appCoordinationPaths(home, process.platform);
    privateDirectory(path.dirname(paths.directory));
    privateDirectory(paths.directory);
    const descriptor = openSync(
        paths.lockFile,
        constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
        0o600,
    );
    let retained = false;
    try {
        const opened = fstatSync(descriptor);
        const named = lstatSync(paths.lockFile);
        if (
            !opened.isFile() ||
            !named.isFile() ||
            named.isSymbolicLink() ||
            opened.dev !== named.dev ||
            opened.ino !== named.ino
        )
            throw new Error('Singleton lock identity is unsafe.');
        if (process.platform !== 'win32' && (opened.uid !== userInfo().uid || (opened.mode & 0o077) !== 0))
            throw new Error('Singleton lock is not private to the native account.');
        retained = options.tryLock(descriptor);
        // A numeric descriptor is deliberately retained until actual process exit. No release/takeover API exists.
        return Object.freeze({ ownsSingleton: retained, paths });
    } finally {
        if (!retained) closeSync(descriptor);
    }
}
