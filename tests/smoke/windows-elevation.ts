import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createPlatformAdapter, validateProcessIdentity } from '../../src/adapters/platform-process.ts';
import { createWindowsLauncher } from '../../src/adapters/windows-launch.ts';
import { errorDetails, errorMessage, isRecord } from '../../src/shared/errors.ts';

if (process.platform !== 'win32') throw new Error('Windows elevation smoke requires Windows.');
const folder = path.resolve(process.argv[2] ?? '.superpowers/sdd/mcp-native-lifecycle/windows-elevation');
const mode = process.argv[3] ?? 'normal';
if (!['normal', 'access-denied-return', 'access-denied-exception'].includes(mode))
    throw new Error('Unknown elevation smoke mode.');
await mkdir(folder, { recursive: true });
const executablePath = path.join(folder, 'requireAdministrator.exe');
const compiled = await promisify(execFile)(
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
const inspection: unknown = JSON.parse(compiled.stdout.trim());
if (
    !isRecord(inspection) ||
    typeof inspection.currentElevation !== 'boolean' ||
    typeof inspection.requiresElevation !== 'boolean'
)
    throw new Error('The disposable fixture compilation did not provide privilege evidence.');
const marker = path.join(folder, 'visible');
const phases: string[] = [];
const native = createWindowsLauncher();
const evidence: Record<string, unknown> = {
    mode,
    phases,
    gatewayElevated: inspection.currentElevation,
    fixtureRequiresElevation: inspection.requiresElevation,
};
let application: Awaited<ReturnType<typeof native.launch>> | undefined;
let closeAttempted = false;
const reportPhase = (phase: string) => {
    phases.push(phase);
    console.log(JSON.stringify({ phase }));
};
async function waitForActualExit(child: Awaited<ReturnType<typeof native.launch>>) {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve, reject) => {
        let release: (() => void) | undefined;
        const complete = () => {
            release?.();
            resolve();
        };
        child.once('exit', complete);
        release = child.onMonitorError(() => {
            child.off('exit', complete);
            reject(new Error('The actual native application observer failed.'));
        });
        if (child.exitCode !== null) complete();
    });
}
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
                ...(mode === 'access-denied-exception' ? { DCT_TEST_DENY_MEDIUM_QUERY: 'true' } : {}),
            },
        },
        {
            onPhase: reportPhase,
            onCreated: (child) => {
                application = child;
                evidence.actualCreationObservedSynchronously = true;
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
    if (mode !== 'normal') {
        const denied = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('../fixtures/windows-close-denial.ps1', import.meta.url)),
                '-TargetProcessId',
                String(child.pid),
                '-ExecutablePath',
                executablePath,
                '-StartedAtUtc',
                child.startedAtUtc,
                '-Mode',
                mode === 'access-denied-exception' ? 'inspect' : 'request',
            ],
            { windowsHide: true, shell: false },
        );
        const deniedEvidence: unknown = JSON.parse(denied.stdout.trim());
        assert.ok(isRecord(deniedEvidence));
        evidence.actualNativeAccessDenied = deniedEvidence;
        assert.equal(deniedEvidence.nativeError, 5);
        assert.equal(deniedEvidence.threw === true, mode === 'access-denied-exception');
    }
    if (mode !== 'access-denied-exception') {
        validateProcessIdentity(await platform.snapshot(child.pid, identity.port), identity);
        evidence.identityVerifiedFromUnelevatedGateway = true;
    }
    assert.equal(child.monitoringFailure, undefined);
    closeAttempted = true;
    evidence.closeRequest = await native.requestNormalClose(identity, { onPhase: reportPhase });
    const closed = await native.waitForExit(identity);
    evidence.close = closed;
    assert.equal(closed.closeRequested, true);
    assert.equal(closed.processExited, true);
    assert.equal(closed.closed, true);
    assert.equal(await readFile(`${marker}.closed`, 'utf8'), 'normal-close');
    await waitForActualExit(child);
    assert.equal(child.exitCode, 0);
    assert.equal(child.monitoringFailure, undefined);
    assert.equal((await platform.snapshot(child.pid, identity.port)).root.exists, false);
    evidence.actualExitObserved = true;
    evidence.passed = true;
} catch (error) {
    evidence.failure = { ...errorDetails(error), message: errorMessage(error) };
    throw error;
} finally {
    if (application && application.exitCode === null) {
        try {
            if (!closeAttempted) {
                closeAttempted = true;
                const identity = {
                    processId: application.pid,
                    startedAtUtc: application.startedAtUtc,
                    executablePath,
                    targetKind: 'generic-cdp' as const,
                    port: 9222,
                };
                evidence.cleanupRequest = await native.requestNormalClose(identity, { onPhase: reportPhase });
                evidence.cleanupExit = await native.waitForExit(identity);
            }
            // After a cancelled authorization, the disposable window's own timer
            // closes it normally. Do not retry UAC or signal the application.
            await waitForActualExit(application);
            evidence.cleanupActualExitObserved = true;
        } catch (error) {
            evidence.cleanupFailure = { ...errorDetails(error), message: errorMessage(error) };
            evidence.retainedProcessId = application.pid;
        }
    }
    if (application?.exitCode !== null) application?.disposeMonitor();
    await writeFile(path.join(folder, 'evidence.json'), `${JSON.stringify(evidence, null, 4)}\n`);
    console.log(JSON.stringify(evidence));
}
