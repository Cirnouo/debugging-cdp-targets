import { setTimeout as wait } from 'node:timers/promises';

const backoffMilliseconds = [10, 25] as const;

/** Recheck the caller's ownership evidence before each bounded removal attempt. */
export async function retryOwnedDirectoryRemoval(
    verify: () => Promise<void>,
    remove: () => Promise<void>,
    retryable: (error: unknown) => boolean,
    pause: (milliseconds: number) => Promise<unknown> = wait,
): Promise<void> {
    const removalErrors: unknown[] = [];
    try {
        for (let attempt = 0; ; attempt++) {
            await verify();
            try {
                await remove();
                return;
            } catch (error) {
                const delay = backoffMilliseconds[attempt];
                if (delay === undefined || !retryable(error)) throw error;
                removalErrors.push(error);
                await pause(delay);
            }
        }
    } catch (error) {
        if (!removalErrors.length) throw error;
        throw new AggregateError([...removalErrors, error], 'Owned directory removal failed after retry.', {
            cause: error,
        });
    }
}
