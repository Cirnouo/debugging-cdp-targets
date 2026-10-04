import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConnectionRoute, parseControlRequest } from '../src/domains/control-contract.ts';

const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const connectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('MCP control accepts structured launch and explicit official arguments without a command string', () => {
    const request = {
        action: 'start',
        entryId,
        requestId: 'launch-1',
        launch: { executable: '/opt/app', args: ['a b'], env: { PORT: '{port}' } },
        mcpArgs: ['--workspace=/work'],
    };
    assert.deepEqual(parseControlRequest(request), request);
    assert.deepEqual(parseControlRequest({ action: 'status' }), { action: 'status' });
    assert.deepEqual(parseControlRequest({ action: 'status', entryId, toolNames: ['click_at'] }), {
        action: 'status',
        entryId,
        toolNames: ['click_at'],
    });
});

test('MCP controls reject missing identities, ambiguous selectors and inapplicable fields', () => {
    for (const request of [
        { action: 'start', entryId, requestId: 'one', launchCommand: 'app' },
        { action: 'start', entryId, launch: { executable: '/app' } },
        { action: 'start', entryId, requestId: 'one', launch: { executable: '/app' }, sessionId },
        { action: 'status', connectionId },
        { action: 'status', entryId, sessionId },
        { action: 'status', entryId, connectionId, operationId: sessionId },
        { action: 'restart', entryId, requestId: 'one', connectionId },
        { action: 'restart', entryId, requestId: 'one', connectionId, sessionId, disposition: 'Keep' },
        { action: 'stop', entryId, requestId: 'one', connectionId, sessionId, disposition: 'Kill' },
        { action: 'wait', entryId, operationId: sessionId, cursor: -1 },
        { action: 'cancel', entryId, operationId: sessionId, disposition: 'Close' },
        { action: 'start', entryId, requestId: 'one', launch: { executable: '/app' }, mcpArgs: [1] },
    ])
        assert.throws(() => parseControlRequest(request));
    assert.throws(() => parseConnectionRoute({ connectionId, sessionId, extra: true }));
});

test('explicit restart and event wait retain the selected identities and cursors', () => {
    for (const request of [
        {
            action: 'restart',
            entryId,
            requestId: 'restart-1',
            connectionId,
            sessionId,
            mcpArgs: ['--experimentalVision=true'],
        },
        { action: 'end-task', entryId, requestId: 'end-1', connectionId, sessionId },
        { action: 'stop', entryId, requestId: 'stop-1', connectionId, sessionId, disposition: 'Keep' },
        { action: 'wait', entryId, operationId: sessionId, cursor: 3 },
        { action: 'cancel', entryId, operationId: sessionId },
    ])
        assert.deepEqual(parseControlRequest(request), request);
});

test('selected status accepts only explicit configuration and diagnostic includes', () => {
    const request = {
        action: 'status',
        entryId,
        connectionId,
        include: ['configuration', 'diagnostics'],
        toolNames: ['evaluate_script'],
    };
    assert.deepEqual(parseControlRequest(request), request);
    for (const invalid of [
        { action: 'status', entryId, include: ['configuration'] },
        { action: 'status', entryId, include: [] },
        { ...request, include: ['launch'] },
        { ...request, include: 'configuration' },
        { ...request, include: ['diagnostics', 'diagnostics'] },
        { action: 'status', entryId, operationId: sessionId, toolNames: ['evaluate_script'] },
        { action: 'status', entryId, operationId: sessionId, include: ['diagnostics'] },
    ])
        assert.throws(() => parseControlRequest(invalid), Error, JSON.stringify(invalid));
});
