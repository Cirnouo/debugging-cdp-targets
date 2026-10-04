import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createTargetHost } from '../../src/adapters/target-host.ts';
import { createWindowsLauncher } from '../../src/adapters/windows-launch.ts';
import type { ProcessTarget } from '../../src/domains/cdp-target.ts';

const source = process.argv[2];
if (!source) throw new Error('Provide an explicitly selected readest.exe test copy.');
const folder = path.resolve(process.argv[3] ?? '.superpowers/sdd/mcp-native-lifecycle/readest-native');
const sourceHash = createHash('sha256')
    .update(await readFile(source))
    .digest('hex');
const native = createWindowsLauncher();
const results: Record<string, unknown>[] = [];
await mkdir(folder, { recursive: true });
for (const mode of ['native', 'native-cdp'] as const) {
    const directory = path.join(folder, mode);
    await mkdir(directory, { recursive: true });
    const executable = path.join(directory, 'readest.exe');
    await copyFile(source, executable);
    // A settings file beside Readest selects its portable data directory. No existing user settings/books are copied.
    await writeFile(
        path.join(directory, 'Settings.json'),
        JSON.stringify({ autoCheckUpdates: false, telemetryEnabled: false, openLastBooks: false }),
    );
    const environment = {
        ...Object.fromEntries(
            Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined),
        ),
        WEBVIEW2_USER_DATA_FOLDER: path.join(directory, 'webview'),
    };
    let identity: ProcessTarget;
    let close: () => Promise<unknown>;
    const started = performance.now();
    if (mode === 'native-cdp') {
        const host = createTargetHost();
        const target = await host.launch({
            launch: {
                executable,
                cwd: directory,
                env: { ...environment, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port={port}' },
            },
            basePort: 21222,
        });
        identity = target;
        close = () => host.close(target, { requireListener: false });
    } else {
        const child = await native.launch({
            executablePath: executable,
            arguments: [],
            cwd: directory,
            env: environment,
        });
        identity = {
            processId: child.pid,
            startedAtUtc: child.startedAtUtc,
            executablePath: executable,
            port: 0,
            targetKind: 'generic-cdp',
        };
        close = () => native.close(identity);
    }
    const sample = async () => {
        const output = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./windows-window-evidence.ps1', import.meta.url)),
                '-ApplicationPid',
                String(identity.processId),
            ],
            { windowsHide: true, shell: false },
        );
        const windows: unknown = JSON.parse(output.stdout);
        return { elapsedMs: performance.now() - started, windows };
    };
    try {
        const first = await sample();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const settled = await sample();
        const closing = await close();
        results.push({
            mode,
            sourceHash,
            processId: identity.processId,
            startedAtUtc: identity.startedAtUtc,
            first,
            settled,
            closing,
            afterClose: await sample(),
        });
        assert.ok(
            closing === true ||
                (closing && typeof closing === 'object' && 'closed' in closing && closing.closed === true),
        );
    } finally {
        await writeFile(path.join(folder, 'evidence.json'), `${JSON.stringify(results, null, 4)}\n`);
        // Retain evidence and retry only normal close when a previous observation/close failed.
        if (!results.some((result) => result.mode === mode)) await close();
    }
}
console.log(JSON.stringify({ folder, sourceHash, results }));
