import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { PlatformAdapter } from '../src/adapters/platform-process.ts';
import { createPortReservations } from '../src/adapters/port-reservation.ts';
import { createTargetHost } from '../src/adapters/target-host.ts';
import { createTargetController, type TargetEvent } from '../src/application/target-controller.ts';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';
import { DetailedError, errorDetails } from '../src/shared/errors.ts';

function fixture(
    options: {
        reservations?: ReturnType<typeof createPortReservations>;
        foreign?: boolean;
        requestNormalClose?: NonNullable<PlatformAdapter['requestNormalClose']>;
    } = {},
) {
    const children: (EventEmitter & { pid: number; exitCode: number | null; signalCode: string | null })[] = [];
    let probeGate: Promise<void> | undefined;
    let versionGate: Promise<void> | undefined;
    let snapshotGate: Promise<void> | undefined;
    let sleepGate: Promise<void> | undefined;
    let snapshotEntered: (() => void) | undefined;
    let versionEntered: (() => void) | undefined;
    let sleepEntered: (() => void) | undefined;
    let versionFails = false;
    let versionFailure: Error = new Error('CDP is not ready.');
    let clock: number | undefined;
    let failSpawn = false;
    let failAfterCreation = false;
    let failClose = false;
    let closeFailure: Error | undefined;
    let holdExit = false;
    let closeEntered: (() => void) | undefined;
    const probes: number[] = [];
    const closed: number[] = [];
    const host = createTargetHost({
        ...(options.reservations ? { portReservations: options.reservations } : {}),
        probe: async (port) => {
            probes.push(port);
            await probeGate;
            return true;
        },
        spawn: async (_executable, _args, _port, _cwd, _env, context) => {
            if (failSpawn) throw new Error('Application creation failed.');
            const child = Object.assign(new EventEmitter(), {
                pid: children.length + 601,
                exitCode: null,
                signalCode: null,
            });
            children.push(child);
            context?.onCreated?.(child);
            if (failAfterCreation) throw new Error('Launch transport failed after creation.');
            return child;
        },
        getVersion: async (port) => {
            versionEntered?.();
            await versionGate;
            if (versionFails) throw versionFailure;
            return { Browser: 'DCTFixture/1.0', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/owned` };
        },
        sleep: async () => {
            sleepEntered?.();
            await sleepGate;
            if (clock !== undefined) clock += 25_000;
        },
        now: () => clock ?? Date.now(),
        platformAdapter: {
            ...(options.requestNormalClose ? { requestNormalClose: options.requestNormalClose } : {}),
            reservedRanges: async () => [],
            validateNewRoot: () => {},
            snapshot: async (pid) => {
                snapshotEntered?.();
                await snapshotGate;
                return {
                    root: {
                        exists: true,
                        executablePath: process.execPath,
                        startedAtUtc: '2026-10-04T00:00:00Z',
                        sessionId: 1,
                    },
                    currentSessionId: 1,
                    processIds: [pid],
                    listeners: [{ localAddress: '127.0.0.1', owningProcess: options.foreign ? 900 : pid }],
                };
            },
            close: async (target) => {
                closed.push(target.processId);
                closeEntered?.();
                if (failClose) {
                    if (closeFailure) throw closeFailure;
                    return false;
                }
                const child = children.find((candidate) => candidate.pid === target.processId);
                if (child && !holdExit) {
                    child.exitCode = 0;
                    child.emit('exit', 0);
                }
                return true;
            },
        },
    });
    return {
        host,
        children,
        probes,
        closed,
        setProbeGate: (gate?: Promise<void>) => {
            probeGate = gate;
        },
        setVersionGate: (gate?: Promise<void>, entered?: () => void) => {
            versionGate = gate;
            versionEntered = entered;
        },
        setSnapshotGate: (gate?: Promise<void>, entered?: () => void) => {
            snapshotGate = gate;
            snapshotEntered = entered;
        },
        setSleepGate: (gate?: Promise<void>, entered?: () => void) => {
            sleepGate = gate;
            sleepEntered = entered;
        },
        failVersion: () => {
            versionFails = true;
        },
        expireReadiness: (error: Error) => {
            versionFails = true;
            versionFailure = error;
            clock = 0;
        },
        holdExit: (entered: () => void) => {
            holdExit = true;
            closeEntered = entered;
        },
        failSpawn: () => {
            failSpawn = true;
        },
        failAfterCreation: () => {
            failAfterCreation = true;
        },
        failClose: (error?: Error) => {
            failClose = true;
            closeFailure = error;
        },
    };
}

const launch = { launch: { executable: process.execPath }, basePort: 9222 };

function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function controllerFixture(f: ReturnType<typeof fixture>, routeFails = false) {
    const events: TargetEvent[] = [];
    const controller = createTargetController({
        entryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        host: f.host,
        router: {
            isBusy: () => false,
            setTarget: () => {
                if (routeFails) throw new Error('Routing failed after readiness.');
            },
            clearTarget: () => {},
        },
        server: { ensure: async () => {}, close: async () => {} },
        onProcessExit: (event) => events.push(event),
    });
    return { controller, events };
}

function readinessFailure() {
    const error = Object.assign(new DetailedError('Controlled CDP readiness probe failure.'), {
        code: 'ECONNREFUSED',
    });
    error.details = { phase: 'waiting-cdp', nativeError: 111, category: 'cdp-readiness' };
    return error;
}

function confirmExit(f: ReturnType<typeof fixture>) {
    const child = f.children[0];
    assert.ok(child);
    child.exitCode = 0;
    child.emit('exit', 0);
}

for (const cancelDuringRollback of [false, true]) {
    test(`readiness rollback preserves its original failure after real exit${cancelDuringRollback ? ' and later cancellation' : ''}`, async () => {
        const reservations = createPortReservations();
        const f = fixture({ reservations });
        const failure = readinessFailure();
        f.expireReadiness(failure);
        const closeEntered = deferred();
        f.holdExit(closeEntered.resolve);
        const { controller, events } = controllerFixture(f);
        const phases: string[] = [];
        const abort = new AbortController();
        let settled = false;
        const outcome = controller
            .start(launch, sessionId, {
                operationId,
                signal: abort.signal,
                onPhase: (phase) => phases.push(phase),
            })
            .then(
                () => new Error('Unready application unexpectedly started.'),
                (error: unknown) => error,
            )
            .finally(() => {
                settled = true;
            });
        await closeEntered.promise;
        if (cancelDuringRollback) abort.abort(new Error('Cancellation after rollback began.'));
        await Promise.resolve();
        assert.equal(settled, false, 'Accepted close must still wait for the actual application exit.');
        assert.equal(reservations.claim(9222), undefined);
        assert.equal(events.length, 0);
        assert.equal(phases.at(-1), 'waiting-cdp');
        confirmExit(f);
        const result = await outcome;
        assert.ok(result instanceof Error);
        assert.match(result.message, /Controlled CDP readiness probe failure/);
        assert.deepEqual(errorDetails(result), {
            phase: 'waiting-cdp',
            nativeError: 111,
            category: 'cdp-readiness',
            code: 'ECONNREFUSED',
            processId: 601,
            port: 9222,
            closeConfirmed: true,
        });
        assert.equal(events.length, 1);
        assert.equal(events[0]?.expected, 'rollback');
        assert.equal(events[0]?.operationId, operationId);
        assert.equal(controller.status().status, 'idle');
        const release = reservations.claim(9222);
        assert.ok(release);
        release();
    });
}

test('cancellation before readiness rollback retains its exact reason while waiting for actual exit', async () => {
    const f = fixture();
    const held = block(f, 'endpoint');
    const closeEntered = deferred();
    f.holdExit(closeEntered.resolve);
    const { controller, events } = controllerFixture(f);
    const abort = new AbortController();
    const cancellation = new Error('Explicit readiness cancellation.');
    let settled = false;
    const outcome = controller
        .start(launch, sessionId, { operationId, signal: abort.signal })
        .then(
            () => new Error('Cancelled start unexpectedly succeeded.'),
            (error: unknown) => error,
        )
        .finally(() => {
            settled = true;
        });
    await held.entered;
    abort.abort(cancellation);
    await closeEntered.promise;
    await Promise.resolve();
    assert.equal(settled, false);
    confirmExit(f);
    const result = await outcome;
    held.release();
    assert.equal(result, cancellation);
    assert.equal(events[0]?.expected, 'rollback');
    assert.equal(events[0]?.operationId, operationId);
    assert.equal(controller.status().status, 'idle');
});

test('host transport rollback attributes its actual exit to the initiating operation', async () => {
    const f = fixture();
    f.failAfterCreation();
    const { controller, events } = controllerFixture(f);
    await assert.rejects(controller.start(launch, sessionId, { operationId }), /after creation/);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.expected, 'rollback');
    assert.equal(events[0]?.operationId, operationId);
    assert.equal(controller.status().status, 'idle');
});

test('actual exit before rollback remains unexpected and does not acquire a rollback operation identity', async () => {
    const f = fixture();
    const held = block(f, 'snapshot');
    const { controller, events } = controllerFixture(f);
    const outcome = controller.start(launch, sessionId, { operationId }).then(
        () => new Error('Exited application unexpectedly started.'),
        (error: unknown) => error,
    );
    await held.entered;
    confirmExit(f);
    const result = await outcome;
    held.release();
    assert.ok(result instanceof Error);
    assert.match(result.message, /exited/);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.expected, undefined);
    assert.equal(events[0]?.operationId, undefined);
    assert.equal(events[0]?.taskActive, true);
    assert.deepEqual(f.closed, []);
    assert.equal(controller.status().status, 'idle');
});

for (const failureAt of ['host-readiness', 'controller-routing'] as const) {
    test(`failed ${failureAt} rollback leaves a later real exit independently deliverable`, async () => {
        const reservations = createPortReservations();
        const f = fixture({ reservations });
        if (failureAt === 'host-readiness') f.expireReadiness(readinessFailure());
        f.failClose();
        const { controller, events } = controllerFixture(f, failureAt === 'controller-routing');
        await assert.rejects(controller.start(launch, sessionId, { operationId }));
        assert.equal(controller.status().status, 'close-failed');
        assert.equal(controller.status().taskActive, false);
        assert.equal(reservations.claim(9222), undefined);
        assert.equal(events.length, 0);
        confirmExit(f);
        assert.equal(events.length, 1);
        assert.equal(events[0]?.expected, undefined);
        assert.equal(events[0]?.operationId, undefined);
        assert.equal(events[0]?.taskActive, false);
        await controller.retireExited({ sessionId });
        assert.equal(controller.status().status, 'idle');
        const release = reservations.claim(9222);
        assert.ok(release);
        release();
    });
}

test('failed rollback prioritizes native close evidence while preserving the original readiness cause', async () => {
    const f = fixture();
    const failure = readinessFailure();
    failure.details = { phase: 'waiting-cdp', nativeError: 77, category: 'cdp-readiness' };
    f.expireReadiness(failure);
    const closeFailure = Object.assign(new DetailedError('Native normal close was denied.'), { code: 'EACCES' });
    closeFailure.details = { phase: 'normal-close', nativeError: 5, category: 'close-request-denied' };
    f.failClose(closeFailure);
    const { controller, events } = controllerFixture(f);
    const result = await controller.start(launch, sessionId, { operationId }).then(
        () => new Error('Unready application unexpectedly started.'),
        (error: unknown) => error,
    );
    assert.ok(result instanceof Error);
    assert.match(result.message, /Controlled CDP readiness probe failure/);
    assert.deepEqual(errorDetails(result), {
        phase: 'normal-close',
        nativeError: 5,
        category: 'close-request-denied',
        code: 'EACCES',
        processId: 601,
        port: 9222,
        closeConfirmed: false,
    });
    assert.equal(controller.status().status, 'close-failed');
    confirmExit(f);
    assert.equal(events[0]?.expected, undefined);
    await controller.retireExited({ sessionId });
});

for (const failureAt of ['host-readiness', 'launch-transport'] as const) {
    test(`actual exit interrupts a pending ${failureAt} rollback close request and consumes its late failure`, async () => {
        const reservations = createPortReservations();
        const requestEntered = deferred();
        const held = deferred();
        let requestSignal: AbortSignal | undefined;
        const f = fixture({
            reservations,
            requestNormalClose: async (target, context) => {
                assert.equal(target.processId, 601);
                requestSignal = context?.signal;
                requestEntered.resolve();
                await held.promise;
                throw new Error('Late helper request failure after actual application exit.');
            },
        });
        if (failureAt === 'host-readiness') f.expireReadiness(readinessFailure());
        else f.failAfterCreation();
        const { controller, events } = controllerFixture(f);
        const outcome = controller.start(launch, sessionId, { operationId }).then(
            () => new Error('Failed startup unexpectedly succeeded.'),
            (error: unknown) => error,
        );
        await requestEntered.promise;
        confirmExit(f);
        const earlyResult = await Promise.race([outcome, delay(30, 'still-waiting')]);
        held.resolve();
        const result = await outcome;
        await delay(0);
        assert.notEqual(earlyResult, 'still-waiting', 'Actual exit must settle rollback before the pending request.');
        assert.ok(requestSignal?.aborted, 'Actual exit must cancel the outstanding helper request.');
        assert.ok(result instanceof Error);
        assert.match(
            result.message,
            failureAt === 'host-readiness' ? /Controlled CDP readiness probe failure/ : /after creation/,
        );
        assert.equal(events.length, 1);
        assert.equal(events[0]?.expected, 'rollback');
        assert.equal(events[0]?.operationId, operationId);
        assert.equal(controller.status().status, 'idle');
        const release = reservations.claim(9222);
        assert.ok(release);
        release();
    });
}

function block(f: ReturnType<typeof fixture>, phase: 'snapshot' | 'endpoint' | 'retry') {
    const entered = deferred();
    const held = deferred();
    if (phase === 'snapshot') f.setSnapshotGate(held.promise, entered.resolve);
    else if (phase === 'endpoint') f.setVersionGate(held.promise, entered.resolve);
    else {
        f.failVersion();
        f.setSleepGate(held.promise, entered.resolve);
    }
    return { entered: entered.promise, release: held.resolve };
}

for (const phase of ['snapshot', 'endpoint', 'retry'] as const) {
    test(`cancelled readiness interrupts a pending ${phase} wait and normally closes the owned application`, async () => {
        const reservations = createPortReservations();
        const f = fixture({ reservations });
        const held = block(f, phase);
        const abort = new AbortController();
        const pending = f.host.launch(launch, { signal: abort.signal });
        const outcome = pending.then(
            () => new Error('The cancelled launch unexpectedly succeeded.'),
            (error: unknown) => error,
        );
        await held.entered;
        abort.abort(new Error('Readiness cancelled.'));
        const result = await Promise.race([outcome, delay(50, 'still-waiting')]);
        held.release();
        await outcome;
        assert.ok(result instanceof Error, 'Cancellation must settle without the blocked I/O completing.');
        assert.match(result.message, /cancelled/);
        assert.deepEqual(f.closed, [601]);
        const release = reservations.claim(9222);
        assert.ok(release, 'Only confirmed normal-close exit releases the reservation.');
        release();
    });
}

for (const phase of ['snapshot', 'endpoint'] as const) {
    test(`actual exit interrupts a pending readiness ${phase} wait without a launch cancellation signal`, async () => {
        const f = fixture();
        const held = block(f, phase);
        const pending = f.host.launch(launch);
        const outcome = pending.then(
            () => new Error('A dead application unexpectedly became ready.'),
            (error: unknown) => error,
        );
        await held.entered;
        f.children[0]?.emit('exit', 0);
        const result = await Promise.race([outcome, delay(50, 'still-waiting')]);
        held.release();
        await outcome;
        assert.ok(result instanceof Error, 'Actual exit must settle readiness without the blocked I/O completing.');
        assert.match(result.message, /exited/);
        assert.deepEqual(f.closed, []);
    });

    test(`actual exit interrupts a pending identity verification ${phase} wait`, async () => {
        const f = fixture();
        const target = await f.host.launch(launch);
        assert.ok(target.verify);
        const held = block(f, phase);
        const outcome = target.verify().then(
            () => new Error('A dead application unexpectedly verified.'),
            (error: unknown) => error,
        );
        await held.entered;
        f.children[0]?.emit('exit', 0);
        const result = await Promise.race([outcome, delay(50, 'still-waiting')]);
        held.release();
        await outcome;
        assert.ok(result instanceof Error, 'Exit must settle verification without the blocked I/O completing.');
        assert.match(result.message, /exited/);
        assert.deepEqual(f.closed, []);
    });
}

test('shared gateway port claims happen before asynchronous probes and choose distinct ports', async () => {
    const reservations = createPortReservations();
    const first = fixture({ reservations });
    const second = fixture({ reservations });
    let releaseProbe: (() => void) | undefined;
    first.setProbeGate(
        new Promise<void>((resolve) => {
            releaseProbe = resolve;
        }),
    );
    const pending = first.host.launch(launch);
    await Promise.resolve();
    const other = await second.host.launch(launch);
    assert.equal(other.port, 9223);
    assert.deepEqual(second.probes, [9223]);
    assert.ok(releaseProbe);
    releaseProbe();
    const target = await pending;
    assert.equal(target.port, 9222);
    await first.host.close(target);
    await second.host.close(other);
});

test('onCreated provides the same target with an exit latch before endpoint readiness', async () => {
    const f = fixture();
    let releaseVersion: (() => void) | undefined;
    f.setVersionGate(
        new Promise<void>((resolve) => {
            releaseVersion = resolve;
        }),
    );
    let created: ManagedTarget | undefined;
    let resolveCreation: (() => void) | undefined;
    const creation = new Promise<void>((resolve) => {
        resolveCreation = resolve;
    });
    const pending = f.host.launch(launch, {
        onCreated: (target) => {
            created = target;
            resolveCreation?.();
        },
    });
    await creation;
    assert.ok(created?.waitForExit);
    assert.ok(releaseVersion);
    releaseVersion();
    assert.equal(await pending, created);
    f.children[0]?.emit('exit', 0);
    await created.waitForExit();
});

test('failed creation releases its port, while retained live targets keep the claim until true exit', async () => {
    const reservations = createPortReservations();
    const failed = fixture({ reservations });
    failed.failSpawn();
    await assert.rejects(failed.host.launch(launch), /creation failed/);
    const retained = fixture({ reservations, foreign: true });
    retained.failClose();
    await assert.rejects(retained.host.launch(launch), /foreign process/);
    assert.equal(reservations.claim(9222), undefined);
    retained.children[0]?.emit('exit', 0);
    const released = reservations.claim(9222);
    assert.ok(released);
    released();
});

test('a foreign post-creation listener fails one launch without automatically relaunching', async () => {
    const f = fixture({ foreign: true });
    await assert.rejects(f.host.launch(launch), /foreign process/);
    assert.equal(f.children.length, 1);
    assert.deepEqual(f.probes, [9222]);
});

test('a launch transport failure after creation normally closes the retained actual application', async () => {
    const reservations = createPortReservations();
    const f = fixture({ reservations });
    f.failAfterCreation();
    await assert.rejects(f.host.launch(launch), /after creation/);
    const release = reservations.claim(9222);
    assert.ok(release, 'The close must observe actual exit before releasing the created target port.');
    release();
});

test('an old child callback cannot release a port owned by a later target', async () => {
    const reservations = createPortReservations();
    const f = fixture({ reservations });
    const first = await f.host.launch(launch);
    f.children[0]?.emit('exit', 0);
    const second = await f.host.launch(launch);
    first.releaseProfile?.();
    assert.equal(reservations.claim(9222), undefined);
    await f.host.close(second);
    const release = reservations.claim(9222);
    assert.ok(release);
    release();
});

test('a successful legacy close request preserves ownership until actual exit is observed', async () => {
    const reservations = createPortReservations();
    const child = Object.assign(new EventEmitter(), { pid: 601, exitCode: null, signalCode: null });
    const host = createTargetHost({
        portReservations: reservations,
        probe: async () => true,
        spawn: async () => child,
        getVersion: async (port) => ({
            Browser: 'DCTFixture/1.0',
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/live`,
        }),
        platformAdapter: {
            reservedRanges: async () => [],
            validateNewRoot: () => {},
            close: async () => true,
            snapshot: async () => ({
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-04T00:00:00Z',
                    sessionId: 1,
                },
                currentSessionId: 1,
                processIds: [601],
                listeners: [{ localAddress: '127.0.0.1', owningProcess: 601 }],
            }),
        },
    });
    const target = await host.launch(launch);
    const request = await host.requestNormalClose(target);
    assert.equal(request.closeRequested, true);
    assert.equal(request.processExited, false);
    target.releaseProfile?.();
    assert.equal(reservations.claim(9222), undefined);
    const cancelled = new AbortController();
    const waiting = host.waitForExit(target, cancelled.signal);
    cancelled.abort(new Error('Observation wait cancelled.'));
    await assert.rejects(waiting, /cancelled/);
    assert.equal(reservations.claim(9222), undefined);
    child.emit('exit', 0);
    await host.waitForExit(target);
    const release = reservations.claim(9222);
    assert.ok(release);
    release();
});
