import { randomUUID } from 'node:crypto';
import type { CallToolResult, ListRootsResult } from '@modelcontextprotocol/client';
import type { profileAvailable as nativeProfileAvailable } from '../../adapters/chrome-profile.ts';
import type { DataDirectoryRegistry } from '../../adapters/data-directory.ts';
import { createPortReservations } from '../../adapters/port-reservation.ts';
import { createTargetHost } from '../../adapters/target-host.ts';
import type { loadOfficialToolCatalog } from '../../adapters/tool-catalog.ts';
import { waitForClient } from '../../application/client-context.ts';
import { createLifecycleService } from '../../application/mcp-lifecycle.ts';
import type { createRegistrationRegistry } from '../../application/registrations.ts';
import type { Diagnose, Diagnostic } from '../../domains/control-contract.ts';
import {
    type ControlContext,
    type ControlHandler,
    type CoreControlRequest,
    parseConnectionRoute,
} from '../../domains/control-contract.ts';
import { RequestFailure } from '../../domains/request-failure.ts';
import type { ClientRequestContext } from '../../shared/client-context.ts';
import { isRecord } from '../../shared/errors.ts';
import { measured } from '../diagnostics.ts';
import { buildOfficialLaunchArguments } from '../official/server-launch.ts';
import type { OfficialUpstream, openOfficialUpstream } from '../official/upstream.ts';
import type { createGatewayRegistry } from '../registry.ts';
import type { createTargetLifecycle, TargetLifecycleHost, TargetLifecycleRouter } from '../targets/target-lifecycle.ts';
import { createConnectionView } from './connection-view.ts';
import type { ConnectionDirectoryLease } from './directory-lease.ts';
import type { ResourceOwner } from './resource-owner.ts';
import { createStartAdmission } from './start-admission.ts';
import type { describeWorkspacePolicy } from './workspace-policy.ts';

export type RuntimeRouter = TargetLifecycleRouter & { url: string; close(): Promise<void> };
type Controller = ReturnType<typeof createTargetLifecycle>;
export type ManagedConnection = {
    connectionId: string;
    sessionId: string;
    owner: ResourceOwner;
    logicalOwner: ResourceOwner;
    officialOwner: ResourceOwner;
    restartScope?: import('../../domains/control-contract.ts').RestartScope;
    directory: ConnectionDirectoryLease;
    controller: Controller;
    router: RuntimeRouter;
    upstream?: OfficialUpstream;
    mcpArgs: string[];
    roots: ListRootsResult;
    rootsNegotiated: boolean;
    officialEnvironment: NodeJS.ProcessEnv;
    workspace: ReturnType<typeof describeWorkspacePolicy>;
    establishedAt?: number;
    lastRealOperationAt?: number;
    executionContext?: ClientRequestContext;
    executionFacilityFailure?: RequestFailure;
    activeCalls: number;
    diagnostics: (Diagnostic & { sessionId: string })[];
    diagnose: Diagnose;
    quarantined: boolean;
    quarantine?: Promise<boolean>;
};
export function createManagedConnections({
    entryId,
    timestamp,
    runtimeLocation,
    dataDirectories,
    profileAvailable,
    createRouter,
    createHost,
    createConnection,
    registrations,
    registry,
    readCatalog,
}: {
    entryId: string;
    timestamp: () => number;
    runtimeLocation: Readonly<{ nodeExecutable: string; bin: string }> | undefined;
    dataDirectories: DataDirectoryRegistry;
    profileAvailable: typeof nativeProfileAvailable;
    createRouter: (options?: { diagnose?: Diagnose }) => Promise<RuntimeRouter>;
    createHost: (() => TargetLifecycleHost) | undefined;
    createConnection: typeof openOfficialUpstream;
    registrations: Pick<
        ReturnType<typeof createRegistrationRegistry>,
        'check' | 'touch' | 'authorize' | 'beginJob' | 'resolve' | 'transfer'
    >;
    registry: Pick<
        ReturnType<typeof createGatewayRegistry>,
        | 'retryDirectory'
        | 'newOwner'
        | 'selected'
        | 'routed'
        | 'disposeResources'
        | 'trackRetirement'
        | 'closing'
        | 'admissionSignal'
        | 'cleanupState'
        | 'enrollDirectory'
        | 'publishConnection'
        | 'removeConnection'
        | 'observeExit'
        | 'trackStart'
        | 'trackReplacement'
        | 'connectionReferences'
        | 'registrationPrincipal'
        | 'adoptTransferredPrincipal'
    >;
    readCatalog: () => Awaited<ReturnType<typeof loadOfficialToolCatalog>> | undefined;
}) {
    const { retryDirectory, newOwner, selected, routed, disposeResources } = registry;
    const portReservations = createPortReservations();
    const makeHost = createHost ?? (() => createTargetHost({ portReservations }));
    const { statusOf, summary, status, projectControlResult, connections } = createConnectionView({
        registry,
        readCatalog,
    });
    async function closeUpstream(connection: ManagedConnection, owner = connection.officialOwner) {
        if (connection.officialOwner === owner) delete connection.upstream;
        try {
            await owner.closeResource('upstream');
        } finally {
            if (connection.officialOwner === owner) delete connection.upstream;
        }
    }
    async function ensureUpstream(connection: ManagedConnection, context: ControlContext = {}) {
        if (connection.upstream) return;
        if (connection.officialOwner.retired) connection.officialOwner = newOwner(randomUUID(), connection.directory);
        const owner = connection.officialOwner;
        owner.assertOpen();
        const args = buildOfficialLaunchArguments(
            connection.router.url,
            connection.officialEnvironment,
            connection.mcpArgs,
        );
        connection.mcpArgs = args.slice(1);
        const signal = context.signal ? AbortSignal.any([owner.signal, context.signal]) : owner.signal;
        const acquiring = createConnection(connection.router.url, {
            ...runtimeLocation,
            args,
            environment: connection.officialEnvironment,
            signal,
            validateTools: (tools) => {
                const fullCatalog = readCatalog();
                if (!fullCatalog) throw new Error('Missing fixed tool catalog.');
                fullCatalog.validate(tools);
            },
            diagnose: (event) => {
                if (connection.officialOwner === owner && !owner.retired) connection.diagnose(event);
            },
            onAcquired: (resource) => owner.register('upstream', resource),
            roots: async () => structuredClone(connection.roots),
            elicitation: {
                form: true,
                request: async (params, incoming) => {
                    owner.assertOpen();
                    const origin = connection.executionContext;
                    if (!origin) throw new RequestFailure('CLIENT_CONTEXT_UNAVAILABLE');
                    try {
                        return await origin.elicit(params, AbortSignal.any([incoming, owner.signal]));
                    } catch (error) {
                        // The official SDK round trip erases local error types. Retain only a
                        // closed local facility reason on this same owned execution, never raw
                        // upstream text/data or another request's context.
                        if (error instanceof RequestFailure && connection.executionContext === origin)
                            connection.executionFacilityFailure = error;
                        throw error;
                    }
                },
            },
        });
        const upstream = await owner.track(acquiring);
        if (!owner.hasResource('upstream')) owner.register('upstream', upstream);
        if (connection.officialOwner !== owner || owner.retired || signal.aborted || registry.closing) {
            owner.retire(new Error('The official connection acquisition belongs to a retired session.'));
            await owner.closeResource('upstream');
            throw new Error('The target exited or its official connection acquisition was cancelled.');
        }
        const fullCatalog = readCatalog();
        if (!fullCatalog) throw new Error('Missing fixed tool catalog.');
        try {
            fullCatalog.validate(upstream.tools);
        } catch (error) {
            await owner.closeResource('upstream');
            throw error;
        }
        owner.assertOpen();
        connection.upstream = upstream;
        upstream.onExit(() => {
            if (connection.officialOwner !== owner || owner.retired || connection.upstream !== upstream) return;
            delete connection.upstream;
            connection.controller.officialDisconnected();
        });
    }
    const start = createStartAdmission({
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
    });
    const handler: ControlHandler = {
        status,
        start: (options, context) => {
            const job = start(options, context, lifecycle);
            return registry.trackStart(job);
        },
        restart: (request, context = {}) => {
            const job = (async () => {
                if (registry.closing) throw new Error('The gateway is closing.');
                const connection = routed(request);
                if (connection.activeCalls > 0) throw new RequestFailure('CONNECTION_BUSY');
                connection.lastRealOperationAt = timestamp();
                connection.owner.expectedOperationId = context.operationId;
                if (request.scope === undefined || !['target', 'official', 'both'].includes(request.scope))
                    throw new Error('An explicit target, official or both restart scope is required.');
                if (Object.hasOwn(request, 'mcpArgs'))
                    throw new Error('Restart cannot replace mcpArgs; Close and start a new connection.');
                const releaseSuccessor = connection.directory.holdSuccessor();
                connection.restartScope = request.scope;
                try {
                    if (connection.restartScope === 'official') {
                        connection.router.pause?.();
                        connection.officialOwner.retire(new Error('The official generation is restarting.'));
                        await closeUpstream(connection);
                        await ensureUpstream(connection, context);
                        const sessionId = randomUUID();
                        connection.controller.replaceOfficialSession(sessionId);
                        connection.sessionId = sessionId;
                        context.onIdentity?.({ connectionId: request.connectionId, sessionId });
                        return { ...summary(connection), pageIdsInvalidated: true };
                    }
                    const result = await connection.controller.restart(request, {
                        ...context,
                        ...(connection.directory.path === undefined
                            ? {}
                            : { dataDirectory: connection.directory.path }),
                        onSession: (sessionId) => {
                            connection.sessionId = sessionId;
                            context.onIdentity?.({ connectionId: request.connectionId, sessionId });
                        },
                    });
                    return { ...summary(connection), ...result, connectionId: request.connectionId };
                } catch (error) {
                    connection.directory.requestRelease();
                    if (request.scope === 'official') {
                        delete connection.restartScope;
                        try {
                            await connection.controller.cleanup('rollback');
                        } catch {
                            /* Retained failed disposal remains owned for explicit cleanup retry. */
                        }
                    }
                    const owner = connection.owner;
                    if (!owner.target || owner.exited) {
                        connection.logicalOwner.retire(error);
                        connection.officialOwner.retire(error);
                        delete connection.upstream;
                        await Promise.allSettled([
                            disposeResources(connection.officialOwner),
                            disposeResources(connection.logicalOwner),
                        ]);
                    }
                    if (!owner.target || owner.exited) {
                        owner.retire(error);
                        try {
                            await disposeResources(owner);
                        } catch {
                            /* The original disposal error remains in the owned cleanup ledger. */
                        }
                    }
                    if (connection.owner.retired || connection.controller.status().status === 'idle')
                        registry.removeConnection(request.connectionId);
                    throw error;
                } finally {
                    delete connection.restartScope;
                    releaseSuccessor();
                    await retryDirectory(connection.directory).catch(() => {});
                }
            })();
            return registry.trackReplacement(job);
        },
        stop: async (request, context = {}) => {
            const connection = routed(request);
            connection.lastRealOperationAt = timestamp();
            connection.owner.expectedOperationId = context.operationId;
            if (request.disposition === 'Close') connection.directory.requestRelease();
            const result = await connection.controller.stop(request, context);
            if (request.disposition === 'Close') {
                registry.removeConnection(request.connectionId, connection);
                await retryDirectory(connection.directory);
            }
            return {
                ...result,
                connectionId: connection.connectionId,
                enabledToolCount: request.disposition === 'Close' ? 0 : (summary(connection).enabledToolCount ?? 0),
                upstreamStatus:
                    request.disposition === 'Close'
                        ? 'disconnected'
                        : (summary(connection).upstreamStatus ?? 'disconnected'),
            };
        },
    };
    const lifecycle = createLifecycleService({
        entryId,
        handler,
        authorize: registrations.authorize,
        beginJob: registrations.beginJob,
    });
    function lifecycleResult(details: Record<string, unknown>): CallToolResult {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(details) }],
            structuredContent: details,
        };
    }
    async function control(
        request: import('../../domains/control-contract.ts').ControlRequest,
        signal?: AbortSignal,
        client?: ClientRequestContext,
    ): Promise<Record<string, unknown>> {
        if (client) registrations.check(client.principal);
        const result = await performControl(request, signal, client);
        if (client) {
            registrations.touch(client.principal);
            if (Array.isArray(result.connections))
                return {
                    ...result,
                    connections: result.connections.filter((item: unknown) => {
                        if (!isRecord(item) || typeof item.connectionId !== 'string') return false;
                        try {
                            registrations.authorize(item.connectionId, client.principal);
                            return true;
                        } catch {
                            return false;
                        }
                    }),
                };
        }
        return result;
    }
    async function performControl(
        request: import('../../domains/control-contract.ts').ControlRequest,
        signal?: AbortSignal,
        client?: ClientRequestContext,
    ): Promise<Record<string, unknown>> {
        if (client) registrations.check(client.principal);
        const result = await lifecycle.control(request, signal, client);
        return projectControlResult(request, result);
    }
    async function invoke(
        name: string,
        arguments_: Record<string, unknown>,
        signal: AbortSignal,
        onProgress: (progress: import('@modelcontextprotocol/client').Progress) => void,
        client?: ClientRequestContext,
    ): Promise<CallToolResult> {
        if (registry.closing) throw new RequestFailure('APP_CLOSING');
        signal.throwIfAborted();
        const route = parseConnectionRoute(arguments_._dct);
        if (client) {
            registrations.check(client.principal);
            registrations.authorize(route.connectionId, client.principal);
        }
        const connection = routed(route);
        if (connection.activeCalls > 0 || lifecycle.isBusy(connection.connectionId))
            throw new RequestFailure('CONNECTION_BUSY');
        const owner = connection.owner;
        connection.activeCalls += 1;
        connection.lastRealOperationAt = timestamp();
        if (client) connection.executionContext = client;
        const execution = (async () => {
            // Last-known absence is not a current configuration fact until metadata admission settles.
            await connection.upstream?.ensureToolCatalog?.();
            owner.assertOpen();
            routed(route);
            if (connection.upstream && !connection.upstream.tools.some((tool) => tool.name === name))
                return lifecycleResult({
                    code: 'TOOL_NOT_ENABLED',
                    ...route,
                    ...readCatalog()?.requirements(name, connection.mcpArgs, true),
                    nextAction: 'close-and-new-start',
                });
            const healthTiming = measured(connection.diagnose, 'connection-health');
            await connection.controller.checkHealth();
            healthTiming();
            owner.assertOpen();
            routed(route);
            const current = summary(connection);
            const upstream = connection.upstream;
            if (!connection.controller.canInvoke() || !upstream)
                return lifecycleResult({
                    ...current,
                    reason: current.reason ?? 'target-not-ready',
                    nextAction: 'inspect-connection-error',
                });
            const { _dct: routing, ...upstreamArguments } = arguments_;
            void routing;
            const timing = measured(connection.diagnose, 'upstream-processing');
            try {
                const result = await upstream.call(name, upstreamArguments, owner.signal, (progress) => {
                    if (
                        !signal.aborted &&
                        connection.owner === owner &&
                        !owner.retired &&
                        connection.upstream === upstream
                    )
                        onProgress(progress);
                });
                owner.assertOpen();
                routed(route);
                timing();
                measured(connection.diagnose, 'result-ready')();
                if (client) registrations.touch(client.principal);
                return result;
            } catch (error) {
                timing('failed');
                throw connection.executionFacilityFailure ?? error;
            }
        })().finally(() => {
            connection.activeCalls -= 1;
            delete connection.executionContext;
            delete connection.executionFacilityFailure;
        });
        owner.track(execution);
        return waitForClient(execution, signal);
    }
    function transfer(connectionId: string, registrationId: string) {
        const principal = registrations.resolve(registrationId);
        const connection = selected(connectionId);
        registrations.transfer(
            connectionId,
            principal,
            () =>
                registry.cleanupState !== 'open' ||
                lifecycle.isBusy(connectionId) ||
                connection.activeCalls > 0 ||
                connection.owner.hasPendingWork() ||
                [connection.owner, connection.officialOwner, connection.logicalOwner].some(
                    (owner) => owner.isCleaning() || owner.hasFailedDisposal(),
                ),
        );
        registry.adoptTransferredPrincipal(connectionId, principal);
    }
    function adminControl(request: CoreControlRequest) {
        if (request.action === 'start') return Promise.reject(new Error('Administration cannot create targets.'));
        return performControl(request);
    }
    return { handler, lifecycle, control, invoke, status, transfer, connections, adminControl };
}
