import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
    beginFixtureStage,
    captureFixtureOrigin,
    emitFixtureEvent,
    type FixtureEvent,
    fixtureHasSubscribers,
    runFixtureCleanup,
    runFixtureObservation,
    runFixtureResource,
    subscribeFixtureDiagnostics,
    validateFixtureEvent,
    validateLinuxIdentity,
} from '../src/adapters/fixture-diagnostics.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createOperationRegistry } from '../src/application/operations.ts';
import { startPluginRuntime } from '../src/application/plugin-runtime.ts';
import { createTargetController } from '../src/application/target-controller.ts';
import type { LaunchOptions } from '../src/domains/control-contract.ts';
import { DetailedError, isRecord } from '../src/shared/errors.ts';

const entryId = '11111111-1111-4111-8111-111111111111';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('listener owner fixture schema admits only closed relations and safe numeric metadata', () => {
    const base = {
        stage: 'listener-owner-evidence',
        event: 'decision',
        outcome: 'observed',
        timestampMs: 1,
        durationMs: 0,
        pid: 42,
        listenerOwnerPid: 43,
        listenerOwnerParentPid: 0,
        listenerOwnerUid: 7,
        listenerOwnerStartedAtMs: 1_000,
        rootOwnerUid: 7,
        rootOwnerStartedAtMs: 999,
        listenerOwnerRecordCount: 2,
        listenerOwnerOwned: false,
    };
    for (const relation of [
        'root',
        'owned-descendant',
        'owner-row-missing',
        'ancestor-row-missing',
        'uid-mismatch',
        'child-before-parent',
        'unrelated-root',
        'cycle',
        'depth-limit',
        'invalid-owner',
        'root-absent',
    ]) {
        const accepted = validateFixtureEvent({ ...base, listenerOwnerRelation: relation });
        assert.equal(accepted?.listenerOwnerRelation, relation);
        assert.equal(accepted?.listenerOwnerOwned, false);
        assert.ok(Object.isFrozen(accepted));
    }
    for (const key of [
        'listenerOwnerPid',
        'listenerOwnerParentPid',
        'listenerOwnerUid',
        'listenerOwnerStartedAtMs',
        'rootOwnerUid',
        'rootOwnerStartedAtMs',
        'listenerOwnerRecordCount',
        'listenerOwnerCount',
        'listenerRecordCount',
        'listenerOwnerEmittedCount',
        'listenerOwnerOmittedCount',
    ]) {
        for (const invalid of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, 'PRIVATE_TOKEN', {}, []]) {
            assert.equal(validateFixtureEvent({ ...base, [key]: invalid }), undefined, key);
        }
    }
    assert.equal(validateFixtureEvent({ ...base, listenerOwnerPid: 0 }), undefined);
    assert.equal(validateFixtureEvent({ ...base, listenerOwnerOwned: true })?.listenerOwnerOwned, true);
    for (const invalid of [0, 1, 'true', 'PRIVATE_TOKEN', null, {}, []]) {
        assert.equal(validateFixtureEvent({ ...base, listenerOwnerOwned: invalid }), undefined);
    }
    assert.equal(validateFixtureEvent({ ...base, listenerOwnerRelation: 'PRIVATE_TOKEN' }), undefined);
    assert.equal(validateFixtureEvent({ ...base, listenerOwnerPath: '/private/path' }), undefined);
    assert.equal(validateFixtureEvent({ ...base, listenerOwnerRows: [base] }), undefined);
    const summary = validateFixtureEvent({
        stage: 'listener-owner-evidence',
        event: 'decision',
        outcome: 'observed',
        timestampMs: 1,
        durationMs: 0,
        pid: 42,
        listenerOwnerCount: 10,
        listenerRecordCount: 11,
        listenerOwnerEmittedCount: 8,
        listenerOwnerOmittedCount: 2,
    });
    assert.equal(summary?.listenerOwnerOmittedCount, 2);
});

test('parallel operations publish distinct routes and primary errors without request contents', async () => {
    const events: FixtureEvent[] = [];
    const unsubscribe = subscribeFixtureDiagnostics((event) => events.push(event));
    try {
        const registry = createOperationRegistry(entryId);
        const routeA = {
            connectionId: '10000000-0000-4000-8000-000000000001',
            sessionId: '10000000-0000-4000-8000-000000000002',
        };
        const routeB = {
            connectionId: '10000000-0000-4000-8000-000000000003',
            sessionId: '10000000-0000-4000-8000-000000000004',
        };
        const a = registry.submit('request-a', { action: 'start', secret: '/private/a' }, async (context) => {
            context.identity(routeA);
            await tick();
            context.phase('creating-router');
            return {};
        });
        const b = registry.submit('request-b', { action: 'stop', secret: '/private/b' }, async (context) => {
            context.identity(routeB);
            await tick();
            context.phase('closing-resources');
            throw Object.assign(new Error('/private/error'), { code: 'EACCES' });
        });
        await tick();
        await tick();
        assert.ok(events.length > 0, 'operation observation must publish events');
        const owned = events.filter(isRecord);
        for (const event of owned) {
            assert.ok(Object.isFrozen(event));
            assert.equal(event.entryId, entryId);
            if (event.connectionId === routeA.connectionId) assert.equal(event.operationId, a.operationId);
            if (event.connectionId === routeB.connectionId) assert.equal(event.operationId, b.operationId);
        }
        assert.ok(owned.some((event) => event.stage === 'operation-error' && event.operationId === b.operationId));
        assert.equal(JSON.stringify(events).includes('/private/'), false);
        assert.equal(registry.get(a.operationId).state, 'succeeded');
        assert.equal(registry.get(b.operationId).state, 'failed');
    } finally {
        unsubscribe();
    }
});

test('default observation never resolves scopes or reads sensitive error metadata', () => {
    assert.equal(fixtureHasSubscribers(), false);
    let identities = 0;
    let reads = 0;
    const error = Object.defineProperty({}, 'name', {
        get: () => {
            reads++;
            return 'Error';
        },
    });
    const result = runFixtureObservation(
        () => {
            identities++;
            return { entryId };
        },
        () => {
            assert.equal(captureFixtureOrigin(), undefined);
            beginFixtureStage('spawn')('failed', {}, error);
            emitFixtureEvent('operation-error', 'decision', {}, error);
            return 42;
        },
    );
    assert.equal(result, 42);
    assert.equal(identities, 0);
    assert.equal(reads, 0);
});

test('receiver rejects unknown fields and contains proxy validation and callback errors', async () => {
    const events: FixtureEvent[] = [];
    let rejected = 0;
    const stopThrowing = subscribeFixtureDiagnostics(() => {
        throw new Error('receiver failure');
    });
    const stop = subscribeFixtureDiagnostics(
        (event) => events.push(event),
        () => {
            rejected++;
            throw new Error('rejection callback failed');
        },
    );
    const stopAsync = subscribeFixtureDiagnostics(async () => {
        throw new Error('async receiver failed');
    });
    try {
        const selected = channel('debugging-cdp-targets.fixture');
        const good = { stage: 'spawn', event: 'end', outcome: 'failed', timestampMs: 1, durationMs: 0 };
        selected.publish({ ...good, argv: ['/private/argv'] });
        selected.publish(
            new Proxy(
                {},
                {
                    getPrototypeOf: () => {
                        throw new Error('hostile validation');
                    },
                },
            ),
        );
        selected.publish({ ...good, error: { name: 'Error', message: '/private/error' } });
        selected.publish({ ...good, command: '/private/command' });
        selected.publish({ ...good, error: { name: 'Error', code: 'PRIVATE_TOKEN' } });
        selected.publish(good);
        await tick();
        assert.equal(events.length, 1);
        assert.equal(rejected, 5);
        assert.ok(Object.isFrozen(events[0]));
        assert.equal(validateFixtureEvent({ ...good, durationMs: -1 }), undefined);
    } finally {
        stop();
        stopThrowing();
        stopAsync();
    }
});

test('receiver detaches changing proxy error keys before publishing accepted metadata', () => {
    for (const nested of [false, true]) {
        let inspections = 0;
        const error = new Proxy(
            { name: 'Error', message: 'PRIVATE_TOKEN' },
            { ownKeys: (target) => (++inspections <= 2 ? ['name'] : Reflect.ownKeys(target)) },
        );
        const accepted = validateFixtureEvent(
            new Proxy(
                {
                    stage: 'spawn',
                    event: 'end',
                    outcome: 'failed',
                    timestampMs: 1,
                    durationMs: 0,
                    error: nested ? { name: 'Error', cause: error } : error,
                },
                { get: () => 'PRIVATE_TOKEN' },
            ),
        );
        assert.ok(accepted);
        assert.deepEqual(accepted.error, nested ? { name: 'Error', cause: { name: 'Error' } } : { name: 'Error' });
        assert.equal(JSON.stringify(accepted).includes('PRIVATE_TOKEN'), false);
        assert.ok(Object.isFrozen(accepted.error));
        if (nested) assert.ok(Object.isFrozen(accepted.error?.cause));
    }
});

test('readiness observation admits nonnegative monotonic elapsed milliseconds only', () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event));
    try {
        emitFixtureEvent('readiness', 'decision', { elapsedMs: 42.5 });
        assert.equal(events[0]?.elapsedMs, 42.5);
        assert.equal(validateFixtureEvent({ ...events[0], elapsedMs: -1 }), undefined);
    } finally {
        stop();
    }
});

test('fixture identities reject token-shaped private strings and observation failures cannot change work', () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event));
    try {
        const good = { stage: 'spawn', event: 'end', outcome: 'failed', timestampMs: 1, durationMs: 0 };
        assert.equal(validateFixtureEvent({ ...good, entryId: 'PRIVATE_TOKEN' }), undefined);
        const result = runFixtureObservation(
            () => {
                throw new Error('scope resolver failed');
            },
            () => {
                assert.doesNotThrow(() => emitFixtureEvent('spawn', 'decision'));
                assert.doesNotThrow(() => captureFixtureOrigin());
                return 42;
            },
        );
        assert.equal(result, 42);
        assert.deepEqual(events, []);
        const hostileIdentity = Object.defineProperty({}, 'entryId', {
            enumerable: true,
            get: () => {
                throw new Error('scope getter failed');
            },
        });
        assert.equal(
            runFixtureCleanup(hostileIdentity, () => 42),
            42,
        );
        const hostileFields = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error('field copy failed');
                },
            },
        );
        assert.doesNotThrow(() => beginFixtureStage('spawn')('failed', hostileFields));
    } finally {
        stop();
    }
});

test('error metadata is copied frozen closed and bounded through cyclic sensitive causes', () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event));
    try {
        const error = Object.assign(new Error('/private/message'), { code: 'EACCES', syscall: 'open', errno: -13 });
        error.cause = error;
        const finish = beginFixtureStage('spawn', { attempt: 1 });
        finish('failed', {}, error);
        error.code = 'PRIVATE_TOKEN';
        const value = events.at(-1);
        assert.equal(value?.error?.code, 'EACCES');
        assert.equal(value?.error?.syscall, 'open');
        assert.equal(value?.error?.errno, -13);
        assert.equal(value?.error?.cause?.truncated, true);
        assert.ok(Object.isFrozen(value?.error));
        assert.ok(Object.isFrozen(value?.error?.cause));
        assert.ok((value?.durationMs ?? -1) >= 0);
        assert.equal(JSON.stringify(events).includes('/private/'), false);
        assert.equal(JSON.stringify(events).includes('PRIVATE_TOKEN'), false);
    } finally {
        stop();
    }
});

test('direct IO origin snapshots identity while current operation and independent EOF keep their scopes', () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event));
    try {
        const route = {
            entryId,
            operationId: '10000000-0000-4000-8000-000000000009',
            connectionId: '10000000-0000-4000-8000-000000000001',
            sessionId: '10000000-0000-4000-8000-000000000002',
        };
        const origin = runFixtureObservation(
            () => route,
            () => captureFixtureOrigin(),
        );
        const lease = runFixtureObservation(route, () => captureFixtureOrigin({ sessionId: undefined }));
        route.sessionId = '10000000-0000-4000-8000-000000000004';
        runFixtureObservation({ operationId: '10000000-0000-4000-8000-000000000012', action: 'stop' }, () => {
            runFixtureResource(origin, () => emitFixtureEvent('native-close', 'decision'));
            runFixtureCleanup({ entryId }, () => {
                runFixtureResource(origin, () => emitFixtureEvent('data-directory-cleanup', 'decision'));
                runFixtureResource(lease, () => emitFixtureEvent('directory-lease', 'decision'));
            });
        });
        assert.equal(events[0]?.originOperationId, '10000000-0000-4000-8000-000000000009');
        assert.equal(events[0]?.operationId, '10000000-0000-4000-8000-000000000012');
        assert.equal(events[0]?.sessionId, '10000000-0000-4000-8000-000000000002');
        assert.equal(events[1]?.operationId, undefined);
        assert.equal(events[1]?.trigger, 'gateway-disconnect');
        assert.equal(events[2]?.sessionId, undefined);
        assert.equal(events[2]?.trigger, 'gateway-disconnect');
    } finally {
        stop();
    }
});

const options: LaunchOptions = {
    targetKind: 'generic-cdp',
    launch: { executable: process.execPath },
    isolation: { mode: 'none' },
};
function targetFixture(failures: { ensure?: Error; close?: Error }) {
    const children: (EventEmitter & { exitCode: number | null; signalCode: string | null })[] = [];
    const controller = createTargetController({
        entryId,
        router: { setTarget: () => {}, clearTarget: () => {}, isBusy: () => false },
        server: {
            ensure: async () => {
                if (failures.ensure) throw failures.ensure;
            },
            close: async (owner) => {
                await owner?.closeResources();
            },
        },
        host: {
            launch: async (_options, context) => {
                const child = Object.assign(new EventEmitter(), {
                    exitCode: null,
                    signalCode: null,
                });
                children.push(child);
                const target = {
                    child,
                    processId: 1000 + children.length,
                    port: 9333,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-09T00:00:00Z',
                    targetKind: 'generic-cdp' as const,
                    launchDefinition: { executablePath: process.execPath, arguments: [] },
                };
                context?.onCreated?.(target);
                return target;
            },
            close: async (target) => {
                if (failures.close) throw failures.close;
                const child = children[target.processId - 1001];
                assert.ok(child);
                child.exitCode = 0;
                child.emit('exit');
                return true;
            },
        },
    });
    return controller;
}

test('retained rollback failure preserves primary official acquisition details and independent close evidence', async () => {
    const primary = Object.assign(new DetailedError('primary'), {
        code: 'ECONNREFUSED',
        details: { phase: 'starting-official-server', category: 'upstream', nativeError: 77 },
    });
    const secondary = Object.assign(new DetailedError('secondary'), {
        code: 'EACCES',
        details: { phase: 'normal-close', category: 'native', nativeError: 5 },
    });
    const fixture = targetFixture({ ensure: primary, close: secondary });
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event));
    try {
        await assert.rejects(fixture.start(options, '10000000-0000-4000-8000-000000000002'), (error: unknown) => {
            assert.ok(error instanceof DetailedError);
            assert.equal(error.details?.phase, 'starting-official-server');
            assert.equal(error.details?.code, 'ECONNREFUSED');
            assert.equal(error.details?.category, 'upstream');
            assert.equal(error.details?.nativeError, 77);
            assert.equal(error.cause, primary);
            assert.equal(error.details?.processId, 1001);
            return true;
        });
        assert.equal(fixture.status().status, 'close-failed');
        assert.equal(fixture.status().processId, 1001);
        assert.ok(events.some((event) => event.stage === 'target-acquisition' && event.error?.code === 'ECONNREFUSED'));
        assert.ok(events.some((event) => event.stage === 'target-close' && event.error?.code === 'EACCES'));
    } finally {
        stop();
    }
});

async function runtimeFixture(primary?: Error, secondary?: Error) {
    let resolveClosed = () => {};
    const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
    });
    let routers = 0;
    let secondaryFailures = 0;
    const children: EventEmitter[] = [];
    const runtime = await startPluginRuntime({
        createRouter: async () => {
            const catalog = ++routers === 1;
            return {
                url: 'http://127.0.0.1:31000',
                setTarget: () => {},
                clearTarget: () => {},
                isBusy: () => false,
                close: async () => {
                    if (!catalog && secondary && secondaryFailures++ === 0) throw secondary;
                },
            };
        },
        createHost: () => ({
            launch: async () => {
                if (primary) throw primary;
                const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
                children.push(child);
                return {
                    child,
                    processId: 998 + children.length,
                    port: 9333,
                    targetKind: 'generic-cdp',
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-09T00:00:00Z',
                };
            },
            close: async (target) => {
                children[target.processId - 999]?.emit('exit');
                return true;
            },
        }),
        createConnection: async () => ({
            tools: [],
            call: async () => ({ content: [] }),
            rootsChanged: async () => {},
            onExit: () => {},
            close: async () => {},
        }),
        loadCatalog: async () => createToolCatalog({ version: '1.10.1', tools: [] }),
        createEntry: () => ({
            connect: async () => {},
            closed,
            close: async () => {
                resolveClosed();
            },
            roots: async () => ({ roots: [] }),
            supportsRoots: () => false,
            supportsFormElicitation: () => false,
            elicit: async () => ({ action: 'cancel' }),
        }),
    });
    return runtime;
}

test('runtime preserves primary launch phase and code through secondary resource cleanup failure', async () => {
    const primary = Object.assign(new DetailedError('/private/primary'), {
        code: 'EACCES',
        details: { phase: 'waiting-cdp' },
    });
    const secondary = Object.assign(new Error('/private/secondary'), { code: 'EPERM' });
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event));
    const runtime = await runtimeFixture(primary, secondary);
    try {
        await assert.rejects(runtime.controller.start(options), (error: unknown) => {
            assert.ok(error instanceof DetailedError);
            assert.equal(error.details?.phase, 'waiting-cdp');
            assert.equal(error.details?.code, 'EACCES');
            assert.ok(error.cause instanceof Error);
            return true;
        });
        const failed = events.filter((event) => event.outcome === 'failed');
        const original = failed.findIndex(
            (event) => event.stage === 'target-acquisition' && event.error?.code === 'EACCES',
        );
        const cleanup = failed.findIndex(
            (event) => event.stage === 'resource-disposal' && event.error?.code === 'EPERM',
        );
        assert.ok(original >= 0 && cleanup > original);
        assert.equal(JSON.stringify(events).includes('/private/'), false);
    } finally {
        await runtime.close();
        stop();
    }
});

test('runtime EOF cleanup has independent scope even when gateway was born in another operation', async () => {
    const events: FixtureEvent[] = [];
    const stop = subscribeFixtureDiagnostics((event) => events.push(event));
    try {
        const runtime = await runFixtureObservation(
            { entryId, operationId: '10000000-0000-4000-8000-000000000013' },
            () => runtimeFixture(),
        );
        await runFixtureObservation({ entryId, operationId: '10000000-0000-4000-8000-000000000011' }, () =>
            runtime.close(),
        );
        const cleanup = events.find((event) => event.stage === 'gateway-cleanup' && event.event === 'begin');
        assert.ok(cleanup, 'gateway cleanup must enter its own observation scope');
        assert.equal(cleanup.operationId, undefined);
        assert.equal(cleanup.originOperationId, undefined);
        assert.equal(cleanup.trigger, 'gateway-disconnect');
    } finally {
        stop();
    }
});

function currentIntervalPayload() {
    const calibration = {
        beforeUtcMs: 1000500,
        afterUtcMs: 1000500,
        uptimeUpperNs: '1000509999999',
        offset: { lowerNs: '-10000000', upperNs: '1000000' },
    };
    return {
        model: 'linux-private-interval-v1',
        mode: 'initial',
        decision: 'initial-accepted',
        timeBasis: 'source-stat-read-ended',
        facts: {
            pre: structuredClone(calibration),
            post: structuredClone(calibration),
            raw: { q: '100050', H: '100', bootSeconds: '0' },
            requestUtcMs: 1000500,
            decisionUtcMs: 1000500,
            offset: { status: 'nonempty', lowerNs: '0', upperNs: '1000000' },
            birth: {
                branch: 'divide',
                result: 'present',
                readerUpperNs: '1000509999999',
                interval: { lowerNs: '1000500000000', upperNs: '1000509999999' },
            },
            absolute: { lowerNs: '1000500000000', upperNs: '1000510999999' },
            public: { branch: 'accepted', pointMs: '1000500' },
            selectedMs: 1000500,
        },
    };
}
test('current interval nested decoder detaches recursively and accepted envelope bypasses legacy rejection', () => {
    const payload = currentIntervalPayload();
    const result = validateLinuxIdentity(payload);
    assert.ok(result);
    assert.notEqual(result.facts.pre, payload.facts.pre);
    payload.facts.pre.offset.lowerNs = '42';
    assert.equal(result.facts.pre?.offset.lowerNs, '-10000000');
    assert.ok(Object.isFrozen(result.facts.pre?.offset));
    const event = {
        stage: 'process-creation-identity',
        event: 'decision',
        phase: 'process-identity',
        outcome: 'observed',
        timestampMs: 1,
        durationMs: 0,
        linuxIdentity: result,
    };
    assert.ok(validateFixtureEvent(event));
    for (const change of [
        { outcome: 'rejected' },
        { stage: 'native-file' },
        { creationToleranceMs: 1000 },
        { error: { name: 'Error' } },
        { phase: 'waiting-cdp' },
    ])
        assert.equal(validateFixtureEvent({ ...event, ...change }), undefined);
});
test('current interval validator rejects hostile descriptors, prototypes and canonical operand violations before conversion', () => {
    let invoked = 0;
    const good = currentIntervalPayload();
    const hostile = [
        null,
        [],
        Object.create({}),
        { ...good, model: 'future' },
        { ...good, extra: 1 },
        { ...good, [Symbol('private')]: 1 },
        { ...good, facts: { ...good.facts, path: '/private' } },
        {
            ...good,
            facts: {
                ...good.facts,
                raw: {
                    ...good.facts.raw,
                    get uid() {
                        invoked++;
                        return 7;
                    },
                },
            },
        },
        {
            ...good,
            facts: {
                ...good.facts,
                pre: Object.defineProperty({}, 'offset', {
                    enumerable: true,
                    get() {
                        invoked++;
                        return {};
                    },
                }),
            },
        },
        { ...good, facts: { ...good.facts, birth: { ...good.facts.birth, interval: [] } } },
    ];
    for (const value of hostile) assert.equal(validateLinuxIdentity(value), undefined);
    for (const value of ['-0', '+1', '01', ' 1', '1e3', '1.0', '9'.repeat(100000), '-1', '9007199254740992'])
        assert.equal(
            validateLinuxIdentity({ ...good, facts: { ...good.facts, raw: { q: value, H: '100', bootSeconds: '0' } } }),
            undefined,
        );
    for (const value of ['18446744073709551616', '-1', '00'])
        assert.equal(
            validateLinuxIdentity({
                ...good,
                facts: { ...good.facts, birth: { ...good.facts.birth, readerUpperNs: value } },
            }),
            undefined,
        );
    for (const value of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1000500'])
        assert.equal(validateLinuxIdentity({ ...good, facts: { ...good.facts, requestUtcMs: value } }), undefined);
    assert.equal(invoked, 0);
});
test('current interval validator enforces required and forbidden reached groups for every decision stage', () => {
    const good = currentIntervalPayload();
    const f = good.facts;
    const initial = { pre: f.pre, raw: f.raw, requestUtcMs: f.requestUtcMs };
    const post = { ...initial, post: f.post };
    const derived = { ...post, offset: f.offset, birth: f.birth, decisionUtcMs: f.decisionUtcMs };
    const candidate = { ...derived, absolute: f.absolute, public: f.public };
    const cases = [
        ['unregistered', 'no-launch', {}],
        ['unselected', 'launch-check-threw', {}],
        ['unselected', 'root-proof-rejected', {}],
        ['established', 'established-changed', { raw: f.raw }],
        ['established', 'established-accepted', { raw: f.raw, selectedMs: f.selectedMs }],
        ['initial', 'boot-missing', { ...initial, raw: { q: '100050', H: '100' } }],
        ['initial', 'post-calibration-threw', { ...initial, postFailure: { branch: 'read-or-abort' } }],
        ...['post-launch-check-threw', 'clock-order-rejected', 'root-proof-changed'].map((d) => ['initial', d, post]),
        ['initial', 'decision-clock-rejected', derived],
        ['initial', 'interval-rejected', { ...derived, offset: { status: 'empty', lowerNs: '2', upperNs: '1' } }],
        ...['readiness-check-threw', 'final-launch-check-threw', 'concurrent-changed'].map((d) => [
            'initial',
            d,
            candidate,
        ]),
        ['initial', 'initial-accepted', f],
    ];
    for (const [mode, decision, facts] of cases) {
        assert.ok(isRecord(facts));
        const value = { ...good, mode, decision, facts };
        assert.ok(validateLinuxIdentity(value), String(decision));
        for (const key of Object.keys(facts)) {
            const partial: Record<string, unknown> = { ...facts };
            delete partial[key];
            if (
                key !== 'decisionUtcMs' ||
                decision === 'initial-accepted' ||
                String(decision).endsWith('check-threw') ||
                decision === 'concurrent-changed'
            )
                assert.equal(
                    validateLinuxIdentity({ ...value, facts: partial }),
                    undefined,
                    `${String(decision)} missing ${key}`,
                );
        }
        for (const [key, item] of Object.entries(f)) {
            if (!(key in facts))
                assert.equal(validateLinuxIdentity({ ...value, facts: { ...facts, [key]: item } }), undefined);
        }
        assert.equal(validateLinuxIdentity({ ...value, facts: { ...facts, forbidden: 1 } }), undefined);
        if (decision !== 'initial-accepted' && decision !== 'established-accepted')
            assert.equal(validateLinuxIdentity({ ...value, facts: { ...facts, selectedMs: 1 } }), undefined);
    }
});

test('current accepted public points retain Date range while a point rejection retains out-of-range N', () => {
    const good = currentIntervalPayload();
    const facts = { ...good.facts, public: { branch: 'accepted', pointMs: '8640000000000001' } };
    assert.equal(validateLinuxIdentity({ ...good, facts }), undefined);
    const { selectedMs: _selected, ...rejected } = facts;
    assert.ok(
        validateLinuxIdentity({
            ...good,
            decision: 'interval-rejected',
            facts: { ...rejected, public: { branch: 'point-or-date-range-rejected', pointMs: '8640000000000001' } },
        }),
    );
});
