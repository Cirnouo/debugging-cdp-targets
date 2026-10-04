import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createPlatformAdapter, validateProcessIdentity } from '../../src/adapters/platform-process.ts';
import { createWindowsLauncher } from '../../src/adapters/windows-launch.ts';
import { errorDetails } from '../../src/shared/errors.ts';

if (process.platform !== 'win32') throw new Error('Windows elevation smoke requires Windows.');
const folder = path.resolve(process.argv[2] ?? '.superpowers/sdd/mcp-native-lifecycle/windows-elevation');
await mkdir(folder, { recursive: true });
const executablePath = path.join(folder, 'requireAdministrator.exe');
await promisify(execFile)(
    'powershell.exe',
    [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(new URL('../fixtures/compile-native-window.ps1', import.meta.url)),
        '-Output',
        executablePath,
        '-Level',
        'requireAdministrator',
    ],
    { windowsHide: true, shell: false },
);
const marker = path.join(folder, 'visible');
const phases: string[] = [];
const native = createWindowsLauncher();
const evidence: Record<string, unknown> = { phases };
let application: Awaited<ReturnType<typeof native.launch>> | undefined;
try {
    const child = await native.launch(
        {
            executablePath,
            arguments: [marker],
            cwd: folder,
            env: {
                ...Object.fromEntries(
                    Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined),
                ),
                DCT_TEST_NATIVE: 'elevated Unicode 中文',
                DCT_TEST_WINDOW_LIFETIME_MS: '90000',
            },
        },
        {
            onPhase: (phase) => {
                phases.push(phase);
                console.log(JSON.stringify({ phase }));
            },
        },
    );
    application = child;
    evidence.processId = child.pid;
    evidence.startedAtUtc = child.startedAtUtc;
    evidence.elevated = child.elevated;
    assert.equal(child.elevated, true);
    const deadline = Date.now() + 8000;
    for (;;) {
        try {
            assert.equal(
                Buffer.from(await readFile(marker, 'utf8'), 'base64').toString('utf8'),
                'elevated Unicode 中文',
            );
            break;
        } catch (error) {
            if (Date.now() >= deadline) throw error;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    evidence.environmentPreserved = true;
    const identity = {
        processId: child.pid,
        startedAtUtc: child.startedAtUtc,
        executablePath,
        targetKind: 'generic-cdp' as const,
        port: 9222,
    };
    const platform = createPlatformAdapter();
    validateProcessIdentity(await platform.snapshot(child.pid, identity.port), identity);
    assert.equal(child.monitoringFailure, undefined);
    evidence.identityVerifiedFromUnelevatedGateway = true;
    const closed = await native.close(identity);
    evidence.close = closed;
    assert.equal(closed.closeRequested, true);
    assert.equal(closed.processExited, true);
    assert.equal(closed.closed, true);
    assert.equal(await readFile(`${marker}.closed`, 'utf8'), 'normal-close');
    const exitDeadline = Date.now() + 5000;
    while (child.exitCode === null && Date.now() < exitDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(child.exitCode, 0);
    assert.equal(child.monitoringFailure, undefined);
    assert.equal((await platform.snapshot(child.pid, identity.port)).root.exists, false);
    evidence.actualExitObserved = true;
    evidence.passed = true;
} catch (error) {
    evidence.failure = errorDetails(error);
    throw error;
} finally {
    application?.disposeMonitor();
    await writeFile(path.join(folder, 'evidence.json'), `${JSON.stringify(evidence, null, 4)}\n`);
    console.log(JSON.stringify(evidence));
}
