import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import type { ConnectionStatus } from '../src/domains/control-contract.ts';
import { parseControlRequest } from '../src/domains/control-contract.ts';
import { isRecord } from '../src/shared/errors.ts';
import { createCoreFixture } from './fixtures/core-runtime.ts';

class Application extends EventEmitter {
    exitCode: number | null = null;
    signalCode: string | null = null;

    exit() {
        this.exitCode = 0;
        this.emit('exit');
    }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture(
    options: {
        failAppClose?: boolean;
        failUpstreamClose?: boolean;
        waitExit?: boolean;
        launchGate?: Promise<void>;
        connectionGate?: Promise<void>;
        callGate?: Promise<void>;
        healthGate?: Promise<void>;
        replacementRouterGate?: Promise<void>;
        replacementConnectionGate?: Promise<void>;
        failLateUpstreamClose?: boolean;
        failLateRouterClose?: boolean;
        disposalGate?: Promise<void>;
        busyRouter?: boolean;
        requestGate?: Promise<void>;
        exitOnUpstreamClose?: boolean;
        failReplacementConnection?: boolean;
    } = {},
) {
    const applications: Application[] = [];
    const order: string[] = [];
    let upstreamCloses = 0;
    let routerCount = 0;
    let lateRouterCloses = 0;
    let lateUpstreamCloses = 0;
    let health: 'healthy' | 'gone' = 'healthy';
    let timeoutCall = false;
    let callSignal: AbortSignal | undefined;
    const tools = [{ name: 'list_pages', inputSchema: { type: 'object' as const, properties: {} } }];
    const runtime = await createCoreFixture({
        loadCatalog: async () =>
            createToolCatalog({
                version: '1.11.0',
                tools: [{ name: 'list_pages', requires: {}, variants: tools }],
            }),
        createHost: () => ({
            launch: async (_options, context) => {
                const child = new Application();
                child.once('exit', () => order.push('application-exit'));
                applications.push(child);
                const target = {
                    processId: 700 + applications.length,
                    port: 9333 + applications.length,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-05T00:00:00.000Z',
                    targetKind: 'generic-cdp' as const,
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: [] },
                };
                if (isRecord(context) && typeof context.onCreated === 'function') context.onCreated(target);
                await options.launchGate;
                return target;
            },
            close: async (target) => {
                order.push('close-request');
                if (options.failAppClose) return false;
                const child = applications.find((_child, index) => target.processId === 701 + index);
                assert.ok(child);
                if (options.waitExit && child.exitCode === null)
                    await new Promise<void>((resolve) => child.once('exit', resolve));
                else if (child.exitCode === null) child.exit();
                return true;
            },
            health: async (target) => {
                if (target.processId === 701) await options.healthGate;
                return health;
            },
            ...(options.requestGate
                ? {
                      requestNormalClose: async () => {
                          order.push('close-request');
                          await options.requestGate;
                          return { closeRequested: true };
                      },
                  }
                : {}),
        }),
        createRouter: async () => {
            const index = ++routerCount;
            if (index === 3) await options.replacementRouterGate;
            return {
                url: 'http://127.0.0.1:32100',
                isBusy: () => options.busyRouter === true,
                setTarget: () => {},
                clearTarget: () => order.push('route-invalidated'),
                close: async () => {
                    order.push('router-close');
                    if (index === 3 && ++lateRouterCloses === 1 && options.failLateRouterClose)
                        throw new Error('late router disposal failed');
                },
            };
        },
        createConnection: async () => {
            const targetIndex = applications.length;
            if (targetIndex === 2) await options.replacementConnectionGate;
            if (targetIndex === 2 && options.failReplacementConnection)
                throw new Error('replacement initialize failed');
            let onExit = () => {};
            if (applications.length) await options.connectionGate;
            return {
                tools,
                onExit: (listener) => {
                    onExit = listener;
                },
                rootsChanged: async () => {},
                call: async (_name, _arguments, signal, progress) => {
                    if (targetIndex === 1 && options.callGate) {
                        callSignal = signal;
                        await options.callGate;
                        progress?.({ progress: 1 });
                    }
                    if (timeoutCall) throw new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out.');
                    return { content: [{ type: 'text', text: 'unchanged' }] };
                },
                close: async () => {
                    upstreamCloses += 1;
                    order.push('upstream-close');
                    if (targetIndex === 2 && ++lateUpstreamCloses === 1 && options.failLateUpstreamClose)
                        throw new Error('late upstream disposal failed');
                    if (targetIndex === 1) await options.disposalGate;
                    if (options.exitOnUpstreamClose) onExit();
                    if (options.failUpstreamClose && upstreamCloses === 2) throw new Error('upstream cleanup failed');
                },
            };
        },
    });
    assert.ok(runtime?.control);
    const selectedCallbacks = runtime;
    assert.ok(selectedCallbacks.control);
    const control = selectedCallbacks.control;
    const status = (value: Record<string, unknown> = {}) =>
        control(parseControlRequest({ action: 'status', ...value }));
    const start = () =>
        runtime.controller.start({
            isolation: { mode: 'none' },
            launch: { executable: process.execPath },
            mcpArgs: ['--workspace', process.cwd()],
        });
    const invoke = (current: ConnectionStatus) =>
        selectedCallbacks.invoke(
            'list_pages',
            {
                _dct: { connectionId: current.connectionId, sessionId: current.sessionId },
            },
            new AbortController().signal,
            () => {},
        );
    order.length = 0;
    return {
        runtime,

        control,
        status,
        start,
        applications,
        order,
        invoke,
        gone: () => {
            health = 'gone';
        },
        timeout: () => {
            timeoutCall = true;
        },
        upstreamCloses: () => upstreamCloses,
        callSignal: () => callSignal,
        lateUpstreamCloses: () => lateUpstreamCloses,
        lateRouterCloses: () => lateRouterCloses,
    };
}

for (const kept of [false, true]) {
    test(`route retirement precedes deferred cleanup for a ${kept ? 'kept' : 'live'} connection`, async () => {
        let release = () => {};
        const disposalGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const f = await fixture({ disposalGate });
        try {
            const current = await f.start();
            const peer = await f.start();
            assert.ok(current.sessionId);
            if (kept)
                await f.runtime.controller.stop({
                    connectionId: current.connectionId,
                    sessionId: current.sessionId,
                    disposition: 'Keep',
                });
            f.applications[0]?.exit();
            assert.throws(() => f.runtime.controller.status(current.connectionId), /closed/);
            await tick();
            assert.equal(
                f.runtime.core.admin.registrations()[0]?.resources,
                2,
                'A revoked route must retain its pending cleanup ownership.',
            );
            await assert.rejects(f.invoke(current), /closed|retired|exited/i);
            await f.invoke(peer);
            release();
            await tick();
            await tick();
            assert.equal(f.runtime.core.admin.registrations()[0]?.resources, 1);
            await f.invoke(peer);
        } finally {
            release();
            await f.runtime.cleanup();
        }
    });
}

test('actual exit immediately ends a call awaiting health validation and old health cannot block a new session', async () => {
    let release = () => {};
    const healthGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await fixture({ healthGate });
    const current = await f.start();
    let settled = false;
    const rejected = assert.rejects(f.invoke(current), /exit|closed|retired/i).then(() => {
        settled = true;
    });
    await tick();
    f.applications[0]?.exit();
    await tick();
    try {
        assert.equal(settled, true, 'exit must abort health validation without waiting for its I/O');
    } finally {
        release();
        await rejected;
        await f.runtime.cleanup();
    }
});

test('normal Close is allowed while its router and official call are busy', async () => {
    let release = () => {};
    const callGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await fixture({ busyRouter: true, callGate });
    const current = await f.start();
    assert.ok(current.sessionId);
    const rejected = assert.rejects(f.invoke(current), /exit|closed|retired/i);
    await tick();
    try {
        await f.runtime.controller.stop({
            connectionId: current.connectionId,
            sessionId: current.sessionId,
            disposition: 'Close',
        });
        assert.equal(f.applications[0]?.exitCode, 0);
        assert.equal(f.callSignal()?.aborted, true);
    } finally {
        release();
        f.applications[0]?.exit();
        await rejected;
        await f.runtime.cleanup();
    }
});

test('actual exit completes Close even while the normal-close request still awaits authorization', async () => {
    let release = () => {};
    const requestGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await fixture({ requestGate });
    const current = await f.start();
    assert.ok(current.sessionId);
    let settled = false;
    const close = f.runtime.controller
        .stop({ connectionId: current.connectionId, sessionId: current.sessionId, disposition: 'Close' })
        .then(() => {
            settled = true;
        });
    await tick();
    f.applications[0]?.exit();
    await tick();
    try {
        assert.equal(settled, true, 'a confirmed application exit does not wait for an unfinished request');
    } finally {
        release();
        await close;
        await f.runtime.cleanup();
    }
});

test('normal Close remains available after a terminal official failure', async () => {
    let release = () => {};
    const disposalGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await fixture({ disposalGate });
    const current = await f.start();
    assert.ok(current.sessionId);
    f.timeout();
    const rejected = assert.rejects(f.invoke(current), /timed out/i);
    await tick();
    const close = f.runtime.controller.stop({
        connectionId: current.connectionId,
        sessionId: current.sessionId,
        disposition: 'Close',
    });
    await tick();
    try {
        assert.ok(f.order.includes('close-request'), 'upstream disposal cannot delay the application close request');
        assert.equal(f.applications[0]?.exitCode, 0);
    } finally {
        release();
        await rejected;
        await close;
        await f.runtime.cleanup();
    }
});

test('a settled SDK failure does not dispose or quarantine a healthy official child', async () => {
    const f = await fixture({ exitOnUpstreamClose: true });
    try {
        const current = await f.start();
        f.timeout();
        await assert.rejects(f.invoke(current), /timed out/);
        const state = f.runtime.controller.status(current.connectionId);
        assert.ok('status' in state);
        assert.equal(state.status, 'active');
        assert.equal(state.upstreamStatus, 'connected');
    } finally {
        await f.runtime.cleanup();
    }
});

test('cancelling a Close wait retains the accepted request and exit observation for a later retry', async () => {
    const f = await fixture({ requestGate: Promise.resolve() });
    const current = await f.start();
    assert.ok(current.sessionId);
    const abort = new AbortController();
    const pending = f.runtime.controller.stop(
        { connectionId: current.connectionId, sessionId: current.sessionId, disposition: 'Close' },
        { signal: abort.signal },
    );
    const rejected = assert.rejects(pending, (error) => error === abort.signal.reason);
    await tick();
    abort.abort(new Error('cancel this Close wait'));
    await rejected;
    assert.equal(f.applications[0]?.exitCode, null);
    const retry = f.runtime.controller.stop({
        connectionId: current.connectionId,
        sessionId: current.sessionId,
        disposition: 'Close',
    });
    await tick();
    assert.equal(f.order.filter((value) => value === 'close-request').length, 1);
    f.applications[0]?.exit();
    await retry;
    assert.throws(() => f.runtime.controller.status(current.connectionId), /closed/);
    await f.runtime.cleanup();
});

test('a failed restart normally closes both the old target and replacement rollback', async () => {
    const f = await fixture({ failReplacementConnection: true });
    try {
        const current = await f.start();
        assert.ok(current.sessionId);
        const accepted = await f.control({
            action: 'restart',
            requestId: 'replacement-rollback',
            connectionId: current.connectionId,
            sessionId: current.sessionId,
            scope: 'both',
        });
        await tick();
        const operation = f.runtime.core.admin.operations().find((item) => item.operationId === accepted.operationId);
        assert.equal(operation?.action, 'restart');
        assert.equal(operation?.state, 'failed');
        assert.equal(f.applications.length, 2);
        assert.ok(f.applications.every((application) => application.exitCode === 0));
        const gateway = f.runtime.controller.status();
        assert.ok('connections' in gateway);
        assert.deepEqual(gateway.connections, []);
    } finally {
        await f.runtime.cleanup();
    }
});

test('a Close operation waits for owned disposal before becoming terminal', async () => {
    let release = () => {};
    const disposalGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await fixture({ disposalGate });
    try {
        const current = await f.start();
        assert.ok(current.sessionId);
        const accepted = await f.control({
            action: 'stop',
            requestId: 'expected-close',
            connectionId: current.connectionId,
            sessionId: current.sessionId,
            disposition: 'Close',
        });
        await tick();
        assert.equal(
            f.runtime.core.admin.operations().find((item) => item.operationId === accepted.operationId)?.state,
            'running',
        );
        release();
        await tick();
        assert.equal(
            f.runtime.core.admin.operations().find((item) => item.operationId === accepted.operationId)?.state,
            'succeeded',
        );
    } finally {
        release();
        await f.runtime.cleanup();
    }
});

test('gateway shutdown awaits replacement official acquisition and retries late failed disposal', async () => {
    let release = () => {};
    const replacementRouterGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await fixture({ replacementConnectionGate: replacementRouterGate, failLateUpstreamClose: true });
    const current = await f.start();
    assert.ok(current.sessionId);
    const restart = f.runtime.controller.restart({
        connectionId: current.connectionId,
        sessionId: current.sessionId,
        scope: 'both',
    });
    const failed = assert.rejects(restart, /closing|retired|exited|late upstream disposal failed/);
    await tick();
    let closed = false;
    const shutdown = f.runtime.cleanup().then(() => {
        closed = true;
    });
    await tick();
    try {
        assert.equal(closed, false, 'shutdown must account for the in-flight replacement official child');
    } finally {
        release();
        await failed;
        await shutdown;
    }
    assert.equal(f.lateUpstreamCloses(), 2, 'late failed disposal remains owned and receives the shutdown retry');
});

test('actual exit aborts an in-flight official call and suppresses late progress and result while a peer stays usable', async () => {
    let release = () => {};
    const callGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await fixture({ callGate });
    const first = await f.start();
    const second = await f.start();
    const progress: unknown[] = [];
    const pending = f.runtime.invoke(
        'list_pages',
        { _dct: { connectionId: first.connectionId, sessionId: first.sessionId } },
        new AbortController().signal,
        (value) => progress.push(value),
    );
    const rejected = assert.rejects(pending, /exit|closed|retired/i);
    await tick();
    f.applications[0]?.exit();
    assert.equal(f.callSignal()?.aborted, true);
    assert.equal((await f.invoke(second)).isError, undefined);
    release();
    await rejected;
    assert.deepEqual(progress, []);
    await f.runtime.cleanup();
});

test('gateway shutdown closes official resources before waiting on an already pending Target Close', async () => {
    const f = await fixture({ waitExit: true });
    const first = await f.start();
    const second = await f.start();
    assert.ok(first.sessionId);
    const close = f.runtime.controller.stop({
        connectionId: first.connectionId,
        sessionId: first.sessionId,
        disposition: 'Close',
    });
    await tick();
    assert.equal(f.upstreamCloses(), 1);
    const shutdown = f.runtime.cleanup();
    await tick();
    assert.equal(f.upstreamCloses(), 3);
    const observed = f.runtime.controller.status(second.connectionId);
    assert.ok('processId' in observed);
    await assert.rejects(f.invoke(second), /closing/);
    f.applications[1]?.exit();
    f.applications[0]?.exit();
    await close;
    await shutdown;
});

test('ordinary status gives a gateway summary and selected enabled names without implicit schemas or configuration', async () => {
    const f = await fixture();
    try {
        const empty = await f.status();
        assert.deepEqual(Object.keys(empty).sort(), ['connections']);
        const current = await f.start();
        const all = await f.status({});
        assert.ok(Array.isArray(all.connections));
        const connection: unknown = all.connections[0];
        assert.ok(isRecord(connection));
        assert.equal(connection.upstreamStatus, 'connected');
        assert.equal(connection.enabledToolCount, 1);
        for (const key of ['enabledTools', 'mcpArgs', 'workspace', 'diagnostics', 'toolAvailability'])
            assert.equal(Object.hasOwn(connection, key), false, key);
        const selected = await f.status({ connectionId: current.connectionId });
        assert.deepEqual(selected.enabledTools, ['list_pages']);
        for (const key of ['mcpArgs', 'workspace', 'diagnostics', 'toolAvailability'])
            assert.equal(Object.hasOwn(selected, key), false, key);
        const details = await f.status({
            connectionId: current.connectionId,
            include: ['configuration', 'diagnostics'],
        });
        assert.ok(Array.isArray(details.mcpArgs));
        assert.ok(isRecord(details.workspace));
        assert.ok(Array.isArray(details.diagnostics));
    } finally {
        await f.runtime.cleanup();
    }
});

test('exit during CDP readiness cancels startup before official acquisition without acquiring an official child', async () => {
    let ready = () => {};
    const launchGate = new Promise<void>((resolve) => {
        ready = resolve;
    });
    const f = await fixture({ launchGate });
    const starting = f.start();
    const failed = assert.rejects(starting, /exit|retired|closed|abort/i);
    await tick();
    f.applications[0]?.exit();
    ready();
    await failed;
    const status = f.runtime.controller.status();
    assert.ok('connections' in status);
    assert.deepEqual(status.connections, []);
    await f.runtime.cleanup();
});

test('a late official connection cannot publish a ready session after its Target exited', async () => {
    let connected = () => {};
    const connectionGate = new Promise<void>((resolve) => {
        connected = resolve;
    });
    const f = await fixture({ connectionGate });
    const starting = f.start();
    const failed = assert.rejects(starting, /exit|retired|closed|abort/i);
    await tick();
    f.applications[0]?.exit();
    connected();
    await failed;
    await tick();
    const status = f.runtime.controller.status();
    assert.ok('connections' in status);
    assert.deepEqual(status.connections, []);
    assert.equal(f.upstreamCloses(), 2);
    await f.runtime.cleanup();
});

test('a real active exit removes only its connection and leaves its peer usable', async () => {
    const f = await fixture();
    try {
        const first = await f.start();
        const second = await f.start();
        f.applications[0]?.exit();
        await tick();
        assert.throws(() => f.runtime.controller.status(first.connectionId), /absent|closed/);
        const stillActive = f.runtime.controller.status(second.connectionId);
        assert.ok('status' in stillActive);
        assert.equal(stillActive.status, 'active');
        await assert.rejects(f.invoke(first), /absent|closed/);
        const next = await f.start();
        assert.notEqual(next.connectionId, first.connectionId);
        assert.notEqual(next.sessionId, first.sessionId);
    } finally {
        await f.runtime.cleanup();
    }
});

test('late actual exit after a failed Close automatically retires the retained live connection', async () => {
    const f = await fixture({ failAppClose: true });
    try {
        const current = await f.start();
        assert.ok(current.sessionId);
        await assert.rejects(
            f.runtime.controller.stop({
                connectionId: current.connectionId,
                sessionId: current.sessionId,
                disposition: 'Close',
            }),
        );
        const retained = f.runtime.controller.status(current.connectionId);
        assert.ok('processId' in retained);
        assert.equal(retained.processId, current.processId);
        f.applications[0]?.exit();
        await tick();
        assert.throws(() => f.runtime.controller.status(current.connectionId), /absent|closed/);
        assert.equal(f.upstreamCloses(), 2);
    } finally {
        await f.runtime.cleanup();
    }
});

test('a missing process snapshot gates calls but cannot invent process exit or retire the session', async () => {
    const f = await fixture();
    try {
        const current = await f.start();
        f.gone();
        await f.invoke(current);
        const lost = f.runtime.controller.status(current.connectionId);
        assert.ok('status' in lost);
        assert.equal(lost.status, 'lost');
        assert.equal(f.upstreamCloses(), 1);
        f.applications[0]?.exit();
        await tick();
        assert.throws(() => f.runtime.controller.status(current.connectionId), /absent|closed/);
    } finally {
        await f.runtime.cleanup();
    }
});

test('post-exit disposal failures never retain a routable session and are retried at gateway shutdown', async () => {
    const f = await fixture({ failUpstreamClose: true });
    const current = await f.start();
    f.applications[0]?.exit();
    await tick();
    assert.throws(() => f.runtime.controller.status(current.connectionId), /absent|closed/);
    await assert.rejects(f.invoke(current), /absent|closed/);
    assert.equal(f.upstreamCloses(), 2);
    await f.runtime.cleanup();
    assert.equal(f.upstreamCloses(), 3);
});

test('Close waits for application exit before closing the upstream and router', async () => {
    const f = await fixture({ waitExit: true });
    const current = await f.start();
    assert.ok(current.sessionId);
    const closing = f.runtime.controller.stop({
        connectionId: current.connectionId,
        sessionId: current.sessionId,
        disposition: 'Close',
    });
    await tick();
    assert.equal(f.order.includes('upstream-close'), false);
    f.applications[0]?.exit();
    await closing;
    assert.ok(f.order.indexOf('application-exit') < f.order.indexOf('upstream-close'));
    assert.ok(f.order.indexOf('upstream-close') < f.order.indexOf('router-close'));
    await f.runtime.cleanup();
});

test('operation results remain summaries and an official failure creates no lifecycle operation', async () => {
    const f = await fixture();
    try {
        const accepted = await f.control({
            isolation: { mode: 'none' },
            action: 'start',
            requestId: 'compact-result',
            launch: { executable: process.execPath },
        });
        assert.equal(typeof accepted.operationId, 'string');
        await tick();
        const operation = f.runtime.core.admin.operations().find((item) => item.operationId === accepted.operationId);
        const text = JSON.stringify(operation?.result);
        for (const field of ['enabledTools', 'mcpArgs', 'workspace', 'diagnostics', 'inputSchema', 'suggestedMcpArgs'])
            assert.equal(text.includes(field), false, field);
        const status = f.runtime.controller.status();
        assert.ok('connections' in status && status.connections[0]);
        const prior = f.runtime.core.admin.operations().length;
        f.timeout();
        await assert.rejects(f.invoke(status.connections[0]), /timed out/);
        assert.equal(f.runtime.core.admin.operations().length, prior);
        assert.equal(f.runtime.core.admin.connections()[0]?.upstreamStatus, 'connected');
    } finally {
        await f.runtime.cleanup();
    }
});
