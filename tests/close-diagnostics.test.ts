import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperationRegistry } from '../src/application/operations.ts';
import { createTargetController } from '../src/application/target-controller.ts';
import { DetailedError, errorDetails } from '../src/shared/errors.ts';

test('failed normal close preserves native diagnostics and exact retry identity', async () => {
    const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const controller = createTargetController({
        entryId,
        router: { isBusy: () => false, setTarget: () => {}, clearTarget: () => {} },
        host: {
            launch: async () => ({
                processId: 42,
                port: 9222,
                targetKind: 'generic-cdp',
                executablePath: '/fixture',
                startedAtUtc: '2026-10-04T00:00:00Z',
            }),
            close: async () => {
                const error = new DetailedError('Normal close failed.');
                error.details = { phase: 'send-close', nativeError: 5, closeRequested: false, listenerState: 'absent' };
                throw error;
            },
        },
        server: { ensure: async () => {}, close: async () => {} },
    });
    const active = await controller.start({ launch: { executable: '/fixture' } });
    assert.ok(active.sessionId);
    await assert.rejects(controller.stop({ sessionId: active.sessionId, disposition: 'Close' }), (error: unknown) => {
        const detail = errorDetails(error);
        assert.equal(detail?.entryId, entryId);
        assert.equal(detail?.sessionId, active.sessionId);
        assert.equal(detail?.phase, 'send-close');
        assert.equal(detail?.nativeError, 5);
        assert.equal(detail?.closeRequested, false);
        assert.equal(detail?.listenerState, 'absent');
        assert.equal(detail?.cause, 'Normal close failed.');
        return true;
    });
    assert.equal(controller.status().sessionId, active.sessionId);
    const sessionId = active.sessionId;
    const operations = createOperationRegistry(entryId);
    const accepted = operations.submit('preserve-close-cause', { action: 'stop', sessionId }, async () =>
        controller.stop({ sessionId, disposition: 'Close' }),
    );
    let result = await operations.wait(accepted.operationId, 0);
    while (!result.complete) result = await operations.wait(accepted.operationId, result.cursor);
    assert.equal(result.operation.error?.cause, 'Normal close failed.');
    assert.match(String(result.operation.error?.message), /identity remain available for retry/);
});
