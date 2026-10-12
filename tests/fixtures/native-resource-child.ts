import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [mode, directory] = process.argv.slice(2);
if (!directory) throw new Error('Missing fixture directory.');
const fixtureDirectory = directory;
async function waitFor(name: string) {
    const file = path.join(fixtureDirectory, name);
    const watcher = watch(fixtureDirectory);
    try {
        await new Promise<void>((resolve, reject) => {
            const check = () => {
                void access(file).then(resolve, () => {});
            };
            watcher.on('change', check);
            watcher.on('error', reject);
            check();
        });
    } finally {
        watcher.close();
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
if (mode === 'root') {
    launch('middle');
    await waitFor('middle-ready');
} else if (mode === 'middle') {
    await writeFile(path.join(directory, 'middle-ready'), String(process.pid));
    await waitFor('launch-late');
    launch('late');
    await waitFor('late-ready');
} else if (mode === 'late') {
    await writeFile(path.join(directory, 'late-ready'), String(process.pid));
    await waitFor('finish');
    await writeFile(path.join(directory, 'late-finished'), 'ordinary fixture exit');
} else throw new Error('Unknown fixture mode.');
