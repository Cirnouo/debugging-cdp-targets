import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';

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

function retainExitWitness(pid: number) {
    const child = execFile(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL('./native-resource-witness.ps1', import.meta.url)),
            '-OwnedPid',
            String(pid),
        ],
        { windowsHide: true, shell: false },
    );
    let output = '';
    let resolveArmed = () => {};
    let rejectArmed: (error: unknown) => void = () => {};
    const armed = new Promise<void>((resolve, reject) => {
        resolveArmed = resolve;
        rejectArmed = reject;
    });
    const exited = new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.stdout?.on('data', (chunk: Buffer) => {
            output += chunk.toString();
            if (!output.includes('\n')) return;
            try {
                const receipt: unknown = JSON.parse(output.split(/\r?\n/)[0] ?? 'null');
                if (
                    !isRecord(receipt) ||
                    receipt.event !== 'armed' ||
                    receipt.pid !== pid ||
                    typeof receipt.executablePath !== 'string' ||
                    path.win32.resolve(receipt.executablePath).toLowerCase() !==
                        path.win32.resolve(process.execPath).toLowerCase() ||
                    typeof receipt.startedAtUtc !== 'string' ||
                    !Number.isFinite(Date.parse(receipt.startedAtUtc))
                )
                    throw new Error('Invalid owned fixture handle identity.');
                resolveArmed();
            } catch (error) {
                rejectArmed(error);
            }
        });
        child.once('close', (code) => {
            try {
                if (code !== 0) throw new Error('Passive fixture handle witness failed.');
                const receipt: unknown = JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? 'null');
                if (!isRecord(receipt) || receipt.event !== 'exited' || receipt.pid !== pid || receipt.exitCode !== 0)
                    throw new Error('Owned fixture did not supply ordinary actual exit.');
                resolve();
            } catch (error) {
                rejectArmed(error);
                reject(error);
            }
        });
    });
    void armed.catch(() => {});
    void exited.catch(() => {});
    return { armed, exited };
}

export async function retainNativeResourceFixture(directory: string) {
    await Promise.all(['root-ready', 'middle-ready'].map((name) => waitForResourceFile(directory, name)));
    const root = retainExitWitness(Number(await readFile(path.join(directory, 'root-ready'), 'utf8')));
    const middle = retainExitWitness(Number(await readFile(path.join(directory, 'middle-ready'), 'utf8')));
    await Promise.all([root.armed, middle.armed]);
    let late: ReturnType<typeof retainExitWitness> | undefined;
    async function armLate(signal?: AbortSignal) {
        if (late) return late.armed;
        const observing = new AbortController();
        try {
            await Promise.race([
                waitForResourceFile(
                    directory,
                    'late-ready',
                    signal ? AbortSignal.any([signal, observing.signal]) : observing.signal,
                ),
                middle.exited.then(() => access(path.join(directory, 'late-ready'))),
            ]);
        } finally {
            observing.abort();
        }
        late ??= retainExitWitness(Number(await readFile(path.join(directory, 'late-ready'), 'utf8')));
        await late.armed;
    }
    return {
        releaseRoot: () => writeFile(path.join(directory, 'root-release'), 'retained actual root/middle handles'),
        armLate,
        async finish(disposeMonitor = () => {}, additionalExit: Promise<unknown> = Promise.resolve()) {
            await writeFile(path.join(directory, 'root-release'), 'ordinary fixture cleanup');
            await writeFile(path.join(directory, 'launch-late'), 'ordinary fixture cleanup');
            await armLate();
            const lateWitness = late;
            if (!lateWitness) throw new Error('Late descendant observation was not acquired.');
            await finishNativeResourceFixture(directory, {
                waitForExit: async () => {
                    await Promise.all([root.exited, middle.exited, lateWitness.exited]);
                    await additionalExit;
                },
                disposeMonitor,
            });
        },
    };
}

export async function finishNativeResourceFixture(
    directory: string,
    observation: { waitForExit(): Promise<void>; disposeMonitor(): void },
) {
    await writeFile(path.join(directory, 'root-release'), 'ordinary fixture cleanup');
    await writeFile(path.join(directory, 'launch-late'), 'ordinary fixture cleanup');
    await writeFile(path.join(directory, 'finish'), 'ordinary fixture cleanup');
    await observation.waitForExit();
    observation.disposeMonitor();
    if (
        path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !['dct-native-resources-', 'dct-native-handoff-'].some((prefix) => path.basename(directory).startsWith(prefix))
    )
        throw new Error('Refusing cleanup outside owned native fixture directory.');
    await rm(directory, { recursive: true, force: true });
}
