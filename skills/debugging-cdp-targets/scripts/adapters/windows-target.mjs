import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fail, SessionError } from '../shared/errors.mjs';
import { isIntegerInRange } from '../shared/values.mjs';
import { assertFile, getSkillRoot } from './local-data.mjs';
import { closeServer } from './runtime.mjs';

export function processExists(processId) {
    if (!Number.isInteger(processId) || processId <= 0) return false;
    try {
        // Signal 0 is an existence/permission probe; it never terminates the process.
        process.kill(processId, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

export async function listenProbe(port, host, ipv6Only = false) {
    const server = net.createServer();
    return new Promise((resolve) => {
        const finish = (result) => {
            server.removeAllListeners('error');
            resolve({ result, server: result.status === 'available' ? server : null });
        };
        server.once('error', (error) => {
            const occupiedCodes = new Set(['EADDRINUSE', 'EACCES']);
            const unsupportedCodes = new Set(['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT']);
            const status = occupiedCodes.has(error.code)
                ? 'occupied'
                : unsupportedCodes.has(error.code)
                  ? 'unsupported'
                  : 'error';
            finish({ status, message: error.message, code: error.code });
        });
        server.listen({ host, port, exclusive: true, ipv6Only }, () => {
            finish({ status: 'available' });
        });
    });
}

export async function probeLoopbackPort(port) {
    if (!isIntegerInRange(port, 1, 65535)) {
        fail('PORT_INVALID', 'The candidate port must be an integer from 1 through 65535.');
    }

    let ipv4;
    let ipv6;
    try {
        ipv4 = await listenProbe(port, '127.0.0.1');
        ipv6 = await listenProbe(port, '::1', true);
        const supported = [ipv4.result, ipv6.result].filter((item) => item.status !== 'unsupported');
        const available = supported.length > 0 && supported.every((item) => item.status === 'available');
        return {
            port,
            available,
            ipv4: ipv4.result,
            ipv6: ipv6.result,
        };
    } finally {
        await Promise.all([closeServer(ipv4?.server), closeServer(ipv6?.server)]);
    }
}

export function helperPath() {
    return path.join(getSkillRoot(), 'scripts', 'windows-cdp-helper.ps1');
}

export async function invokeWindowsHelper(action, parameters) {
    const helper = helperPath();
    await assertFile(helper, 'WINDOWS_HELPER_MISSING', `The Windows helper is missing at ${helper}.`);
    const arguments_ = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helper,
        '-Action',
        action,
    ];
    for (const [name, value] of Object.entries(parameters)) {
        if (value === undefined || value === null) continue;
        arguments_.push(`-${name}`, String(value));
    }
    const result = spawnSync('powershell.exe', arguments_, {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
        maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) fail('WINDOWS_HELPER_FAILED', result.error.message);
    let output;
    try {
        output = JSON.parse(String(result.stdout).trim());
    } catch (error) {
        fail('WINDOWS_HELPER_FAILED', 'The Windows helper did not return one JSON object.', {
            stdout: result.stdout,
            stderr: result.stderr,
            cause: error.message,
        });
    }
    if (result.status !== 0 || output.ok === false) {
        fail(
            output.errorCode || 'WINDOWS_HELPER_FAILED',
            output.message || result.stderr || 'The Windows helper failed.',
            output.details,
        );
    }
    return output;
}

export async function getWindowsSnapshot(rootProcessId, port) {
    return invokeWindowsHelper('Snapshot', { RootProcessId: rootProcessId, Port: port });
}

export async function closeTargetGracefully(state, timeoutSeconds = 10, requireOwnedListener = true) {
    const result = await invokeWindowsHelper('Close', {
        RootProcessId: state.rootProcessId,
        Port: state.port,
        ExecutablePath: state.executablePath,
        StartedAtUtc: state.startedAtUtc,
        ListenerPolicy: requireOwnedListener ? 'OwnedExclusive' : 'ProcessIdentityOnly',
        TimeoutSeconds: timeoutSeconds,
    });
    return result.closed === true;
}

export async function getCdpVersion(port, timeoutMilliseconds = 1000) {
    return new Promise((resolve, reject) => {
        const request = http.get(
            {
                hostname: '127.0.0.1',
                port,
                path: '/json/version',
                agent: false,
                timeout: timeoutMilliseconds,
            },
            (response) => {
                const chunks = [];
                response.setEncoding('utf8');
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    if (response.statusCode !== 200) {
                        reject(
                            new SessionError(
                                'CDP_HTTP_ERROR',
                                `The CDP endpoint returned HTTP ${response.statusCode}.`,
                            ),
                        );
                        return;
                    }
                    try {
                        resolve(JSON.parse(chunks.join('')));
                    } catch (error) {
                        reject(
                            new SessionError(
                                'CDP_RESPONSE_INVALID',
                                'The CDP version endpoint returned invalid JSON.',
                                { cause: error.message },
                            ),
                        );
                    }
                });
            },
        );
        request.once('timeout', () => request.destroy(new Error('CDP request timed out.')));
        request.once('error', reject);
    });
}

export async function spawnTarget(executablePath, arguments_) {
    const child = spawn(executablePath, arguments_, {
        cwd: path.dirname(executablePath),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
    });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    child.unref();
    return child.pid;
}
