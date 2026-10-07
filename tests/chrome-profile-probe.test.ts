import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import type { ProcessEvidence, ProcessTarget } from '../src/domains/cdp-target.ts';
import { isRecord } from '../src/shared/errors.ts';

async function probe() {
    assert.ok(
        existsSync(new URL('./smoke/chrome-profile-probe.ts', import.meta.url)),
        'The owned profile probe is required.',
    );
    return import('./smoke/chrome-profile-probe.ts');
}

async function fixture(t: test.TestContext) {
    const requests: string[] = [];
    const evaluations: Record<string, unknown>[] = [];
    const replies: unknown[] = [{ url: 'chrome://version/', profilePath: '/synthetic/lease/Default' }];
    let descriptor: unknown;
    let browserId = 'owned-browser';
    let versionRequests = 0;
    let malformedCreation = false;
    let holdCreation = false;
    let silentSocket = false;
    let rawReply: string | undefined;
    let onEvaluation: (() => void) | undefined;
    let closeStatus = 200;
    let connected = 0;
    let disconnected = 0;
    let closed: (() => void) | undefined;
    const socketClosed = new Promise<void>((resolve) => {
        closed = resolve;
    });
    const server = createServer((request, response) => {
        requests.push(`${request.method} ${request.url}`);
        response.setHeader('content-type', 'application/json');
        if (request.url === '/json/version') {
            versionRequests += 1;
            response.end(
                JSON.stringify({
                    Browser: 'Chrome/154.0.8037.98',
                    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${browserId}`,
                }),
            );
        } else if (request.url === '/json/list') {
            response.end(JSON.stringify([{ id: 'original-page', type: 'page', url: 'data:text/html,fixture' }]));
        } else if (request.url?.startsWith('/json/new?')) {
            assert.equal(request.method, 'PUT');
            assert.equal(decodeURIComponent(request.url.slice('/json/new?'.length)), 'chrome://version/');
            if (!holdCreation) response.end(malformedCreation ? '{invalid' : JSON.stringify(descriptor));
        } else if (request.url === '/json/close/fresh-page') {
            assert.equal(request.method, 'GET');
            response.statusCode = closeStatus;
            response.end('Target is closing');
        } else {
            response.statusCode = 404;
            response.end('{}');
        }
    });
    const sockets = new WebSocketServer({ server });
    sockets.on('connection', (socket, request) => {
        connected += 1;
        assert.equal(request.url, '/devtools/page/fresh-page');
        socket.once('close', () => {
            disconnected += 1;
            closed?.();
        });
        socket.on('message', (bytes) => {
            const request: unknown = JSON.parse(bytes.toString());
            assert.ok(isRecord(request));
            evaluations.push(request);
            assert.equal(request.method, 'Runtime.evaluate');
            assert.ok(isRecord(request.params));
            assert.equal(request.params.returnByValue, true);
            assert.equal(request.params.awaitPromise, true);
            assert.match(String(request.params.expression), /profile_path/);
            onEvaluation?.();
            if (rawReply !== undefined) {
                socket.send(rawReply);
                return;
            }
            if (!silentSocket)
                socket.send(
                    JSON.stringify({
                        id: request.id,
                        result: {
                            result: { type: 'object', value: replies.length > 1 ? replies.shift() : replies[0] },
                        },
                    }),
                );
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    descriptor = {
        id: 'fresh-page',
        type: 'page',
        url: 'about:blank',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/fresh-page`,
    };
    t.after(async () => {
        for (const socket of sockets.clients) socket.terminate();
        await new Promise<void>((resolve) => sockets.close(() => resolve()));
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const target: ProcessTarget = {
        processId: 4100,
        port,
        targetKind: 'chrome',
        executablePath: '/synthetic/chrome',
        startedAtUtc: '2026-10-07T00:00:00.000Z',
    };
    let snapshotCalls = 0;
    let changeAt = Infinity;
    let foreignListener = false;
    const platform = {
        async snapshot(pid: number, requestedPort: number): Promise<ProcessEvidence> {
            assert.equal(pid, target.processId);
            assert.equal(requestedPort, port);
            snapshotCalls += 1;
            return {
                root: {
                    exists: true,
                    executablePath: target.executablePath,
                    startedAtUtc: snapshotCalls >= changeAt ? '2026-10-07T01:00:00.000Z' : target.startedAtUtc,
                    sessionId: 1,
                    productName: 'Google Chrome',
                    companyName: 'Google LLC',
                },
                currentSessionId: 1,
                processIds: [4100],
                listeners: [{ localAddress: '127.0.0.1', owningProcess: foreignListener ? 4200 : 4100 }],
            };
        },
    };
    return {
        target,
        platform,
        requests,
        evaluations,
        replies,
        setDescriptor(value: unknown) {
            descriptor = value;
        },
        setBrowserId(value: string) {
            browserId = value;
        },
        setRawReply(value: string) {
            rawReply = value;
        },
        onEvaluation(callback: () => void) {
            onEvaluation = callback;
        },
        failIdentityAfter(count: number) {
            changeAt = count;
        },
        foreignListener() {
            foreignListener = true;
        },
        malformedCreation() {
            malformedCreation = true;
        },
        holdCreation() {
            holdCreation = true;
        },
        silentSocket() {
            silentSocket = true;
        },
        failClose() {
            closeStatus = 500;
        },
        stats: () => ({ connected, disconnected, versionRequests, snapshotCalls }),
        async waitDisconnected() {
            await Promise.race([
                socketClosed,
                delay(1_000, undefined, { ref: false }).then(() =>
                    assert.fail('The peer must observe socket cleanup.'),
                ),
            ]);
        },
    };
}

test('native profile probe waits for the exact version document and asynchronously populated path, then closes its socket and fresh target', async (t) => {
    const f = await fixture(t);
    f.replies.unshift({ url: 'about:blank', profilePath: '' }, { url: 'chrome://version/', profilePath: '' });
    const { readChromeSmokeProfile } = await probe();
    assert.equal(
        await readChromeSmokeProfile(f.target, { platform: f.platform, pollMs: 1 }),
        '/synthetic/lease/Default',
    );
    assert.equal(f.evaluations.length, 3);
    assert.equal(f.stats().connected, 1);
    assert.equal(f.stats().disconnected, 1);
    assert.ok(f.stats().versionRequests >= 3);
    assert.ok(f.stats().snapshotCalls >= 6);
    assert.equal(f.requests.filter((value) => value.startsWith('PUT /json/new?')).length, 1);
    assert.equal(f.requests.filter((value) => value === 'GET /json/close/fresh-page').length, 1);
    assert.equal(
        f.requests.some((value) => value.includes('close/original-page')),
        false,
    );
});

test('native profile probe refuses foreign process or listener evidence before creating a page', async (t) => {
    const { readChromeSmokeProfile } = await probe();
    for (const kind of ['process', 'listener']) {
        const f = await fixture(t);
        if (kind === 'process') f.failIdentityAfter(1);
        else f.foreignListener();
        await assert.rejects(
            readChromeSmokeProfile(f.target, { platform: f.platform }),
            /creation|identity|owner|process|listener/i,
        );
        assert.equal(
            f.requests.some((value) => value.startsWith('PUT ')),
            false,
        );
        assert.equal(f.stats().connected, 0);
    }
});

test('native profile probe rejects foreign or malformed page sockets and cleans only the newly created target', async (t) => {
    const { readChromeSmokeProfile } = await probe();
    for (const suffix of [
        'ws://localhost:PORT/devtools/page/fresh-page',
        'ws://127.0.0.1:1/devtools/page/fresh-page',
        'ws://127.0.0.1:PORT/devtools/page/foreign-page',
        'ws://user@127.0.0.1:PORT/devtools/page/fresh-page',
        'ws://127.0.0.1:PORT/devtools/page/fresh-page?query=1',
        'ws://127.0.0.1:PORT/devtools/page/fresh-page#fragment',
        'ws://127.0.0.1:PORT/devtools/browser/fresh-page',
        'not a URL',
    ]) {
        const f = await fixture(t);
        f.setDescriptor({
            id: 'fresh-page',
            type: 'page',
            webSocketDebuggerUrl: suffix.replace('PORT', String(f.target.port)),
        });
        await assert.rejects(readChromeSmokeProfile(f.target, { platform: f.platform }), /socket|endpoint|URL/i);
        assert.equal(f.stats().connected, 0);
        assert.ok(f.requests.includes('GET /json/close/fresh-page'));
    }
});

test('native profile probe rejects malformed creation, invalid IDs and reused IDs without closing an existing page', async (t) => {
    const { readChromeSmokeProfile } = await probe();
    for (const descriptor of [null, {}, { id: '../original-page' }, { id: 'original-page', type: 'page' }]) {
        const f = await fixture(t);
        f.setDescriptor(descriptor);
        await assert.rejects(readChromeSmokeProfile(f.target, { platform: f.platform }), /target|page|ID/i);
        assert.equal(
            f.requests.some((value) => value.startsWith('GET /json/close/')),
            false,
        );
    }
    const f = await fixture(t);
    f.malformedCreation();
    await assert.rejects(readChromeSmokeProfile(f.target, { platform: f.platform }), /JSON|Unexpected|property/i);
    assert.equal(
        f.requests.some((value) => value.startsWith('GET /json/close/')),
        false,
    );
});

test('native profile probe bounds missing DOM evidence and unanswered CDP, and always disposes a known probe', async (t) => {
    const { readChromeSmokeProfile } = await probe();
    for (const condition of ['wrong-document', 'empty-path', 'invalid-path', 'silent-socket']) {
        const f = await fixture(t);
        if (condition === 'silent-socket') f.silentSocket();
        else
            f.replies.splice(0, 1, {
                url: condition === 'wrong-document' ? 'data:text/html,foreign' : 'chrome://version/',
                profilePath: condition === 'invalid-path' ? 42 : '',
            });
        const started = Date.now();
        await assert.rejects(
            readChromeSmokeProfile(f.target, { platform: f.platform, timeoutMs: 100, pollMs: 1 }),
            /profile|timed out|timeout|aborted/i,
        );
        assert.ok(Date.now() - started < 2_000);
        assert.equal(f.stats().connected, 1);
        assert.equal(f.stats().disconnected, 1);
        assert.ok(f.requests.includes('GET /json/close/fresh-page'));
    }
});

test('native profile probe bounds an unanswered page creation without inventing a cleanup ID', async (t) => {
    const f = await fixture(t);
    f.holdCreation();
    const { readChromeSmokeProfile } = await probe();
    await assert.rejects(
        readChromeSmokeProfile(f.target, { platform: f.platform, timeoutMs: 100 }),
        /timed out|timeout|aborted/i,
    );
    assert.equal(f.stats().connected, 0);
    assert.equal(
        f.requests.some((value) => value.startsWith('GET /json/close/')),
        false,
    );
});

test('native profile probe fails when target cleanup fails even after valid browser evidence', async (t) => {
    const f = await fixture(t);
    f.failClose();
    const { readChromeSmokeProfile } = await probe();
    await assert.rejects(readChromeSmokeProfile(f.target, { platform: f.platform }), /close|cleanup|HTTP/i);
    assert.equal(f.stats().disconnected, 1);
    assert.ok(f.requests.includes('GET /json/close/fresh-page'));
});

test('native profile probe closes its socket but refuses target mutation after native or browser identity changes', async (t) => {
    const { readChromeSmokeProfile } = await probe();
    for (const kind of ['process', 'browser']) {
        const f = await fixture(t);
        f.onEvaluation(() => (kind === 'process' ? f.failIdentityAfter(0) : f.setBrowserId('replacement-browser')));
        await assert.rejects(readChromeSmokeProfile(f.target, { platform: f.platform }), /cleanup failed/i);
        await f.waitDisconnected();
        assert.equal(f.stats().disconnected, 1);
        assert.equal(
            f.requests.some((request) => request.startsWith('GET /json/close/')),
            false,
        );
    }
});

test('native profile probe rejects malformed, mismatched and failed CDP evaluations while cleaning its target', async (t) => {
    const { readChromeSmokeProfile } = await probe();
    for (const reply of [
        '{invalid',
        'null',
        JSON.stringify({ id: 400, result: {} }),
        JSON.stringify({ id: 1, error: { message: 'Fixture evaluation failure' } }),
        JSON.stringify({ id: 1, result: { exceptionDetails: {}, result: {} } }),
        JSON.stringify({ id: 1, result: { result: { value: null } } }),
    ]) {
        const f = await fixture(t);
        f.setRawReply(reply);
        await assert.rejects(
            readChromeSmokeProfile(f.target, { platform: f.platform }),
            /JSON|Unexpected|property|profile|CDP|script/i,
        );
        assert.equal(f.stats().disconnected, 1);
        assert.ok(f.requests.includes('GET /json/close/fresh-page'));
    }
});

test('native profile probe retains primary timeout evidence alongside a failed target cleanup', async (t) => {
    const f = await fixture(t);
    f.silentSocket();
    f.failClose();
    const { readChromeSmokeProfile } = await probe();
    await assert.rejects(
        readChromeSmokeProfile(f.target, { platform: f.platform, timeoutMs: 100 }),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors.length, 2);
            assert.match(String(error.errors[0]), /timed out|timeout|aborted/i);
            assert.match(String(error.errors[1]), /HTTP|close/);
            return true;
        },
    );
    assert.equal(f.stats().disconnected, 1);
});
