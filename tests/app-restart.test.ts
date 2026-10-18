import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeploymentLease } from '../src/adapters/app-deployment.ts';
import { prepareAppParentExit } from '../src/adapters/app-parent-exit.ts';
import { type AppRestartBridgeOptions, runAppRestartBridge } from '../src/application/app-restart.ts';
import {
    encodeAppRestartContext,
    encodeAppRestartLeaseReceipt,
    parseAppRestartContext,
    parseAppRestartLeaseReceipt,
} from '../src/domains/app-restart.ts';

const installationIdentity = '1'.repeat(64);
const buildId = 'a'.repeat(64);
const attemptId = '2'.repeat(32);
const context = {
    type: 'restart-v1',
    installationIdentity,
    buildId,
    attemptId,
    receiptPath: '/owned/restart/lease-held',
} as const;
const contextFrame = `{"type":"restart-v1","installationIdentity":"${installationIdentity}","buildId":"${buildId}","attemptId":"${attemptId}","receiptPath":"/owned/restart/lease-held"}`;
const childIdentity = { installationIdentity, buildId, attemptId, processId: 713 };
const leaseFrame = `lease-held-v1 ${installationIdentity} ${buildId} ${attemptId} 713\n`;
const parentIdentity = { processId: 503, startedAtUtc: '2026-10-17T06:12:00.0000000Z', executablePath: '/owned/App' };
const parentReady = { event: 'parent-ready-v1', ...parentIdentity };
const parentExit = {
    event: 'parent-exited-v1',
    ...parentIdentity,
    processExited: true,
    waitResult: 0,
    waitError: 0,
    exitCode: 0,
};

function deferred<T>() {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    return { promise, resolve, reject };
}

test('restart context has one canonical bounded record and preserves an opaque absolute receipt path', () => {
    assert.equal(encodeAppRestartContext(context), contextFrame);
    assert.deepEqual(parseAppRestartContext(contextFrame), context);
    assert.equal(Object.isFrozen(parseAppRestartContext(contextFrame)), true);
    const windows = { ...context, receiptPath: 'C:\\owned operation\\lease-held' };
    assert.deepEqual(parseAppRestartContext(encodeAppRestartContext(windows)), windows);
});

test('restart context rejects extra fields, ambiguous encodings and unsafe or oversized path syntax', () => {
    for (const value of [
        { ...context, type: 'restart-v2' },
        { ...context, installationIdentity: 'A'.repeat(64) },
        { ...context, buildId: 'b'.repeat(63) },
        { ...context, attemptId: 'x'.repeat(32) },
        { ...context, extra: true },
        ...[
            'relative',
            '/owned/../receipt',
            '/owned/./receipt',
            '/owned/receipt\n',
            '/owned/\0receipt',
            `/${'界'.repeat(100)}`,
        ].map((receiptPath) => ({ ...context, receiptPath })),
    ])
        assert.throws(() => encodeAppRestartContext(value));
    for (const value of [
        undefined,
        '{}',
        `${contextFrame}\n`,
        ` ${contextFrame}`,
        contextFrame.replace('"type":', '"type":"restart-v1","type":'),
    ])
        assert.throws(() => parseAppRestartContext(value));
});

test('restart context accepts exactly 512 UTF-8 bytes and refuses the next byte', () => {
    const fixedBytes = Buffer.byteLength(contextFrame) - Buffer.byteLength(context.receiptPath);
    const receiptPath = `/${'x'.repeat(511 - fixedBytes)}`;
    const frame = contextFrame.replace(context.receiptPath, receiptPath);
    assert.equal(Buffer.byteLength(frame), 512);
    assert.equal(encodeAppRestartContext({ ...context, receiptPath }), frame);
    assert.equal(parseAppRestartContext(frame).receiptPath, receiptPath);
    assert.throws(() => encodeAppRestartContext({ ...context, receiptPath: `${receiptPath}x` }));
    assert.throws(() => parseAppRestartContext(`${frame} `));
});

test('lease receipt is exact and bound to installation, build, attempt and actual spawned PID', () => {
    assert.equal(encodeAppRestartLeaseReceipt(childIdentity), leaseFrame);
    assert.deepEqual(parseAppRestartLeaseReceipt(leaseFrame, childIdentity), childIdentity);
    for (const value of [
        leaseFrame.replace(installationIdentity, '3'.repeat(64)),
        leaseFrame.replace(buildId, 'b'.repeat(64)),
        leaseFrame.replace(attemptId, '4'.repeat(32)),
        leaseFrame.replace('713', '714'),
        leaseFrame.replace('713', '0713'),
        leaseFrame.replace('713', '0'),
        leaseFrame.replace('713', '4294967296'),
        leaseFrame.replace('\n', '\r\n'),
        leaseFrame.trimEnd(),
        `${leaseFrame}${leaseFrame}`,
        `${' '.repeat(512)}${leaseFrame}`,
        undefined,
    ])
        assert.throws(() => parseAppRestartLeaseReceipt(value, childIdentity));
    for (const processId of [0, -1, 1.5, Number.NaN, 4294967296])
        assert.throws(() => encodeAppRestartLeaseReceipt({ ...childIdentity, processId }));
});

test('read-only parent preparation waits for exact handle readiness and actual matching exit without Close', async () => {
    const ready = deferred<unknown>();
    const exited = deferred<unknown>();
    let closeRequests = 0;
    let disposals = 0;
    const producer = {
        ready: ready.promise,
        exited: exited.promise,
        dispose: async () => {
            disposals++;
        },
        requestClose: () => {
            closeRequests++;
        },
    };
    const observer = await prepareAppParentExit(parentIdentity, async (expected) => {
        assert.deepEqual(expected, parentIdentity);
        assert.equal(Object.isFrozen(expected), true);
        return producer;
    });
    let acknowledged = false;
    void observer.ready.then(() => {
        acknowledged = true;
    });
    await Promise.resolve();
    assert.equal(acknowledged, false);
    ready.resolve(parentReady);
    await observer.ready;
    assert.equal(acknowledged, true);
    let actualExit = false;
    void observer.exited.then(() => {
        actualExit = true;
    });
    await Promise.resolve();
    assert.equal(actualExit, false);
    exited.resolve(parentExit);
    await observer.exited;
    assert.equal(actualExit, true);
    assert.equal(disposals, 0);
    await observer.dispose();
    assert.equal(disposals, 1);
    assert.equal(closeRequests, 0);
});

test('parent helper EOF, error and reused identity never become actual parent exit', async () => {
    for (const result of [
        undefined,
        { event: 'eof' },
        { ...parentExit, processId: 504 },
        { ...parentExit, startedAtUtc: '2026-10-17T06:12:01.0000000Z' },
        { ...parentExit, executablePath: '/other/App' },
        { ...parentExit, processExited: false },
        { ...parentExit, waitResult: 258 },
        { ...parentExit, waitError: 5 },
        { ...parentExit, closeRequested: true },
    ]) {
        const observer = await prepareAppParentExit(parentIdentity, async () => ({
            ready: Promise.resolve(parentReady),
            exited: Promise.resolve(result),
            dispose: async () => {},
        }));
        await observer.ready;
        await assert.rejects(observer.exited);
    }
    const error = new Error('Read-only native observation failed.');
    const observer = await prepareAppParentExit(parentIdentity, async () => ({
        ready: Promise.resolve({ ...parentReady, executablePath: '/other/App' }),
        exited: Promise.reject(error),
        dispose: async () => {},
    }));
    await assert.rejects(observer.ready);
    await assert.rejects(observer.exited, error);
    await assert.rejects(
        prepareAppParentExit({ ...parentIdentity, processId: 0 }, async () => {
            throw new Error('Invalid parent reached native boundary.');
        }),
        /parent identity/,
    );
});

function bridgeFixture() {
    const ready = deferred<void>();
    const parentExited = deferred<void>();
    const verified = deferred<void>();
    const spawned = deferred<void>();
    const childExited = deferred<void>();
    const receipt = deferred<unknown>();
    const events: string[] = [];
    let bridgeHeld = true;
    let childHeld = false;
    const use: DeploymentLease = {
        kind: 'use',
        release: async () => {
            events.push('release-use');
            bridgeHeld = false;
        },
    };
    const parent = {
        ready: ready.promise,
        exited: parentExited.promise,
        dispose: async () => {
            events.push('dispose-parent');
        },
    };
    const child = {
        processId: 713,
        exited: childExited.promise,
        releaseObservation: async () => {
            events.push('release-child-observation');
        },
        unref: () => {
            events.push('unref');
        },
    };
    const active = {
        schemaVersion: 1,
        installationIdentity,
        phase: 'active',
        selectedBuildId: buildId,
        selectedManifestSha256: 'b'.repeat(64),
    };
    let selection = active;
    const options: AppRestartBridgeOptions = {
        use,
        parent,
        context: { type: 'restart-v1', installationIdentity, attemptId, receiptPath: context.receiptPath },
        publishReady: async () => {
            assert.equal(bridgeHeld, true);
            events.push('ready');
        },
        readSelection: async (lease) => {
            assert.equal(lease, use);
            events.push('read');
            return selection;
        },
        verifySelection: async (state) => {
            assert.deepEqual(state, active);
            events.push('verify');
            await verified.promise;
        },
        spawn: async (launch, lifetime) => {
            assert.deepEqual(launch, context);
            assert.deepEqual(lifetime, { detached: true, shell: false, stdio: 'ignore' });
            assert.equal(bridgeHeld, true);
            events.push('spawn');
            spawned.resolve();
            return { outcome: 'created', child };
        },
        readReceipt: (launch, actualChild) => {
            assert.deepEqual(launch, context);
            assert.equal(actualChild, child);
            events.push('receipt');
            return {
                result: receipt.promise,
                stop: async () => {
                    events.push('stop-receipt');
                },
            };
        },
    };
    return {
        options,
        ready,
        parentExited,
        verified,
        spawned,
        childExited,
        receipt,
        events,
        child,
        active,
        held: () => bridgeHeld,
        exclusiveUseAvailable: () => !bridgeHeld && !childHeld,
        beginRemoval: () => {
            selection = { ...active, phase: 'removing' };
        },
        acquireChild: () => {
            childHeld = true;
            events.push('child-acquired');
        },
        exitChild: () => {
            childHeld = false;
            childExited.resolve();
        },
        admit: () => {
            ready.resolve();
            parentExited.resolve();
            verified.resolve();
        },
    };
}

test('bridge holds use through exact parent exit and complete verification then overlaps successor ACK coverage', async () => {
    const fixture = bridgeFixture();
    const result = runAppRestartBridge(fixture.options);
    await Promise.resolve();
    assert.deepEqual([...fixture.events], []);
    fixture.ready.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual([...fixture.events], ['ready']);
    assert.equal(fixture.held(), true);
    fixture.parentExited.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fixture.events.includes('spawn'), false);
    assert.equal(fixture.exclusiveUseAvailable(), false);
    fixture.verified.resolve();
    await fixture.spawned.promise;
    assert.equal(fixture.held(), true);
    assert.equal(fixture.exclusiveUseAvailable(), false);
    fixture.acquireChild();
    fixture.receipt.resolve(leaseFrame);
    assert.deepEqual(await result, { outcome: 'acknowledged' });
    assert.equal(fixture.held(), false);
    assert.equal(fixture.exclusiveUseAvailable(), false);
    assert.ok(fixture.events.indexOf('child-acquired') < fixture.events.indexOf('release-use'));
    assert.deepEqual(fixture.events.slice(-5), [
        'stop-receipt',
        'release-child-observation',
        'unref',
        'dispose-parent',
        'release-use',
    ]);
});

test('failed readiness, parent observation or pre-spawn verification produces no successor', async () => {
    for (const failure of ['ready', 'parent', 'verify', 'selection', 'publish'] as const) {
        const fixture = bridgeFixture();
        const error = new Error('Controlled pre-spawn failure.');
        if (failure === 'ready') fixture.ready.reject(error);
        else fixture.ready.resolve();
        if (failure === 'parent') fixture.parentExited.reject(error);
        else fixture.parentExited.resolve();
        if (failure === 'verify') fixture.verified.reject(error);
        else fixture.verified.resolve();
        if (failure === 'selection')
            fixture.options.readSelection = async () => ({ ...fixture.active, installationIdentity: 'f'.repeat(64) });
        if (failure === 'publish')
            fixture.options.publishReady = async () => {
                throw error;
            };
        assert.deepEqual(await runAppRestartBridge(fixture.options), { outcome: 'no-successor' });
        assert.equal(fixture.events.includes('spawn'), false);
        assert.equal(fixture.held(), false);
    }
});

test('removing and removed selection after parent exit refuse launch under the retained use lease', async () => {
    for (const phase of ['removing', 'removed']) {
        const fixture = bridgeFixture();
        fixture.admit();
        fixture.options.readSelection = async () => ({ ...fixture.active, phase });
        assert.deepEqual(await runAppRestartBridge(fixture.options), { outcome: 'no-successor' });
        assert.equal(fixture.events.includes('verify'), false);
        assert.equal(fixture.events.includes('spawn'), false);
        assert.equal(fixture.held(), false);
    }
});

test('definitive no-created-child releases bridge use while uncertain spawn retains coverage without replay', async () => {
    const absent = bridgeFixture();
    absent.admit();
    absent.options.spawn = async () => ({ outcome: 'not-created' });
    assert.deepEqual(await runAppRestartBridge(absent.options), { outcome: 'no-successor' });
    assert.equal(absent.held(), false);
    const uncertain = bridgeFixture();
    uncertain.admit();
    let attempts = 0;
    uncertain.options.spawn = async () => {
        attempts++;
        throw new Error('Creation outcome unknown.');
    };
    const result = await runAppRestartBridge(uncertain.options);
    assert.equal(result.outcome, 'retained');
    if (result.outcome !== 'retained') assert.fail('Uncertain spawn lost its owner.');
    assert.equal(result.coverage.use, uncertain.options.use);
    assert.equal(result.coverage.parent, uncertain.options.parent);
    assert.equal((await result.retryRelease()).outcome, 'retained');
    assert.equal(uncertain.held(), true);
    assert.equal(uncertain.events.includes('dispose-parent'), false);
    assert.equal(attempts, 1);
});

test('missing, invalid or failed bounded ACK wait retains child observation until actual child exit', async () => {
    for (const receiptOutcome of ['missing', 'foreign', 'failed', 'setup-failed'] as const) {
        const fixture = bridgeFixture();
        fixture.admit();
        if (receiptOutcome === 'setup-failed')
            fixture.options.readReceipt = () => {
                throw new Error('Receipt setup failed.');
            };
        const pending = runAppRestartBridge(fixture.options);
        await fixture.spawned.promise;
        if (receiptOutcome === 'failed') fixture.receipt.reject(new Error('Bounded receipt wait failed.'));
        else fixture.receipt.resolve(receiptOutcome === 'foreign' ? leaseFrame.replace('713', '714') : undefined);
        const result = await pending;
        assert.equal(result.outcome, 'retained');
        if (result.outcome !== 'retained') assert.fail('Missing ACK released a live child.');
        assert.equal(result.coverage.child, fixture.child);
        assert.equal(fixture.held(), true);
        assert.equal(fixture.events.includes('release-child-observation'), false);
        assert.equal(fixture.events.includes('unref'), false);
        assert.equal((await result.retryRelease()).outcome, 'retained');
        fixture.exitChild();
        assert.deepEqual(await result.completion, { outcome: 'child-exited' });
        assert.equal(fixture.held(), false);
        assert.equal(fixture.events.filter((event) => event === 'spawn').length, 1);
    }
});

test('actual child exit settles coverage while a receipt wait is still pending', async () => {
    const fixture = bridgeFixture();
    fixture.admit();
    const pending = runAppRestartBridge(fixture.options);
    await fixture.spawned.promise;
    fixture.exitChild();
    assert.deepEqual(await pending, { outcome: 'child-exited' });
    assert.equal(fixture.held(), false);
    assert.equal(fixture.events.includes('stop-receipt'), true);
    fixture.receipt.resolve(undefined);
});

test('child observer failure and a removal fence after spawn retain use without inferring exit or replay', async () => {
    const fixture = bridgeFixture();
    fixture.admit();
    const pending = runAppRestartBridge(fixture.options);
    await fixture.spawned.promise;
    fixture.beginRemoval();
    fixture.childExited.reject(new Error('Actual child exit is unknown.'));
    fixture.receipt.resolve(undefined);
    const result = await pending;
    assert.equal(result.outcome, 'retained');
    assert.equal(fixture.held(), true);
    assert.equal(fixture.exclusiveUseAvailable(), false);
    assert.equal(fixture.events.includes('release-child-observation'), false);
    assert.equal(fixture.events.filter((event) => event === 'spawn').length, 1);
});

test('failed release retains safe handoff ownership for an explicit cleanup retry without spawning again', async () => {
    const fixture = bridgeFixture();
    fixture.admit();
    let releases = 0;
    const release = fixture.options.use.release;
    fixture.options.use.release = async () => {
        if (++releases === 1) throw new Error('Descriptor close failed.');
        await release();
    };
    fixture.acquireChild();
    fixture.receipt.resolve(leaseFrame);
    const result = await runAppRestartBridge(fixture.options);
    assert.equal(result.outcome, 'retained');
    if (result.outcome !== 'retained') assert.fail('Failed descriptor close was discarded.');
    assert.equal(fixture.held(), true);
    assert.deepEqual(await result.retryRelease(), { outcome: 'acknowledged' });
    assert.deepEqual(await result.completion, { outcome: 'acknowledged' });
    assert.equal(fixture.held(), false);
    assert.equal(fixture.events.filter((event) => event === 'spawn').length, 1);
    assert.equal(fixture.events.filter((event) => event === 'release-child-observation').length, 1);
});

test('restart snapshots its initiating context before parent wait rather than adopting later caller edits', async () => {
    const fixture = bridgeFixture();
    const pending = runAppRestartBridge(fixture.options);
    fixture.options.context = { ...fixture.options.context, attemptId: 'f'.repeat(32) };
    fixture.admit();
    const originalSpawn = fixture.options.spawn;
    fixture.options.spawn = async (launch, lifetime) => {
        assert.equal(launch.attemptId, attemptId);
        return originalSpawn(launch, lifetime);
    };
    fixture.acquireChild();
    fixture.receipt.resolve(leaseFrame);
    const result = await pending;
    assert.deepEqual(result, { outcome: 'acknowledged' });
});

test('an unconfirmed spawn retains its actual owned child observer and settles only on actual exit', async () => {
    const fixture = bridgeFixture();
    fixture.admit();
    fixture.options.spawn = async () => ({ outcome: 'unconfirmed', child: fixture.child });
    fixture.receipt.resolve(leaseFrame);
    const result = await runAppRestartBridge(fixture.options);
    assert.equal(result.outcome, 'retained');
    if (result.outcome !== 'retained') assert.fail('Unconfirmed spawn accepted an ACK.');
    assert.equal(result.reason, 'spawn-unconfirmed');
    assert.equal(result.coverage.child, fixture.child);
    assert.equal(fixture.events.includes('receipt'), false);
    assert.equal(fixture.events.includes('release-child-observation'), false);
    assert.equal(fixture.held(), true);
    fixture.exitChild();
    assert.deepEqual(await result.completion, { outcome: 'child-exited' });
    assert.equal(fixture.held(), false);
});

test('bridge refuses an operation lease before readiness or any launch work', async () => {
    const fixture = bridgeFixture();
    fixture.options.use = {
        kind: 'operation',
        release: async () => {
            assert.fail('Foreign lease was released.');
        },
    };
    await assert.rejects(runAppRestartBridge(fixture.options), /shared use lease/);
    assert.deepEqual(fixture.events, []);
});
