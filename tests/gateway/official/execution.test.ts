import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfficialExecution } from '../../../src/gateway/official/execution.ts';

for (const id of [0, 42, '0', 'request'] as const) {
    test(`official wire execution observes only its exact ${typeof id} identity ${id}`, async () => {
        const execution = createOfficialExecution();
        execution.assign(id);
        assert.equal(
            execution.observe({ jsonrpc: '2.0', id: typeof id === 'number' ? String(id) : -1, result: {} }),
            false,
        );
        assert.equal(execution.observe({ jsonrpc: '2.0', id, method: 'roots/list' }), false);
        assert.equal(execution.observe({ jsonrpc: '2.0', id }), false);
        assert.equal(execution.settled, false);
        assert.equal(execution.observe({ jsonrpc: '2.0', id, result: { content: [] } }), true);
        await execution.terminal;
        assert.equal(execution.settled, true);
        assert.equal(execution.observe({ jsonrpc: '2.0', id, error: { code: -32603, message: 'late' } }), false);
    });
}

test('response and definitive close are idempotent in either same-turn order', async () => {
    for (const closeFirst of [false, true]) {
        const execution = createOfficialExecution();
        execution.assign(0);
        let observed = 0;
        void execution.terminal.then(() => {
            observed += 1;
        });
        if (closeFirst) execution.finish();
        execution.observe({ jsonrpc: '2.0', id: 0, error: { code: -32603, message: 'failure' } });
        execution.finish();
        await execution.terminal;
        assert.equal(observed, 1);
    }
});

test('an execution cannot bind a second request identity and exposes no result archive', () => {
    const execution = createOfficialExecution();
    assert.equal(execution.id, undefined);
    execution.assign(0);
    assert.throws(() => execution.assign(1), /already bound/);
    assert.equal('result' in execution, false);
});
