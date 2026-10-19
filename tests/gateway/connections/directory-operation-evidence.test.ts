import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { DataDirectoryRegistry } from '../../../src/adapters/data-directory.ts';
import { isRecord } from '../../../src/shared/errors.ts';
import { createDirectoryRuntimeFixture, deferred, tick } from '../../fixtures/connection-directory-runtime.ts';

test('post-acquisition inspection failure preserves actual path and bounded cleanup evidence', async (t) => {
    const directories = new DataDirectoryRegistry({
        io: {
            entries: async (directory) => {
                throw new Error(`EACCES private inspection ${directory}`);
            },
        },
    });
    const f = await createDirectoryRuntimeFixture(t, { directories });
    await assert.rejects(f.runtime.controller.start(f.dataOptions(), f.context), /directory-inspection-failed/);
    const result = f.evidence.at(-1);
    assert.ok(result?.mode === 'data-dir');
    assert.equal(result.path, path.join(f.parent, 'profile'));
    assert.equal(result.state, 'deleted');
    assert.equal(result.nonempty, undefined);
    assert.equal(f.launches.length, 0);
    await assert.rejects(lstat(result.path), { code: 'ENOENT' });
});

test('none exposes only explicit mode and summaries omit directory and raw cleanup errors', async (t) => {
    const f = await createDirectoryRuntimeFixture(t, { failUpstreamClose: true });
    const active = await f.runtime.controller.start(
        { launch: { executable: process.execPath }, isolation: { mode: 'none' } },
        f.context,
    );
    assert.deepEqual(f.evidence, [{ mode: 'none' }]);
    assert.equal('isolation' in active, false);
    assert.deepEqual(await import('node:fs/promises').then((fs) => fs.readdir(f.parent)), []);
    f.applications[0]?.exit();
    await tick();
    await tick();
    const text = JSON.stringify(await f.control({ action: 'status' }));
    assert.ok(!text.includes(f.parent));
    assert.ok(!text.includes('EACCES private'));
});

test('idempotent start keeps original directory metadata after terminal actual exit without another notice', async (t) => {
    const f = await createDirectoryRuntimeFixture(t);
    const request = {
        action: 'start' as const,
        requestId: 'same-start',
        ...f.dataOptions('retain'),
    };
    const accepted = await f.control(request);
    assert.ok(typeof accepted.operationId === 'string');
    let snapshot = accepted;
    while (snapshot.state !== 'succeeded') {
        const waited = await f.control({
            action: 'wait',
            operationId: accepted.operationId,
            cursor: typeof snapshot.cursor === 'number' ? snapshot.cursor : 0,
        });
        assert.ok(isRecord(waited.operation));
        snapshot = waited.operation;
    }
    assert.ok(isRecord(snapshot.isolation));
    const original = structuredClone(snapshot);
    const retry = await f.control(request);
    assert.equal(retry.operationId, accepted.operationId);
    assert.equal(f.launches.length, 1);
    assert.ok(typeof snapshot.connectionId === 'string' && typeof snapshot.sessionId === 'string');
    const selected = await f.control({
        action: 'status',
        connectionId: snapshot.connectionId,
        include: ['configuration'],
    });
    assert.deepEqual(selected.isolation, snapshot.isolation);
    f.applications[0]?.exit();
    for (let attempt = 0; attempt < 50; attempt++) {
        snapshot = await f.control({ action: 'status', operationId: accepted.operationId });
        if (isRecord(snapshot.isolation) && snapshot.isolation.state === 'retained') break;
        await tick();
    }
    assert.ok(isRecord(snapshot.isolation));
    assert.equal(snapshot.isolation.state, 'retained');
    assert.equal(snapshot.cursor, original.cursor);
    assert.deepEqual(snapshot.result, original.result);
    assert.equal(snapshot.state, original.state);
    assert.equal(f.runtime.core.admin.operations().length, 1);
});

for (const state of ['failed', 'cancelled'] as const) {
    test(`${state} start preserves acquired path and authorized final cleanup in operation metadata`, async (t) => {
        const gate = deferred();
        t.after(() => gate.resolve());
        const f = await createDirectoryRuntimeFixture(
            t,
            state === 'failed' ? { failLaunch: 1 } : { beforeCreation: gate.promise },
        );
        const accepted = await f.control({
            action: 'start',
            requestId: `start-${state}`,
            ...f.dataOptions(),
        });
        assert.ok(typeof accepted.operationId === 'string');
        if (state === 'cancelled') {
            await f.launchEntered;
            await f.control({ action: 'cancel', operationId: accepted.operationId });
            gate.resolve();
        }
        let snapshot = accepted;
        while (!['succeeded', 'failed', 'cancelled'].includes(String(snapshot.state))) {
            const waited = await f.control({
                action: 'wait',
                operationId: accepted.operationId,
                cursor: typeof snapshot.cursor === 'number' ? snapshot.cursor : 0,
            });
            assert.ok(isRecord(waited.operation));
            snapshot = waited.operation;
        }
        assert.equal(snapshot.state, state);
        assert.ok(isRecord(snapshot.isolation));
        assert.equal(snapshot.isolation.path, path.join(f.parent, 'profile'));
        assert.equal(snapshot.isolation.state, 'deleted');
        assert.ok(!String(JSON.stringify(snapshot.error)).includes(f.parent));
        await assert.rejects(lstat(String(snapshot.isolation.path)), { code: 'ENOENT' });
    });
}
