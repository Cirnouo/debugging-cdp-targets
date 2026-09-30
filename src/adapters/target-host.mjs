import { spawn as nodeSpawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { choosePort, validateCdpIdentity } from '../domains/cdp-target.mjs';
import { parseLaunchCommand } from '../domains/launch-command.mjs';
import {
    DEFAULT_BASE_PORT,
    LOOPBACK,
    POLL_INTERVAL_MS,
    STARTUP_TIMEOUT_MS,
    TARGET_KINDS,
} from '../shared/constants.mjs';
import { createPlatformAdapter, validateProcessIdentity } from './platform-process.mjs';

async function probeAddress(port, host) {
    const server = net.createServer();
    try {
        return await new Promise((resolve, reject) => {
            server.once('error', (error) => {
                if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) resolve(null);
                else if (['EADDRINUSE', 'EACCES'].includes(error.code)) resolve(false);
                else reject(error);
            });
            server.listen({ host, port, exclusive: true, ipv6Only: host === '::1' }, () => resolve(true));
        });
    } finally {
        if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
}

export async function probePort(port) {
    const ipv4 = await probeAddress(port, LOOPBACK);
    const ipv6 = await probeAddress(port, '::1');
    return ipv4 === true && ipv6 !== false;
}

async function spawn(executable, arguments_) {
    const child = nodeSpawn(executable, arguments_, {
        cwd: path.dirname(executable),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
    });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    child.unref();
    return child;
}

async function getVersion(port) {
    const response = await fetch(`http://${LOOPBACK}:${port}/json/version`, {
        signal: AbortSignal.timeout(1_000),
        redirect: 'error',
    });
    if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}.`);
    return response.json();
}

export function applyChromePreset(arguments_) {
    const home = process.platform === 'win32' ? process.env.USERPROFILE : os.homedir();
    if (!home || !path.isAbsolute(home)) throw new Error('The Chrome profile home directory is unavailable.');
    const addresses = [];
    for (let index = 0; index < arguments_.length; index += 1) {
        const match = arguments_[index].match(/^--remote-debugging-address(?:[=:](.*))?$/i);
        if (match) addresses.push(match[1] ?? arguments_[index + 1]);
    }
    if (addresses.length > 1) throw new Error('Duplicate Chrome debugging addresses are prohibited.');
    if (addresses.length && addresses[0] !== '127.0.0.1') throw new Error('Chrome debugging must use loopback.');
    const result = [...arguments_];
    if (!result.some((value) => /^--user-data-dir(?:=|$)/.test(value)))
        result.push(`--user-data-dir=${path.join(home, '.cache', 'chrome-devtools-mcp', 'chrome-profile')}`);
    if (!addresses.length) result.push('--remote-debugging-address=127.0.0.1');
    for (const flag of ['--no-first-run', '--no-default-browser-check']) if (!result.includes(flag)) result.push(flag);
    return result;
}

export function createTargetHost(dependencies = {}) {
    const platform = dependencies.platformAdapter ?? createPlatformAdapter();
    const io = {
        probe: probePort,
        spawn,
        getVersion,
        now: Date.now,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        ...dependencies,
    };
    return {
        async launch({ launchCommand, targetKind = 'generic-cdp', basePort = DEFAULT_BASE_PORT }) {
            if (!TARGET_KINDS.includes(targetKind)) throw new Error('Unknown target kind.');
            const excluded = await platform.reservedRanges();
            let candidate = basePort;
            while (candidate <= 65535) {
                const port = await choosePort({ basePort: candidate, reservedRanges: excluded, probe: io.probe });
                const parsed = parseLaunchCommand({ template: launchCommand, port, environment: process.env });
                if (!path.isAbsolute(parsed.executable))
                    throw new Error('The launch command must use an absolute executable path.');
                const executablePath = path.resolve(parsed.executable);
                const args = targetKind === 'chrome' ? applyChromePreset(parsed.arguments) : parsed.arguments;
                const launchedAt = io.now();
                const child = await io.spawn(executablePath, args, port);
                const target = {
                    port,
                    processId: child.pid,
                    executablePath,
                    startedAtUtc: new Date(launchedAt).toISOString(),
                    targetKind,
                    child,
                };
                let lastError;
                let foreignRace = false;
                while (io.now() - launchedAt < STARTUP_TIMEOUT_MS) {
                    try {
                        const evidence = await platform.snapshot(child.pid, port);
                        platform.validateNewRoot(evidence, target);
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
                            async verify() {
                                const current = await platform.snapshot(child.pid, port);
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
                        if (child.exitCode !== null || /exposed|identity|Google Chrome|PID/.test(error.message)) break;
                        await io.sleep(POLL_INTERVAL_MS);
                    }
                }
                let closeConfirmed = false;
                try {
                    closeConfirmed = await platform.close(target, { requireListener: false });
                } catch {
                    /* Keep PID/port evidence for manual recovery. */
                }
                if (foreignRace && closeConfirmed) {
                    candidate = port + 1;
                    continue;
                }
                const error = new Error(`The new target did not expose a verified CDP endpoint: ${lastError?.message}`);
                error.details = { processId: child.pid, port, closeConfirmed };
                throw error;
            }
            throw new Error('The CDP port range is exhausted.');
        },
        close: (target) => platform.close(target),
    };
}
