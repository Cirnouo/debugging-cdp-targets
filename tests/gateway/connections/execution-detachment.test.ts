import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagedConnectionFixture } from '../../fixtures/gateway/core-runtime.ts';

test('transport-free core keeps resources while a client detaches and binds forms/progress to each request', async () => {
    const { core, client, counts } = await createManagedConnectionFixture();
    try {
        const a = client('a');
        const b = client('b');
        assert.deepEqual(counts(), { launched: 0, closed: 0 });
        const first = await core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: a.context() },
        );
        const second = await core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: b.context() },
        );
        await core.invoke(
            'echo',
            { _dct: { connectionId: first.connectionId, sessionId: first.sessionId }, elicit: true },
            a.context(),
        );
        await core.invoke(
            'echo',
            { _dct: { connectionId: second.connectionId, sessionId: second.sessionId }, elicit: true },
            b.context(),
        );
        assert.deepEqual(a.events, ['progress', 'form']);
        assert.deepEqual(b.events, ['progress', 'form']);
        a.handle.detach();
        assert.deepEqual(counts(), { launched: 2, closed: 0 });
        await core.invoke(
            'echo',
            { _dct: { connectionId: second.connectionId, sessionId: second.sessionId } },
            b.context(),
        );
        assert.deepEqual(b.events, ['progress', 'form', 'progress']);
    } finally {
        await core.cleanup();
    }
});

test('client abort detaches its wait while actual official execution keeps the connection busy', async () => {
    const f = await createManagedConnectionFixture();
    const { core, client } = f;
    const a = client('a');
    const b = client('b');
    try {
        const first = await core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: a.context() },
        );
        const second = await core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: b.context() },
        );
        const route = { connectionId: first.connectionId, sessionId: first.sessionId };
        const pending = core.invoke('echo', { _dct: route, hold: true }, a.context());
        await f.executing;
        a.handle.detach();
        await assert.rejects(
            Promise.race([
                pending,
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('wait did not detach')), 100);
                }),
            ]),
            /unavailable/,
        );
        assert.equal(f.counts().closed, 0);
        assert.throws(() => core.admin.transfer(first.connectionId, b.registration.principal.registrationId), /busy/);
        await assert.rejects(
            core.invoke(
                'echo',
                { _dct: route },
                core
                    .attachClient(a.registration.bearer)
                    .request({ requestId: 1, capabilities: { roots: false, formElicitation: false } }),
            ),
            /busy/,
        );
        await core.invoke(
            'echo',
            { _dct: { connectionId: second.connectionId, sessionId: second.sessionId } },
            b.context(),
        );
        f.settle();
        await new Promise<void>((resolve) => setImmediate(resolve));
        core.admin.transfer(first.connectionId, b.registration.principal.registrationId);
        await core.invoke('echo', { _dct: route }, b.context());
        assert.deepEqual(a.events, ['progress']);
    } finally {
        f.settle();
        await core.cleanup();
    }
});

for (const mode of ['cancel', 'response-timeout', 'disconnect'] as const) {
    test(`${mode} detaches the response while a late failure remains accounted to the original execution`, async () => {
        const f = await createManagedConnectionFixture();
        const a = f.client('a');
        const b = f.client('b');
        const wait = new AbortController();
        try {
            const first = await f.core.controller.start(
                { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
                { client: a.context() },
            );
            const route = { connectionId: first.connectionId, sessionId: first.sessionId };
            const origin = a.handle.request({
                requestId: 0,
                capabilities: { roots: false, formElicitation: false },
                waitSignal: wait.signal,
                onProgress: () => a.events.push('progress'),
            });
            const pending = f.core.invoke('echo', { _dct: route, hold: true, fail: true }, origin);
            await f.executing;
            const rejected = assert.rejects(pending, /cancel|timeout|unavailable/);
            if (mode === 'disconnect') a.handle.detach();
            else wait.abort(new Error(mode === 'cancel' ? 'Client cancelled.' : 'Response timeout.'));
            await rejected;
            assert.equal(f.counts().closed, 0);
            assert.equal(f.generations().officialClosed, 1, 'Only initial catalog acquisition was closed.');
            assert.throws(
                () => f.core.admin.transfer(first.connectionId, b.registration.principal.registrationId),
                /busy/,
            );
            f.settle();
            await new Promise<void>((resolve) => setImmediate(resolve));
            f.core.admin.transfer(first.connectionId, b.registration.principal.registrationId);
            const result = await f.core.invoke('echo', { _dct: route }, b.context());
            assert.deepEqual(result.structuredContent, { roots: { roots: [{ uri: 'file:///a' }] } });
            assert.deepEqual(a.events, ['progress']);
            assert.equal(f.core.admin.operations().length, 0, 'Official calls have no second result archive.');
        } finally {
            f.settle();
            await f.core.cleanup();
        }
    });
}

test('actual target exit during detached execution invalidates only its old route and consumes late completion', async () => {
    const f = await createManagedConnectionFixture();
    const a = f.client('a');
    const b = f.client('b');
    try {
        const first = await f.core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: a.context() },
        );
        const peer = await f.core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: b.context() },
        );
        const route = { connectionId: first.connectionId, sessionId: first.sessionId };
        const pending = f.core.invoke('echo', { _dct: route, hold: true }, a.context());
        await f.executing;
        const detached = assert.rejects(pending, /unavailable/);
        a.handle.detach();
        await detached;
        assert.ok(first.processId);
        f.exit(first.processId);
        f.settle();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.throws(() => f.core.admin.status(first.connectionId), /absent|closed/);
        await f.core.invoke(
            'echo',
            { _dct: { connectionId: peer.connectionId, sessionId: peer.sessionId } },
            b.context(),
        );
        assert.deepEqual(a.events, ['progress']);
    } finally {
        f.settle();
        await f.core.cleanup();
    }
});
