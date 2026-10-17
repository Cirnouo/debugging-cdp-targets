import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ajv, addFormats } from '@modelcontextprotocol/server/validators/ajv';
import { lifecycleTools } from '../src/adapters/lifecycle-tools.ts';
import { connectionSummary, parseControlRequest } from '../src/domains/control-contract.ts';

test('App lifecycle uses connection/operation identities without a public entry or task activity', () => {
    const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const start = { action: 'start', requestId: 'start', launch: { executable: '/app' }, isolation: { mode: 'none' } };
    assert.deepEqual(parseControlRequest(start), start);
    assert.deepEqual(parseControlRequest({ action: 'status', connectionId }), { action: 'status', connectionId });
    const restart = { action: 'restart', requestId: 'restart', connectionId, sessionId, scope: 'target' };
    assert.deepEqual(parseControlRequest(restart), restart);
    for (const request of [
        { ...start, entryId: connectionId },
        { action: 'status', hookEventName: 'Stop' },
        { action: 'end-task', requestId: 'old', connectionId, sessionId },
        { action: 'restart', requestId: 'missing-scope', connectionId, sessionId },
    ])
        assert.throws(() => parseControlRequest(request));
    const summary = connectionSummary({ connectionId, status: 'active', sessionId });
    assert.equal(Object.hasOwn(summary, 'entryId'), false);
    assert.equal(Object.hasOwn(summary, 'taskActive'), false);
});

test('published lifecycle schemas accept real bearer inputs and reject credentials missing or mixed with retired entry fields', () => {
    const route = {
        registrationBearer: 'x'.repeat(43),
        connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    const requests: Record<string, Record<string, unknown>> = {
        dct_registration_register: {},
        dct_connection_status: { registrationBearer: route.registrationBearer },
        dct_connection_start: {
            registrationBearer: route.registrationBearer,
            requestId: 'once',
            launch: { executable: '/app' },
            isolation: { mode: 'none' },
        },
        dct_connection_restart: { ...route, requestId: 'repair', scope: 'target' },
        dct_connection_stop: { ...route, requestId: 'close', disposition: 'Close' },
        dct_operation_wait: {
            registrationBearer: route.registrationBearer,
            operationId: route.connectionId,
            cursor: 0,
        },
        dct_operation_cancel: { registrationBearer: route.registrationBearer, operationId: route.connectionId },
    };
    const validator = new Ajv({ strict: false });
    addFormats(validator);
    for (const tool of lifecycleTools()) {
        const validate = validator.compile(tool.inputSchema);
        const request = requests[tool.name];
        assert.ok(request);
        assert.equal(validate(request), true, tool.name);
        if (tool.name === 'dct_registration_register') continue;
        const { registrationBearer, ...missing } = request;
        void registrationBearer;
        assert.equal(validate(missing), false, tool.name);
        assert.equal(validate({ ...request, entryId: route.connectionId }), false, tool.name);
        assert.equal(Object.hasOwn(tool.inputSchema.properties ?? {}, 'entryId'), false, tool.name);
    }
});
