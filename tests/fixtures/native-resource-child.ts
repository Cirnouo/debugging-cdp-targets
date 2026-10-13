import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishNativeResourcePid } from './native-resource-ready.ts';

const [mode, directory] = process.argv.slice(2);
if (!directory) throw new Error('Missing fixture directory.');
const fixtureDirectory = directory;
const lifetime = AbortSignal.timeout(30_000);
async function waitFor(name: string) {
    lifetime.throwIfAborted();
    const file = path.join(fixtureDirectory, name);
    const watcher = watch(fixtureDirectory);
    const abort = () => watcher.close();
    lifetime.addEventListener('abort', abort, { once: true });
    try {
        await new Promise<void>((resolve, reject) => {
            const check = () => {
                void access(file).then(resolve, () => {});
            };
            watcher.on('change', check);
            watcher.on('error', reject);
            watcher.on('close', () => reject(lifetime.reason ?? new Error('Fixture watcher closed.')));
            check();
        });
    } finally {
        watcher.close();
        lifetime.removeEventListener('abort', abort);
    }
}
function launch(childMode: string) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), childMode, fixtureDirectory], {
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
}
try {
    if (mode === 'root') {
        await publishNativeResourcePid(directory, 'root', process.pid);
        launch('middle');
        await waitFor('middle-ready');
        await waitFor('root-release');
    } else if (mode === 'middle') {
        await publishNativeResourcePid(directory, 'middle', process.pid);
        await waitFor('launch-late');
        launch('late');
        await waitFor('late-ready');
    } else if (mode === 'late') {
        await publishNativeResourcePid(directory, 'late', process.pid);
        await waitFor('finish');
        await writeFile(path.join(directory, 'late-finished'), 'ordinary fixture exit');
    } else throw new Error('Unknown fixture mode.');
} catch (error) {
    if (!lifetime.aborted) throw error;
}
