import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isRecord } from '../../src/shared/errors.ts';
import { readWindowSample, type WindowIdentity } from './window-evidence.ts';
export interface ApplicationProcessEvidence {
    identity: WindowIdentity;
    commandLine: string;
    argv: string[];
    file: { sha256: string; fileVersion: string; productVersion: string };
    elevated: boolean;
    identityVerifiedBefore: true;
    identityVerifiedAfter: true;
}
export function readApplicationProcessEvidence(raw: unknown, identity: WindowIdentity): ApplicationProcessEvidence {
    assert.ok(isRecord(raw) && isRecord(raw.identity) && isRecord(raw.file));
    // Reuse the precise native process-creation comparison in the window validator.
    readWindowSample(
        [
            {
                ...raw.identity,
                handle: 1,
                child: false,
                visible: true,
                isIconic: false,
                showCmd: 1,
                actionAccepted: null,
                nativeError: 0,
                stateReached: true,
            },
        ],
        identity,
    );
    assert.ok(typeof raw.commandLine === 'string' && raw.commandLine.length > 0);
    assert.ok(
        Array.isArray(raw.argv) &&
            raw.argv.length > 0 &&
            raw.argv.every((arg: unknown) => typeof arg === 'string' && !arg.includes('\0')),
    );
    assert.ok(typeof raw.file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(raw.file.sha256));
    assert.ok(typeof raw.file.fileVersion === 'string' && raw.file.fileVersion.trim().length > 0);
    assert.ok(typeof raw.file.productVersion === 'string' && raw.file.productVersion.trim().length > 0);
    assert.ok(
        typeof raw.elevated === 'boolean' && raw.identityVerifiedBefore === true && raw.identityVerifiedAfter === true,
    );
    return {
        identity,
        commandLine: raw.commandLine,
        argv: raw.argv.map((arg: unknown) => {
            assert.ok(typeof arg === 'string');
            return arg;
        }),
        file: { sha256: raw.file.sha256, fileVersion: raw.file.fileVersion, productVersion: raw.file.productVersion },
        elevated: raw.elevated,
        identityVerifiedBefore: true,
        identityVerifiedAfter: true,
    };
}

export function qualifyApplicationBrowserArguments(
    evidence: ApplicationProcessEvidence,
    expected: { application: 'obsidian' | 'readest'; profile: string; port: number; candidate: boolean },
): void {
    const end = evidence.argv.indexOf('--');
    const args = evidence.argv.slice(1, end < 0 ? undefined : end);
    const values = (name: string) =>
        args.flatMap((arg, index) =>
            arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : arg === name ? [args[index + 1]] : [],
        );
    const profiles = values('--user-data-dir');
    assert.equal(profiles.length, 1, 'Actual browser profile adoption is absent or ambiguous.');
    assert.ok(
        profiles[0] &&
            path.win32.normalize(profiles[0]).toLowerCase() === path.win32.normalize(expected.profile).toLowerCase(),
        'Actual browser profile differs.',
    );
    assert.deepEqual(values('--remote-debugging-port'), [String(expected.port)], 'Actual browser port differs.');
    const entries = (name: string) => values(name).flatMap((value) => (value ?? '').split(','));
    const target = (entry: string) => /^CDPScreenshotNewSurface(?:$|[<:*])/.test(entry);
    assert.ok(!entries('--disable-features').some(target), 'Actual browser disables screenshot candidate.');
    const enabled = entries('--enable-features').filter(target);
    assert.deepEqual(
        enabled,
        expected.candidate ? ['CDPScreenshotNewSurface'] : [],
        'Actual bare feature carrier differs.',
    );
    if (expected.application === 'readest')
        assert.equal(evidence.elevated, false, 'Readest requires observed ordinary privileges.');
}

export async function runApplicationPowerShell(script: string, args: string[], signal?: AbortSignal) {
    const output = await promisify(execFile)(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL(script, import.meta.url)),
            ...args,
        ],
        { windowsHide: true, shell: false, timeout: 10_000, ...(signal === undefined ? {} : { signal }) },
    );
    const raw: unknown = JSON.parse(output.stdout);
    return { raw, stdout: output.stdout, stderr: output.stderr };
}

export function applicationIdentityArguments(identity: WindowIdentity) {
    return [
        '-ApplicationPid',
        String(identity.processId),
        '-ExecutablePath',
        identity.executablePath,
        '-StartedAtUtc',
        identity.startedAtUtc,
    ];
}

export function startApplicationExitWitness(
    identities: WindowIdentity[],
    record: (kind: string, value: unknown) => Promise<void>,
) {
    const child = spawn(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL('./windows-application-evidence.ps1', import.meta.url)),
            '-Mode',
            'Witness',
            '-IdentitiesJson',
            JSON.stringify(identities),
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false },
    );
    const lines = createInterface({ input: child.stdout });
    let stderr = '';
    child.stderr.on('data', (value) => {
        stderr += String(value);
    });
    let armedResolve: () => void;
    let armedReject: (error: Error) => void;
    let resultResolve: (value: unknown) => void;
    let resultReject: (error: Error) => void;
    let received: unknown;
    const armed = new Promise<void>((resolve, reject) => {
        armedResolve = resolve;
        armedReject = reject;
    });
    const result = new Promise<unknown>((resolve, reject) => {
        resultResolve = resolve;
        resultReject = reject;
    });
    // Consumers await each promise later; attach rejection handlers immediately to prevent lost evidence.
    void armed.catch(() => {});
    void result.catch(() => {});
    let writes = Promise.resolve();
    const watchdog = setTimeout(() => {
        child.stdin.end();
        armedReject(new Error('Passive witness arm deadline expired.'));
    }, 10_000);
    lines.on('line', (line) => {
        writes = writes
            .then(async () => {
                const raw: unknown = JSON.parse(line);
                await record('passive-exit-witness', raw);
                assert.ok(isRecord(raw));
                if (raw.event === 'armed') {
                    clearTimeout(watchdog);
                    armedResolve();
                }
                if (raw.event === 'observed') received = raw;
            })
            .catch((error: unknown) => {
                armedReject(new Error(String(error)));
                resultReject(new Error(String(error)));
                child.stdin.end();
            });
    });
    child.once('error', (error) => {
        clearTimeout(watchdog);
        armedReject(error);
        resultReject(error);
    });
    child.once('exit', (code) => {
        clearTimeout(watchdog);
        lines.close();
        void writes.then(() => {
            if (code !== 0 || received === undefined) {
                const error = new Error(`Passive witness failed: ${stderr}`);
                armedReject(error);
                resultReject(error);
            } else resultResolve(received);
        });
    });
    return {
        armed,
        async finish() {
            child.stdin.end('observe\n');
            return result;
        },
    };
}
