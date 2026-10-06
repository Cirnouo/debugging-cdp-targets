import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';
import { boundedProbeError, runOwnedStartupProbe } from './smoke/linux-startup-probe-support.ts';

function ownedFixture() {
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
    const target: ManagedTarget = {
        processId: 1234,
        port: 19222,
        executablePath: '/opt/google/chrome/chrome',
        startedAtUtc: '2026-10-06T00:00:00.000Z',
        targetKind: 'chrome',
        child,
    };
    return { child, target };
}

test('probe bounds cyclic nested and aggregate fetch errors without copying unknown fields', () => {
    const secret = 'must-not-copy';
    const cause = Object.assign(new Error('x'.repeat(1_000)), {
        code: 'ECONNREFUSED',
        address: '127.0.0.1',
        port: 19222,
        secret,
    });
    cause.cause = cause;
    const error = new AggregateError(Array(100).fill(cause), 'fetch failed', { cause });
    const result = JSON.stringify(boundedProbeError(error));
    assert.match(result, /ECONNREFUSED/);
    assert.match(result, /127\.0\.0\.1/);
    assert.doesNotMatch(result, /must-not-copy/);
    assert.ok(result.length < 5_000);
    assert.match(result, /truncated/);
});

test('probe normally closes its successfully created target', async () => {
    const { child, target } = ownedFixture();
    const closed: ManagedTarget[] = [];
    const host = {
        async launch(_options: unknown, context: { onCreated?: (target: ManagedTarget) => void }) {
            context.onCreated?.(target);
            return target;
        },
        async close(actual: ManagedTarget) {
            closed.push(actual);
            child.exitCode = 0;
            child.emit('exit');
            return true;
        },
    };
    assert.equal(await runOwnedStartupProbe(host, { launch: { executable: target.executablePath, args: [] } }), target);
    assert.deepEqual(closed, [target]);
});

test('probe retries normal cleanup for a created target retained after failed launch', async () => {
    const { child, target } = ownedFixture();
    const original = new Error('CDP readiness failed');
    let closeCalls = 0;
    const host = {
        async launch(
            _options: unknown,
            context: { onCreated?: (target: ManagedTarget) => void },
        ): Promise<ManagedTarget> {
            context.onCreated?.(target);
            throw original;
        },
        async close(actual: ManagedTarget) {
            assert.equal(actual, target);
            closeCalls += 1;
            child.exitCode = 0;
            child.emit('exit');
            return true;
        },
    };
    await assert.rejects(
        runOwnedStartupProbe(host, { launch: { executable: target.executablePath, args: [] } }),
        (error) => error === original,
    );
    assert.equal(closeCalls, 1);
});

test('probe does not request another Close after host rollback proved actual exit', async () => {
    const { child, target } = ownedFixture();
    const original = new Error('CDP readiness failed');
    let closeCalls = 0;
    const host = {
        async launch(
            _options: unknown,
            context: { onCreated?: (target: ManagedTarget) => void },
        ): Promise<ManagedTarget> {
            context.onCreated?.(target);
            child.exitCode = 0;
            child.emit('exit');
            throw original;
        },
        async close() {
            closeCalls += 1;
            return true;
        },
    };
    await assert.rejects(
        runOwnedStartupProbe(host, { launch: { executable: target.executablePath, args: [] } }),
        (error) => error === original,
    );
    assert.equal(closeCalls, 0);
});

test('probe reports both startup and retained cleanup failures without force termination', async () => {
    const { target } = ownedFixture();
    const startup = new Error('readiness failed');
    const cleanup = new Error('normal close failed');
    const events: Record<string, unknown>[] = [];
    const host = {
        async launch(
            _options: unknown,
            context: { onCreated?: (target: ManagedTarget) => void },
        ): Promise<ManagedTarget> {
            context.onCreated?.(target);
            throw startup;
        },
        async close(actual: ManagedTarget): Promise<boolean> {
            assert.equal(actual, target);
            throw cleanup;
        },
    };
    await assert.rejects(
        runOwnedStartupProbe(host, { launch: { executable: target.executablePath, args: [] } }, (event) =>
            events.push(event),
        ),
        (error: unknown) =>
            error instanceof AggregateError && error.errors[0] === startup && error.errors[1] === cleanup,
    );
    assert.deepEqual(
        events.map((event) => event.event),
        ['created', 'startup-failure', 'normal-close-start', 'normal-close-failure'],
    );
});
