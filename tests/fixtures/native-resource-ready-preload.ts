import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import type { NativeResourceReadyIo } from './native-resource-ready.ts';

interface FixtureProcessIo {
    spawn(
        executable: string,
        arguments_: readonly string[],
        options: { shell: false; windowsHide: true; detached: true; stdio: 'ignore' },
    ): Pick<childProcess.ChildProcess, 'unref'>;
}

const role = process.argv[2];
if (role !== 'root' && role !== 'middle' && role !== 'late') throw new Error('Unknown fixture role.');

// These owned boundary views cover precisely the fixture's filesystem/process calls.
const fixtureFiles: Pick<NativeResourceReadyIo, 'writeFile'> = fs.promises;
const fixtureProcesses: FixtureProcessIo = childProcess;
const originalWrite = fixtureFiles.writeFile;
let held = false;
fixtureFiles.writeFile = async (file, data, options) => {
    const name = path.basename(file);
    if (!held && (name === `${role}-ready` || name.startsWith(`.${role}-ready-`))) {
        held = true;
        const handle = await fs.promises.open(file, options?.flag ?? 'w', options?.mode);
        process.stdout.write(`${JSON.stringify({ event: 'opened-before-write', name })}\n`);
        await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));
        try {
            await handle.writeFile(data);
        } finally {
            await handle.close();
        }
    } else await originalWrite(file, data, options);
};
// Ready/release preconditions are controlled by the test; no detached descendant is launched.
fixtureProcesses.spawn = () => ({ unref() {} });
syncBuiltinESMExports();
