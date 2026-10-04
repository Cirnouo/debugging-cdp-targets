import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createPortReservations } from '../src/adapters/port-reservation.ts';
import { createTargetHost } from '../src/adapters/target-host.ts';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';

function fixture(options: { reservations?: ReturnType<typeof createPortReservations>; foreign?: boolean } = {}) {
    const children: (EventEmitter & { pid: number; exitCode: number | null; signalCode: string | null })[] = [];
    let probeGate: Promise<void> | undefined;
    let versionGate: Promise<void> | undefined;
    let snapshotGate: Promise<void> | undefined;
    let sleepGate: Promise<void> | undefined;
    let snapshotEntered: (() => void) | undefined;
    let versionEntered: (() => void) | undefined;
    let sleepEntered: (() => void) | undefined;
    let versionFails = false;
    let failSpawn = false;
    let failAfterCreation = false;
    let failClose = false;
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
            if (versionFails) throw new Error('CDP is not ready.');
            return { Browser: 'DCTFixture/1.0', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/owned` };
        },
        sleep: async () => {
            sleepEntered?.();
            await sleepGate;
        },
        platformAdapter: {
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
                if (failClose) return false;
                const child = children.find((candidate) => candidate.pid === target.processId);
                child?.emit('exit', 0);
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
        failSpawn: () => {
            failSpawn = true;
        },
        failAfterCreation: () => {
            failAfterCreation = true;
        },
        failClose: () => {
            failClose = true;
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
