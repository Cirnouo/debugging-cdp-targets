import path from 'node:path';
import process from 'node:process';
import { fail } from '../shared/errors.mjs';
import { isIntegerInRange, sleep } from '../shared/values.mjs';
import { validateRootSnapshot, validateCdpContract } from '../domains/cdp-target/policy.mjs';
import { assertFile, assertDirectory } from '../adapters/local-data.mjs';
import { processExists, getWindowsSnapshot, getCdpVersion } from '../adapters/windows-target.mjs';
import { getNpxLaunch } from '../adapters/official-cli.mjs';
import { POLL_INTERVAL_MILLISECONDS } from '../shared/constants.mjs';

export async function waitForCdp(port, rootProcessId, timeoutSeconds) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let lastError;
    while (Date.now() < deadline) {
        if (!processExists(rootProcessId)) fail('TARGET_EXITED', `The newly started target process ${rootProcessId} exited before CDP became available.`);
        try {
            return await getCdpVersion(port, 750);
        } catch (error) {
            lastError = error;
            await sleep(POLL_INTERVAL_MILLISECONDS);
        }
    }
    fail('CDP_TIMEOUT', `The target did not expose a CDP endpoint on port ${port} within ${timeoutSeconds} seconds.`, { cause: lastError?.message });
}

export async function inspectManagedTarget(state, { getSnapshot = getWindowsSnapshot, getVersion = getCdpVersion } = {}) {
    let snapshot;
    try {
        snapshot = await getSnapshot(state.rootProcessId, state.port);
    } catch (error) {
        return { status: 'unverifiable', reason: error.code || 'snapshot-failed' };
    }
    if (typeof snapshot?.root?.exists !== 'boolean' || !Array.isArray(snapshot.listeners)) {
        return { status: 'unverifiable', reason: 'snapshot-invalid' };
    }
    if (snapshot.root.exists === false) {
        return snapshot.listeners.length > 0
            ? { status: 'mismatch', reason: 'root-absent-listener-present', processIdentityValid: false }
            : { status: 'absent', reason: 'root-and-listener-absent', processIdentityValid: false };
    }
    try {
        validateRootSnapshot({ snapshot, executablePath: state.executablePath, startedAtUtc: state.startedAtUtc, targetAdapter: state.targetAdapter });
    } catch (error) {
        return { status: 'mismatch', reason: error.code || 'root-validation-failed', processIdentityValid: false };
    }

    let endpoint;
    try {
        endpoint = await getVersion(state.port);
    } catch (error) {
        return { status: 'unverifiable', reason: error.code || 'endpoint-unavailable', processIdentityValid: true, snapshot };
    }
    try {
        const contract = validateCdpContract({
            port: state.port,
            endpoint,
            listeners: snapshot.listeners,
            allowedProcessIds: snapshot.processIds,
            targetAdapter: state.targetAdapter,
        });
        if (contract.browserProduct !== state.browserProduct) return { status: 'mismatch', reason: 'browser-product-mismatch', processIdentityValid: true, snapshot };
        if (contract.webSocketDebuggerUrl !== state.webSocketDebuggerUrl) return { status: 'mismatch', reason: 'websocket-mismatch', processIdentityValid: true, snapshot };
        return { status: 'valid', reason: 'valid', processIdentityValid: true, snapshot, endpoint, contract };
    } catch (error) {
        return { status: 'mismatch', reason: error.code || 'cdp-contract-mismatch', processIdentityValid: true, snapshot };
    }
}

export async function validateManagedTarget(state) {
    return (await inspectManagedTarget(state)).status === 'valid';
}

export async function assertStartEnvironment(options) {
    if (process.platform !== 'win32') fail('WINDOWS_REQUIRED', 'This Skill supports Windows only.');
    if (!options.executablePath || !path.isAbsolute(options.executablePath)) fail('EXECUTABLE_INVALID', 'ExecutablePath must be an existing absolute file path.');
    await assertFile(options.executablePath, 'EXECUTABLE_INVALID', 'ExecutablePath must be an existing absolute file path.');
    if (!['chrome', 'generic-cdp'].includes(options.targetAdapter)) fail('TARGET_ADAPTER_INVALID', 'Target adapter must be chrome or generic-cdp.');
    if (!isIntegerInRange(options.basePort, 1, 65535)) fail('PORT_INVALID', 'BasePort must be an integer from 1 through 65535.');
    if (!isIntegerInRange(options.startupTimeoutSeconds, 1, 300)) fail('STARTUP_TIMEOUT_INVALID', 'StartupTimeoutSeconds must be from 1 through 300.');
    for (const workspace of options.workspaces) {
        if (!path.isAbsolute(workspace)) fail('WORKSPACE_INVALID', `Workspace must be absolute: '${workspace}'.`);
        await assertDirectory(workspace, 'WORKSPACE_INVALID', `Workspace does not exist: '${workspace}'.`);
    }
    await getNpxLaunch();
}
