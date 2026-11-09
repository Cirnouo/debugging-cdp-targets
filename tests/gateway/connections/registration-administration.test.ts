import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagedConnectionFixture } from '../../fixtures/gateway/core-runtime.ts';

test('authenticated reads refresh empty idle expiry without advancing last-real-operation time', async () => {
    let now = 0;
    const f = await createManagedConnectionFixture(() => now);
    const a = f.client('a');
    const empty = f.client('empty');
    try {
        const connection = await f.core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: a.context() },
        );
        const before = f.core.admin.connections()[0];
        now = 29 * 60 * 1000;
        await f.core.control({ action: 'status' }, empty.context());
        await f.core.control({ action: 'status', connectionId: connection.connectionId }, a.context());
        const after = f.core.admin.connections()[0];
        assert.equal(after?.lastRealOperationAt, before?.lastRealOperationAt);
        assert.equal(after?.establishedAt, before?.establishedAt);
        now += 29 * 60 * 1000;
        await f.core.control({ action: 'status' }, empty.context());
        now += 30 * 60 * 1000;
        await assert.rejects(f.core.control({ action: 'status' }, empty.context()), /expired/);
        await f.core.control({ action: 'status', connectionId: connection.connectionId }, a.context());
    } finally {
        await f.core.cleanup();
    }
});

test('trusted administration resolves inventory registration IDs without bearer or principal mirrors', async () => {
    let now = 0;
    const f = await createManagedConnectionFixture(() => now);
    const a = f.client('a');
    const b = f.client('b');
    const expired = f.client('expired');
    try {
        const connection = await f.core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: a.context() },
        );
        const inventory = f.core.admin.registrations();
        const recipient = inventory.find((item) => item.registrationId === b.registration.principal.registrationId);
        assert.ok(recipient);
        f.core.admin.transfer(connection.connectionId, recipient.registrationId);
        assert.throws(() => f.core.admin.unregister(recipient.registrationId), /resources or jobs/);
        assert.throws(
            () => f.core.admin.transfer(connection.connectionId, 'absent'),
            /registration.*absent|absent.*registration/,
        );
        assert.throws(() => f.core.admin.unregister('absent'), /registration.*absent|absent.*registration/);
        now = 30 * 60 * 1000;
        assert.throws(
            () => f.core.admin.transfer(connection.connectionId, expired.registration.principal.registrationId),
            /expired/,
        );
        await f.core.invoke(
            'echo',
            { _dct: { connectionId: connection.connectionId, sessionId: connection.sessionId } },
            b.context(),
        );
        assert.equal(JSON.stringify(f.core.admin.registrations()).includes(b.registration.bearer), false);
    } finally {
        await f.core.cleanup();
    }
});

test('registrations authorize reads, calls and immutable operation ownership across idle transfer', async () => {
    const { core, client } = await createManagedConnectionFixture();
    try {
        const a = client('a');
        const b = client('b');
        const request = {
            action: 'start' as const,
            requestId: 'same',
            isolation: { mode: 'none' as const },
            launch: { executable: 'fixture' },
        };
        const first = await core.control(request, a.context());
        const second = await core.control(request, b.context());
        assert.notEqual(first.operationId, second.operationId);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const own = await core.control({ action: 'status', operationId: String(first.operationId) }, a.context());
        const connectionId = String(own.connectionId);
        const sessionId = String(own.sessionId);
        await assert.rejects(
            core.control({ action: 'status', operationId: String(first.operationId) }, b.context()),
            /absent or unauthorized/,
        );
        await assert.rejects(
            core.control({ action: 'cancel', operationId: String(first.operationId) }, b.context()),
            /absent or unauthorized/,
        );
        await assert.rejects(
            core.control({ action: 'status', connectionId, include: ['configuration'] }, b.context()),
            /absent or unauthorized/,
        );
        const reconnect = core.attachClient(a.registration.bearer);
        assert.equal(
            (
                await core.control(
                    request,
                    reconnect.request({ requestId: 1, capabilities: { roots: false, formElicitation: false } }),
                )
            ).operationId,
            first.operationId,
        );
        core.admin.transfer(connectionId, b.registration.principal.registrationId);
        await assert.rejects(
            core.invoke('echo', { _dct: { connectionId, sessionId } }, a.context()),
            /absent or unauthorized/,
        );
        const result = await core.invoke('echo', { _dct: { connectionId, sessionId } }, b.context());
        assert.deepEqual(result.structuredContent, { roots: { roots: [{ uri: 'file:///a' }] } });
        assert.equal(
            (await core.control({ action: 'status', operationId: String(first.operationId) }, a.context())).state,
            'succeeded',
        );
        await assert.rejects(
            core.control({ action: 'status', operationId: String(first.operationId) }, b.context()),
            /absent or unauthorized/,
        );
    } finally {
        await core.cleanup();
    }
});
