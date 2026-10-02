import { spawn as nodeSpawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ManagedTarget, ProcessTarget } from '../domains/cdp-target.ts';
import { choosePort, RetainedTargetError, validateCdpIdentity } from '../domains/cdp-target.ts';
import type { LaunchOptions } from '../domains/control-contract.ts';
import { parseLaunchCommand } from '../domains/launch-command.ts';
import {
    DEFAULT_BASE_PORT,
    LOOPBACK,
    POLL_INTERVAL_MS,
    STARTUP_TIMEOUT_MS,
    TARGET_KINDS,
} from '../shared/constants.ts';
import { DetailedError, errorCode, errorMessage } from '../shared/errors.ts';
import type { PlatformAdapter } from './platform-process.ts';
import { createPlatformAdapter, validateProcessIdentity } from './platform-process.ts';

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

async function spawn(executable: string, arguments_: string[], _port: number, cwd = path.dirname(executable)) {
    const child = nodeSpawn(executable, arguments_, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
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

export function applyChromePreset(arguments_: string[], profileKey?: string) {
    const home = process.platform === 'win32' ? process.env.USERPROFILE : os.homedir();
    if (!home || !path.isAbsolute(home)) throw new Error('The Chrome profile home directory is unavailable.');
    const addresses = [];
    for (let index = 0; index < arguments_.length; index += 1) {
        const match = arguments_[index]?.match(/^--remote-debugging-address(?:[=:](.*))?$/i);
        if (match) addresses.push(match[1] ?? arguments_[index + 1]);
    }
    if (addresses.length > 1) throw new Error('Duplicate Chrome debugging addresses are prohibited.');
    if (addresses.length && addresses[0] !== '127.0.0.1') throw new Error('Chrome debugging must use loopback.');
    const result = [...arguments_];
    if (!result.some((value) => /^--user-data-dir(?:=|$)/.test(value)))
        result.push(
            `--user-data-dir=${path.join(home, '.cache', 'chrome-devtools-mcp', profileKey ? `profile-${profileKey}` : 'chrome-profile')}`,
        );
    if (!addresses.length) result.push('--remote-debugging-address=127.0.0.1');
    for (const flag of ['--no-first-run', '--no-default-browser-check']) if (!result.includes(flag)) result.push(flag);
    return result;
}

type LaunchProcess = { exitCode: number | null; pid: number; once(event: 'exit', listener: () => void): unknown };
export interface HostDependencies {
    platformAdapter?: PlatformAdapter;
    probe?: (port: number) => Promise<boolean>;
    spawn?: (executable: string, arguments_: string[], port: number, cwd?: string) => Promise<LaunchProcess>;
    getVersion?: (port: number) => Promise<unknown>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}
export function createTargetHost(dependencies: HostDependencies = {}) {
    const platform = dependencies.platformAdapter ?? createPlatformAdapter();
    const io = {
        probe: probePort,
        spawn,
        getVersion,
        now: Date.now,
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        ...dependencies,
    };
    return {
        async launch({
            launchCommand,
            targetKind = 'generic-cdp',
            basePort = DEFAULT_BASE_PORT,
            exactPort,
            profileKey,
            launchDefinition,
        }: LaunchOptions): Promise<ManagedTarget> {
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
                const parsed = launchDefinition
                    ? { executable: launchDefinition.executablePath, arguments: [...launchDefinition.arguments] }
                    : parseLaunchCommand({ template: launchCommand, port, environment: process.env });
                if (!path.isAbsolute(parsed.executable))
                    throw new Error('The launch command must use an absolute executable path.');
                const executablePath = path.resolve(parsed.executable);
                const args =
                    targetKind === 'chrome' ? applyChromePreset(parsed.arguments, profileKey) : parsed.arguments;
                const cwd = launchDefinition?.cwd ?? path.dirname(executablePath);
                const launchedAt = io.now();
                const child = await io.spawn(executablePath, args, port, cwd);
                if (child.pid === undefined) throw new Error('The target process has no PID.');
                const processId = child.pid;
                const target: ProcessTarget & { child: NonNullable<ManagedTarget['child']> } = {
                    port,
                    processId: child.pid,
                    executablePath,
                    startedAtUtc: new Date(launchedAt).toISOString(),
                    targetKind,
                    child,
                };
                let lastError: unknown;
                let foreignRace = false;
                while (io.now() - launchedAt < STARTUP_TIMEOUT_MS) {
                    try {
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
                            launchDefinition: { executablePath, arguments: args, cwd },
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
                        if (child.exitCode !== null || /exposed|identity|Google Chrome|PID/.test(errorMessage(error)))
                            break;
                        await io.sleep(POLL_INTERVAL_MS);
                    }
                }
                let closeConfirmed = false;
                try {
                    closeConfirmed = await platform.close(target, { requireListener: false });
                } catch {
                    /* Keep PID/port evidence for manual recovery. */
                }
                if (foreignRace && closeConfirmed && exactPort === undefined) {
                    candidate = port + 1;
                    continue;
                }
                const message = `The new target did not expose a verified CDP endpoint: ${lastError === undefined ? undefined : errorMessage(lastError)}`;
                const error = closeConfirmed
                    ? new DetailedError(message)
                    : new RetainedTargetError(message, {
                          ...target,
                          launchDefinition: { executablePath, arguments: args, cwd },
                      });
                error.details = { processId: child.pid, port, closeConfirmed };
                throw error;
            }
            throw new Error('The CDP port range is exhausted.');
        },
        close: (target: ManagedTarget, options?: { requireListener?: boolean }) => platform.close(target, options),
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
