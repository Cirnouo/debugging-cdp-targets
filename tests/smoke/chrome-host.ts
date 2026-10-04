import assert from 'node:assert/strict';
import { access, constants, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    createPlatformAdapter,
    type PlatformAdapter,
    validateProcessIdentity,
} from '../../src/adapters/platform-process.ts';
import { type ProcessTarget, validateCdpIdentity } from '../../src/domains/cdp-target.ts';
import type { ConnectionStatus } from '../../src/domains/control-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';

function absolutePath(value: string, platform: NodeJS.Platform) {
    if (platform !== 'win32') return path.posix.isAbsolute(value);
    return path.win32.isAbsolute(value) && /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value);
}

export function resolveChromeSmokeExecutable(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string {
    if (!['win32', 'linux', 'darwin'].includes(platform)) throw new Error('Unsupported Chrome smoke host.');
    const executable =
        environment.DCT_SMOKE_CHROME_EXECUTABLE ??
        (platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    if (executable === undefined)
        throw new Error('DCT_SMOKE_CHROME_EXECUTABLE must identify the actual Chrome executable.');
    if (!executable || executable.includes('\0') || !absolutePath(executable, platform)) {
        throw new Error('The Chrome executable must be a nonempty absolute path without NUL characters.');
    }
    return executable;
}

export async function requireChromeSmokeExecutable() {
    const executable = resolveChromeSmokeExecutable(process.platform, process.env);
    await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    if (!(await stat(executable)).isFile()) throw new Error('The Chrome executable must be a file.');
    return executable;
}

export function createChromeSmokeLaunch(
    executable: string,
    profile: string,
    page: string,
    platform: NodeJS.Platform = process.platform,
) {
    if (!absolutePath(profile, platform)) throw new Error('The smoke profile must be an absolute path.');
    return {
        executable,
        args: [
            '--no-first-run',
            '--disable-background-networking',
            '--disable-background-mode',
            `--user-data-dir=${profile}`,
            '--remote-debugging-port={port}',
            page,
        ],
    };
}

export function chromeSmokeVersion(endpoint: unknown): string {
    const product = isRecord(endpoint) && typeof endpoint.Browser === 'string' ? endpoint.Browser : '';
    const version = product.match(/^Chrome\/(\d+)\.\d+\.\d+\.\d+$/)?.[0].slice('Chrome/'.length);
    if (!version || Number(version.split('.')[0]) < 149) {
        throw new Error('Chrome 149 or newer with a complete browser version is required for the official CSS tools.');
    }
    return version;
}

export async function inspectChromeSmokeTarget(
    target: ConnectionStatus,
    executable: string,
    platform: PlatformAdapter = createPlatformAdapter(),
): Promise<ProcessTarget> {
    assert.ok(target.processId && target.port && target.targetKind === 'chrome');
    const evidence = await platform.snapshot(target.processId, target.port);
    assert.ok(evidence.root.exists);
    const fixture: ProcessTarget = {
        processId: target.processId,
        port: target.port,
        targetKind: target.targetKind,
        executablePath: executable,
        startedAtUtc: evidence.root.startedAtUtc,
    };
    validateProcessIdentity(evidence, fixture);
    const response = await fetch(`http://127.0.0.1:${target.port}/json/version`, {
        signal: AbortSignal.timeout(5_000),
    });
    assert.ok(response.ok, 'The owned Chrome version endpoint must respond successfully.');
    const endpoint: unknown = await response.json();
    validateCdpIdentity({
        endpoint,
        port: target.port,
        listeners: evidence.listeners,
        processIds: evidence.processIds,
        targetKind: target.targetKind,
    });
    const chromeVersion = chromeSmokeVersion(endpoint);
    validateProcessIdentity(await platform.snapshot(target.processId, target.port), fixture);
    console.log(
        JSON.stringify({
            chromeSmokeEnvironment: {
                platform: process.platform,
                osRelease: os.release(),
                architecture: process.arch,
                nodeVersion: process.version,
                chromeVersion,
                executable,
                processId: fixture.processId,
                startedAtUtc: fixture.startedAtUtc,
                userOrSessionId: evidence.root.sessionId,
                listeners: evidence.listeners,
            },
        }),
    );
    return fixture;
}
