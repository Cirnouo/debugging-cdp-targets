import type { ConnectionStatus, ControlContext, ControlHandler, ControlRequest } from '../domains/control-contract.ts';
import { createOperationRegistry } from './operations.ts';

export function createLifecycleService({ entryId, handler }: { entryId: string; handler: ControlHandler }) {
    const operations = createOperationRegistry(entryId);
    const changing = new Set<string>();
    let closing = false;
    async function control(request: ControlRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
        if (request.entryId !== undefined && request.entryId !== entryId)
            throw new Error('This request identifies another entry.');
        if (request.action === 'status') {
            if (request.operationId) return { ...operations.get(request.operationId) };
            return { ...handler.status(request.connectionId) };
        }
        if (request.action === 'wait') return operations.wait(request.operationId, request.cursor, signal);
        if (request.action === 'cancel') return { ...operations.cancel(request.operationId) };
        const prior = operations.prior(request.requestId, request);
        if (prior) return { ...prior };
        if (closing) throw new Error('The gateway is closing.');
        const connectionId = request.action === 'start' ? undefined : request.connectionId;
        if (request.action !== 'start') {
            const current = handler.status(request.connectionId);
            if (!('sessionId' in current) || current.sessionId !== request.sessionId)
                throw new Error('The target session is absent or stale.');
            if (changing.has(request.connectionId))
                throw new Error('A lifecycle operation is already running for this connection.');
            changing.add(request.connectionId);
        }
        let boundConnection = connectionId;
        const accepted = operations.submit(
            request.requestId,
            request,
            async (operation) => {
                const context: ControlContext = {
                    signal: operation.signal,
                    onPhase: operation.phase,
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
                    else if (request.action === 'stop') result = await handler.stop(request, context);
                    else result = await handler.endTask(request);
                    if (result.sessionId)
                        operation.identity({ connectionId: result.connectionId, sessionId: result.sessionId });
                    if (operation.signal.aborted && (request.action === 'start' || request.action === 'restart')) {
                        if (result.sessionId) {
                            operation.phase('cancelling-created-target');
                            await handler.stop({
                                connectionId: result.connectionId,
                                sessionId: result.sessionId,
                                disposition: 'Close',
                            });
                        }
                        throw operation.signal.reason;
                    }
                    return { ...result };
                }
            },
            () => {
                if (boundConnection) changing.delete(boundConnection);
            },
        );
        return { ...accepted };
    }
    return {
        control,
        takeNotices: operations.takeNotices,
        async close() {
            closing = true;
            await operations.close();
        },
    };
}
