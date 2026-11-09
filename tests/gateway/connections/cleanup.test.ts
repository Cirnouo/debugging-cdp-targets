import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedManagedResult, createManagedConnectionFixture } from '../../fixtures/gateway/core-runtime.ts';

for (const phase of ['closing', 'failed'] as const) {
    test(`all direct restart scopes reject before acquisition while final cleanup is ${phase}`, async () => {
        const f = await createManagedConnectionFixture();
        let releaseClose = () => {};
        let cleaning: Promise<unknown> | undefined;
        try {
            const target = await f.core.controller.start(
                {
                    isolation: { mode: 'none' },
                    launch: { executable: 'fixture' },
                },
                { client: f.client('direct-controller').context() },
            );
            if (phase === 'closing') releaseClose = f.blockClose();
            else f.failClose(true);
            cleaning = f.core.cleanup().catch((error: unknown) => error);
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (phase === 'failed') await cleaning;
            const counts = f.counts();
            const generations = f.generations();
            for (const scope of ['official', 'target', 'both'] as const) {
                await assert.rejects(
                    boundedManagedResult(
                        f.core.controller.restart({
                            connectionId: target.connectionId,
                            sessionId: target.sessionId ?? '',
                            scope,
                        }),
                        'Direct restart did not reject while closing.',
                    ),
                    /closing/,
                );
                assert.deepEqual(f.counts(), counts);
                assert.deepEqual(f.generations(), generations);
            }
        } finally {
            releaseClose();
            f.failClose(false);
            await cleaning;
            await f.core.cleanup();
        }
    });
}

test('final cleanup attempts peers, retains a failed live owner and retries without reporting successful exit', async () => {
    const f = await createManagedConnectionFixture();
    const origin = f.client('cleanup-owner');
    try {
        await f.core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: origin.context() },
        );
        await f.core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: origin.context() },
        );
        f.failClose(true);
        await assert.rejects(f.core.cleanup(), /cleanup.*failed|did not close/);
        assert.equal(f.counts().closed, 2);
        assert.equal(f.core.admin.status().connections.length, 1);
        await assert.rejects(
            f.core.controller.start(
                { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
                { client: origin.context() },
            ),
            /closing/,
        );
        f.failClose(false);
        await f.core.cleanup();
        assert.equal(f.counts().closed, 3);
        assert.equal(f.core.admin.status().connections.length, 0);
    } finally {
        f.failClose(false);
        await f.core.cleanup();
    }
});
