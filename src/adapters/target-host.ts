import { spawn as nodeSpawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ManagedTarget, ProcessTarget } from '../domains/cdp-target.ts';
import { choosePort, RetainedTargetError, validateCdpIdentity } from '../domains/cdp-target.ts';
import type { LaunchContext, LaunchOptions } from '../domains/control-contract.ts';
import { resolveLaunchDefinition } from '../domains/launch-command.ts';
import {
    DEFAULT_BASE_PORT,
    LOOPBACK,
    POLL_INTERVAL_MS,
    STARTUP_TIMEOUT_MS,
    TARGET_KINDS,
} from '../shared/constants.ts';
import { DetailedError, errorCode, errorDetails, errorMessage } from '../shared/errors.ts';
import { chromeProfileArgument, profileAvailable, reserveProfile } from './chrome-profile.ts';
import type { PlatformAdapter } from './platform-process.ts';
import { createPlatformAdapter, validateProcessIdentity } from './platform-process.ts';
import { createWindowsLauncher } from './windows-launch.ts';

async function probeAddress(port: number, host: string): Promise<boolean | null> {
    const server = net.createServer();
    try {
        return await new Promise<boolean | null>((resolve, reject) => {
            server.once('error', (error) => {
                if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(errorCode(error) ?? ''))
                    resolve(null);
                else if (['EADDRINUSE', 'EACCES'].includes(errorCode(error) ?? '')) resolve(false);
                else reject(error);
            });
            server.listen({ host, port, exclusive: true, ipv6Only: host === '::1' }, () => resolve(true));
        });
    } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

export async function probePort(port: number) {
    const ipv4 = await probeAddress(port, LOOPBACK);
    const ipv6 = await probeAddress(port, '::1');
    return ipv4 === true && ipv6 !== false;
}

export async function spawnPortableApplication(
    executable: string,
    arguments_: string[],
    _port: number,
    cwd = path.dirname(executable),
    env?: NodeJS.ProcessEnv,
) {
    const child = nodeSpawn(executable, arguments_, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
        env,
    });
    await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    child.unref();
    return child;
}

async function getVersion(port: number): Promise<unknown> {
    const response = await fetch(`http://${LOOPBACK}:${port}/json/version`, {
        signal: AbortSignal.timeout(1_000),
        redirect: 'error',
    });
    if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}.`);
    return response.json();
}

export function applyChromePreset(arguments_: string[]) {
    const addresses = [];
    for (let index = 0; index < arguments_.length; index += 1) {
        const match = arguments_[index]?.match(/^--remote-debugging-address(?:[=:](.*))?$/i);
        if (match) addresses.push(match[1] ?? arguments_[index + 1]);
    }
    if (addresses.length > 1) throw new Error('Duplicate Chrome debugging addresses are prohibited.');
    if (addresses.length && addresses[0] !== '127.0.0.1') throw new Error('Chrome debugging must use loopback.');
    const result = [...arguments_];
    if (chromeProfileArgument(result) === undefined) {
        const home = process.platform === 'win32' ? process.env.USERPROFILE : os.homedir();
        if (!home || !path.isAbsolute(home)) throw new Error('The Chrome profile home directory is unavailable.');
        result.push(`--user-data-dir=${path.join(home, '.cache', 'chrome-devtools-mcp', 'chrome-profile')}`);
    }
    if (!addresses.length) result.push('--remote-debugging-address=127.0.0.1');
    for (const flag of ['--no-first-run', '--no-default-browser-check', '--disable-updater-scheduler'])
        if (!result.includes(flag)) result.push(flag);
    return result;
}

type LaunchProcess = NonNullable<ManagedTarget['child']> & {
    exitCode: number | null;
    pid?: number | undefined;
    startedAtUtc?: string;
};
export interface HostDependencies {
    platformAdapter?: PlatformAdapter;
    probe?: (port: number) => Promise<boolean>;
    spawn?: (
        executable: string,
        arguments_: string[],
        port: number,
        cwd?: string,
        env?: NodeJS.ProcessEnv,
        context?: LaunchContext,
    ) => Promise<LaunchProcess>;
    getVersion?: (port: number) => Promise<unknown>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    profileAvailable?: (directory: string) => Promise<boolean>;
}
export function createTargetHost(dependencies: HostDependencies = {}) {
    const platform = dependencies.platformAdapter ?? createPlatformAdapter();
    const launchWindows = createWindowsLauncher();
    const io = {
        probe: probePort,
        spawn:
            process.platform === 'win32'
                ? (
                      executablePath: string,
                      arguments_: string[],
                      _port: number,
                      cwd: string,
                      env: NodeJS.ProcessEnv,
                      context: LaunchContext,
                  ) =>
                      launchWindows.launch(
                          {
                              executablePath,
                              arguments: arguments_,
                              cwd,
                              env: Object.fromEntries(
                                  Object.entries(env).filter(
                                      (entry): entry is [string, string] => entry[1] !== undefined,
                                  ),
                              ),
                          },
                          context,
                      )
                : spawnPortableApplication,
        getVersion,
        now: Date.now,
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        profileAvailable,
        ...dependencies,
    };
    return {
        async launch(
            {
                launch,
                targetKind = 'generic-cdp',
                basePort = DEFAULT_BASE_PORT,
                exactPort,
                launchDefinition,
            }: LaunchOptions,
            context: LaunchContext = {},
        ): Promise<ManagedTarget> {
            context.signal?.throwIfAborted();
            if (!TARGET_KINDS.includes(targetKind)) throw new Error('Unknown target kind.');
            const excluded = await platform.reservedRanges();
            if (
                exactPort !== undefined &&
                (!Number.isInteger(exactPort) ||
                    exactPort < 1024 ||
                    exactPort > 65535 ||
                    excluded.some(([start, end]) => exactPort >= start && exactPort <= end) ||
                    !(await io.probe(exactPort)))
            )
                throw new Error('The original CDP port is occupied or excluded; exact-port restart cannot proceed.');
            let candidate = basePort;
            while (candidate <= 65535) {
                const port =
                    exactPort ?? (await choosePort({ basePort: candidate, reservedRanges: excluded, probe: io.probe }));
                context.signal?.throwIfAborted();
                const parsed = launchDefinition ?? resolveLaunchDefinition(launch, port, process.env);
                if (!path.isAbsolute(parsed.executablePath))
                    throw new Error('The application must use an absolute executable path.');
                const executablePath = path.resolve(parsed.executablePath);
                const args = targetKind === 'chrome' ? applyChromePreset(parsed.arguments) : parsed.arguments;
                const cwd = parsed.cwd ?? path.dirname(executablePath);
                if (!path.isAbsolute(cwd)) throw new Error('The application working directory must be absolute.');
                const environment = new Map<string, [string, string | undefined]>();
                for (const [name, value] of [...Object.entries(process.env), ...Object.entries(parsed.env ?? {})])
                    environment.set(process.platform === 'win32' ? name.toLowerCase() : name, [name, value]);
                const env = Object.fromEntries(environment.values());
                const profile = targetKind === 'chrome' ? chromeProfileArgument(args) : undefined;
                const release =
                    profile === undefined
                        ? undefined
                        : await reserveProfile(path.resolve(cwd, profile), io.profileAvailable);
                const requestedAt = io.now();
                context.onPhase?.('launching');
                let child: LaunchProcess;
                try {
                    context.signal?.throwIfAborted();
                    child = await io.spawn(executablePath, args, port, cwd, env, context);
                    if (child.pid === undefined) throw new Error('The target process has no PID.');
                } catch (error) {
                    release?.();
                    throw error;
                }
                const releaseProfile = () => {
                    release?.();
                    child.off?.('exit', releaseProfile);
                };
                if (release) {
                    child.once('exit', releaseProfile);
                    if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') releaseProfile();
                }
                const processId = child.pid;
                if (processId === undefined) throw new Error('The target process has no PID.');
                const target: ProcessTarget & {
                    child: NonNullable<ManagedTarget['child']>;
                    releaseProfile?: () => void;
                } = {
                    port,
                    processId,
                    executablePath,
                    startedAtUtc: child.startedAtUtc ?? new Date(requestedAt).toISOString(),
                    targetKind,
                    child,
                    ...(release ? { releaseProfile } : {}),
                };
                let lastError: unknown;
                let foreignRace = false;
                const launchedAt = io.now();
                context.onPhase?.('waiting-cdp');
                while (io.now() - launchedAt < STARTUP_TIMEOUT_MS) {
                    try {
                        context.signal?.throwIfAborted();
                        if (child.monitoringFailure)
                            throw new Error(
                                'The native process observer failed; retaining application identity for cleanup.',
                            );
                        const evidence = await platform.snapshot(child.pid, port);
                        platform.validateNewRoot(evidence, target);
                        if (!evidence.root.exists) throw new Error('The target root process is absent.');
                        target.startedAtUtc = evidence.root.startedAtUtc;
                        if (
                            evidence.listeners.some(({ localAddress }) => !['127.0.0.1', '::1'].includes(localAddress))
                        ) {
                            throw new Error('The CDP listener is exposed outside loopback.');
                        }
                        foreignRace = evidence.listeners.some(
                            ({ owningProcess }) => !evidence.processIds.includes(Number(owningProcess)),
                        );
                        if (foreignRace) {
                            lastError = new Error('A foreign process won the CDP port race.');
                            break;
                        }
                        const endpoint = await io.getVersion(port);
                        context.signal?.throwIfAborted();
                        const identity = validateCdpIdentity({
                            endpoint,
                            port,
                            listeners: evidence.listeners,
                            processIds: evidence.processIds,
                            targetKind,
                        });
                        return {
                            ...target,
                            ...identity,
                            launchDefinition: {
                                executablePath,
                                arguments: args,
                                cwd,
                                ...(parsed.env ? { env: { ...parsed.env } } : {}),
                            },
                            async verify() {
                                const current = await platform.snapshot(processId, port);
                                validateProcessIdentity(current, target);
                                const endpointNow = await io.getVersion(port);
                                const checked = validateCdpIdentity({
                                    endpoint: endpointNow,
                                    port,
                                    listeners: current.listeners,
                                    processIds: current.processIds,
                                    targetKind,
                                });
                                if (
                                    checked.webSocketDebuggerUrl !== identity.webSocketDebuggerUrl ||
                                    checked.browserProduct !== identity.browserProduct
                                )
                                    throw new Error('The target CDP endpoint identity changed.');
                            },
                        };
                    } catch (error) {
                        lastError = error;
                        if (
                            context.signal?.aborted ||
                            child.monitoringFailure ||
                            child.exitCode !== null ||
                            typeof child.signalCode === 'string' ||
                            /exposed|identity|Google Chrome|PID/.test(errorMessage(error))
                        )
                            break;
                        await io.sleep(POLL_INTERVAL_MS);
                    }
                }
                let closeConfirmed = false;
                let cleanupError: unknown;
                try {
                    closeConfirmed = await platform.close(target, { requireListener: false });
                } catch (error) {
                    cleanupError = error;
                }
                if (closeConfirmed) {
                    releaseProfile?.();
                    child.disposeMonitor?.();
                }
                if (closeConfirmed && context.signal?.aborted) throw context.signal.reason;
                if (foreignRace && closeConfirmed && exactPort === undefined) {
                    candidate = port + 1;
                    continue;
                }
                const message = `The new target did not expose a verified CDP endpoint: ${lastError === undefined ? undefined : errorMessage(lastError)}`;
                const error = closeConfirmed
                    ? new DetailedError(message)
                    : new RetainedTargetError(message, {
                          ...target,
                          launchDefinition: {
                              executablePath,
                              arguments: args,
                              cwd,
                              ...(parsed.env ? { env: { ...parsed.env } } : {}),
                          },
                      });
                error.details = { processId: child.pid, port, closeConfirmed, ...errorDetails(cleanupError) };
                throw error;
            }
            throw new Error('The CDP port range is exhausted.');
        },
        async close(target: ManagedTarget, options?: { requireListener?: boolean }) {
            const closed = await platform.close(target, options);
            if (closed) {
                target.releaseProfile?.();
                target.child?.disposeMonitor?.();
            }
            return closed;
        },
        async health(target: ManagedTarget): Promise<'healthy' | 'gone' | 'unavailable' | 'identity-changed'> {
            const evidence = await platform.snapshot(target.processId, target.port);
            if (!evidence.root.exists) return 'gone';
            try {
                validateProcessIdentity(evidence, target);
            } catch {
                return 'identity-changed';
            }
            if (evidence.listeners.some(({ owningProcess }) => !evidence.processIds.includes(owningProcess)))
                return 'identity-changed';
            if (!evidence.listeners.length) return 'unavailable';
            try {
                await target.verify?.();
                return 'healthy';
            } catch {
                return 'unavailable';
            }
        },
    };
}
