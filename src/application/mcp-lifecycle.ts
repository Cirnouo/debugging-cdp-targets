import {
    type ConnectionStatus,
    type ControlContext,
    type ControlHandler,
    type ControlRequest,
    connectionSummary,
} from '../domains/control-contract.ts';
import { RequestFailure } from '../domains/request-failure.ts';
import type { ClientPrincipal, ClientRequestContext } from '../shared/client-context.ts';
import { createOperationRegistry } from './operations.ts';

export function createLifecycleService({
    entryId,
    handler,
    authorize,
    beginJob,
}: {
    entryId: string;
    handler: ControlHandler;
    authorize?: (connectionId: string, principal: ClientPrincipal) => void;
    beginJob?: (principal: ClientPrincipal) => () => void;
}) {
    const operations = createOperationRegistry(entryId);
    const changing = new Set<string>();
    let closing = false;
    async function control(
        request: ControlRequest,
        signal?: AbortSignal,
        client?: ClientRequestContext,
    ): Promise<Record<string, unknown>> {
        const ownerId = client?.principal.registrationId;
        if (request.action === 'status' && request.connectionId && client)
            authorize?.(request.connectionId, client.principal);
        if (request.action === 'status') {
            if (request.operationId) {
                const result = operations.get(request.operationId, ownerId);
                signal?.throwIfAborted();
                return { ...result };
            }
            return { ...handler.status(request.connectionId) };
        }
        if (request.action === 'wait') {
            const result = await operations.wait(request.operationId, request.cursor, signal, ownerId);
            signal?.throwIfAborted();
            return result;
        }
        if (request.action === 'cancel') {
            const result = operations.cancel(request.operationId, ownerId);
            signal?.throwIfAborted();
            return { ...result };
        }
        const prior = operations.prior(request.requestId, request, ownerId);
        if (prior) {
            signal?.throwIfAborted();
            return { ...prior };
        }
        if (closing) throw new RequestFailure('APP_CLOSING');
        if (request.action !== 'start' && client) authorize?.(request.connectionId, client.principal);
        const connectionId = request.action === 'start' ? undefined : request.connectionId;
        if (request.action !== 'start') {
            const current = handler.status(request.connectionId);
            if (!('sessionId' in current) || current.sessionId !== request.sessionId)
                throw new Error('The target session is absent or stale.');
            if (changing.has(request.connectionId)) throw new RequestFailure('CONNECTION_BUSY');
            changing.add(request.connectionId);
        }
        let boundConnection = connectionId;
        const finishJob = client ? beginJob?.(client.principal) : undefined;
        const accepted = operations.submit(
            request.requestId,
            request,
            async (operation) => {
                const context: ControlContext = {
                    ...(client ? { client } : {}),
                    operationId: operation.operationId,
                    signal: operation.signal,
                    onPhase: operation.phase,
                    onIsolation: operation.isolation,
                    onIdentity: (route) => {
                        boundConnection = route.connectionId;
                        changing.add(route.connectionId);
                        operation.identity(route);
                    },
                };
                {
                    if (request.action !== 'start') operation.identity(request);
                    let result: ConnectionStatus;
                    if (request.action === 'start') result = await handler.start(request, context);
                    else if (request.action === 'restart') result = await handler.restart(request, context);
                    else result = await handler.stop(request, context);
                    if (result.sessionId)
                        operation.identity({ connectionId: result.connectionId, sessionId: result.sessionId });
                    if (operation.signal.aborted && (request.action === 'start' || request.action === 'restart')) {
                        if (result.sessionId) {
                            operation.phase('cancelling-created-target');
                            await handler.stop(
                                {
                                    connectionId: result.connectionId,
                                    sessionId: result.sessionId,
                                    disposition: 'Close',
                                },
                                { operationId: operation.operationId },
                            );
                        }
                        throw operation.signal.reason;
                    }
                    return { ...connectionSummary(result) };
                }
            },
            () => {
                if (boundConnection) changing.delete(boundConnection);
                finishJob?.();
            },
            request.action === 'start' ? undefined : request,
            ownerId,
        );
        return { ...accepted };
    }
    return {
        control,
        list: operations.list,
        isBusy: (connectionId: string) => changing.has(connectionId),
        forgetOwner: operations.forgetOwner,
        cancelRoute: operations.cancelRoute,
        async close() {
            closing = true;
            await operations.close();
        },
    };
}
