import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createTargetHost } from '../src/adapters/target-host.ts';
import { createTargetController } from '../src/application/target-controller.ts';
import { type ManagedTarget, RetainedTargetError } from '../src/domains/cdp-target.ts';
import { DetailedError, errorDetails } from '../src/shared/errors.ts';

const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture() {
    let launchCount = 0;
    let closeSucceeds = false;
    let routeFails = true;
    const closed: number[] = [];
    const children = new Map<number, EventEmitter & { exitCode: number | null }>();
    const controller = createTargetController({
        entryId,
        router: {
            isBusy: () => false,
            setTarget: () => {
                if (routeFails) throw new Error('route failure');
            },
            clearTarget: () => {},
        },
        host: {
            launch: async (_options, context): Promise<ManagedTarget> => {
                const processId = 42 + launchCount++;
                const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
                children.set(processId, child);
                const target: ManagedTarget = {
                    processId,
                    port: 9222,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    targetKind: 'generic-cdp',
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: [], cwd: process.cwd() },
                };
                context?.onCreated?.(target);
                return target;
            },
            close: async (target) => {
                closed.push(target.processId);
                if (!closeSucceeds) return false;
                const child = children.get(target.processId);
                assert.ok(child);
                child.exitCode = 0;
                child.emit('exit', 0);
                return true;
            },
        },
        server: { ensure: async () => {}, close: async () => {} },
    });
    return {
        controller,
        children,
        closed,
        launches: () => launchCount,
        allowClose: () => {
            closeSucceeds = true;
        },
        failClose: () => {
            closeSucceeds = false;
        },
        allowRoute: () => {
            routeFails = false;
        },
        failRoute: () => {
            routeFails = true;
        },
    };
}

test('failed attachment and failed rollback retain a gated session until explicit Close succeeds', async () => {
    const f = fixture();
    await assert.rejects(f.controller.start({ launch: { executable: 'fixture' } }), /normally/);
    const retained = f.controller.status();
    assert.equal(retained.status, 'close-failed');
    assert.equal(retained.processId, 42);
    assert.ok(retained.sessionId);
    assert.equal(f.controller.canInvoke(), false);
    await assert.rejects(f.controller.start({ launch: { executable: 'another' } }), /existing target/i);
    await assert.rejects(f.controller.stop({ sessionId: retained.sessionId, disposition: 'Keep' }), /Close/);
    await assert.rejects(f.controller.restart({ sessionId: retained.sessionId }), /lost/);
    await assert.rejects(f.controller.endTask({ sessionId: retained.sessionId }), /Close/);
    await assert.rejects(f.controller.stop({ sessionId: entryId, disposition: 'Close' }), /stale/);
    assert.equal(f.launches(), 1);
    f.allowClose();
    assert.equal((await f.controller.stop({ sessionId: retained.sessionId, disposition: 'Close' })).status, 'idle');
    assert.deepEqual(f.closed, [42, 42]);
});

test('restart rollback retains the new failed target and never overwrites it with the previous session', async () => {
    let launches = 0;
    const children = new Map<number, EventEmitter & { exitCode: number | null }>();
    let allowFailedClose = false;
    const controller = createTargetController({
        entryId,
        router: {
            isBusy: () => false,
            setTarget: () => {
                if (launches > 1) throw new Error('route failure');
            },
            clearTarget: () => {},
        },
        host: {
            launch: async (_options, context) => {
                const processId = 50 + launches++;
                const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
                children.set(processId, child);
                const target: ManagedTarget = {
                    processId,
                    port: 9222,
                    targetKind: 'generic-cdp',
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: [], cwd: process.cwd() },
                };
                context?.onCreated?.(target);
                return target;
            },
            close: async (target) => {
                if (target.processId !== 50 && !allowFailedClose) return false;
                const child = children.get(target.processId);
                assert.ok(child);
                child.exitCode = 0;
                child.emit('exit', 0);
                return true;
            },
        },
        server: { ensure: async () => {}, close: async () => {} },
    });
    const active = await controller.start({ launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    await assert.rejects(controller.restart({ sessionId: active.sessionId }), /normally/);
    const retained = controller.status();
    assert.equal(retained.status, 'close-failed');
    assert.equal(retained.processId, 51);
    assert.notEqual(retained.sessionId, active.sessionId);
    assert.equal(controller.canInvoke(), false);
    children.get(50)?.emit('exit', 0);
    assert.equal(controller.status().sessionId, retained.sessionId);
    assert.equal(children.get(50)?.listenerCount('exit'), 0);
    assert.ok(retained.sessionId);
    allowFailedClose = true;
    await controller.stop({ sessionId: retained.sessionId, disposition: 'Close' });
    assert.equal(controller.status().status, 'idle');
});

test('unverified host startup with failed normal cleanup retains typed identity without serializing launch evidence', async () => {
    let clock = 0;
    let launches = 0;
    let closeSucceeds = false;
    const child = Object.assign(new EventEmitter(), { pid: 90, exitCode: null as number | null });
    const host = createTargetHost({
        platformAdapter: {
            reservedRanges: async () => [],
            snapshot: async (pid) => ({
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    sessionId: 1,
                },
                currentSessionId: 1,
                processIds: [pid],
                listeners: [{ localAddress: '127.0.0.1', owningProcess: pid }],
            }),
            validateNewRoot: () => {},
            close: async () => {
                if (!closeSucceeds) return false;
                child.exitCode = 0;
                child.emit('exit', 0);
                return true;
            },
        },
        probe: async () => true,
        spawn: async () => {
            launches++;
            return child;
        },
        getVersion: async () => {
            throw new Error('unavailable');
        },
        now: () => clock,
        sleep: async () => {
            clock += 25_000;
        },
    });
    const controller = createTargetController({
        entryId,
        router: { isBusy: () => false, setTarget: () => {}, clearTarget: () => {} },
        host,
        server: { ensure: async () => {}, close: async () => {} },
    });
    await assert.rejects(
        controller.start({ launch: { executable: process.execPath }, basePort: 9222 }),
        (error: unknown) => {
            assert.ok(error instanceof DetailedError && error instanceof RetainedTargetError);
            assert.equal(error.target.processId, 90);
            assert.doesNotMatch(JSON.stringify(error), /executablePath|launchDefinition|arguments/);
            assert.deepEqual(errorDetails(error), { processId: 90, port: 9222, closeConfirmed: false });
            return true;
        },
    );
    const retained = controller.status();
    assert.equal(retained.status, 'close-failed');
    assert.equal(retained.processId, 90);
    assert.ok(retained.sessionId);
    await assert.rejects(controller.start({ launch: { executable: process.execPath } }), /existing target/i);
    assert.equal(launches, 1);
    closeSucceeds = true;
    await controller.stop({ sessionId: retained.sessionId, disposition: 'Close' });
    assert.equal(controller.status().status, 'idle');
});
