// Preloaded only in the short-lived npx acquisition process, never the Server.
import childProcess, { type SpawnOptions } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

export function hiddenOptions<T extends object>(options?: T) {
    return { ...options, windowsHide: true };
}

if (process.platform === 'win32') {
    const original = childProcess.spawn;
    const hiddenSpawn = (command: string, arguments_?: readonly string[] | SpawnOptions, options?: SpawnOptions) =>
        Array.isArray(arguments_)
            ? original(command, arguments_ as readonly string[], hiddenOptions(options))
            : original(command, hiddenOptions(arguments_ as SpawnOptions | undefined));
    // Preserve Node's overloads; the branches above mirror its argument forms.
    childProcess.spawn = hiddenSpawn as typeof original;
    syncBuiltinESMExports();
}
