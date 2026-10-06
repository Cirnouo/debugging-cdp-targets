import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import type { ScreenshotTimeoutRoute } from './screenshot-timeout-fixture.ts';

export const cancelledPassiveSample = Symbol('cancelled passive sample');

export function createScreenshotCaptureObserver(io: {
    sample(handle: number, signal: AbortSignal): Promise<unknown>;
    tabs(handle: number, signal: AbortSignal): Promise<void>;
    record(kind: string, value: unknown): Promise<void>;
}): ScreenshotTimeoutRoute['capture'] {
    return async (call, handle, observe) => {
        const abort = new AbortController();
        const startedAt = performance.now();
        let observer: Promise<void> | undefined;
        let samplingFailure: string | undefined;
        const cancelled = (error: unknown) =>
            abort.signal.aborted && isRecord(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
        const failure = async (error: unknown) => {
            samplingFailure = errorMessage(error);
            try {
                await observe(async () => {
                    throw error;
                });
            } catch {}
        };
        const record = async (kind: string, value: unknown) => {
            try {
                await io.record(kind, value);
            } catch (error) {
                await failure(error);
            }
        };
        const sample = async () => {
            for (
                let count = 0;
                count < 100 && performance.now() - startedAt < 95_000 && !abort.signal.aborted;
                count += 1
            ) {
                try {
                    await observe(async () => {
                        try {
                            return await io.sample(handle, abort.signal);
                        } catch (error) {
                            if (cancelled(error)) return cancelledPassiveSample;
                            samplingFailure = errorMessage(error);
                            throw error;
                        }
                    });
                    if (!abort.signal.aborted) await io.tabs(handle, abort.signal);
                } catch (error) {
                    if (cancelled(error)) return;
                    await failure(error);
                    await record('passive-native-error', { error: errorMessage(error), stopped: abort.signal.aborted });
                }
                if (!abort.signal.aborted)
                    await new Promise<void>((resolve) => {
                        const finish = () => {
                            clearTimeout(timer);
                            abort.signal.removeEventListener('abort', finish);
                            resolve();
                        };
                        const timer = setTimeout(finish, 500);
                        abort.signal.addEventListener('abort', finish, { once: true });
                    });
            }
        };
        try {
            return await call({
                dispatched() {
                    observer = sample();
                },
                settled() {
                    abort.abort();
                },
            });
        } finally {
            abort.abort();
            await observer;
            await record('passive-observer-stopped', { elapsedMs: performance.now() - startedAt, samplingFailure });
        }
    };
}
