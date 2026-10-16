import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WitnessChild } from './native-resource-witness.ts';

export type NativeAssemblyChild = Pick<WitnessChild, 'once'>;
export interface NativeAssemblyScope {
    readonly nativeAssembly: string;
    assertActive(): void;
    trackChild(child: NativeAssemblyChild): void;
}
export type NativeAssemblyCompile = (
    args: string[],
    options: { windowsHide: true; shell: false; timeout: 60_000; maxBuffer: 262144 },
    callback: (error: Error | null, stdout: string) => void,
) => NativeAssemblyChild;

export function createNativeResourceAssembly(
    options: {
        platform?: NodeJS.Platform;
        compile?: NativeAssemblyCompile;
        remove?: (directory: string) => Promise<void>;
    } = {},
) {
    const compile: NativeAssemblyCompile =
        options.compile ?? ((args, settings, callback) => execFile('powershell.exe', args, settings, callback));
    let prepared: Promise<string> | undefined;
    let directory: string | undefined;
    let retainedDirectory: string | undefined;
    let closing = false;
    let cases = 0;
    const idle: (() => void)[] = [];
    let disposing: Promise<void> | undefined;
    const closes: Promise<void>[] = [];
    function trackChild(child: NativeAssemblyChild) {
        closes.push(
            new Promise<void>((resolve) => {
                child.once('close', () => resolve());
            }),
        );
    }
    function prepare() {
        if (prepared) return prepared;
        if (closing) return Promise.reject(new Error('Native assembly owner is closing.'));
        prepared = (async () => {
            if ((options.platform ?? process.platform) !== 'win32')
                throw new Error('Native preparation requires Windows.');
            directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-assembly-中文 [owned] '));
            const nativeAssembly = path.join(directory, 'native process.dll');
            try {
                const stdout = await new Promise<string>((resolve, reject) => {
                    const child = compile(
                        [
                            '-NoProfile',
                            '-NonInteractive',
                            '-ExecutionPolicy',
                            'Bypass',
                            '-File',
                            fileURLToPath(new URL('./native-resource-compile.ps1', import.meta.url)),
                            '-NativeAssembly',
                            nativeAssembly,
                        ],
                        { windowsHide: true, shell: false, timeout: 60_000, maxBuffer: 262144 },
                        (error, output) => {
                            if (error) reject(error);
                            else resolve(output);
                        },
                    );
                    trackChild(child);
                });
                await Promise.all(closes);
                const info = await stat(nativeAssembly);
                const bytes = await readFile(nativeAssembly);
                if (
                    stdout.trim() !== 'dct-native-assembly-ready' ||
                    !info.isFile() ||
                    bytes.length < 64 ||
                    bytes.subarray(0, 2).toString() !== 'MZ'
                )
                    throw new Error('Native assembly output was not validated.');
                return nativeAssembly;
            } catch (cause) {
                // PowerShell close alone cannot disprove pending compiler descendants/output writers.
                retainedDirectory = directory;
                throw new Error(`Native assembly preparation failed; retained ${directory}`, { cause });
            }
        })();
        return prepared;
    }
    return {
        prepare,
        get retainedDirectory() {
            return retainedDirectory;
        },
        async run<T>(action: (scope: NativeAssemblyScope) => T | Promise<T>): Promise<T> {
            if (closing) throw new Error('Native assembly owner is closing.');
            cases++;
            let active = true;
            try {
                const nativeAssembly = await prepare();
                return await action({
                    nativeAssembly,
                    assertActive() {
                        if (!active) throw new Error('Native assembly case has settled.');
                    },
                    trackChild(child) {
                        if (!active) throw new Error('Native assembly case has settled.');
                        trackChild(child);
                    },
                });
            } finally {
                active = false;
                cases--;
                if (cases === 0) for (const notify of idle.splice(0)) notify();
            }
        },
        dispose() {
            if (disposing) return disposing;
            closing = true;
            disposing = (async () => {
                if (cases > 0)
                    await new Promise<void>((resolve) => {
                        idle.push(resolve);
                    });
                if (prepared) await prepared.catch(() => {});
                if (retainedDirectory || !directory) return;
                // Cases can register late cleanup users until their entire continuation settles.
                // Only now is the physical-close set final; rejected evidence is not a close.
                await Promise.all(closes);
                if (
                    path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
                    !path.basename(directory).startsWith('dct-native-assembly-')
                )
                    throw new Error('Refusing cleanup outside owned native assembly directory.');
                await (options.remove ?? ((owned) => rm(owned, { recursive: true, force: true })))(directory);
            })();
            return disposing;
        },
    };
}
