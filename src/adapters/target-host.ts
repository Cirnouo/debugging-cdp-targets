import { spawn as nodeSpawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import type { ManagedTarget } from '../domains/cdp-target.ts';
import { RetainedTargetError, validateCdpIdentity } from '../domains/cdp-target.ts';
import { withChromeScreenshotFeature } from '../domains/chromium-features.ts';
import type { LaunchContext, LaunchOptions } from '../domains/control-contract.ts';
import { parseDataIsolation } from '../domains/data-isolation.ts';
import { resolveLaunchDefinition, validateDataIsolationBinding } from '../domains/launch-command.ts';
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
import {
    createPlatformAdapter,
    observeTargetExit,
    targetExitObserved,
    validateProcessIdentity,
    waitForTargetExit,
} from './platform-process.ts';
import { createPortReservations, type PortReservations } from './port-reservation.ts';
import { createWindowsLauncher } from './windows-launch.ts';

function waitForWork<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const pending = work();
    if (!signal) return pending;
    return new Promise<T>((resolve, reject) => {
        const aborted = () => {
            signal.removeEventListener('abort', aborted);
            reject(signal.reason);
        };
        signal.addEventListener('abort', aborted, { once: true });
        void pending.then(
            (value) => {
                signal.removeEventListener('abort', aborted);
                if (signal.aborted) reject(signal.reason);
                else resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', aborted);
                reject(error);
            },
        );
        if (signal.aborted) aborted();
    });
}

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
    context: ProcessLaunchContext = {},
) {
    context.signal?.throwIfAborted();
    const child = nodeSpawn(executable, arguments_, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
        env,
    });
    await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => {
            context.onCreated?.(child);
            resolve();
        });
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
    const result = process.platform === 'win32' ? withChromeScreenshotFeature(arguments_) : [...arguments_];
    const addresses = [];
    for (let index = 0; index < arguments_.length; index += 1) {
        const match = arguments_[index]?.match(/^--remote-debugging-address(?:[=:](.*))?$/i);
        if (match) addresses.push(match[1] ?? arguments_[index + 1]);
    }
    if (addresses.length > 1) throw new Error('Duplicate Chrome debugging addresses are prohibited.');
    if (addresses.length && addresses[0] !== '127.0.0.1') throw new Error('Chrome debugging must use loopback.');
    chromeProfileArgument(result);
    if (!addresses.length) result.push('--remote-debugging-address=127.0.0.1');
    for (const flag of ['--no-first-run', '--no-default-browser-check', '--disable-updater-scheduler'])
        if (!result.includes(flag)) result.push(flag);
    return result;
}

function directoryKey(directory: string) {
    const normalized = path.resolve(directory);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function validateTargetLaunch(options: LaunchOptions) {
    const isolation = parseDataIsolation(options.isolation);
    const targetKind = options.targetKind ?? 'generic-cdp';
    const basePort = options.basePort ?? DEFAULT_BASE_PORT;
    if (!TARGET_KINDS.includes(targetKind)) throw new Error('Unknown target kind.');
    if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) throw new Error('Invalid base port.');
    if (options.launchDefinition) return;
    validateDataIsolationBinding(options.launch, isolation.mode, process.env);
    const sample = process.platform === 'win32' ? 'C:/dct-preflight-data' : '/dct-preflight-data';
    const parsed = resolveLaunchDefinition(
        options.launch,
        basePort,
        process.env,
        isolation.mode === 'data-dir' ? sample : undefined,
    );
    if (!path.isAbsolute(parsed.executablePath) || (parsed.cwd !== undefined && !path.isAbsolute(parsed.cwd)))
        throw new Error('Application executable and working directory must be absolute.');
    if (targetKind === 'chrome') {
        const args = applyChromePreset(parsed.arguments);
        const profile = chromeProfileArgument(args);
        if (
            isolation.mode === 'data-dir' &&
            (profile === undefined ||
                directoryKey(path.resolve(parsed.cwd ?? path.dirname(parsed.executablePath), profile)) !==
                    directoryKey(sample))
        )
            throw new Error('Isolated Chrome profile must match the leased data directory.');
    }
}

type LaunchProcess = NonNullable<ManagedTarget['child']> & {
    exitCode: number | null;
    pid?: number | undefined;
    startedAtUtc?: string;
};
interface ProcessLaunchContext extends LaunchContext {
    onCreated?: (child: LaunchProcess) => void;
}
export interface TargetLaunchContext extends LaunchContext {
    onCreated?: (target: ManagedTarget) => void;
    onRollback?: (target: ManagedTarget) => void;
}
export interface HostDependencies {
    platformAdapter?: PlatformAdapter;
    probe?: (port: number) => Promise<boolean>;
    spawn?: (
        executable: string,
        arguments_: string[],
        port: number,
        cwd?: string,
        env?: NodeJS.ProcessEnv,
        context?: ProcessLaunchContext,
    ) => Promise<LaunchProcess>;
    getVersion?: (port: number) => Promise<unknown>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    profileAvailable?: (directory: string) => Promise<boolean>;
    portReservations?: PortReservations;
}
export function createTargetHost(dependencies: HostDependencies = {}) {
    const launchWindows = createWindowsLauncher();
    const platform =
        dependencies.platformAdapter ??
        createPlatformAdapter({
            requestWindowsClose: launchWindows.requestNormalClose,
            waitWindowsExit: launchWindows.waitForExit,
        });
    const reservations = dependencies.portReservations ?? createPortReservations();
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
                      context: ProcessLaunchContext,
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
    async function requestNormalClose(
        target: ManagedTarget,
        context?: LaunchContext,
    ): Promise<Record<string, unknown>> {
        if (targetExitObserved(target)) return { closeRequested: false, processExited: true };
        if (platform.requestNormalClose) return platform.requestNormalClose(target, context);
        const accepted = await platform.close(target);
        if (!accepted) throw new Error('The application rejected normal close.');
        return { closeRequested: true, processExited: targetExitObserved(target) };
    }
    async function waitForExit(target: ManagedTarget, signal?: AbortSignal) {
        if (platform.waitForExit) await platform.waitForExit(target, signal);
        else await waitForTargetExit(target, signal);
        target.releaseProfile?.();
        target.child?.disposeMonitor?.();
    }
    async function rollbackCreatedTarget(target: ManagedTarget, context: TargetLaunchContext) {
        if (!targetExitObserved(target)) context.onRollback?.(target);
        const requestAbort = new AbortController();
        let resolveExit = () => {};
        const actualExit = new Promise<void>((resolve) => {
            resolveExit = resolve;
        });
        const exited = () => {
            resolveExit();
            requestAbort.abort(new Error('The target application exited during its normal-close request.'));
        };
        target.child?.once('exit', exited);
        if (targetExitObserved(target)) exited();
        try {
            const request = requestNormalClose(target, { signal: requestAbort.signal });
            try {
                await Promise.race([request, actualExit]);
            } catch (error) {
                if (!targetExitObserved(target)) throw error;
            }
            await waitForExit(target);
        } finally {
            target.child?.off?.('exit', exited);
        }
    }
    return {
        validateLaunch: validateTargetLaunch,
        async launch(options: LaunchOptions, context: TargetLaunchContext = {}): Promise<ManagedTarget> {
            validateTargetLaunch(options);
            const {
                launch,
                isolation,
                targetKind = 'generic-cdp',
                basePort = DEFAULT_BASE_PORT,
                exactPort,
                launchDefinition,
            } = options;
            context.signal?.throwIfAborted();
            if (isolation.mode === 'data-dir' && context.dataDirectory === undefined)
                throw new Error('A leased data directory binding is required.');
            if (!TARGET_KINDS.includes(targetKind)) throw new Error('Unknown target kind.');
            if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) throw new Error('Invalid base port.');
            const excluded = await waitForWork(() => platform.reservedRanges(), context.signal);
            if (
                exactPort !== undefined &&
                (!Number.isInteger(exactPort) ||
                    exactPort < 1024 ||
                    exactPort > 65535 ||
                    excluded.some(([start, end]) => exactPort >= start && exactPort <= end))
            )
                throw new Error('The original CDP port is occupied or excluded; exact-port restart cannot proceed.');
            const candidate = basePort;
            let port: number | undefined;
            let releasePort: (() => void) | undefined;
            for (
                let probeCandidate = exactPort ?? Math.max(candidate, 1024);
                probeCandidate <= 65535;
                probeCandidate += 1
            ) {
                if (excluded.some(([start, end]) => probeCandidate >= start && probeCandidate <= end)) continue;
                const claimed = reservations.claim(probeCandidate);
                if (!claimed) {
                    if (exactPort !== undefined) break;
                    continue;
                }
                let available: boolean;
                try {
                    available = await waitForWork(() => io.probe(probeCandidate), context.signal);
                } catch (error) {
                    claimed();
                    throw error;
                }
                if (available) {
                    port = probeCandidate;
                    releasePort = claimed;
                    break;
                }
                claimed();
                if (exactPort !== undefined) break;
            }
            if (port === undefined || releasePort === undefined) {
                if (exactPort !== undefined)
                    throw new Error(
                        'The original CDP port is occupied or excluded; exact-port restart cannot proceed.',
                    );
                throw new Error('No available, non-reserved CDP port remains.');
            }
            let created: ManagedTarget | undefined;
            let release: (() => void) | undefined;
            let readinessSignal = context.signal;
            try {
                context.signal?.throwIfAborted();
                const parsed =
                    launchDefinition ?? resolveLaunchDefinition(launch, port, process.env, context.dataDirectory);
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
                if (targetKind === 'chrome' && isolation.mode === 'data-dir') {
                    if (profile === undefined || context.dataDirectory === undefined)
                        throw new Error('Isolated Chrome profile must match the leased data directory.');
                    let actual: string;
                    try {
                        actual = await realpath(path.resolve(cwd, profile));
                    } catch {
                        throw new Error('Isolated Chrome profile identity is unavailable.');
                    }
                    if (directoryKey(actual) !== directoryKey(context.dataDirectory))
                        throw new Error('Isolated Chrome profile must match the leased data directory.');
                }
                release =
                    profile === undefined
                        ? undefined
                        : await reserveProfile(path.resolve(cwd, profile), (directory) =>
                              waitForWork(() => io.profileAvailable(directory), context.signal),
                          );
                context.signal?.throwIfAborted();
                const requestedAt = io.now();
                context.onPhase?.('launching');
                let child: LaunchProcess;
                try {
                    context.signal?.throwIfAborted();
                    const onCreated = (application: LaunchProcess) => {
                        if (created) return;
                        if (application.pid === undefined) throw new Error('The target process has no PID.');
                        const target: ManagedTarget = {
                            port,
                            processId: application.pid,
                            executablePath,
                            startedAtUtc: application.startedAtUtc ?? new Date(requestedAt).toISOString(),
                            targetKind,
                            child: application,
                            launchDefinition: {
                                executablePath,
                                arguments: args,
                                cwd,
                                ...(parsed.env ? { env: { ...parsed.env } } : {}),
                            },
                        };
                        created = target;
                        observeTargetExit(target);
                        const observation = new AbortController();
                        readinessSignal = context.signal
                            ? AbortSignal.any([context.signal, observation.signal])
                            : observation.signal;
                        const exited = () =>
                            observation.abort(
                                new Error('The target application exited before CDP readiness or verification.'),
                            );
                        const monitorFailed = () =>
                            observation.abort(
                                new Error(
                                    'The native process observer failed; retaining application identity for cleanup.',
                                ),
                            );
                        application.once('exit', exited);
                        const stopMonitor = application.onMonitorError?.(monitorFailed);
                        const releaseResources = () => {
                            if (!targetExitObserved(target)) return;
                            release?.();
                            releasePort?.();
                            application.off?.('exit', releaseResources);
                            application.off?.('exit', exited);
                            stopMonitor?.();
                        };
                        target.releaseProfile = releaseResources;
                        target.waitForExit = (signal) => waitForExit(target, signal);
                        application.once('exit', releaseResources);
                        if (targetExitObserved(target)) {
                            exited();
                            releaseResources();
                        } else if (application.monitoringFailure) monitorFailed();
                        context.onCreated?.(target);
                    };
                    child = await io.spawn(executablePath, args, port, cwd, env, {
                        ...(context.signal ? { signal: context.signal } : {}),
                        ...(context.onPhase ? { onPhase: context.onPhase } : {}),
                        onCreated,
                    });
                    onCreated(child);
                    if (child.pid === undefined) throw new Error('The target process has no PID.');
                } catch (error) {
                    if (created) {
                        try {
                            await rollbackCreatedTarget(created, context);
                        } catch (cleanupError) {
                            const retained = new RetainedTargetError(errorMessage(error), created);
                            retained.details = {
                                processId: created.processId,
                                port,
                                closeConfirmed: false,
                                ...errorDetails(cleanupError),
                            };
                            throw retained;
                        }
                    }
                    throw error;
                }
                const processId = child.pid;
                if (processId === undefined) throw new Error('The target process has no PID.');
                const target = created;
                if (!target) throw new Error('The created application identity is missing.');
                let lastError: unknown;
                let foreignRace = false;
                const launchedAt = io.now();
                context.onPhase?.('waiting-cdp');
                while (io.now() - launchedAt < STARTUP_TIMEOUT_MS) {
                    try {
                        context.signal?.throwIfAborted();
                        if (targetExitObserved(target))
                            throw new Error('The target application exited before CDP readiness.');
                        if (child.monitoringFailure)
                            throw new Error(
                                'The native process observer failed; retaining application identity for cleanup.',
                            );
                        const evidence = await waitForWork(() => platform.snapshot(processId, port), readinessSignal);
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
                        const endpoint = await waitForWork(() => io.getVersion(port), readinessSignal);
                        context.signal?.throwIfAborted();
                        if (targetExitObserved(target))
                            throw new Error('The target application exited before CDP readiness.');
                        const identity = validateCdpIdentity({
                            endpoint,
                            port,
                            listeners: evidence.listeners,
                            processIds: evidence.processIds,
                            targetKind,
                        });
                        Object.assign(target, identity);
                        target.verify = async () => {
                            const current = await waitForWork(
                                () => platform.snapshot(processId, port),
                                readinessSignal,
                            );
                            validateProcessIdentity(current, target);
                            const endpointNow = await waitForWork(() => io.getVersion(port), readinessSignal);
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
                        };
                        return target;
                    } catch (error) {
                        lastError = error;
                        if (
                            readinessSignal?.aborted ||
                            child.monitoringFailure ||
                            targetExitObserved(target) ||
                            child.exitCode !== null ||
                            typeof child.signalCode === 'string' ||
                            /exposed|identity|Google Chrome|PID/.test(errorMessage(error))
                        )
                            break;
                        try {
                            await waitForWork(() => io.sleep(POLL_INTERVAL_MS), readinessSignal);
                        } catch (waitingError) {
                            lastError = waitingError;
                            break;
                        }
                    }
                }
                const cancellationBeforeRollback = context.signal?.aborted
                    ? { reason: context.signal.reason }
                    : undefined;
                let closeConfirmed = false;
                let cleanupError: unknown;
                try {
                    await rollbackCreatedTarget(target, context);
                    closeConfirmed = true;
                } catch (error) {
                    cleanupError = error;
                }
                if (closeConfirmed) {
                    target.releaseProfile?.();
                    child.disposeMonitor?.();
                }
                if (closeConfirmed && cancellationBeforeRollback) throw cancellationBeforeRollback.reason;
                const message = `The new target did not expose a verified CDP endpoint: ${lastError === undefined ? undefined : errorMessage(lastError)}`;
                const error = closeConfirmed ? new DetailedError(message) : new RetainedTargetError(message, target);
                error.details = {
                    ...errorDetails(lastError),
                    ...(errorCode(lastError) ? { code: errorCode(lastError) } : {}),
                    ...errorDetails(cleanupError),
                    ...(errorCode(cleanupError) ? { code: errorCode(cleanupError) } : {}),
                    processId: child.pid,
                    port,
                    closeConfirmed,
                };
                throw error;
            } catch (error) {
                if (!created) {
                    release?.();
                    releasePort();
                    context.signal?.throwIfAborted();
                }
                throw error;
            }
        },
        async close(target: ManagedTarget, _options?: { requireListener?: boolean }) {
            await requestNormalClose(target);
            await waitForExit(target);
            return true;
        },
        requestNormalClose,
        waitForExit,
        async health(target: ManagedTarget): Promise<'healthy' | 'gone' | 'unavailable' | 'identity-changed'> {
            if (targetExitObserved(target)) return 'gone';
            const evidence = await platform.snapshot(target.processId, target.port);
            if (!evidence.root.exists) return targetExitObserved(target) ? 'gone' : 'unavailable';
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
