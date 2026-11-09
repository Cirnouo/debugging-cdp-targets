import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientRequestContext } from '../../../src/shared/client-context.ts';
import { createManagedConnectionFixture } from '../../fixtures/gateway/core-runtime.ts';

for (const scope of ['target', 'official', 'both'] as const) {
    test(`${scope} restart retains admitted roots, launch/environment and official configuration after mutation and transfer`, async () => {
        const previous = process.env.DCT_TEST_SNAPSHOT;
        process.env.DCT_TEST_SNAPSHOT = 'original';
        const f = await createManagedConnectionFixture();
        const a = f.client('a');
        const b = f.client('b');
        const roots = { roots: [{ uri: 'file:///original' }] };
        const context = a.handle.request({
            requestId: 0,
            capabilities: { roots: true, formElicitation: false },
            readRoots: async () => roots,
        });
        const options = {
            isolation: { mode: 'none' as const },
            launch: { executable: 'fixture', args: ['--remote-debugging-port={port}', '%DCT_TEST_SNAPSHOT%', '9222'] },
            mcpArgs: ['--categoryNetwork=false', '--workspace=/admitted-workspace', '--allowUnrestrictedPaths'],
        };
        try {
            const original = await f.core.controller.start(options, { client: context });
            async function assertAdmittedConfiguration(client: ClientRequestContext) {
                const selected = await f.core.control(
                    { action: 'status', connectionId: original.connectionId, include: ['configuration'] },
                    client,
                );
                assert.deepEqual(selected.workspace, {
                    officialDirectories: ['/admitted-workspace'],
                    officialSource: 'explicit-workspace',
                    clientRoots: 'immutable-start-snapshot',
                    unrestrictedPaths: true,
                    cwdGrantsAccess: false,
                });
                assert.deepEqual(selected.roots, { roots: [{ uri: 'file:///original' }] });
            }
            await assertAdmittedConfiguration(context);
            options.launch.args[1] = 'changed';
            options.mcpArgs[0] = '--slim';
            options.mcpArgs[1] = '--workspace=/changed-workspace';
            options.mcpArgs[2] = '--allowUnrestrictedPaths=false';
            process.env.DCT_TEST_SNAPSHOT = 'changed';
            assert.ok(roots.roots[0]);
            roots.roots[0].uri = 'file:///changed';
            await assertAdmittedConfiguration(context);
            f.core.admin.transfer(original.connectionId, b.registration.principal.registrationId);
            await assertAdmittedConfiguration(b.context());
            const result = await f.core.controller.restart({
                connectionId: original.connectionId,
                sessionId: original.sessionId ?? '',
                scope,
            });
            assert.equal(f.launchInputs.at(-1)?.preparedLaunch?.environment.DCT_TEST_SNAPSHOT, 'original');
            assert.equal(f.launchInputs.at(-1)?.preparedLaunch?.arguments[1], 'original');
            assert.equal(f.officialInputs.at(-1)?.environment.DCT_TEST_SNAPSHOT, 'original');
            assert.ok(f.officialInputs.at(-1)?.args.includes('--categoryNetwork=false'));
            assert.equal(f.officialInputs.at(-1)?.args.includes('--slim'), false);
            await assertAdmittedConfiguration(b.context());
            const response = await f.core.invoke(
                'echo',
                { _dct: { connectionId: result.connectionId, sessionId: result.sessionId } },
                b.context(),
            );
            assert.deepEqual(response.structuredContent, { roots: { roots: [{ uri: 'file:///original' }] } });
        } finally {
            await f.core.cleanup();
            if (previous === undefined) delete process.env.DCT_TEST_SNAPSHOT;
            else process.env.DCT_TEST_SNAPSHOT = previous;
        }
    });
}

test('failed official-only repair performs final normal cleanup without escalating or launching a target', async () => {
    const f = await createManagedConnectionFixture();
    try {
        const target = await f.core.controller.start(
            {
                isolation: { mode: 'none' },
                launch: { executable: 'fixture' },
            },
            { client: f.client('direct-controller').context() },
        );
        f.failOfficial();
        await assert.rejects(
            f.core.controller.restart({
                connectionId: target.connectionId,
                sessionId: target.sessionId ?? '',
                scope: 'official',
            }),
            /Official acquisition failed/,
        );
        assert.deepEqual(f.counts(), { launched: 1, closed: 1 });
        assert.throws(() => f.core.controller.status(target.connectionId), /absent|closed/);
    } finally {
        await f.core.cleanup();
    }
});

for (const scope of ['target', 'official', 'both'] as const) {
    test(`scoped ${scope} restart preserves logical ownership and only replaces the requested side`, async () => {
        const f = await createManagedConnectionFixture();
        const a = f.client('a');
        try {
            const before = await f.core.controller.start(
                { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
                { client: a.context() },
            );
            const resources = f.generations();
            const restarted = await f.core.controller.restart({
                connectionId: before.connectionId,
                sessionId: before.sessionId ?? '',
                scope,
            });
            assert.equal(restarted.connectionId, before.connectionId);
            assert.notEqual(restarted.sessionId, before.sessionId);
            assert.equal(f.generations().routersCreated, resources.routersCreated);
            assert.equal(f.generations().officialCreated - resources.officialCreated, scope === 'target' ? 0 : 1);
            assert.equal(f.counts().launched, scope === 'official' ? 1 : 2);
            assert.equal(f.counts().closed, scope === 'official' ? 0 : 1);
            if (scope !== 'target') f.officialExits[0]?.();
            const live = f.core.controller.status(before.connectionId);
            assert.ok('status' in live);
            assert.equal(live.status, 'active');
            await assert.rejects(
                f.core.invoke(
                    'echo',
                    { _dct: { connectionId: before.connectionId, sessionId: before.sessionId } },
                    a.context(),
                ),
                /stale/,
            );
            await f.core.invoke(
                'echo',
                { _dct: { connectionId: before.connectionId, sessionId: restarted.sessionId } },
                a.context(),
            );
        } finally {
            await f.core.cleanup();
        }
    });
}
