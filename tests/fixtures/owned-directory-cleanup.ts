import { lstat, realpath } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { errorCode } from '../../src/shared/errors.ts';

const backoffMilliseconds = [10, 25] as const;

/** Capture the canonical fixture directory before its producer starts using it. */
export async function captureOwnedDirectoryCleanup(directory: string) {
    const identity = await lstat(directory, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error('Expected an owned fixture directory.');

    return async (
        remove: (directory: string) => Promise<void>,
        pause: (milliseconds: number) => Promise<unknown> = wait,
    ): Promise<void> => {
        const removalErrors: unknown[] = [];
        try {
            for (let attempt = 0; ; attempt++) {
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

                try {
                    await remove(directory);
                    return;
                } catch (error) {
                    const delay = backoffMilliseconds[attempt];
                    if (delay === undefined || errorCode(error) !== 'ENOTEMPTY') throw error;
                    removalErrors.push(error);
                    await pause(delay);
                }
            }
        } catch (error) {
            if (!removalErrors.length) throw error;
            throw new AggregateError([...removalErrors, error], 'Owned fixture directory cleanup failed after retry.', {
                cause: error,
            });
        }
    };
}
