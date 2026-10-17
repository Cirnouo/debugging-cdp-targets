import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConnectionRoute, parseControlRequest } from '../src/domains/control-contract.ts';

const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const connectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('start requires strict isolation intent and preserves directory selection', () => {
    const start = { action: 'start', requestId: 'isolation', launch: { executable: '/app' } };
    assert.throws(() => parseControlRequest(start), /isolation/i);
    for (const isolation of [
        { mode: 'none' },
        { mode: 'data-dir', directory: { kind: 'existing', path: '/data' }, cleanup: 'retain' },
        { mode: 'data-dir', directory: { kind: 'new', parent: '/data' }, cleanup: 'delete-on-release' },
    ])
        assert.deepEqual(parseControlRequest({ ...start, isolation }), { ...start, isolation });
    for (const isolation of [
        { mode: 'none', directory: { kind: 'existing', path: '/data' } },
        { mode: 'data-dir', directory: { kind: 'existing', path: '/data' } },
        { mode: 'data-dir', directory: { kind: 'new', parent: '/data', path: '/data' }, cleanup: 'retain' },
    ])
        assert.throws(() => parseControlRequest({ ...start, isolation }));
});

test('MCP control accepts structured launch and explicit official arguments without a command string', () => {
    const request = {
        action: 'start',
        requestId: 'launch-1',
        isolation: { mode: 'none' },
        launch: { executable: '/opt/app', args: ['a b'], env: { PORT: '{port}' } },
        mcpArgs: ['--workspace=/work'],
    };
    assert.deepEqual(parseControlRequest(request), request);
    assert.deepEqual(parseControlRequest({ action: 'status' }), { action: 'status' });
    assert.deepEqual(parseControlRequest({ action: 'status', toolNames: ['click_at'] }), {
        action: 'status',
        toolNames: ['click_at'],
    });
});

test('MCP controls reject missing identities, ambiguous selectors and inapplicable fields', () => {
    for (const request of [
        { action: 'start', requestId: 'one', launchCommand: 'app' },
        { action: 'start', launch: { executable: '/app' } },
        { action: 'start', requestId: 'one', launch: { executable: '/app' }, sessionId },
        { action: 'status', entryId },
        { action: 'status', sessionId },
        { action: 'status', connectionId, operationId: sessionId },
        { action: 'restart', requestId: 'one', connectionId, scope: 'both' },
        { action: 'restart', requestId: 'one', connectionId, sessionId, disposition: 'Keep', scope: 'both' },
        { action: 'stop', requestId: 'one', connectionId, sessionId, disposition: 'Kill' },
        { action: 'wait', operationId: sessionId, cursor: -1 },
        { action: 'cancel', operationId: sessionId, disposition: 'Close' },
        { action: 'end-task', requestId: 'removed', connectionId, sessionId },
        { action: 'restart', requestId: 'scope-required', connectionId, sessionId },
        { action: 'start', requestId: 'one', launch: { executable: '/app' }, mcpArgs: [1] },
    ])
        assert.throws(() => parseControlRequest(request));
    assert.throws(() => parseConnectionRoute({ connectionId, sessionId, extra: true }));
});

test('explicit restart and event wait retain the selected identities and cursors', () => {
    for (const request of [
        {
            action: 'restart',
            requestId: 'restart-1',
            connectionId,
            sessionId,
            scope: 'official',
        },
        { action: 'stop', requestId: 'stop-1', connectionId, sessionId, disposition: 'Keep' },
        { action: 'wait', operationId: sessionId, cursor: 3 },
        { action: 'cancel', operationId: sessionId },
    ])
        assert.deepEqual(parseControlRequest(request), request);
});

test('selected status accepts only explicit configuration and diagnostic includes', () => {
    const request = {
        action: 'status',
        connectionId,
        include: ['configuration', 'diagnostics'],
        toolNames: ['evaluate_script'],
    };
    assert.deepEqual(parseControlRequest(request), request);
    for (const invalid of [
        { action: 'status', include: ['configuration'] },
        { action: 'status', include: [] },
        { ...request, include: ['launch'] },
        { ...request, include: 'configuration' },
        { ...request, include: ['diagnostics', 'diagnostics'] },
        { action: 'status', operationId: sessionId, toolNames: ['evaluate_script'] },
        { action: 'status', operationId: sessionId, include: ['diagnostics'] },
    ])
        assert.throws(() => parseControlRequest(invalid), Error, JSON.stringify(invalid));
});
