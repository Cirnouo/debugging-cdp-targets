import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createGatewayCore } from '../src/application/plugin-runtime.ts';
import type { LaunchOptions } from '../src/domains/control-contract.ts';
import type { ClientRequestContext } from '../src/shared/client-context.ts';

async function fixture() {
    const tool = { name: 'echo', inputSchema: { type: 'object' as const, properties: {} } };
    const catalog = createToolCatalog({ version: '1.11.0', tools: [{ name: 'echo', requires: {}, variants: [tool] }] });
    const children = new Map<number, EventEmitter>();
    let launched = 0;
    let closed = 0;
    let rejectClose = false;
    let rejectOfficial = false;
    let officialCreated = 0;
    let officialClosed = 0;
    let routersCreated = 0;
    const officialExits: (() => void)[] = [];
    const launchInputs: LaunchOptions[] = [];
    const officialInputs: { args: string[]; environment: NodeJS.ProcessEnv }[] = [];
    let settle: () => void = () => {};
    let entered: () => void = () => {};
    const executing = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const core = await createGatewayCore({
        loadCatalog: async () => catalog,
        createRouter: async () => {
            routersCreated += 1;
            return {
                url: 'http://127.0.0.1:30000',
                isBusy: () => false,
                setTarget() {},
                clearTarget() {},
                close: async () => {},
            };
        },
        createHost: () => ({
            launch: async (options) => {
                launchInputs.push(structuredClone(options));
                const processId = ++launched;
                const child = new EventEmitter();
                children.set(processId, child);
                return {
                    processId,
                    port: 9222 + processId,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-17T00:00:00Z',
                    targetKind: 'generic-cdp' as const,
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: [] },
                };
            },
            close: async (target) => {
                closed += 1;
                if (rejectClose && target.processId === 1) throw new Error('Normal close refused.');
                children.get(target.processId)?.emit('exit');
                return true;
            },
        }),
        createConnection: async (_url, options) => {
            officialCreated += 1;
            officialInputs.push({ args: [...(options?.args ?? [])], environment: { ...options?.environment } });
            if (rejectOfficial) throw new Error('Official acquisition failed.');
            return {
                tools: [tool],
                call: async (_name, args, _signal, progress) => {
                    progress?.({ progress: 1 });
                    if (args.hold) {
                        entered();
                        await new Promise<void>((resolve) => {
                            settle = resolve;
                        });
                        progress?.({ progress: 2 });
                    }
                    if (args.elicit)
                        await options?.elicitation?.request(
                            { mode: 'form', message: 'origin', requestedSchema: { type: 'object', properties: {} } },
                            new AbortController().signal,
                        );
                    return { content: [], structuredContent: { roots: await options?.roots?.() } };
                },
                close: async () => {
                    officialClosed += 1;
                },
                onExit(listener) {
                    officialExits.push(listener);
                },
                rootsChanged: async () => {},
            };
        },
    });
    function client(name: string) {
        const registration = core.register();
        const handle = core.attachClient(registration.bearer);
        const events: string[] = [];
        const context = (): ClientRequestContext =>
            handle.request({
                requestId: 0,
                capabilities: { roots: true, formElicitation: true },
                readRoots: async () => ({ roots: [{ uri: `file:///${name}` }] }),
                onProgress: () => events.push('progress'),
                elicit: async () => {
                    events.push('form');
                    return { action: 'cancel' };
                },
            });
        return { handle, events, context, registration };
    }
    return {
        core,
        client,
        counts: () => ({ launched, closed }),
        generations: () => ({ officialCreated, officialClosed, routersCreated }),
        officialExits,
        executing,
        settle: () => settle(),
        failClose: (value: boolean) => {
            rejectClose = value;
        },
        failOfficial: () => {
            rejectOfficial = true;
        },
        launchInputs,
        officialInputs,
    };
}

test('final cleanup attempts peers, retains a failed live owner and retries without reporting successful exit', async () => {
    const f = await fixture();
    try {
        await f.core.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        await f.core.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } });
        f.failClose(true);
        await assert.rejects(f.core.cleanup(), /cleanup.*failed|did not close/);
        assert.equal(f.counts().closed, 2);
        assert.equal(f.core.admin.status().connections.length, 1);
        await assert.rejects(
            f.core.controller.start({ isolation: { mode: 'none' }, launch: { executable: 'fixture' } }),
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

test('negotiated roots failure precedes all connection acquisitions while unsupported roots are empty', async () => {
    const f = await fixture();
    const registration = f.core.register();
    const client = f.core.attachClient(registration.bearer);
    try {
        const failed = client.request({
            requestId: 0,
            capabilities: { roots: true, formElicitation: false },
            readRoots: async () => {
                throw new Error('Roots unavailable.');
            },
        });
        await assert.rejects(
            f.core.controller.start(
                { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
                { client: failed },
            ),
            /Roots unavailable/,
        );
        assert.deepEqual(f.counts(), { launched: 0, closed: 0 });
        assert.equal(f.generations().routersCreated, 1);
        const unsupported = client.request({
            requestId: 1,
            capabilities: { roots: false, formElicitation: false },
            readRoots: async () => {
                throw new Error('Must not request unnegotiated roots.');
            },
        });
        const connection = await f.core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: unsupported },
        );
        const result = await f.core.invoke(
            'echo',
            { _dct: { connectionId: connection.connectionId, sessionId: connection.sessionId } },
            unsupported,
        );
        assert.deepEqual(result.structuredContent, { roots: { roots: [] } });
    } finally {
        await f.core.cleanup();
    }
});

for (const scope of ['target', 'official', 'both'] as const) {
    test(`${scope} restart retains admitted roots, launch/environment and official configuration after mutation and transfer`, async () => {
        const previous = process.env.DCT_TEST_SNAPSHOT;
        process.env.DCT_TEST_SNAPSHOT = 'original';
        const f = await fixture();
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
            mcpArgs: ['--categoryNetwork=false'],
        };
        try {
            const original = await f.core.controller.start(options, { client: context });
            options.launch.args[1] = 'changed';
            options.mcpArgs[0] = '--slim';
            process.env.DCT_TEST_SNAPSHOT = 'changed';
            assert.ok(roots.roots[0]);
            roots.roots[0].uri = 'file:///changed';
            f.core.admin.transfer(original.connectionId, b.registration.principal);
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
    const f = await fixture();
    try {
        const target = await f.core.controller.start({
            isolation: { mode: 'none' },
            launch: { executable: 'fixture' },
        });
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

test('transport-free core keeps resources while a client detaches and binds forms/progress to each request', async () => {
    const { core, client, counts } = await fixture();
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

for (const scope of ['target', 'official', 'both'] as const) {
    test(`scoped ${scope} restart preserves logical ownership and only replaces the requested side`, async () => {
        const f = await fixture();
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

test('client abort detaches its wait while actual official execution keeps the connection busy', async () => {
    const f = await fixture();
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
        assert.throws(() => core.admin.transfer(first.connectionId, b.registration.principal), /busy/);
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
        core.admin.transfer(first.connectionId, b.registration.principal);
        await core.invoke('echo', { _dct: route }, b.context());
        assert.deepEqual(a.events, ['progress']);
    } finally {
        f.settle();
        await core.cleanup();
    }
});

test('registrations authorize reads, calls and immutable operation ownership across idle transfer', async () => {
    const { core, client } = await fixture();
    try {
        const a = client('a');
        const b = client('b');
        const request = {
            action: 'start' as const,
            entryId: core.entryId,
            requestId: 'same',
            isolation: { mode: 'none' as const },
            launch: { executable: 'fixture' },
        };
        const first = await core.control(request, a.context());
        const second = await core.control(request, b.context());
        assert.notEqual(first.operationId, second.operationId);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const own = await core.control(
            { action: 'status', operationId: String(first.operationId), entryId: core.entryId },
            a.context(),
        );
        const connectionId = String(own.connectionId);
        const sessionId = String(own.sessionId);
        await assert.rejects(
            core.control(
                { action: 'status', operationId: String(first.operationId), entryId: core.entryId },
                b.context(),
            ),
            /absent or unauthorized/,
        );
        await assert.rejects(
            core.control(
                { action: 'cancel', operationId: String(first.operationId), entryId: core.entryId },
                b.context(),
            ),
            /absent or unauthorized/,
        );
        await assert.rejects(
            core.control(
                { action: 'status', connectionId, include: ['configuration'], entryId: core.entryId },
                b.context(),
            ),
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
        core.admin.transfer(connectionId, b.registration.principal);
        await assert.rejects(
            core.invoke('echo', { _dct: { connectionId, sessionId } }, a.context()),
            /absent or unauthorized/,
        );
        const result = await core.invoke('echo', { _dct: { connectionId, sessionId } }, b.context());
        assert.deepEqual(result.structuredContent, { roots: { roots: [{ uri: 'file:///a' }] } });
        assert.equal(
            (
                await core.control(
                    { action: 'status', operationId: String(first.operationId), entryId: core.entryId },
                    a.context(),
                )
            ).state,
            'succeeded',
        );
        await assert.rejects(
            core.control(
                { action: 'status', operationId: String(first.operationId), entryId: core.entryId },
                b.context(),
            ),
            /absent or unauthorized/,
        );
    } finally {
        await core.cleanup();
    }
});
