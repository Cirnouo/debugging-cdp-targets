import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRecord } from '../src/shared/errors.ts';
import { createStdioClient } from './smoke/mcp-client.ts';
import { createScreenshotCaptureObserver } from './smoke/screenshot-capture-observer.ts';
import { runScreenshotTimeoutProbe } from './smoke/screenshot-timeout-fixture.ts';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

const server = `
const lines = require('node:readline').createInterface({ input: process.stdin });
let held;
lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'finish') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: held.id, result: { captured: true } }) + '\\n');
    } else if (message.params.mode === 'reject') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -1, message: 'rejected' } }) + '\\n');
    } else if (message.params.mode === 'exit') {
        process.exit(3);
    } else {
        held = message;
    }
});
`;

test('stdio dispatch and rejection settlement hooks observe the request independently of result evidence writes', async () => {
    const client = createStdioClient(process.execPath, ['-e', server]);
    const events: string[] = [];
    try {
        await assert.rejects(
            client.request('tools/call', { mode: 'reject' }, 1000, {
                dispatched() {
                    events.push('dispatched');
                },
                settled() {
                    events.push('settled');
                },
            }),
            /rejected/,
        );
        assert.deepEqual(events, ['dispatched', 'settled']);
    } finally {
        await client.close();
    }
});

for (const mode of ['success', 'reject', 'timeout', 'exit'] as const) {
    test(`actual stdio screenshot interval settles on ${mode} and excludes crossing samples`, async () => {
        const client = createStdioClient(process.execPath, ['-e', server]);
        const sampling = deferred<void>();
        const release = deferred<void>();
        const settled = deferred<void>();
        const events: string[] = [];
        let pending = false;
        let qualified = 0;
        const capture = createScreenshotCaptureObserver({
            async sample() {
                events.push('sample-started');
                sampling.resolve();
                await release.promise;
                events.push('sample-completed');
                return { window: true };
            },
            async tabs() {},
            async record(kind) {
                events.push(kind);
            },
        });
        try {
            const operation = capture(
                async (interval) => {
                    events.push('request-evidence-write');
                    await new Promise<void>((resolve) => setImmediate(resolve));
                    assert.equal(events.includes('sample-started'), false);
                    const result = await client.request('tools/call', { mode }, 500, {
                        dispatched() {
                            events.push('dispatched');
                            pending = true;
                            interval.dispatched();
                        },
                        settled() {
                            events.push('settled');
                            pending = false;
                            interval.settled();
                            settled.resolve();
                        },
                    });
                    assert.ok(isRecord(result));
                    return result;
                },
                120,
                async (action) => {
                    const startedPending = pending;
                    await action();
                    if (startedPending && pending) qualified += 1;
                },
            );
            const result = operation.then(
                (value) => ({ value }),
                (error: unknown) => ({ error }),
            );
            await sampling.promise;
            if (mode === 'success') client.notify('finish');
            await settled.promise;
            release.resolve();
            const actual = await result;
            assert.equal(qualified, 0);
            assert.ok(events.indexOf('dispatched') < events.indexOf('sample-started'));
            assert.ok(events.indexOf('settled') < events.indexOf('sample-completed'));
            if (mode === 'success') assert.deepEqual(actual, { value: { captured: true } });
            else assert.ok('error' in actual);
            assert.equal(events.filter((event) => event === 'settled').length, 1);
        } finally {
            release.resolve();
            await client.close();
        }
    });
}

test('actual screenshot observer retains a completed in-flight sample and ignores record failure after capture', async () => {
    const client = createStdioClient(process.execPath, ['-e', server]);
    let pending = false;
    let qualified = 0;
    const capture = createScreenshotCaptureObserver({
        async sample() {
            return { window: true };
        },
        async tabs() {
            client.notify('finish');
        },
        async record() {
            throw new Error('Evidence sink failed');
        },
    });
    try {
        const result = await capture(
            async (interval) => {
                const result = await client.request('tools/call', {}, 1000, {
                    dispatched() {
                        pending = true;
                        interval.dispatched();
                    },
                    settled() {
                        pending = false;
                        interval.settled();
                    },
                });
                assert.ok(isRecord(result));
                return result;
            },
            120,
            async (action) => {
                const startedPending = pending;
                await action();
                if (startedPending && pending) qualified += 1;
            },
        );
        assert.deepEqual(result, { captured: true });
        assert.equal(qualified, 1);
    } finally {
        await client.close();
    }
});

test('throwing interval hooks preserve rejection and subsequent unobserved request behavior', async () => {
    const client = createStdioClient(process.execPath, ['-e', server]);
    try {
        await assert.rejects(
            client.request('tools/call', { mode: 'reject' }, 1000, {
                dispatched() {
                    throw new Error('Dispatch observer failed');
                },
                settled() {
                    throw new Error('Settlement observer failed');
                },
            }),
            /rejected/,
        );
        await assert.rejects(client.request('tools/call', { mode: 'reject' }), /rejected/);
    } finally {
        await client.close();
    }
});

for (const mode of [
    'in-flight',
    'crossing',
    'sampler-failure',
    'record-failure',
    'cancelled-default',
    'tabs-cancelled',
    'tabs-failure',
] as const) {
    test(`real capture adapter preserves the runner result with ${mode} observation`, async () => {
        const client = createStdioClient(process.execPath, ['-e', server]);
        const settled = deferred<void>();
        const identity = {
            processId: 4100,
            executablePath: 'C:/Fixture/chrome.exe',
            startedAtUtc: '2026-10-05T00:00:00.0000001Z',
        };
        const window = [
            {
                ...identity,
                actualExecutablePath: identity.executablePath,
                handle: 120,
                foregroundHwnd: 300,
                child: false,
                visible: true,
                isIconic: false,
                showCmd: 1,
                stateReached: true,
                actionAccepted: null,
                nativeError: 0,
            },
        ];
        const evidence: { kind: string; value: unknown }[] = [];
        let sampleCount = 0;
        const capture = createScreenshotCaptureObserver({
            async sample(_handle, signal) {
                sampleCount += 1;
                if (mode === 'crossing' || mode === 'sampler-failure' || mode === 'cancelled-default')
                    client.notify('finish');
                if (mode === 'crossing') await settled.promise;
                if (mode === 'sampler-failure') throw new Error('Native observation failed');
                if (mode === 'cancelled-default')
                    await new Promise<void>((_resolve, reject) => {
                        signal.addEventListener(
                            'abort',
                            () =>
                                reject(
                                    Object.assign(new Error('Cancelled at settlement'), {
                                        name: 'AbortError',
                                        code: 'ABORT_ERR',
                                    }),
                                ),
                            { once: true },
                        );
                    });
                return window;
            },
            async tabs(_handle, signal) {
                if (
                    mode === 'in-flight' ||
                    mode === 'record-failure' ||
                    mode === 'tabs-cancelled' ||
                    mode === 'tabs-failure'
                )
                    client.notify('finish');
                if (mode === 'tabs-cancelled')
                    await new Promise<void>((_resolve, reject) => {
                        signal.addEventListener(
                            'abort',
                            () =>
                                reject(
                                    Object.assign(new Error('Tabs cancelled at settlement'), {
                                        name: 'AbortError',
                                        code: 'ABORT_ERR',
                                    }),
                                ),
                            { once: true },
                        );
                    });
                if (mode === 'tabs-failure') throw new Error('Tabs observation failed');
            },
            async record() {
                if (mode === 'record-failure') throw new Error('Passive evidence write failed');
            },
        });
        try {
            const result = await runScreenshotTimeoutProbe(
                {
                    label: 'interval-regression',
                    url: 'https://example.test/',
                    launch: { executable: identity.executablePath, args: ['--user-data-dir={fixture}/profile'] },
                    background: true,
                    fullPage: true,
                    colorScheme: 'light',
                    viewport: '1280x900x1',
                    evaluations: [],
                    ...(mode === 'cancelled-default' ? {} : { windowCondition: 'background-normal' }),
                },
                'C:/Evidence/shot.png',
                {
                    async acquire() {
                        return {
                            identity,
                            async call(name, _args, interval) {
                                if (name !== 'take_screenshot')
                                    return {
                                        content: [
                                            {
                                                type: 'text',
                                                text: name === 'new_page' ? '1: baseline\n7: capture' : '1: baseline',
                                            },
                                        ],
                                    };
                                // This is the actual adapter's delayed evidence/write boundary followed by the real stdio request.
                                await new Promise<void>((resolve) => setImmediate(resolve));
                                assert.equal(sampleCount, 0);
                                const response = await client.request('tools/call', {}, 1000, {
                                    dispatched() {
                                        interval?.dispatched();
                                    },
                                    settled() {
                                        interval?.settled();
                                        settled.resolve();
                                    },
                                });
                                assert.ok(isRecord(response));
                                return response;
                            },
                            async status() {
                                return { diagnostics: [] };
                            },
                            async sample() {
                                return window;
                            },
                            async condition() {
                                return window;
                            },
                            capture,
                            async png() {
                                return { width: 1280, height: 900 };
                            },
                        };
                    },
                    async cleanup() {
                        return { connections: [] };
                    },
                    async record(kind, value) {
                        evidence.push({ kind, value });
                    },
                },
            );
            assert.equal(result.capture?.outcome, 'success');
            assert.deepEqual(result.capture?.result, { captured: true });
            assert.equal(
                result.outcome,
                mode === 'in-flight' || mode === 'cancelled-default' || mode === 'tabs-cancelled'
                    ? 'success'
                    : 'blocked-evidence',
            );
            const interval = evidence.find((event) => event.kind === 'capture-interval')?.value;
            assert.ok(isRecord(interval));
            assert.equal(
                interval.duringCompleted,
                mode === 'in-flight' ||
                    mode === 'record-failure' ||
                    mode === 'tabs-cancelled' ||
                    mode === 'tabs-failure'
                    ? 1
                    : 0,
            );
            if (mode === 'sampler-failure' || mode === 'record-failure' || mode === 'tabs-failure')
                assert.match(result.observations.errors[0]?.error ?? '', /observation failed|write failed/);
        } finally {
            await client.close();
        }
    });
}
