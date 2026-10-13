import { watch } from 'node:fs';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NativeResourceLog, WitnessContext, WitnessRole } from './native-resource-log.ts';
import { pidInputFailure, retainWitnessFromPidText } from './native-resource-witness.ts';

export async function waitForResourceFile(directory: string, name: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const watcher = watch(directory);
    const abort = () => watcher.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
        await new Promise<void>((resolve, reject) => {
            const check = () => {
                void access(path.join(directory, name)).then(resolve, () => {});
            };
            watcher.on('change', check);
            watcher.on('error', reject);
            watcher.on('close', () => reject(signal?.reason ?? new Error('Fixture observation closed.')));
            check();
        });
    } finally {
        signal?.removeEventListener('abort', abort);
        watcher.close();
    }
}

export async function retainNativeResourceFixture(directory: string, log: NativeResourceLog) {
    async function retain(role: WitnessRole, context: WitnessContext) {
        let text: string;
        try {
            text = await readFile(path.join(directory, `${role}-ready`), 'utf8');
        } catch (error) {
            throw pidInputFailure(
                role,
                context,
                typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
                    ? 'missing'
                    : 'read-failed',
                log,
            );
        }
        return retainWitnessFromPidText(text, role, context, log);
    }
    const [root, middle] = await log.step('initial-arming', undefined, async () => {
        await Promise.all(['root-ready', 'middle-ready'].map((name) => waitForResourceFile(directory, name)));
        const root = await retain('root', 'initial-arming');
        const middle = await retain('middle', 'initial-arming');
        await Promise.all([root.armed, middle.armed]);
        return [root, middle] as const;
    });
    let late: Awaited<ReturnType<typeof retainWitnessFromPidText>> | undefined;
    async function armLate(signal?: AbortSignal) {
        if (late) return late.armed;
        const observing = new AbortController();
        try {
            await log.step('late-ready-wait', 'late', () =>
                Promise.race([
                    waitForResourceFile(
                        directory,
                        'late-ready',
                        signal ? AbortSignal.any([signal, observing.signal]) : observing.signal,
                    ),
                    middle.exited.then(() => access(path.join(directory, 'late-ready'))),
                ]),
            );
        } finally {
            observing.abort();
        }
        await log.step('late-arming', 'late', async () => {
            late ??= await retain('late', 'late-arming');
            await late.armed;
        });
    }
    return {
        releaseRoot: () =>
            log.step('root-release', 'root', () =>
                writeFile(path.join(directory, 'root-release'), 'retained actual root/middle handles'),
            ),
        armLate,
        async finish(disposeMonitor = () => {}, additionalExit: Promise<unknown> = Promise.resolve()) {
            await log.step('root-release', 'root', () =>
                writeFile(path.join(directory, 'root-release'), 'ordinary fixture cleanup'),
            );
            await log.step('late-release', 'late', () =>
                writeFile(path.join(directory, 'launch-late'), 'ordinary fixture cleanup'),
            );
            await armLate();
            const lateWitness = late;
            if (!lateWitness) throw new Error('Late descendant observation was not acquired.');
            await finishNativeResourceFixture(
                directory,
                {
                    waitForExit: async () => {
                        await log.step('exit-join', undefined, () =>
                            Promise.all([root.exited, middle.exited, lateWitness.exited]),
                        );
                        await log.step('additional-exit', undefined, () => additionalExit);
                    },
                    disposeMonitor,
                },
                log,
            );
        },
    };
}

export async function finishNativeResourceFixture(
    directory: string,
    observation: { waitForExit(): Promise<void>; disposeMonitor(): void },
    log?: NativeResourceLog,
) {
    const releaseRoot = () => writeFile(path.join(directory, 'root-release'), 'ordinary fixture cleanup');
    const releaseLate = () => writeFile(path.join(directory, 'launch-late'), 'ordinary fixture cleanup');
    if (log) {
        await log.step('root-release', 'root', releaseRoot);
        await log.step('late-release', 'late', releaseLate);
    } else {
        await releaseRoot();
        await releaseLate();
    }
    const release = () => writeFile(path.join(directory, 'finish'), 'ordinary fixture cleanup');
    if (log) await log.step('finish-release', undefined, release);
    else await release();
    await observation.waitForExit();
    observation.disposeMonitor();
    if (
        path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !['dct-native-resources-', 'dct-native-handoff-'].some((prefix) => path.basename(directory).startsWith(prefix))
    )
        throw new Error('Refusing cleanup outside owned native fixture directory.');
    const remove = () => rm(directory, { recursive: true, force: true });
    if (log) await log.step('directory-remove', undefined, remove);
    else await remove();
}

export async function withNativeResourceCleanup<T>(
    log: NativeResourceLog,
    body: () => T | Promise<T>,
    cleanup: () => unknown,
) {
    let primary: unknown;
    let bodyFailed = false;
    let result: T | undefined;
    try {
        result = await log.step('body', undefined, body);
    } catch (error) {
        primary = error;
        bodyFailed = true;
    }
    try {
        await log.step('cleanup', undefined, cleanup);
    } catch (error) {
        if (bodyFailed)
            throw new AggregateError([primary, error], 'Native fixture body and cleanup failed.', { cause: primary });
        throw error;
    }
    if (bodyFailed) throw primary;
    return result;
}
