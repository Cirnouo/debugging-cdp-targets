import assert from 'node:assert/strict';
import { validateIdentity } from '../../src/domains/control-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';

export const hookMarker = 'CDP lifecycle events: ';
export type HookEvents = {
    exits: Record<string, unknown>[];
    operations: Record<string, unknown>[];
    connections: Record<string, unknown>[];
};
const blocked = new Set([
    'result',
    'error',
    'mcpArgs',
    'workspace',
    'diagnostics',
    'toolAvailability',
    'inputSchema',
    'suggestedMcpArgs',
    'launch',
    'args',
    'env',
    'cwd',
    'message',
    'cause',
    'isolation',
    'directory',
    'path',
    'cleanup',
    'nonempty',
    'cleanupError',
]);
const hookBlocked = new Set(['toolNames', 'enabledTools', 'enabledToolCount']);
function assertCompact(value: unknown, hook = false) {
    if (Array.isArray(value)) {
        for (const item of value) assertCompact(item, hook);
    } else if (isRecord(value))
        for (const [key, item] of Object.entries(value)) {
            assert.ok(!blocked.has(key) && !(hook && hookBlocked.has(key)), `Hook/summary leaked ${key}.`);
            assertCompact(item, hook);
        }
}
export function assertSummary(value: unknown, selected = false) {
    assert.ok(isRecord(value));
    assertCompact(value);
    validateIdentity(value.entryId, 'entry ID');
    if (Array.isArray(value.connections)) {
        assert.deepEqual(Object.keys(value).sort(), ['connections', 'entryId']);
        for (const connection of value.connections) assertSummary(connection);
    } else {
        validateIdentity(value.connectionId, 'connection ID');
        if (value.sessionId !== undefined) validateIdentity(value.sessionId, 'session ID');
        if (!selected) assert.equal(value.enabledTools, undefined, 'Summary must not contain selected tool names.');
        else
            assert.ok(
                Array.isArray(value.enabledTools) &&
                    value.enabledTools.every((name: unknown) => typeof name === 'string'),
            );
        assert.ok(typeof value.status === 'string');
        assert.ok(['connected', 'disconnected', 'quarantined'].includes(String(value.upstreamStatus)));
        assert.ok(typeof value.enabledToolCount === 'number');
    }
}
function eventList(value: unknown, kind: string): Record<string, unknown>[] {
    assert.ok(Array.isArray(value));
    return value.map((event: unknown) => {
        assert.ok(isRecord(event));
        assert.equal(event.kind, kind);
        validateIdentity(event.entryId, 'entry ID');
        if (kind === 'operation') {
            assert.ok(
                Object.keys(event).every((key) =>
                    [
                        'kind',
                        'entryId',
                        'operationId',
                        'action',
                        'state',
                        'phase',
                        'elapsedMs',
                        'connectionId',
                        'sessionId',
                        'code',
                        'exits',
                        'category',
                        'nativeError',
                        'exceptionType',
                        'closeRequested',
                        'processExited',
                        'listenerState',
                        'closeConfirmed',
                    ].includes(key),
                ),
            );
            validateIdentity(event.operationId, 'operation ID');
            if (event.connectionId !== undefined) validateIdentity(event.connectionId, 'connection ID');
            if (event.sessionId !== undefined) validateIdentity(event.sessionId, 'session ID');
            assert.ok(['start', 'restart', 'stop', 'end-task'].includes(String(event.action)));
            assert.ok(['succeeded', 'failed', 'cancelled'].includes(String(event.state)));
            assert.ok(typeof event.phase === 'string' && typeof event.elapsedMs === 'number');
            for (const key of ['category', 'exceptionType', 'listenerState'])
                if (event[key] !== undefined) assert.equal(typeof event[key], 'string');
            if (event.nativeError !== undefined)
                assert.ok(typeof event.nativeError === 'number' && Number.isFinite(event.nativeError));
            for (const key of ['closeRequested', 'processExited', 'closeConfirmed'])
                if (event[key] !== undefined) assert.equal(typeof event[key], 'boolean');
            if (event.exits !== undefined)
                for (const exit of eventList(event.exits, 'target-exit')) {
                    assert.equal(exit.operationId, event.operationId);
                    assert.ok(exit.expected !== undefined);
                }
        } else {
            validateIdentity(event.connectionId, 'connection ID');
            validateIdentity(event.sessionId, 'session ID');
            if (kind === 'target-exit') {
                assert.ok(
                    Object.keys(event).every((key) =>
                        [
                            'kind',
                            'entryId',
                            'connectionId',
                            'sessionId',
                            'reason',
                            'taskActive',
                            'expected',
                            'operationId',
                            'processId',
                            'port',
                            'targetKind',
                            'exitedAt',
                            'exitCode',
                            'signalCode',
                            'cleanupStatus',
                            'cleanupCode',
                        ].includes(key),
                    ),
                );
                assert.equal(event.reason, 'process-exited');
                assert.equal(typeof event.taskActive, 'boolean');
                if (event.expected !== undefined)
                    assert.ok(['close', 'restart', 'rollback', 'disconnect'].includes(String(event.expected)));
                if (event.operationId !== undefined) validateIdentity(event.operationId, 'operation ID');
                assert.ok(typeof event.processId === 'number' && typeof event.port === 'number');
                assert.ok(['chrome', 'generic-cdp'].includes(String(event.targetKind)));
                assert.ok(typeof event.exitedAt === 'string' && Number.isFinite(Date.parse(event.exitedAt)));
                if (event.exitCode !== undefined) assert.equal(typeof event.exitCode, 'number');
                if (event.signalCode !== undefined) assert.equal(typeof event.signalCode, 'string');
                assert.ok(['succeeded', 'failed'].includes(String(event.cleanupStatus)));
                if (event.cleanupCode !== undefined) assert.equal(event.cleanupCode, 'RESOURCE_CLEANUP_FAILED');
            } else assert.ok(typeof event.code === 'string' && typeof event.reason === 'string');
        }
        assertCompact(event, true);
        return event;
    });
}

function wrappedEvents(value: unknown): HookEvents[] {
    if (typeof value === 'string') return hookEvents(value);
    if (Array.isArray(value)) return value.flatMap(wrappedEvents);
    if (isRecord(value)) return Object.values(value).flatMap(wrappedEvents);
    return [];
}

/** Decode valid host JSON wrappers before reading their actual Hook text strings. */
export function hookEvents(text: string): HookEvents[] {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return textEvents(text);
    }
    return wrappedEvents(value);
}

function textEvents(text: string): HookEvents[] {
    const results: HookEvents[] = [];
    let offset = 0;
    while (offset < text.length) {
        const markerOffset = text.indexOf(hookMarker, offset);
        if (markerOffset === -1) break;
        const start = markerOffset + hookMarker.length;
        assert.equal(text[start], '{');
        let depth = 0,
            quoted = false,
            escaped = false,
            end = start;
        for (; end < text.length; end++) {
            const character = text[end];
            if (quoted) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') quoted = false;
            } else if (character === '"') quoted = true;
            else if (character === '{') depth++;
            else if (character === '}' && --depth === 0) {
                end++;
                break;
            }
        }
        assert.equal(depth, 0, 'Actual Hook context contains incomplete JSON.');
        const value: unknown = JSON.parse(text.slice(start, end));
        assert.ok(isRecord(value));
        assert.deepEqual(Object.keys(value).sort(), ['connections', 'exits', 'operations']);
        const events = {
            exits: eventList(value.exits, 'target-exit'),
            operations: eventList(value.operations, 'operation'),
            connections: eventList(value.connections, 'connection-failure'),
        };
        assert.ok(events.exits.length + events.operations.length + events.connections.length > 0);
        results.push(events);
        offset = end;
    }
    return results;
}

export function hookResultEvents(value: unknown): HookEvents[] {
    assert.ok(isRecord(value));
    if (Object.keys(value).length === 0) return [];
    if (value.decision === 'block') {
        assert.ok(typeof value.reason === 'string');
        return hookEvents(value.reason);
    }
    assert.ok(isRecord(value.hookSpecificOutput) && typeof value.hookSpecificOutput.additionalContext === 'string');
    return hookEvents(value.hookSpecificOutput.additionalContext);
}

export async function waitForSmokeHookEvents(read: () => Promise<unknown>, timeout = 15_000): Promise<HookEvents[]> {
    const deadline = Date.now() + timeout;
    const requireBudget = () => {
        if (Date.now() >= deadline) throw new Error('Expected Hook lifecycle events were not reached.');
    };
    for (;;) {
        requireBudget();
        const value = await read();
        requireBudget();
        assert.ok(isRecord(value), 'Expected a Hook response object.');
        if (Object.keys(value).length !== 0) {
            const events = hookResultEvents(value);
            assert.ok(events.length > 0, 'Nonempty Hook response contains no lifecycle events.');
            requireBudget();
            return events;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}
