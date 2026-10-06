import { execFile, spawn } from 'node:child_process';
import { mkdtemp, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createPlatformAdapter } from '../../src/adapters/platform-process.ts';
import { createTargetHost } from '../../src/adapters/target-host.ts';
import { LOOPBACK } from '../../src/shared/constants.ts';
import { createChromeSmokeLaunch, requireChromeSmokeExecutable } from './chrome-host.ts';
import { boundedProbeError, runOwnedStartupProbe } from './linux-startup-probe-support.ts';

if (process.platform !== 'linux') throw new Error('This temporary probe requires the Linux runner.');
const executable = await requireChromeSmokeExecutable();
const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-linux-startup-probe-'));
const stdoutPath = path.join(directory, 'chrome.stdout.log');
const stderrPath = path.join(directory, 'chrome.stderr.log');
const stdoutFile = await open(stdoutPath, 'wx+');
const stderrFile = await open(stderrPath, 'wx+');
const started = performance.now();
function record(event: Record<string, unknown>) {
    console.log(
        JSON.stringify({
            timestampUtc: new Date().toISOString(),
            elapsedMs: Math.round(performance.now() - started),
            ...event,
        }),
    );
}
const platform = createPlatformAdapter();
const host = createTargetHost({
    platformAdapter: {
        ...platform,
        async snapshot(pid, port) {
            const began = performance.now();
            try {
                const evidence = await platform.snapshot(pid, port);
                record({
                    event: 'native-snapshot',
                    processId: pid,
                    port,
                    durationMs: Math.round(performance.now() - began),
                    root: evidence.root,
                    ownedProcessIds: evidence.processIds,
                    listeners: evidence.listeners,
                });
                return evidence;
            } catch (error) {
                record({
                    event: 'native-snapshot-error',
                    processId: pid,
                    port,
                    durationMs: Math.round(performance.now() - began),
                    error: boundedProbeError(error),
                });
                throw error;
            }
        },
    },
    async spawn(actualExecutable, arguments_, port, cwd, env, context = {}) {
        context.signal?.throwIfAborted();
        const child = spawn(actualExecutable, arguments_, {
            cwd,
            detached: true,
            stdio: ['ignore', stdoutFile.fd, stderrFile.fd],
            windowsHide: false,
            shell: false,
            env,
        });
        child.once('exit', (code, signal) => record({ event: 'child-exit', processId: child.pid, code, signal }));
        await new Promise<void>((resolve, reject) => {
            child.once('spawn', () => {
                context.onCreated?.(child);
                record({ event: 'spawn', processId: child.pid, port, executable: actualExecutable });
                resolve();
            });
            child.once('error', reject);
        });
        child.unref();
        return child;
    },
    async getVersion(port) {
        const began = performance.now();
        try {
            const response = await fetch(`http://${LOOPBACK}:${port}/json/version`, {
                signal: AbortSignal.timeout(1_000),
                redirect: 'error',
            });
            if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}.`);
            const endpoint: unknown = await response.json();
            record({ event: 'fetch-version-success', port, durationMs: Math.round(performance.now() - began) });
            return endpoint;
        } catch (error) {
            record({
                event: 'fetch-version-error',
                port,
                durationMs: Math.round(performance.now() - began),
                error: boundedProbeError(error),
            });
            throw error;
        }
    },
});
try {
    record({
        event: 'environment',
        nodeVersion: process.version,
        osRelease: os.release(),
        architecture: process.arch,
        display: process.env.DISPLAY ?? null,
        xauthority: process.env.XAUTHORITY ?? null,
        directory,
        stdoutPath,
        stderrPath,
    });
    const target = await runOwnedStartupProbe(
        host,
        {
            targetKind: 'chrome',
            basePort: 19222,
            launch: createChromeSmokeLaunch(
                executable,
                path.join(directory, 'profile-one'),
                'data:text/html,<title>FIRST</title><style>h1{color:rgb(12,34,56)}</style><h1>Isolated smoke</h1>',
            ),
        },
        record,
    );
    record({
        event: 'probe-success',
        processId: target.processId,
        port: target.port,
        browserProduct: target.browserProduct,
    });
} catch (error) {
    record({ event: 'probe-failure', error: boundedProbeError(error) });
    process.exitCode = 1;
} finally {
    try {
        const version = await promisify(execFile)(executable, ['--version'], {
            shell: false,
            timeout: 10_000,
            maxBuffer: 65_536,
        });
        record({ event: 'chrome-version', chromeVersion: version.stdout.trim().slice(0, 240) });
    } catch (error) {
        record({ event: 'chrome-version-error', error: boundedProbeError(error) });
    }
    for (const [label, file] of [
        ['stdout', stdoutFile],
        ['stderr', stderrFile],
    ] as const) {
        try {
            const size = (await file.stat()).size;
            const length = Math.min(size, 65_536);
            const buffer = Buffer.alloc(length);
            await file.read(buffer, 0, length, size - length);
            record({
                event: 'chrome-output',
                stream: label,
                bytes: size,
                truncated: size > length,
                tail: buffer.toString('utf8'),
            });
        } finally {
            await file.close();
        }
    }
}
