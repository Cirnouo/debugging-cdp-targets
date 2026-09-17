import { fail } from '../shared/errors.mjs';
import { sleep } from '../shared/values.mjs';
import { parseSemver, validatePackageSpec } from '../shared/semver.mjs';
import { createSessionRecord } from '../domains/managed-session/record.mjs';
import { getDaemonSessionId, buildDaemonArguments, validateDaemonStatus } from '../domains/devtools-bridge/contracts.mjs';
import { processExists } from '../adapters/windows-target.mjs';
import { spawnOfficialCliDetached, loadOfficialCliRuntime, getOfficialDaemonStatus, invokeOfficialTool } from '../adapters/official-cli.mjs';
import { DEFAULT_STARTUP_TIMEOUT_SECONDS, DEFAULT_PACKAGE_SPEC, POLL_INTERVAL_MILLISECONDS } from '../shared/constants.mjs';

export async function resolvePackageVersion({ packageSpec = DEFAULT_PACKAGE_SPEC, runNpx }) {
    if (typeof runNpx !== 'function') fail('NPX_EXECUTOR_REQUIRED', 'A safe npx executor is required.');
    validatePackageSpec(packageSpec);
    const arguments_ = ['--yes', '--package', packageSpec, 'chrome-devtools', '--version'];
    const result = await runNpx(arguments_);
    if (result.exitCode !== 0) {
        fail('PACKAGE_RESOLUTION_FAILED', `Unable to resolve ${packageSpec}.`, { stderr: result.stderr?.trim() });
    }
    const versionMatch = String(result.stdout).match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
    if (!versionMatch) fail('PACKAGE_VERSION_INVALID', `The CLI did not report a semantic version for ${packageSpec}.`);
    const version = versionMatch[1];
    parseSemver(version);
    return { version, pinnedPackageSpec: `chrome-devtools-mcp@${version}` };
}

export async function validateDaemonIdentity(state) {
    return (await inspectManagedDaemon(state)).status === 'valid';
}

export async function inspectManagedDaemon(state) {
    let status;
    try {
        status = await getOfficialDaemonStatus(state);
    } catch (error) {
        return { status: 'unverifiable', reason: error.code || 'status-failed' };
    }
    if (!status.running) return { status: 'absent', reason: 'not-running' };
    const identity = validateDaemonStatus({ state, status, processExists });
    return identity.valid
        ? { status: 'valid', reason: 'valid', daemonStatus: status }
        : { status: 'mismatch', reason: identity.reason, daemonStatus: status };
}

export async function stopOfficialDaemon(state) {
    const status = await getOfficialDaemonStatus(state);
    if (!status.running) return;
    if (!validateDaemonStatus({ state, status, processExists }).valid) {
        fail('DAEMON_IDENTITY_MISMATCH', 'Refusing to stop a daemon that does not match the managed session.');
    }
    const runtime = await loadOfficialCliRuntime(state.resolvedPackageVersion);
    let response;
    try { response = await runtime.sendCommand({ method: 'stop' }, getDaemonSessionId(state)); } catch (error) {
        fail('DAEMON_STOP_FAILED', 'The pinned official client could not stop its daemon.', { cause: error.message });
    }
    if (!response?.success) fail('DAEMON_STOP_FAILED', 'The daemon rejected its stop request.', { error: response?.error });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (!runtime.isDaemonRunning(getDaemonSessionId(state))) return;
        await sleep(POLL_INTERVAL_MILLISECONDS);
    }
    fail('DAEMON_STOP_FAILED', 'The daemon remained active after the official stop command.');
}

export async function startOfficialDaemon(state, timeoutSeconds = DEFAULT_STARTUP_TIMEOUT_SECONDS) {
    const before = await getOfficialDaemonStatus(state);
    if (before.running) fail('DAEMON_ALREADY_RUNNING', `A chrome-devtools daemon is already running as PID ${before.processId}.`);
    const launch = buildDaemonArguments(state);
    await spawnOfficialCliDetached(state.resolvedPackageVersion, launch.arguments);
    const deadline = Date.now() + timeoutSeconds * 1000;
    let status;
    while (Date.now() < deadline) {
        try {
            status = await getOfficialDaemonStatus(state);
            if (status.running) break;
        } catch { /* The daemon may still be starting. */ }
        await sleep(POLL_INTERVAL_MILLISECONDS);
    }
    if (!status?.running) fail('DAEMON_START_FAILED', 'The chrome-devtools daemon did not become ready before the timeout.');
    const active = createSessionRecord({ ...state, status: 'active', daemonProcessId: status.processId });
    const identity = validateDaemonStatus({ state: active, status, processExists });
    if (!identity.valid) {
        fail('DAEMON_IDENTITY_MISMATCH', `The started daemon did not match the requested session (${identity.reason}).`);
    }
    const pages = await invokeOfficialTool(active, ['list_pages', '--output-format=json']);
    if (pages.exitCode !== 0) {
        try { await stopOfficialDaemon(active); } catch { /* Report list_pages failure. */ }
        fail('DAEMON_CONNECTION_FAILED', 'The daemon started but list_pages could not reach the verified target.', { stderr: pages.stderr.trim() });
    }
    try { JSON.parse(pages.stdout); } catch {
        try { await stopOfficialDaemon(active); } catch { /* Report invalid handshake. */ }
        fail('DAEMON_CONNECTION_FAILED', 'The list_pages handshake did not return JSON.');
    }
    if (!await validateDaemonIdentity(active)) {
        fail('DAEMON_IDENTITY_MISMATCH', 'The daemon identity changed during its connection handshake.');
    }
    return status.processId;
}
