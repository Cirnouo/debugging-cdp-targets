import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export type AppDataSelection =
    | { kind: 'installed'; userDataDirectory: string }
    | { kind: 'portable'; executablePath: string; platform: NodeJS.Platform };

export function selectAppDataDirectory(selection: AppDataSelection): string {
    if (selection.kind === 'installed') {
        if (!path.isAbsolute(selection.userDataDirectory)) throw new Error('App data directory must be absolute.');
        return selection.userDataDirectory;
    }
    const paths = selection.platform === 'win32' ? path.win32 : path.posix;
    if (!paths.isAbsolute(selection.executablePath)) throw new Error('App executable must be absolute.');
    if (selection.platform === 'darwin') {
        const macOS = paths.dirname(selection.executablePath);
        const contents = paths.dirname(macOS);
        const bundle = paths.dirname(contents);
        if (paths.basename(macOS) !== 'MacOS' || paths.basename(contents) !== 'Contents' || !bundle.endsWith('.app'))
            throw new Error('Portable macOS App requires its actual bundle executable.');
        return paths.join(paths.dirname(bundle), 'data');
    }
    return paths.join(paths.dirname(selection.executablePath), 'data');
}

export async function prepareAppDataDirectory(
    directory: string,
    admission: { ownsSingleton: boolean },
): Promise<string> {
    if (admission.ownsSingleton !== true) throw new Error('App data requires singleton ownership.');
    if (!path.isAbsolute(directory)) throw new Error('App data directory must be absolute.');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error('App data directory must be a regular directory.');
    return realpath(directory);
}
