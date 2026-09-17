import path from 'node:path';
import {
    ensureDirectory,
    getChromeProfilePath,
    getDefaultStatePath,
    readSessionRecord,
    removeSessionRecord,
    withSessionLock,
    writeSessionRecord,
} from '../adapters/local-data.mjs';
import {
    getOfficialDaemonStatus,
    invokeOfficialTool,
    preparePinnedCli,
    runNpx,
    runOfficialCli,
} from '../adapters/official-cli.mjs';
import {
    closeTargetGracefully,
    getWindowsSnapshot,
    probeLoopbackPort,
    processExists,
    spawnTarget,
} from '../adapters/windows-target.mjs';
import {
    buildTargetArguments,
    isLoopbackAddress,
    isVerifiedPortRace,
    runPortTransaction,
    validateCdpContract,
    validateNewRootSnapshot,
} from '../domains/cdp-target/policy.mjs';
import { resolveExtensionMode, resolveStopDaemonAction } from '../domains/devtools-bridge/contracts.mjs';
import { classifyInspectedSession, resolveStopTargetAction } from '../domains/managed-session/lifecycle.mjs';
import { createSessionRecord } from '../domains/managed-session/record.mjs';
import { REQUIRED_EXTENSION_COMMANDS, SESSION_SCHEMA_VERSION } from '../shared/constants.mjs';
import { fail } from '../shared/errors.mjs';
import {
    inspectManagedDaemon,
    resolvePackageVersion,
    startOfficialDaemon,
    stopOfficialDaemon,
    validateDaemonIdentity,
} from './bridge.mjs';
import {
    invokeGuardedTool,
    reconcileMissingTarget,
    resumeManagedSession,
    rollbackManagedStart,
    stopManagedSession,
} from './session-lifecycle.mjs';
import { assertStartEnvironment, inspectManagedTarget, validateManagedTarget, waitForCdp } from './target.mjs';

export async function classifyRealState(state) {
    if (!state) return classifyInspectedSession({ state: null });
    const [targetInspection, daemonInspection] = await Promise.all([
        inspectManagedTarget(state),
        inspectManagedDaemon(state),
    ]);
    return classifyInspectedSession({ state, targetInspection, daemonInspection });
}

export async function startManagedSession(options, statePath = getDefaultStatePath()) {
    await assertStartEnvironment(options);
    const executablePath = path.resolve(options.executablePath);
    const workspaces = [...new Set(options.workspaces.map((workspace) => path.resolve(workspace)))];
    let existing;
    try {
        existing = await readSessionRecord(statePath);
    } catch (error) {
        fail('STATE_STALE_UNVERIFIABLE', 'The existing state file is invalid and will not be replaced automatically.', {
            cause: error.message,
        });
    }
    const classification = await classifyRealState(existing);
    if (['active', 'detached'].includes(classification.status)) {
        fail(
            'SESSION_ALREADY_MANAGED',
            `A managed session is already ${classification.status}. Use status, stop, or resume.`,
        );
    }
    if (classification.status === 'stale') {
        const targetInspection = await inspectManagedTarget(existing);
        if (
            !(await reconcileMissingTarget({
                state: existing,
                statePath,
                targetInspection,
                getDaemonStatus: getOfficialDaemonStatus,
                stopDaemon: stopOfficialDaemon,
            }))
        ) {
            fail('STALE_SESSION_IN_USE', 'The stale state is not confirmed absent and will not be replaced.', {
                targetStatus: targetInspection.status,
                targetReason: targetInspection.reason,
            });
        }
    }

    const version = await resolvePackageVersion({
        packageSpec: options.packageSpec,
        runNpx,
    });
    await preparePinnedCli(version.version);
    const chromeProfilePath = getChromeProfilePath();
    if (options.targetAdapter === 'chrome') await ensureDirectory(chromeProfilePath);
    const transaction = await runPortTransaction({
        probe: probeLoopbackPort,
        basePort: options.basePort,
        tryCandidate: async (port) => {
            const targetArguments = buildTargetArguments({
                targetAdapter: options.targetAdapter,
                port,
                launchArguments: options.launchArguments,
                chromeProfilePath,
            });
            let rootProcessId;
            const launchedAtUtc = new Date().toISOString();
            const provisional = {
                rootProcessId: 0,
                port,
                executablePath,
                startedAtUtc: launchedAtUtc,
            };
            try {
                rootProcessId = await spawnTarget(executablePath, targetArguments);
                provisional.rootProcessId = rootProcessId;
                const endpoint = await waitForCdp(port, rootProcessId, options.startupTimeoutSeconds);
                const snapshot = await getWindowsSnapshot(rootProcessId, port);
                provisional.startedAtUtc = validateNewRootSnapshot({
                    snapshot,
                    executablePath,
                    launchedAtUtc,
                    targetAdapter: options.targetAdapter,
                });
                const foreignLoopback = snapshot.listeners.some(
                    (listener) =>
                        isLoopbackAddress(listener.localAddress) &&
                        !snapshot.processIds.includes(listener.owningProcess),
                );
                const exposed = snapshot.listeners.some((listener) => !isLoopbackAddress(listener.localAddress));
                if (exposed) fail('CDP_EXPOSED', 'The CDP port is listening on a non-loopback address.');
                if (foreignLoopback) {
                    const closed = await closeTargetGracefully(provisional, 10, false);
                    if (!closed) return { outcome: 'fatal', code: 'ROLLBACK_CLOSE_FAILED', details: { rootProcessId } };
                    return { outcome: 'port-race' };
                }
                const contract = validateCdpContract({
                    port,
                    endpoint,
                    listeners: snapshot.listeners,
                    allowedProcessIds: snapshot.processIds,
                    targetAdapter: options.targetAdapter,
                });
                if (
                    options.targetAdapter === 'chrome' &&
                    path.basename(executablePath).toLocaleLowerCase('en-US') !== 'chrome.exe'
                ) {
                    fail('CDP_PRODUCT_MISMATCH', 'The chrome target adapter requires the Google Chrome executable.');
                }
                return { outcome: 'success', port, rootProcessId, startedAtUtc: provisional.startedAtUtc, contract };
            } catch (error) {
                if (!rootProcessId)
                    return { outcome: 'fatal', code: error.code || 'TARGET_START_FAILED', message: error.message };
                let snapshot;
                try {
                    snapshot = await getWindowsSnapshot(rootProcessId, port);
                    if (snapshot.root?.exists)
                        provisional.startedAtUtc = validateNewRootSnapshot({
                            snapshot,
                            executablePath,
                            launchedAtUtc,
                            targetAdapter: options.targetAdapter,
                        });
                } catch {
                    snapshot = null;
                }
                let closed;
                try {
                    closed = await closeTargetGracefully(provisional, 10, false);
                } catch {
                    closed = false;
                }
                if (!closed)
                    return {
                        outcome: 'fatal',
                        code: 'ROLLBACK_CLOSE_FAILED',
                        message: `Target PID ${rootProcessId} did not close normally.`,
                        details: { rootProcessId },
                    };
                if (isVerifiedPortRace({ snapshot, failureCode: error.code })) return { outcome: 'port-race' };
                return {
                    outcome: 'fatal',
                    code: error.code || 'TARGET_LAUNCH_FAILED',
                    message: error.message,
                    details: error.details,
                };
            }
        },
    });

    let extensionsEnabled = false;
    let detached;
    try {
        if (options.enableExtensions) {
            const startHelp = await runOfficialCli(version.version, ['start', '--help']);
            const extensionHelpResults = await Promise.all(
                REQUIRED_EXTENSION_COMMANDS.map((command) => runOfficialCli(version.version, [command, '--help'])),
            );
            extensionsEnabled = resolveExtensionMode({
                requested: true,
                targetAdapter: options.targetAdapter,
                browserProduct: transaction.contract.browserProduct,
                browserMajorVersion: transaction.contract.browserMajorVersion,
                resolvedPackageVersion: version.version,
                startHelp: startHelp.stdout,
                startHelpExitCode: startHelp.exitCode,
                extensionCommandsAvailable: extensionHelpResults.every((result) => result.exitCode === 0),
            }).enabled;
        }
        detached = createSessionRecord({
            schemaVersion: SESSION_SCHEMA_VERSION,
            status: 'detached',
            targetAdapter: options.targetAdapter,
            executablePath,
            rootProcessId: transaction.rootProcessId,
            port: transaction.port,
            browserProduct: transaction.contract.browserProduct,
            browserMajorVersion: transaction.contract.browserMajorVersion,
            webSocketDebuggerUrl: transaction.contract.webSocketDebuggerUrl,
            requestedPackageSpec: options.packageSpec,
            resolvedPackageVersion: version.version,
            extensionsEnabled,
            workspaces,
            startedAtUtc: transaction.startedAtUtc,
            daemonProcessId: 0,
        });
        await writeSessionRecord(statePath, detached);
        const daemonProcessId = await startOfficialDaemon(detached, options.startupTimeoutSeconds);
        const active = createSessionRecord({ ...detached, status: 'active', daemonProcessId });
        await writeSessionRecord(statePath, active);
        return active;
    } catch (error) {
        if (detached) {
            const rollback = await rollbackManagedStart({
                statePath,
                detached,
                getDaemonStatus: getOfficialDaemonStatus,
                stopDaemon: stopOfficialDaemon,
                closeTarget: (state) => closeTargetGracefully(state, 10, false),
            });
            if (!rollback.daemonCleanupConfirmed) {
                fail(
                    'ROLLBACK_DAEMON_FAILED',
                    `Startup failed and daemon rollback could not be confirmed. The target was left open for recovery.`,
                    {
                        cause: error.message,
                        daemonCause: rollback.daemonError?.message,
                        stateCause: rollback.stateWriteError?.message,
                        daemonProcessId: rollback.recoveryState?.daemonProcessId,
                        rootProcessId: transaction.rootProcessId,
                    },
                );
            }
            if (!rollback.targetClosed) {
                fail(
                    'ROLLBACK_CLOSE_FAILED',
                    `Startup failed and target PID ${transaction.rootProcessId} did not close normally. Close it manually.`,
                    {
                        cause: error.message,
                        closeCause: rollback.closeError?.message,
                        stateCause: rollback.stateWriteError?.message,
                        rootProcessId: transaction.rootProcessId,
                    },
                );
            }
            if (rollback.stateRemoveError) {
                fail(
                    'STATE_REMOVE_FAILED_RECOVERABLE',
                    'Startup rollback closed the target and stopped the daemon, but stale state could not be removed.',
                    {
                        cause: rollback.stateRemoveError.message,
                        rootProcessId: transaction.rootProcessId,
                    },
                );
            }
            throw error;
        }
        const provisional = {
            rootProcessId: transaction.rootProcessId,
            port: transaction.port,
            executablePath,
            startedAtUtc: transaction.startedAtUtc,
        };
        let closed;
        try {
            closed = await closeTargetGracefully(provisional, 10, false);
        } catch {
            closed = false;
        }
        if (closed) await removeSessionRecord(statePath);
        if (!closed)
            fail(
                'ROLLBACK_CLOSE_FAILED',
                `Startup failed and target PID ${transaction.rootProcessId} did not close normally. Close it manually.`,
                { cause: error.message, rootProcessId: transaction.rootProcessId },
            );
        throw error;
    }
}

export async function statusManagedSession(statePath = getDefaultStatePath()) {
    let state;
    try {
        state = await readSessionRecord(statePath);
    } catch (error) {
        return { status: 'stale', targetValid: false, daemonValid: false, statePath, errorCode: error.code };
    }
    const classified = await classifyRealState(state);
    const result = { ...classified, statePath };
    if (state)
        Object.assign(result, {
            rootProcessId: state.rootProcessId,
            port: state.port,
            targetAdapter: state.targetAdapter,
            extensionsEnabled: state.extensionsEnabled,
        });
    return result;
}

export async function resumeRealSession(statePath = getDefaultStatePath()) {
    return resumeManagedSession({
        statePath,
        validateTarget: validateManagedTarget,
        inspectTarget: inspectManagedTarget,
        getDaemonStatus: getOfficialDaemonStatus,
        startDaemon: async (state) => startOfficialDaemon(state),
        validateDaemon: validateDaemonIdentity,
        stopDaemon: stopOfficialDaemon,
    });
}

export async function stopRealSession(disposition, statePath = getDefaultStatePath()) {
    if (!['Close', 'Keep'].includes(disposition)) fail('DISPOSITION_INVALID', 'Disposition must be Close or Keep.');
    const existing = await readSessionRecord(statePath);
    if (!existing) return { status: 'none', disposition };
    const targetInspection = await inspectManagedTarget(existing);
    let daemonStatus;
    try {
        daemonStatus = await getOfficialDaemonStatus(existing);
    } catch (error) {
        fail('DAEMON_IDENTITY_UNVERIFIABLE', 'The recorded daemon could not be inspected safely.', {
            cause: error.message,
        });
    }
    const daemonAction = resolveStopDaemonAction({ state: existing, status: daemonStatus, processExists });
    if (daemonAction.action === 'reject') {
        fail('DAEMON_IDENTITY_MISMATCH', 'The recorded daemon no longer matches the managed session.', {
            reason: daemonAction.reason,
        });
    }
    if (daemonAction.action === 'stop') await stopOfficialDaemon(daemonAction.state);

    const targetAction = resolveStopTargetAction(targetInspection);
    if (targetAction.action === 'remove-state') {
        try {
            await removeSessionRecord(statePath);
        } catch (error) {
            fail(
                'STATE_REMOVE_FAILED_RECOVERABLE',
                'The target and daemon are absent, but stale state could not be removed.',
                { cause: error.message },
            );
        }
        return { status: 'closed', disposition, rootProcessId: existing.rootProcessId, targetAlreadyAbsent: true };
    }
    if (targetAction.action === 'reject') {
        fail(
            'TARGET_IDENTITY_MISMATCH',
            'The target process identity cannot be confirmed. A matching daemon was stopped, but no target process was closed and state was retained.',
            {
                targetStatus: targetInspection.status,
                targetReason: targetInspection.reason,
            },
        );
    }
    return stopManagedSession({
        statePath,
        disposition,
        stopDaemon: stopOfficialDaemon,
        closeTarget: (state) => closeTargetGracefully(state, 10, targetAction.requireOwnedListener),
    });
}

export async function invokeRealTool(toolArguments, statePath = getDefaultStatePath()) {
    const state = await readSessionRecord(statePath);
    if (!state) fail('SESSION_NOT_ACTIVE', 'No managed session exists.');
    return invokeGuardedTool({
        state,
        statePath,
        toolArguments,
        validateTarget: validateManagedTarget,
        inspectTarget: inspectManagedTarget,
        getDaemonStatus: getOfficialDaemonStatus,
        stopDaemon: stopOfficialDaemon,
        validateDaemon: validateDaemonIdentity,
        runNpx: (arguments_, currentState) => invokeOfficialTool(currentState, arguments_),
    });
}

export async function executeCommand(command) {
    if (command.action === 'status') return statusManagedSession();
    return withSessionLock({}, async () => {
        if (command.action === 'invoke') return invokeRealTool(command.toolArguments);
        if (command.action === 'start') return startManagedSession(command);
        if (command.action === 'resume') return resumeRealSession();
        if (!['Close', 'Keep'].includes(command.disposition))
            fail('DISPOSITION_REQUIRED', 'Stop requires --disposition Close or --disposition Keep.');
        return stopRealSession(command.disposition);
    });
}
