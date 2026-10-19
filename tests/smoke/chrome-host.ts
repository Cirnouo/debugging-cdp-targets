import assert from 'node:assert/strict';
import type { BigIntStats } from 'node:fs';
import { access, constants, lstat, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    createPlatformAdapter,
    type PlatformAdapter,
    validateProcessIdentity,
} from '../../src/adapters/platform-process.ts';
import type { ConnectionStatus, LaunchOptions } from '../../src/domains/control-contract.ts';
import { validateCdpIdentity } from '../../src/gateway/targets/model/cdp-identity.ts';
import type { ProcessTarget } from '../../src/gateway/targets/model/target-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { readChromeSmokeProfile } from './chrome-profile-probe.ts';
import type { FixtureArtifacts, ProfileDirectoryRecord, ProfilePoint, ProfileRole } from './fixture-artifacts.ts';

export type ProfileStat = Pick<BigIntStats, 'dev' | 'ino' | 'isDirectory' | 'isFile' | 'isSymbolicLink'>;

/** Private point-in-time fixture identity only; never a lease or process-completion proof. */
export function createChromeProfileObservations(
    enabled: boolean,
    sink: Pick<FixtureArtifacts, 'profileDirectory' | 'rejected'>,
    io: { inspect?: (path: string) => Promise<ProfileStat>; now?: () => number } = {},
) {
    const bindings = new Map<ProfileRole, { path: string; baseline?: { dev: bigint; ino: bigint } }>();
    const inspect = io.inspect ?? ((file: string) => lstat(file, { bigint: true }));
    const now = io.now ?? (() => performance.now());
    let origin: number | undefined;
    let lastTime: number | undefined;
    function rejected() {
        try {
            sink.rejected();
        } catch {}
    }
    function time(): number | undefined {
        try {
            const value = now();
            if (!Number.isFinite(value) || value < 0 || (lastTime !== undefined && value < lastTime)) return;
            lastTime = value;
            return value;
        } catch {
            return;
        }
    }
    if (enabled) {
        origin = time();
        if (origin === undefined) rejected();
    }
    function readCode(error: unknown): unknown {
        try {
            if (!error || (typeof error !== 'object' && typeof error !== 'function')) return;
            const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
            return descriptor && 'value' in descriptor ? descriptor.value : undefined;
        } catch {
            return;
        }
    }
    function emit(
        role: ProfileRole,
        point: ProfilePoint,
        start: number | undefined,
        outcome: { value: ProfileStat } | { error: unknown },
        captureBaseline = false,
    ) {
        try {
            const end = time();
            const binding = bindings.get(role);
            if (!binding) return;
            let result: ProfileDirectoryRecord['result'] = 'unavailable';
            let entryKind: ProfileDirectoryRecord['entryKind'] = 'unknown';
            let matchesBaseline: boolean | null = null;
            let readError: ProfileDirectoryRecord['readError'] = 'other';
            if ('value' in outcome) {
                const value = outcome.value;
                if (typeof value.dev !== 'bigint' || typeof value.ino !== 'bigint') {
                    rejected();
                    return;
                }
                entryKind = value.isSymbolicLink()
                    ? 'symlink'
                    : value.isDirectory()
                      ? 'directory'
                      : value.isFile()
                        ? 'file'
                        : 'other';
                if (captureBaseline && entryKind === 'directory') binding.baseline = { dev: value.dev, ino: value.ino };
                if (binding.baseline)
                    matchesBaseline =
                        entryKind === 'directory' &&
                        binding.baseline.dev === value.dev &&
                        binding.baseline.ino === value.ino;
                result = 'present';
                readError = 'none';
            } else {
                const code = readCode(outcome.error);
                if (code === 'ENOENT') {
                    result = 'absent';
                    entryKind = 'none';
                    readError = 'none';
                } else if (code === 'EACCES' || code === 'EPERM') readError = 'denied';
            }
            if (origin === undefined || start === undefined || end === undefined || end < start) {
                rejected();
                return;
            }
            sink.profileDirectory({
                kind: 'profile-directory',
                role,
                point,
                elapsedMs: end - origin,
                readDurationMs: end - start,
                result,
                entryKind,
                matchesBaseline,
                readError,
            });
        } catch {
            rejected();
        }
    }
    async function observe<T extends ProfileStat>(
        role: ProfileRole,
        point: ProfilePoint,
        start: number | undefined,
        pending: Promise<T>,
    ): Promise<T> {
        let value: T;
        try {
            value = await pending;
        } catch (error) {
            emit(role, point, start, { error });
            throw error;
        }
        emit(role, point, start, { value });
        return value;
    }
    async function sampleRead(role: ProfileRole, point: ProfilePoint, captureBaseline = false) {
        if (!enabled) return;
        const binding = bindings.get(role);
        if (!binding) return;
        const start = time();
        try {
            const value = await inspect(binding.path);
            emit(role, point, start, { value }, captureBaseline);
        } catch (error) {
            emit(role, point, start, { error });
        }
    }
    return {
        async register(role: ProfileRole, file: string) {
            if (!enabled) return;
            if (bindings.has(role) || [...bindings.values()].some((binding) => binding.path === file)) {
                rejected();
                return;
            }
            bindings.set(role, { path: file });
            await sampleRead(role, 'registered', true);
        },
        sample(role: ProfileRole, point: ProfilePoint) {
            return sampleRead(role, point);
        },
        async sampleAll(point: ProfilePoint) {
            if (!enabled) return;
            await sampleRead('first', point);
            await sampleRead('second', point);
        },
        observeCheck<T extends ProfileStat>(file: string, point: ProfilePoint, pending: Promise<T>): Promise<T> {
            if (!enabled) return pending;
            const role = [...bindings].find(([, binding]) => binding.path === file)?.[0];
            if (!role) return pending;
            return observe(role, point, time(), pending);
        },
    };
}

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
    startupLog?: string,
): LaunchOptions {
    if (!absolutePath(profile, platform)) throw new Error('The smoke profile must be an absolute path.');
    const paths = platform === 'win32' ? path.win32 : path.posix;
    return {
        isolation: {
            mode: 'data-dir',
            directory: { kind: 'new', parent: paths.dirname(profile), name: paths.basename(profile) },
            cleanup: 'delete-on-release',
        },
        targetKind: 'chrome',
        launch: {
            executable,
            args: [
                '--no-first-run',
                '--disable-background-networking',
                '--disable-background-mode',
                '--user-data-dir={dataDir}',
                '--remote-debugging-port={port}',
                ...(startupLog ? ['--enable-logging', `--log-file=${startupLog}`] : []),
                page,
            ],
        },
    };
}

/** Verify the actual Chrome profile belongs directly to the connection lease. */
export async function inspectChromeSmokeDirectory(
    tool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
    target: ConnectionStatus,
    fixture: ProcessTarget,
    observe: (fixture: ProcessTarget) => Promise<string> = readChromeSmokeProfile,
): Promise<string> {
    assert.ok(target.sessionId);
    assert.equal(fixture.processId, target.processId);
    assert.equal(fixture.port, target.port);
    assert.equal(fixture.targetKind, target.targetKind);
    const configuration = await tool('dct_connection_status', {
        connectionId: target.connectionId,
        include: ['configuration'],
    });
    assert.ok(isRecord(configuration.structuredContent));
    const isolation = configuration.structuredContent.isolation;
    assert.ok(isRecord(isolation) && isolation.mode === 'data-dir' && typeof isolation.path === 'string');
    assert.equal(isolation.state, 'held');
    assert.equal(isolation.cleanup, 'delete-on-release');
    const directory = await realpath(isolation.path);
    assert.equal(directory, isolation.path);
    const route = { _dct: { connectionId: target.connectionId, sessionId: target.sessionId } };
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await tool(name, { ...route, ...args });
        assert.notEqual(result.isError, true, JSON.stringify(result));
        assert.ok(Array.isArray(result.content));
        return result.content
            .filter((block: unknown) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
            .map((block: { text: string }) => block.text)
            .join('\n');
    };
    const selected = (await call('list_pages')).match(/^(\d+):.*\[selected\]/m)?.[1];
    assert.ok(selected, 'The application page must remain selected after the profile probe.');
    let failure: { error: unknown } | undefined;
    try {
        const profilePath = await realpath(await observe(fixture));
        const relative = path.relative(directory, profilePath);
        assert.ok(
            relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`),
            'The browser profile must lie inside the leased directory.',
        );
        // These fresh launches supply no --profile-directory override or nested data root.
        assert.equal(
            await realpath(path.dirname(profilePath)),
            directory,
            'The fresh Chrome profile must have the leased directory as its direct parent.',
        );
        console.log(JSON.stringify({ chromeDataDirectory: { directory, profilePath } }));
    } catch (error) {
        failure = { error };
    } finally {
        try {
            await call('select_page', { pageId: Number(selected) });
        } catch (error) {
            failure = {
                error: failure
                    ? new AggregateError(
                          [failure.error, error],
                          'Profile inspection and page selection restoration failed.',
                      )
                    : error,
            };
        }
    }
    if (failure) throw failure.error;
    return directory;
}

export function chromeSmokeVersion(endpoint: unknown): string {
    const product = isRecord(endpoint) && typeof endpoint.Browser === 'string' ? endpoint.Browser : '';
    const version = product.match(/^Chrome\/(\d+)\.\d+\.\d+\.\d+$/)?.[0].slice('Chrome/'.length);
    if (!version || Number(version.split('.')[0]) < 149) {
        throw new Error('Chrome 149 or newer with a complete browser version is required for the official CSS tools.');
    }
    return version;
}

/** External stimulus only; the gateway owns actual application exit observation. */
export async function requestChromeSmokeClose(
    fixture: ProcessTarget,
    platform: Pick<PlatformAdapter, 'requestNormalClose'>,
): Promise<boolean> {
    if (!platform.requestNormalClose) throw new Error('The platform has no normal Close request API.');
    const receipt = await platform.requestNormalClose(fixture);
    return receipt.closeRequested === true;
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
