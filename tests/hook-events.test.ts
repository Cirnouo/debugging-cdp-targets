import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hookEvents, hookMarker } from './fixtures/hook-gateway-events.ts';

const entryId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const exit = {
    kind: 'target-exit',
    entryId,
    operationId,
    connectionId: '33333333-3333-4333-8333-333333333333',
    sessionId: '44444444-4444-4444-8444-444444444444',
    reason: 'process-exited',
    taskActive: true,
    expected: 'rollback',
    processId: 42,
    port: 9222,
    targetKind: 'generic-cdp',
    exitedAt: '2026-10-05T00:00:00Z',
    cleanupStatus: 'failed',
    cleanupError: 'native "Close" at C:\\fixture\\target\n观察失败 { evidence }',
};
const operation = {
    kind: 'operation',
    entryId,
    operationId,
    action: 'restart',
    state: 'failed',
    phase: 'closing-target',
    elapsedMs: 12,
    nativeError: 5,
    closeRequested: false,
    exits: [exit],
};
const events = { exits: [], operations: [operation], connections: [] };
function context(value: unknown = events) {
    return `<system-reminder>${hookMarker}${JSON.stringify(value)}\nReview the recorded event.</system-reminder>`;
}

test('Hook payloads in serialized model requests are parsed from their actual text strings', () => {
    const request = {
        model: 'isolated-smoke',
        messages: [{ role: 'user', content: [{ type: 'text', text: context() }] }],
    };
    assert.deepEqual(hookEvents(context()), [events]);
    assert.deepEqual(hookEvents(JSON.stringify(request)), [events]);
});

test('nested serialized host wrappers decode each valid JSON layer without changing event escapes', () => {
    const output = JSON.stringify({ hookSpecificOutput: { additionalContext: context() } });
    const request = JSON.stringify({ wrappers: [{ output, unrelated: 'No Hook event.' }] });
    const parsed = hookEvents(request);
    assert.deepEqual(parsed, [events]);
    assert.deepEqual(hookEvents(JSON.stringify(JSON.stringify(request))), [events]);
    assert.deepEqual(hookEvents(JSON.stringify({ text: 'No recorded event.' })), []);
});

test('serialized wrappers still reject leaked fields and malformed nested exit evidence', () => {
    for (const field of [
        'result',
        'error',
        'mcpArgs',
        'workspace',
        'diagnostics',
        'inputSchema',
        'suggestedMcpArgs',
        'toolNames',
        'enabledTools',
        'enabledToolCount',
        'message',
        'cause',
    ]) {
        const leaked = { ...events, operations: [{ ...operation, [field]: 'private' }] };
        assert.throws(() => hookEvents(JSON.stringify({ output: context(leaked) })), { code: 'ERR_ASSERTION' });
        const nested = { ...events, operations: [{ ...operation, exits: [{ ...exit, [field]: 'private' }] }] };
        assert.throws(() => hookEvents(JSON.stringify({ output: context(nested) })), { code: 'ERR_ASSERTION' });
    }
    const mismatch = { ...events, operations: [{ ...operation, exits: [{ ...exit, operationId: entryId }] }] };
    assert.throws(() => hookEvents(JSON.stringify({ output: context(mismatch) })), { code: 'ERR_ASSERTION' });
    const pending = { ...events, operations: [{ ...operation, exits: [{ ...exit, cleanupStatus: 'pending' }] }] };
    assert.throws(() => hookEvents(JSON.stringify({ output: context(pending) })), { code: 'ERR_ASSERTION' });
});
