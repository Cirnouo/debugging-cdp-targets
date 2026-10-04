import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ConnectionStatus, ControlRequest, ControlResult } from '../../src/domains/control-contract.ts';
import { validateIdentity } from '../../src/domains/control-contract.ts';
import { DetailedError, errorMessage, isRecord } from '../../src/shared/errors.ts';

export async function closeSmokeConnection(
    control: (request: ControlRequest) => Promise<ControlResult>,
    request: Extract<ControlRequest, { action: 'stop' }> & { disposition: 'Close' },
    dependencies: { now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {},
): Promise<ControlResult> {
    const now = dependencies.now ?? Date.now;
    const sleep = dependencies.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const deadline = now() + (dependencies.timeoutMs ?? 10_000);
    let selected = request;
    for (;;) {
        try {
            return await control(selected);
        } catch (error) {
            if (errorMessage(error) !== 'CDP is busy; retry after the current request completes.' || now() >= deadline)
                throw error;
            await sleep(Math.min(200, deadline - now()));
            if (now() >= deadline) throw error;
            selected = { ...request, requestId: randomUUID() };
        }
    }
}

export function readConnection(value: unknown): ConnectionStatus {
    assert.ok(isRecord(value));
    validateIdentity(value.entryId, 'entry ID');
    validateIdentity(value.connectionId, 'connection ID');
    if (value.sessionId !== undefined) validateIdentity(value.sessionId, 'session ID');
    const status = value.status;
    assert.ok(
        status === 'idle' ||
            status === 'starting' ||
            status === 'active' ||
            status === 'lost' ||
            status === 'closing' ||
            status === 'close-failed',
    );
    assert.ok(value.targetKind === undefined || value.targetKind === 'chrome' || value.targetKind === 'generic-cdp');
    assert.ok(value.processId === undefined || typeof value.processId === 'number');
    assert.ok(value.port === undefined || typeof value.port === 'number');
    assert.ok(value.taskActive === undefined || typeof value.taskActive === 'boolean');
    assert.ok(value.pageIdsInvalidated === undefined || typeof value.pageIdsInvalidated === 'boolean');
    return {
        entryId: value.entryId,
        connectionId: value.connectionId,
        status,
        ...(value.sessionId ? { sessionId: value.sessionId } : {}),
        ...(value.targetKind ? { targetKind: value.targetKind } : {}),
        ...(value.processId === undefined ? {} : { processId: value.processId }),
        ...(value.port === undefined ? {} : { port: value.port }),
        ...(value.taskActive === undefined ? {} : { taskActive: value.taskActive }),
        ...(value.pageIdsInvalidated === undefined ? {} : { pageIdsInvalidated: value.pageIdsInvalidated }),
    };
}
export function readStatus(value: unknown): ControlResult {
    assert.ok(isRecord(value));
    validateIdentity(value.entryId, 'entry ID');
    if (!('connections' in value)) return readConnection(value);
    assert.ok(Array.isArray(value.connections));
    return { entryId: value.entryId, connections: value.connections.map(readConnection) };
}
export function lifecycleClient(
    tool: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
    return async (request: ControlRequest): Promise<ControlResult> => {
        const { action, ...args } = request;
        const name = `dct_connection_${action.replace('-', '_')}`;
        const response = await tool(name, args);
        if (action === 'status') return readStatus(response.structuredContent);
        const accepted = response.structuredContent;
        assert.ok(isRecord(accepted));
        validateIdentity(accepted.operationId, 'operation ID');
        let cursor = 0;
        for (;;) {
            const response = await tool('dct_operation_wait', {
                entryId: request.entryId,
                operationId: accepted.operationId,
                cursor,
            });
            const waited = response.structuredContent;
            assert.ok(isRecord(waited) && isRecord(waited.operation) && typeof waited.cursor === 'number');
            cursor = waited.cursor;
            if (!waited.complete) continue;
            if (waited.operation.state !== 'succeeded') {
                const details = waited.operation.error;
                const failure = new DetailedError(
                    isRecord(details) && typeof details.message === 'string'
                        ? details.message
                        : 'Lifecycle operation did not succeed.',
                );
                failure.details = waited.operation;
                throw failure;
            }
            return readConnection(waited.operation.result);
        }
    };
}
