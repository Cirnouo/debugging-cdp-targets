import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createAppManagement } from '../src/application/app-management.ts';
import { createOperationRegistry } from '../src/application/operations.ts';
import { createGatewayCore, type GatewayCore } from '../src/application/plugin-runtime.ts';
import type { AppManagementCommand, AppManagementSnapshot } from '../src/domains/app-ui.ts';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';
import { DetailedError, isRecord } from '../src/shared/errors.ts';

type Controller = {
    snapshot(): AppManagementSnapshot;
    manage(command: AppManagementCommand): Promise<AppManagementSnapshot>;
};
async function settled(core: GatewayCore, operationId: string) {
    let cursor = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
        const result = await core.admin.control({ action: 'wait', operationId, cursor });
        if (result.complete) return;
        assert.equal(typeof result.cursor, 'number');
        cursor = Number(result.cursor);
    }
    assert.fail('Lifecycle operation did not settle.');
}
function controller(core: GatewayCore, closing = () => false): Controller {
    return createAppManagement({
        core: () => core,
        closing,
        hosts: { snapshot: () => [], run: async () => {} },
    });
}
async function fixture() {
    let clock = 1000;
    let releaseExecution: (() => void) | undefined;
    let enteredExecution: (() => void) | undefined;
    const executionEntered = new Promise<void>((resolve) => {
        enteredExecution = resolve;
    });
    let closeFails = false;
    const children = new WeakMap<ManagedTarget, EventEmitter>();
    const tools = [{ name: 'list_pages', inputSchema: { type: 'object' as const, properties: {} } }];
    const core = await createGatewayCore({
        now: () => clock,
        createRouter: async () => ({
            url: 'http://127.0.0.1:30000',
            isBusy: () => false,
            setTarget() {},
            clearTarget() {},
            close: async () => {},
        }),
        createHost: () => ({
            launch: async (_options, context) => {
                const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null });
                const target: ManagedTarget = {
                    child,
                    port: 30001,
                    processId: 42,
                    targetKind: 'generic-cdp',
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-17T00:00:00Z',
                    launchDefinition: {
                        executablePath: process.execPath,
                        arguments: ['--fixture'],
                        cwd: process.cwd(),
                        env: { SYNTHETIC_TEST_SECRET: 'never-show-this-value' },
                    },
                };
                children.set(target, child);
                context?.onCreated?.(target);
                return target;
            },
            close: async (target: ManagedTarget) => {
                if (closeFails) return false;
                Object.assign(target.child ?? {}, { exitCode: 0 });
                children.get(target)?.emit('exit', 0);
                return true;
            },
        }),
        createConnection: async () => ({
            tools,
            call: async () => {
                enteredExecution?.();
                await new Promise<void>((resolve) => {
                    releaseExecution = resolve;
                });
                return { content: [] };
            },
            onExit() {},
            close: async () => {},
            rootsChanged: async () => {},
        }),
        loadCatalog: async () =>
            createToolCatalog({
                version: '1.11.0',
                tools: tools.map((tool) => ({ name: tool.name, requires: {}, variants: [tool] })),
            }),
    });
    const registration = core.register();
    const client = core.attachClient(registration.bearer);
    const request = () =>
        client.request({ requestId: randomUUID(), capabilities: { roots: false, formElicitation: false } });
    const start = () =>
        core.controller.start(
            { launch: { executable: process.execPath }, isolation: { mode: 'none' } },
            { client: request() },
        );
    return {
        core,
        registration,
        request,
        start,
        executionEntered,
        release: () => releaseExecution?.(),
        time: (next: number) => {
            clock = next;
        },
        failClose: (next: boolean) => {
            closeFails = next;
        },
    };
}

test('trusted management uses current scoped snapshots, excludes polling from clocks and preserves operation owners after transfer', async () => {
    const f = await fixture();
    try {
        const started = await f.start();
        assert.ok(started.sessionId);
        const route = { connectionId: started.connectionId, sessionId: started.sessionId };
        const app = await controller(f.core);
        const first = app.snapshot().connections[0];
        assert.equal(first?.establishedAt, 1000);
        const owned = await f.core.control(
            { action: 'stop', requestId: 'owned-keep', ...route, disposition: 'Keep' },
            f.request(),
        );
        assert.equal(typeof owned.operationId, 'string');
        await settled(f.core, String(owned.operationId));
        f.time(90_062_000);
        app.snapshot();
        const explicit = await app.manage({ kind: 'connection', route });
        assert.ok(explicit.selected);
        const launch = Reflect.get(explicit.selected, 'launch');
        assert.ok(isRecord(launch));
        assert.equal(launch.executable, process.execPath);
        assert.equal(JSON.stringify(explicit).includes('never-show-this-value'), false);
        assert.equal(Object.hasOwn(explicit.connections[0] ?? {}, 'launch'), false);
        assert.equal(app.snapshot().connections[0]?.lastRealOperationAt, first?.lastRealOperationAt);
        const changed = await app.manage({ kind: 'restart', route, scope: 'official' });
        const operation = changed.operations.find((item) => item.action === 'restart');
        assert.ok(operation);
        await settled(f.core, operation.operationId);
        const refreshed = f.core.admin.connections()[0];
        assert.ok(refreshed?.sessionId);
        assert.notEqual(refreshed.sessionId, route.sessionId);
        assert.equal(refreshed.establishedAt, 1000);
        await assert.rejects(app.manage({ kind: 'restart', route, scope: 'target' }), /stale/);
        const successor = f.core.register();
        const transfer = await app.manage({
            kind: 'transfer',
            routes: [{ connectionId: route.connectionId, sessionId: refreshed.sessionId }],
            registrationId: successor.principal.registrationId,
        });
        assert.equal(transfer.outcomes?.[0]?.state, 'transferred');
        assert.equal(transfer.connections[0]?.registrationId, successor.principal.registrationId);
        assert.equal(
            transfer.operations.find((item) => item.operationId === owned.operationId)?.registrationId,
            f.registration.principal.registrationId,
        );
        assert.equal(JSON.stringify(transfer).includes(f.registration.bearer), false);
    } finally {
        await f.core.cleanup();
    }
});

test('empty registration cleanup unregisters only the selected public identity', async () => {
    const f = await fixture();
    try {
        const app = await controller(f.core);
        const empty = f.core.register();
        await app.manage({ kind: 'unregister', registrationId: empty.principal.registrationId });
        assert.deepEqual(
            app.snapshot().registrations.map((item) => item.registrationId),
            [f.registration.principal.registrationId],
        );
        await assert.rejects(app.manage({ kind: 'unregister', registrationId: empty.principal.registrationId }));
    } finally {
        await f.core.cleanup();
    }
});

test('explicit operation reads expose bounded terminal evidence from the maintained registry with original ownership', async () => {
    const f = await fixture();
    const registry = createOperationRegistry(randomUUID());
    let release: (() => void) | undefined;
    const completed = async (operationId: string) => {
        let cursor = 0;
        for (let attempt = 0; attempt < 30; attempt++) {
            const result = await registry.wait(operationId, cursor);
            if (result.complete) return;
            cursor = result.cursor;
        }
        assert.fail('Fixture operation did not settle.');
    };
    const app = controller({
        ...f.core,
        admin: {
            ...f.core.admin,
            operations: registry.list,
            control: async (request) => {
                if (request.action === 'wait') return registry.wait(request.operationId, request.cursor);
                if (request.action === 'cancel') return { ...registry.cancel(request.operationId) };
                if (request.action === 'status' && request.operationId) return { ...registry.get(request.operationId) };
                return f.core.admin.control(request);
            },
        },
    });
    const isolation = {
        mode: 'data-dir',
        path: '/fixture-private/acquired',
        cleanup: 'delete-on-release',
        state: 'cleanup-failed',
    } as const;
    try {
        const failedStart = registry.submit(
            'failed-start',
            { action: 'start' },
            async (context) => {
                context.isolation(isolation);
                context.phase('launching');
                const error = new DetailedError('raw secret /private/start');
                error.details = {
                    phase: 'launching',
                    category: 'access-denied',
                    nativeError: 5,
                    cause: 'raw private cause',
                };
                throw error;
            },
            undefined,
            undefined,
            f.registration.principal.registrationId,
        );
        await completed(failedStart.operationId);
        assert.equal(JSON.stringify(app.snapshot()).includes(isolation.path), false);
        const start = await app.manage({ kind: 'operation-status', operationId: failedStart.operationId });
        assert.deepEqual(start.selectedOperation?.isolation, isolation);
        assert.deepEqual(start.selectedOperation?.error, {
            kind: 'start-failed',
            phase: 'launching',
            category: 'access-denied',
            nativeError: 5,
        });
        assert.equal(start.selectedOperation?.registrationId, f.registration.principal.registrationId);
        assert.equal(JSON.stringify(start).includes('raw '), false);
        const connection = await f.start();
        assert.ok(connection.sessionId);
        const route = { connectionId: connection.connectionId, sessionId: connection.sessionId };
        const failedClose = registry.submit(
            'failed-close',
            { action: 'stop' },
            async (context) => {
                context.isolation(isolation);
                const error = new DetailedError('raw secret /private/close');
                error.details = {
                    phase: 'normal-close',
                    closeRequested: true,
                    processExited: false,
                    listenerState: 'owned',
                    cleanupError: 'raw secret cleanup',
                };
                throw error;
            },
            undefined,
            route,
            f.registration.principal.registrationId,
        );
        await completed(failedClose.operationId);
        const successor = f.core.register();
        f.core.admin.transfer(route.connectionId, successor.principal.registrationId);
        const close = await app.manage({ kind: 'operation-wait', operationId: failedClose.operationId, cursor: 0 });
        assert.equal(close.selectedOperation?.state, 'failed');
        assert.deepEqual(close.selectedOperation?.error, {
            kind: 'close-failed',
            phase: 'normal-close',
            closeRequested: true,
            processExited: false,
            listenerState: 'owned',
        });
        assert.equal(close.selectedOperation?.wait?.complete, true);
        assert.equal(close.selectedOperation?.registrationId, f.registration.principal.registrationId);
        assert.notEqual(close.connections[0]?.registrationId, close.selectedOperation?.registrationId);
        const success = registry.submit('success', { action: 'stop' }, async () => ({
            ...route,
            status: 'idle',
            disposition: 'Close',
            pageIdsInvalidated: true,
            arbitrary: '/secret',
        }));
        await completed(success.operationId);
        const successRead = await app.manage({ kind: 'operation-wait', operationId: success.operationId, cursor: 0 });
        assert.deepEqual(successRead.selectedOperation?.result, {
            ...route,
            status: 'idle',
            disposition: 'Close',
            pageIdsInvalidated: true,
        });
        assert.equal(JSON.stringify(successRead).includes('/secret'), false);
        const pending = registry.submit('pending', { action: 'start' }, async (context) => {
            context.isolation(isolation);
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            context.signal.throwIfAborted();
            return {};
        });
        await Promise.resolve();
        const cancelled = await app.manage({ kind: 'operation-cancel', operationId: pending.operationId });
        assert.equal(cancelled.selectedOperation?.state, 'cancelling');
        assert.deepEqual(cancelled.selectedOperation?.isolation, isolation);
        release?.();
        await completed(pending.operationId);
        const terminal = await app.manage({ kind: 'operation-wait', operationId: pending.operationId, cursor: 0 });
        assert.equal(terminal.selectedOperation?.state, 'cancelled');
        assert.equal(terminal.selectedOperation?.wait?.complete, true);
    } finally {
        release?.();
        await registry.close();
        await f.core.cleanup();
    }
});

test('batch transfer reports independent busy and stale rows; failed cleanup retains the live connection', async () => {
    const f = await fixture();
    let execution: Promise<unknown> | undefined;
    try {
        const one = await f.start();
        const two = await f.start();
        assert.ok(one.sessionId && two.sessionId);
        const app = await controller(f.core);
        const successor = f.core.register();
        execution = f.core.invoke(
            'list_pages',
            { _dct: { connectionId: one.connectionId, sessionId: one.sessionId } },
            f.request(),
        );
        await f.executionEntered;
        const result = await app.manage({
            kind: 'transfer',
            routes: [
                { connectionId: one.connectionId, sessionId: one.sessionId },
                { connectionId: two.connectionId, sessionId: two.sessionId },
                { connectionId: randomUUID(), sessionId: randomUUID() },
            ],
            registrationId: successor.principal.registrationId,
        });
        assert.deepEqual(
            result.outcomes?.map((row) => row.state),
            ['failed', 'transferred', 'failed'],
        );
        assert.deepEqual(
            result.outcomes?.map((row) => Reflect.get(row, 'reason')),
            ['busy', undefined, 'stale'],
        );
        f.release();
        await execution;
        f.failClose(true);
        const close = await app.manage({
            kind: 'close',
            routes: [{ connectionId: two.connectionId, sessionId: two.sessionId }],
        });
        assert.equal(close.outcomes?.[0]?.state, 'accepted');
        await settled(f.core, close.outcomes?.[0]?.operationId ?? '');
        assert.equal(app.snapshot().connections.length, 2);
        await assert.rejects(app.manage({ kind: 'unregister', registrationId: successor.principal.registrationId }));
        const closing = await controller(f.core, () => true);
        await assert.rejects(
            closing.manage({
                kind: 'transfer',
                routes: [{ connectionId: one.connectionId, sessionId: one.sessionId }],
                registrationId: successor.principal.registrationId,
            }),
            /closing/,
        );
        assert.equal(closing.snapshot().connections.length, 2);
    } finally {
        f.release();
        await execution?.catch(() => {});
        f.failClose(false);
        await f.core.cleanup();
    }
});
