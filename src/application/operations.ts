import { createHash, randomUUID } from 'node:crypto';
import { type ConnectionRoute, lifecycleFailureEvidence } from '../domains/control-contract.ts';
import { errorCode, errorDetails, errorMessage, isRecord } from '../shared/errors.ts';

type State = 'accepted' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';
export interface OperationSnapshot {
    entryId: string;
    operationId: string;
    requestId: string;
    action?: string;
    state: State;
    cursor: number;
    phase: string;
    elapsedMs: number;
    connectionId?: string;
    sessionId?: string;
    result?: Record<string, unknown>;
    error?: Record<string, unknown> & { message: string };
}
export interface OperationNotice {
    kind: 'operation';
    entryId: string;
    operationId: string;
    action?: string;
    state: State;
    phase: string;
    elapsedMs: number;
    connectionId?: string;
    sessionId?: string;
    code?: string;
    category?: string;
    nativeError?: number;
    exceptionType?: string;
    closeRequested?: boolean;
    processExited?: boolean;
    listenerState?: string;
    closeConfirmed?: boolean;
}
export interface OperationContext {
    operationId: string;
    signal: AbortSignal;
    phase(value: string): void;
    identity(value: ConnectionRoute): void;
}
type Event = Pick<OperationSnapshot, 'cursor' | 'state' | 'phase' | 'elapsedMs' | 'connectionId' | 'sessionId'>;
type Operation = {
    snapshot: OperationSnapshot;
    started: number;
    abort: AbortController;
    events: Event[];
    listeners: Set<() => void>;
    finished?: Promise<void>;
};
const terminal = (state: State) => state === 'succeeded' || state === 'failed' || state === 'cancelled';
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (isRecord(value))
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])]),
        );
    return value;
}

/** Gateway-local operations. Cancelling the protocol wait never cancels its job. */
export function createOperationRegistry(entryId: string) {
    const operations = new Map<string, Operation>();
    const requests = new Map<string, { fingerprint: string; operationId: string }>();
    const notices = new Set<string>();
    function selected(operationId: string) {
        const operation = operations.get(operationId);
        if (!operation) throw new Error('The operation is absent from this entry.');
        return operation;
    }
    function get(operationId: string): OperationSnapshot {
        return structuredClone(selected(operationId).snapshot);
    }
    function emit(operation: Operation) {
        operation.snapshot.cursor += 1;
        operation.snapshot.elapsedMs = Math.max(0, Date.now() - operation.started);
        const { cursor, state, phase, elapsedMs, connectionId, sessionId } = operation.snapshot;
        operation.events.push({
            cursor,
            state,
            phase,
            elapsedMs,
            ...(connectionId ? { connectionId, sessionId } : {}),
        });
        if (operation.events.length > 128) operation.events.shift();
        for (const listener of [...operation.listeners]) listener();
    }
    function lookup(requestId: string, request: unknown) {
        const fingerprint = createHash('sha256')
            .update(JSON.stringify(canonical(request)))
            .digest('hex');
        const prior = requests.get(requestId);
        if (prior && prior.fingerprint !== fingerprint)
            throw new Error('This requestId already identifies a different request.');
        return { fingerprint, prior: prior ? get(prior.operationId) : undefined };
    }
    function submit(
        requestId: string,
        request: unknown,
        job: (context: OperationContext) => Promise<Record<string, unknown>>,
        onSettled?: () => void,
        initialIdentity?: ConnectionRoute,
    ) {
        const { fingerprint, prior } = lookup(requestId, request);
        if (prior) return prior;
        const operationId = randomUUID();
        const operation: Operation = {
            snapshot: {
                entryId,
                operationId,
                requestId,
                state: 'accepted',
                cursor: 0,
                phase: 'accepted',
                elapsedMs: 0,
                ...(isRecord(request) && typeof request.action === 'string' ? { action: request.action } : {}),
                ...(initialIdentity
                    ? { connectionId: initialIdentity.connectionId, sessionId: initialIdentity.sessionId }
                    : {}),
            },
            started: Date.now(),
            abort: new AbortController(),
            events: [],
            listeners: new Set(),
        };
        operations.set(operationId, operation);
        requests.set(requestId, { fingerprint, operationId });
        emit(operation);
        const accepted = get(operationId);
        operation.finished = Promise.resolve().then(async () => {
            try {
                operation.abort.signal.throwIfAborted();
                operation.snapshot.state = 'running';
                emit(operation);
                const result = await job({
                    operationId,
                    signal: operation.abort.signal,
                    phase: (phase) => {
                        if (terminal(operation.snapshot.state)) return;
                        operation.snapshot.phase = phase;
                        emit(operation);
                    },
                    identity: (route) => {
                        if (terminal(operation.snapshot.state)) return;
                        operation.snapshot.connectionId = route.connectionId;
                        operation.snapshot.sessionId = route.sessionId;
                        emit(operation);
                    },
                });
                operation.abort.signal.throwIfAborted();
                operation.snapshot.result = result;
                operation.snapshot.state = 'succeeded';
            } catch (error) {
                const cancelled = operation.abort.signal.aborted && error === operation.abort.signal.reason;
                operation.snapshot.state = cancelled ? 'cancelled' : 'failed';
                if (!cancelled) {
                    const code = errorCode(error);
                    const evidence = lifecycleFailureEvidence(errorDetails(error) ?? {});
                    operation.snapshot.error = {
                        ...evidence,
                        phase: typeof evidence.phase === 'string' ? evidence.phase : operation.snapshot.phase,
                        ...(code === undefined ? {} : { code }),
                        message: errorMessage(error),
                    };
                }
            } finally {
                onSettled?.();
                operation.snapshot.phase = operation.snapshot.state;
                notices.add(operationId);
                emit(operation);
            }
        });
        return accepted;
    }
    async function wait(operationId: string, cursor = 0, signal?: AbortSignal) {
        const operation = selected(operationId);
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > operation.snapshot.cursor)
            throw new Error('Invalid event cursor for this operation.');
        signal?.throwIfAborted();
        if (!terminal(operation.snapshot.state) && cursor === operation.snapshot.cursor) {
            await new Promise<void>((resolve, reject) => {
                const finish = (error?: unknown) => {
                    clearTimeout(timer);
                    operation.listeners.delete(changed);
                    signal?.removeEventListener('abort', aborted);
                    if (error) reject(error);
                    else resolve();
                };
                const changed = () => finish();
                const aborted = () => finish(signal?.reason);
                const timer = setTimeout(changed, 25_000);
                operation.listeners.add(changed);
                signal?.addEventListener('abort', aborted, { once: true });
                if (signal?.aborted) aborted();
            });
        }
        const events = operation.events.filter((event) => event.cursor > cursor);
        return {
            operation: get(operationId),
            events: structuredClone(events),
            cursor: operation.snapshot.cursor,
            replayTruncated: cursor < (operation.events[0]?.cursor ?? 1) - 1,
            complete: terminal(operation.snapshot.state),
        };
    }
    function cancel(operationId: string) {
        const operation = selected(operationId);
        if (!terminal(operation.snapshot.state) && !operation.abort.signal.aborted) {
            operation.snapshot.state = 'cancelling';
            operation.abort.abort(new DOMException('Operation aborted; cleanup required.', 'AbortError'));
            emit(operation);
        }
        return get(operationId);
    }
    function cancelRoute(
        route: ConnectionRoute,
        { excludeActions = ['stop', 'restart'] }: { excludeActions?: readonly string[] } = {},
    ) {
        return [...operations.values()]
            .filter(
                ({ snapshot }) =>
                    snapshot.connectionId === route.connectionId &&
                    snapshot.sessionId === route.sessionId &&
                    !terminal(snapshot.state) &&
                    !excludeActions.includes(snapshot.action ?? ''),
            )
            .map(({ snapshot }) => cancel(snapshot.operationId));
    }
    function markRead(operationId: string) {
        if (terminal(selected(operationId).snapshot.state)) notices.delete(operationId);
    }
    function notice(operationId: string): OperationNotice {
        const snapshot = get(operationId);
        const failure = snapshot.error;
        const code = failure?.code;
        return {
            kind: 'operation',
            entryId,
            operationId,
            ...(snapshot.action === undefined ? {} : { action: snapshot.action }),
            state: snapshot.state,
            phase: typeof snapshot.error?.phase === 'string' ? snapshot.error.phase : snapshot.phase,
            elapsedMs: snapshot.elapsedMs,
            ...(snapshot.connectionId === undefined ? {} : { connectionId: snapshot.connectionId }),
            ...(snapshot.sessionId === undefined ? {} : { sessionId: snapshot.sessionId }),
            ...(typeof code === 'string' ? { code } : {}),
            ...(typeof failure?.category === 'string' ? { category: failure.category } : {}),
            ...(typeof failure?.nativeError === 'number' ? { nativeError: failure.nativeError } : {}),
            ...(typeof failure?.exceptionType === 'string' ? { exceptionType: failure.exceptionType } : {}),
            ...(typeof failure?.closeRequested === 'boolean' ? { closeRequested: failure.closeRequested } : {}),
            ...(typeof failure?.processExited === 'boolean' ? { processExited: failure.processExited } : {}),
            ...(typeof failure?.listenerState === 'string' ? { listenerState: failure.listenerState } : {}),
            ...(typeof failure?.closeConfirmed === 'boolean' ? { closeConfirmed: failure.closeConfirmed } : {}),
        };
    }
    return {
        get,
        submit,
        wait,
        cancel,
        cancelRoute,
        markRead,
        prior: (requestId: string, request: unknown) => lookup(requestId, request).prior,
        takeNotices: (predicate?: (notice: OperationNotice) => boolean) => {
            const result = [...notices].map(notice).filter((value) => predicate?.(value) ?? true);
            for (const value of result) notices.delete(value.operationId);
            return result;
        },
        async close() {
            for (const id of operations.keys()) cancel(id);
            await Promise.all([...operations.values()].map((operation) => operation.finished));
        },
    };
}
