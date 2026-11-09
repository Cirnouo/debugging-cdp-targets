import { lstat, realpath } from 'node:fs/promises';
import { retryOwnedDirectoryRemoval } from '../../src/adapters/owned-directory-removal.ts';
import { errorCode } from '../../src/shared/errors.ts';

/** Capture the canonical fixture directory before its producer starts using it. */
export async function captureOwnedDirectoryCleanup(directory: string) {
    const identity = await lstat(directory, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error('Expected an owned fixture directory.');
    return (remove: (directory: string) => Promise<void>, pause?: (milliseconds: number) => Promise<unknown>) =>
        retryOwnedDirectoryRemoval(
            async () => {
                const current = await lstat(directory, { bigint: true });
                if (
                    !current.isDirectory() ||
                    current.isSymbolicLink() ||
                    current.dev !== identity.dev ||
                    current.ino !== identity.ino ||
                    (await realpath(directory)) !== directory
                ) {
                    throw new Error('Owned fixture directory identity changed.');
                }
            },
            () => remove(directory),
            (error) => errorCode(error) === 'ENOTEMPTY',
            pause,
        );
}
