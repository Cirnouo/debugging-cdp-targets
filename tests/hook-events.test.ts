import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hookEvents, hookMarker, waitForSmokeHookEvents } from './fixtures/hook-gateway-events.ts';

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

test('smoke Hook wait crosses two empty observations and returns the first event batch intact', async () => {
    const outputs: unknown[] = [{}, {}, { decision: 'block', reason: context() }, { unread: 'next response' }];
    const received = await waitForSmokeHookEvents(async () => outputs.shift());
    assert.deepEqual(received, [events]);
    assert.deepEqual(outputs, [{ unread: 'next response' }], 'Waiting must not consume the following Hook response.');
});

test('smoke Hook wait rejects its empty deadline without reading a later event', async () => {
    const outputs: unknown[] = [{}, { decision: 'block', reason: context() }];
    await assert.rejects(
        waitForSmokeHookEvents(async () => outputs.shift(), 0),
        /Hook.*not reached/i,
    );
    assert.deepEqual(outputs, [{}, { decision: 'block', reason: context() }]);
});

test('smoke Hook wait leaves a later batch unread when its polling sleep crosses the deadline', async (clock) => {
    clock.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const later = { decision: 'block', reason: context() };
    const outputs: unknown[] = [{}, later];
    const pending = waitForSmokeHookEvents(async () => outputs.shift(), 1);
    const rejected = assert.rejects(pending, /Hook.*not reached/i);
    await new Promise((resolve) => setImmediate(resolve));
    clock.mock.timers.tick(100);
    await rejected;
    assert.deepEqual(outputs, [later]);
});

test('smoke Hook wait rejects a valid read that returns after its readiness deadline', async (clock) => {
    clock.mock.timers.enable({ apis: ['Date'], now: 0 });
    const valid = { decision: 'block', reason: context() };
    const outputs: unknown[] = [valid, valid];
    await assert.rejects(
        waitForSmokeHookEvents(async () => {
            clock.mock.timers.setTime(2);
            return outputs.shift();
        }, 1),
        /Hook.*not reached/i,
    );
    assert.deepEqual(outputs, [valid]);
});

test('smoke Hook wait returns a valid wrong-identity first batch for the caller to reject', async () => {
    const correct = {
        exits: [
            {
                ...exit,
                expected: undefined,
                operationId: undefined,
                cleanupStatus: 'succeeded',
                cleanupError: undefined,
            },
        ],
        operations: [],
        connections: [],
    };
    const wrong = {
        ...correct,
        exits: [{ ...correct.exits[0], connectionId: '55555555-5555-4555-8555-555555555555' }],
    };
    const later = { decision: 'block', reason: context(correct) };
    const outputs: unknown[] = [{ decision: 'block', reason: context(wrong) }, later];
    const received = await waitForSmokeHookEvents(async () => outputs.shift());
    assert.equal(received.length, 1);
    assert.equal(received[0]?.exits.length, 1);
    assert.equal(received[0]?.exits[0]?.connectionId, '55555555-5555-4555-8555-555555555555');
    assert.throws(() => assert.equal(received[0]?.exits[0]?.connectionId, '33333333-3333-4333-8333-333333333333'));
    assert.deepEqual(outputs, [later], 'A later correct batch must remain unread after the wrong first batch.');
});

test('smoke Hook wait rejects the first nonempty malformed response without discarding it', async () => {
    for (const invalid of [{ decision: 'block', reason: 'No lifecycle event.' }, { unrelated: 'invalid wrapper' }]) {
        const outputs: unknown[] = [{}, invalid, { decision: 'block', reason: context() }];
        await assert.rejects(waitForSmokeHookEvents(async () => outputs.shift()));
        assert.deepEqual(outputs, [{ decision: 'block', reason: context() }]);
    }
});

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
