import assert from 'node:assert/strict';
import { test } from 'node:test';
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
        return true;
    });
    assert.equal(controller.status().sessionId, active.sessionId);
});
