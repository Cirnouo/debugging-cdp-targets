import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { profileAvailable as nativeProfileAvailable } from '../../adapters/chrome-profile.ts';
import type { DataDirectoryRegistry } from '../../adapters/data-directory.ts';
import { emitFixtureEvent } from '../../adapters/fixture-diagnostics.ts';
import { waitForClient } from '../../application/client-context.ts';
import type { createLifecycleService } from '../../application/mcp-lifecycle.ts';
import type { createRegistrationRegistry } from '../../application/registrations.ts';
import {
    type ConnectionStatus,
    type ControlContext,
    connectionSummary,
    type Diagnose,
    type Diagnostic,
    lifecycleFailureEvidence,
} from '../../domains/control-contract.ts';
import { DEFAULT_BASE_PORT } from '../../shared/constants.ts';
import { DetailedError, errorCode, errorDetails, errorMessage } from '../../shared/errors.ts';
import {
    buildOfficialLaunchArguments,
    captureOfficialServerEnvironment,
    resolveVerifiedOfficialServerBin,
} from '../official/server-launch.ts';
import { openOfficialUpstream } from '../official/upstream.ts';
import type { createGatewayRegistry } from '../registry.ts';
import { parseDataIsolation } from '../targets/model/isolation.ts';
import {
    bindPreparedLaunch,
    prepareLaunchDefinition,
    validateDataIsolationBinding,
} from '../targets/model/launch-command.ts';
import { createTargetLifecycle, type TargetLifecycleHost } from '../targets/target-lifecycle.ts';
import type { createConnectionView } from './connection-view.ts';
import { createConnectionDirectoryLease } from './directory-lease.ts';
import type { ManagedConnection, RuntimeRouter } from './managed-connection.ts';
import type { ResourceOwner } from './resource-owner.ts';
import { describeWorkspacePolicy } from './workspace-policy.ts';

type Controller = ReturnType<typeof createTargetLifecycle>;

export function createStartAdmission({
    entryId,
    timestamp,
    runtimeLocation,
    dataDirectories,
    profileAvailable,
    createRouter,
    createConnection,
    makeHost,
    registrations,
    registry,
    ensureUpstream,
    closeUpstream,
    statusOf,
    summary,
}: {
    entryId: string;
    timestamp: () => number;
    runtimeLocation: Readonly<{ nodeExecutable: string; bin: string }> | undefined;
    dataDirectories: DataDirectoryRegistry;
    profileAvailable: typeof nativeProfileAvailable;
    createRouter: (options?: { diagnose?: Diagnose }) => Promise<RuntimeRouter>;
    createConnection: typeof openOfficialUpstream;
    makeHost: () => TargetLifecycleHost;
    registrations: Pick<ReturnType<typeof createRegistrationRegistry>, 'check'>;
    registry: Pick<
        ReturnType<typeof createGatewayRegistry>,
        | 'retryDirectory'
        | 'newOwner'
        | 'disposeResources'
        | 'trackRetirement'
        | 'closing'
        | 'admissionSignal'
        | 'enrollDirectory'
        | 'publishConnection'
        | 'removeConnection'
        | 'observeExit'
    >;
    ensureUpstream: (connection: ManagedConnection, context?: ControlContext) => Promise<void>;
    closeUpstream: (connection: ManagedConnection, owner?: ResourceOwner) => Promise<void>;
    statusOf: ReturnType<typeof createConnectionView>['statusOf'];
    summary: ReturnType<typeof createConnectionView>['summary'];
}) {
    const { retryDirectory, newOwner, disposeResources, trackRetirement } = registry;
    async function start(
        options: Parameters<Controller['start']>[0],
        context: ControlContext = {},
        lifecycle: ReturnType<typeof createLifecycleService>,
    ): Promise<ConnectionStatus> {
        if (registry.closing) throw new Error('The gateway is closing.');
        const principal = context.client?.principal;
        if (!principal) throw new Error('Start requires an authenticated originating client.');
        registrations.check(principal);
        context.signal?.throwIfAborted();
        const admissionSignal = context.signal
            ? AbortSignal.any([registry.admissionSignal, context.signal])
            : registry.admissionSignal;
        options = structuredClone(options);
        const ambient = { ...process.env };
        const officialEnvironment = captureOfficialServerEnvironment(ambient);
        const temporaryDirectory = os.tmpdir();
        options.preparedLaunch = prepareLaunchDefinition(
            options.launch,
            options.basePort ?? DEFAULT_BASE_PORT,
            ambient,
            process.platform === 'win32',
        );
        const roots = context.client
            ? await waitForClient(context.client.readRoots(admissionSignal), admissionSignal)
            : { roots: [] };
        admissionSignal.throwIfAborted();
        const isolation = parseDataIsolation(options.isolation);
        validateDataIsolationBinding(options.launch, isolation.mode, ambient, process.platform === 'win32');
        const host = makeHost();
        host.validateLaunch?.(options);
        if (isolation.mode === 'data-dir') {
            const prepared = options.preparedLaunch;
            const parsed = bindPreparedLaunch(
                prepared,
                prepared.portPolicy.kind === 'fixed' ? prepared.portPolicy.port : prepared.portPolicy.basePort,
                '{dataDir}',
            );
            if (!path.isAbsolute(parsed.executablePath) || (parsed.cwd !== undefined && !path.isAbsolute(parsed.cwd)))
                throw new Error('Application executable and working directory must be absolute.');
        }
        const connectionId = randomUUID();
        const sessionId = randomUUID();
        const initialArgs = buildOfficialLaunchArguments('http://127.0.0.1:1', ambient, options.mcpArgs).slice(1);
        const directory = createConnectionDirectoryLease(
            dataDirectories,
            isolation,
            context.onIsolation,
            options.targetKind === 'chrome' ? profileAvailable : undefined,
        );
        registry.enrollDirectory(connectionId, principal, directory);
        const owner = newOwner(randomUUID(), directory);
        const logicalOwner = newOwner(randomUUID(), directory);
        const officialOwner = newOwner(randomUUID(), directory);
        owner.expectedOperationId = context.operationId;
        let connection: ManagedConnection | undefined;
        const diagnostics: (Diagnostic & { sessionId: string })[] = [];
        function diagnoseFor(selectedOwner: ResourceOwner): Diagnose {
            return (event) => {
                if (selectedOwner.retired || (connection && connection.owner !== selectedOwner)) return;
                diagnostics.push({ ...event, sessionId: selectedOwner.sessionId });
                if (diagnostics.length > 64) diagnostics.shift();
            };
        }
        try {
            context.onIdentity?.({ connectionId, sessionId });
            context.onPhase?.('validating-official-server');
            if (createConnection === openOfficialUpstream && !runtimeLocation) await resolveVerifiedOfficialServerBin();
            context.signal?.throwIfAborted();
            if (registry.closing) throw new Error('The gateway is closing.');
            context.onPhase?.('acquiring-data-directory');
            await directory.acquire();
            context.signal?.throwIfAborted();
            if (registry.closing) throw new Error('The gateway is closing.');
            const diagnose = diagnoseFor(owner);
            context.onPhase?.('creating-router');
            const router = await createRouter({ diagnose });
            logicalOwner.register('router', router);
            context.signal?.throwIfAborted();
            if (registry.closing) throw new Error('The gateway is closing.');
            const managed: ManagedConnection = {
                connectionId,
                sessionId,
                owner,
                logicalOwner,
                officialOwner,
                directory,
                router,
                diagnostics,
                diagnose,
                mcpArgs: initialArgs,
                roots: structuredClone(roots),
                rootsNegotiated: context.client?.capabilities.roots ?? false,
                officialEnvironment,
                workspace: describeWorkspacePolicy(
                    initialArgs,
                    context.client?.capabilities.roots ?? false,
                    temporaryDirectory,
                ),
                activeCalls: 0,
                quarantined: false,
                controller: createTargetLifecycle({
                    entryId,
                    host,
                    router: {
                        setTarget: (target) => managed.router.setTarget(target),
                        clearTarget: () => managed.router.clearTarget(),
                        isBusy: () => managed.router.isBusy(),
                        pause: () => managed.router.pause?.(),
                        resume: () => managed.router.resume?.(),
                    },
                    createOwner: async () => {
                        if (!managed.owner.target && !managed.owner.retired) return managed.owner;
                        const replacement = newOwner(randomUUID(), directory);
                        managed.owner = replacement;
                        delete managed.quarantine;
                        managed.quarantined = false;
                        managed.diagnose = diagnoseFor(replacement);
                        replacement.assertOpen();
                        return replacement;
                    },
                    onProcessExit: (event) => registry.observeExit(managed, event, lifecycle),
                    onObservationFailure: (id) => {
                        if (managed.owner.sessionId !== id) return;
                        managed.quarantined = true;
                        trackRetirement(closeUpstream(managed));
                    },
                    server: {
                        ensure: (_options, context) => ensureUpstream(managed, context),
                        close: async (selectedOwner = managed.owner) => {
                            const errors: unknown[] = [];
                            async function disposeSide(owner: ResourceOwner) {
                                try {
                                    await disposeResources(owner);
                                } catch (error) {
                                    errors.push(error);
                                }
                            }
                            if (managed.restartScope !== 'target') {
                                managed.officialOwner.retire(new Error('The official generation is closing.'));
                                delete managed.upstream;
                                await disposeSide(managed.officialOwner);
                            }
                            if (!managed.restartScope) {
                                managed.logicalOwner.retire(new Error('The connection is closing.'));
                                await disposeSide(managed.logicalOwner);
                            }
                            await disposeSide(selectedOwner);
                            if (errors.length === 1) throw errors[0];
                            if (errors.length) throw new AggregateError(errors, 'Connection resource disposal failed.');
                        },
                    },
                }),
            };
            connection = managed;
            registry.publishConnection(connectionId, managed);
            await managed.controller.start(options, sessionId, {
                ...context,
                ...(directory.path === undefined ? {} : { dataDirectory: directory.path }),
            });
            managed.owner.assertOpen();
            managed.establishedAt = timestamp();
            managed.lastRealOperationAt = managed.establishedAt;
            return summary(managed);
        } catch (error) {
            const primaryEvidence = {
                ...lifecycleFailureEvidence(errorDetails(error) ?? {}),
                ...(errorCode(error) === undefined ? {} : { code: errorCode(error) }),
            };
            directory.requestRelease();
            const managed = connection;
            const failedOwner = managed?.owner ?? owner;
            if (!failedOwner.target || failedOwner.exited) {
                failedOwner.retire(error);
                try {
                    const cleanup = await Promise.allSettled([
                        disposeResources(failedOwner),
                        disposeResources(officialOwner),
                        disposeResources(logicalOwner),
                    ]);
                    const failure = cleanup.find((result) => result.status === 'rejected');
                    if (failure?.status === 'rejected') throw failure.reason;
                } catch (cleanupError) {
                    emitFixtureEvent('resource-disposal', 'decision', { outcome: 'failed' }, cleanupError);
                    const failure = new DetailedError(errorMessage(error), { cause: error });
                    failure.details = {
                        ...primaryEvidence,
                        entryId,
                        connectionId,
                        sessionId: connection?.sessionId ?? sessionId,
                        cleanupError: errorMessage(cleanupError),
                    };
                    registry.removeConnection(connectionId);
                    throw failure;
                }
                registry.removeConnection(connectionId);
            }
            if (
                context.signal?.aborted &&
                error === context.signal.reason &&
                (!failedOwner.target || failedOwner.exited)
            )
                throw context.signal.reason;
            const failure = new DetailedError(errorMessage(error), { cause: error });
            failure.details = {
                ...primaryEvidence,
                entryId,
                connectionId,
                sessionId: connection?.sessionId ?? sessionId,
                ...(managed ? connectionSummary(statusOf(managed)) : {}),
                processExited: failedOwner.exited,
            };
            throw failure;
        } finally {
            await retryDirectory(directory).catch(() => {});
        }
    }
    return start;
}
