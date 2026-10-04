import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { RawData } from 'ws';
import { WebSocket, WebSocketServer } from 'ws';
import type { PlatformAdapter } from '../src/adapters/platform-process.ts';
import type { ManagedTarget } from '../src/domains/cdp-target.ts';
import { DetailedError, isRecord } from '../src/shared/errors.ts';

function targetFixture(port: number, processId = 42): ManagedTarget {
    return {
        port,
        processId,
        targetKind: 'generic-cdp',
        executablePath: process.execPath,
        startedAtUtc: '2026-09-30T00:00:00Z',
    };
}
function listeningPort(server: http.Server) {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return address.port;
}

const { createCdpRouter } = await import('../src/adapters/cdp-router.ts');
const { createTargetController } = await import('../src/application/target-controller.ts');
const { choosePort, validateCdpIdentity } = await import('../src/domains/cdp-target.ts');
const { createTargetHost } = await import('../src/adapters/target-host.ts');
const { applyChromePreset } = await import('../src/adapters/target-host.ts');
const { buildServerArguments } = await import('../src/adapters/official-server.ts');
const entryId = randomUUID();

test('CDP router rewrites discovery URLs and forwards WebSocket frames', async (context) => {
    const target = http.createServer((request, response) => {
        response.setHeader('content-type', 'application/json');
        if (request.url === '/json/version') {
            response.end(
                JSON.stringify({
                    Browser: 'Chrome/153.0.0.0',
                    webSocketDebuggerUrl: `ws://127.0.0.1:${listeningPort(target)}/devtools/browser/test`,
                }),
            );
            return;
        }
        response.end(
            JSON.stringify([
                {
                    id: 'page',
                    webSocketDebuggerUrl: `ws://127.0.0.1:${listeningPort(target)}/devtools/page/page`,
                },
            ]),
        );
    });
    const targetWebSockets = new WebSocketServer({ server: target });
    targetWebSockets.on('connection', (socket) => socket.on('message', (message) => socket.send(message)));
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    context.after(async () => {
        for (const socket of targetWebSockets.clients) socket.terminate();
        targetWebSockets.close();
        await new Promise<void>((resolve) => target.close(() => resolve()));
    });

    const router = await createCdpRouter();
    context.after(() => router.close());
    const empty = await fetch(`${router.url}/json/version`);
    assert.equal(empty.status, 503);

    router.setTarget({ port: listeningPort(target) });
    const version = await (await fetch(`${router.url}/json/version`)).json();
    const pages = await (await fetch(`${router.url}/json/list`)).json();
    assert.equal(new URL(version.webSocketDebuggerUrl).port, String(router.port));
    assert.equal(new URL(pages[0].webSocketDebuggerUrl).port, String(router.port));

    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    socket.send(JSON.stringify({ id: 7, method: 'Browser.getVersion' }));
    const message = await new Promise<RawData>((resolve) => socket.once('message', resolve));
    const echoed: unknown = JSON.parse(message.toString());
    assert.ok(isRecord(echoed));
    assert.equal(echoed.id, 7);
    socket.close();
});

test('CDP router rejects a switch while a request is in flight and invalidates old sockets', async (context) => {
    const target = http.createServer((_request, response) => response.end('{}'));
    const targetWebSockets = new WebSocketServer({ server: target });
    targetWebSockets.on('connection', (socket) => socket.on('message', () => {}));
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    context.after(async () => {
        for (const socket of targetWebSockets.clients) socket.terminate();
        targetWebSockets.close();
        await new Promise<void>((resolve) => target.close(() => resolve()));
    });
    const router = await createCdpRouter();
    context.after(() => router.close());
    router.setTarget({ port: listeningPort(target) });
    const socket = new WebSocket(`ws://127.0.0.1:${router.port}/devtools/browser/test`);
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ id: 9, method: 'Page.enable' }));
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    assert.equal(router.isBusy(), true);
    assert.throws(() => router.setTarget({ port: listeningPort(target) }), /busy/i);
    router.clearTarget();
    await new Promise<void>((resolve) => socket.once('close', resolve));
    assert.equal(router.isBusy(), false);
});

test('CDP router pauses new requests during target disposition', async (context) => {
    const router = await createCdpRouter();
    context.after(() => router.close());
    router.setTarget({ port: 1 });
    router.pause();
    assert.equal((await fetch(`${router.url}/json/version`)).status, 409);
    router.clearTarget();
    assert.equal((await fetch(`${router.url}/json/version`)).status, 503);
});

test('CDP router rejects cross-origin browser access and fails closed on changed target identity', async (context) => {
    const router = await createCdpRouter();
    context.after(() => router.close());
    router.setTarget({
        port: 1,
        verify: async () => {
            throw new Error('Listener owner changed');
        },
    });
    const origin = await fetch(`${router.url}/json/version`, { headers: { origin: 'https://untrusted.example' } });
    assert.equal(origin.status, 403);
    const changed = await fetch(`${router.url}/json/version`);
    assert.equal(changed.status, 503);
    assert.match(await changed.text(), /IDENTITY/);
});

test('port allocation skips occupied and operating-system reserved ports', async () => {
    const visited: number[] = [];
    const port = await choosePort({
        basePort: 9222,
        reservedRanges: [[9222, 9223]],
        probe: async (candidate) => {
            visited.push(candidate);
            return candidate !== 9224;
        },
    });
    assert.equal(port, 9225);
    assert.deepEqual(visited, [9224, 9225]);
});

test('port allocation never selects a privileged port and fails when exhausted', async () => {
    assert.equal(await choosePort({ basePort: 1, probe: async () => true }), 1024);
    await assert.rejects(choosePort({ basePort: 65535, probe: async () => false }), /No available/);
});

test('CDP identity rejects foreign and exposed listeners', () => {
    const endpoint = {
        Browser: 'Chrome/153.0.0.0',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    };
    const owned = [{ localAddress: '127.0.0.1', owningProcess: 42 }];
    assert.equal(
        validateCdpIdentity({ endpoint, port: 9222, listeners: owned, processIds: [42] }).browserProduct,
        endpoint.Browser,
    );
    assert.throws(() => validateCdpIdentity({ endpoint, port: 9222, listeners: owned, processIds: [43] }), /owner/i);
    assert.throws(
        () =>
            validateCdpIdentity({
                endpoint,
                port: 9222,
                listeners: [...owned, { localAddress: '0.0.0.0', owningProcess: 42 }],
                processIds: [42],
            }),
        /exposed/i,
    );
    assert.throws(
        () =>
            validateCdpIdentity({
                endpoint: { ...endpoint, webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/test' },
                port: 9222,
                listeners: owned,
                processIds: [42],
            }),
        /port/i,
    );
});

test('target host launches and verifies a browser-level CDP endpoint', async (context) => {
    if (process.platform !== 'win32') return context.skip('Windows process ownership smoke test');
    const fixture = fileURLToPath(new URL('./fixtures/fake-cdp-target.ts', import.meta.url));
    const host = createTargetHost();
    const target = await host.launch({
        launch: { executable: process.execPath, args: [fixture, '--remote-debugging-port={port}'] },
        targetKind: 'generic-cdp',
        basePort: 19000,
    });
    context.after(() => process.kill(target.processId, 'SIGTERM'));
    assert.equal(target.port >= 19000, true);
    assert.equal(target.browserProduct, 'Chrome/153.0.0.0');
    assert.equal(target.executablePath.toLowerCase(), path.resolve(process.execPath).toLowerCase());
});

function hostFixture({ endpointFailure = false, closeSucceeds = true, race = false } = {}) {
    const closed: number[] = [];
    const launched: number[] = [];
    let clock = 0;
    const platform: PlatformAdapter = {
        reservedRanges: async () => [],
        snapshot: async (pid, port) => ({
            root: {
                exists: true,
                executablePath: process.execPath,
                sessionId: 1,
                startedAtUtc: '2026-09-30T00:00:00Z',
            },
            processIds: [pid],
            currentSessionId: 1,
            listeners: [{ localAddress: '127.0.0.1', owningProcess: race && port === 9222 ? 999 : pid }],
        }),
        validateNewRoot: () => {},
        close: async (target) => {
            closed.push(target.port);
            return closeSucceeds;
        },
    };
    const host = createTargetHost({
        platformAdapter: platform,
        probe: async () => true,
        spawn: async (_executable, _args, port) => {
            launched.push(port);
            return { pid: 42, exitCode: null, once: () => {} };
        },
        getVersion: async (port) => {
            if (endpointFailure) throw new Error('Fixture CDP failure');
            return {
                Browser: 'Chrome/153.0.0.0',
                webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/test`,
            };
        },
        now: () => clock,
        sleep: async () => {
            clock += 25_000;
        },
    });
    return { host, closed, launched };
}

test('target startup failure normally closes only its newly launched process', async () => {
    const { host, closed } = hostFixture({ endpointFailure: true });
    await assert.rejects(host.launch({ launch: { executable: process.execPath }, basePort: 9222 }), /CDP/);
    assert.deepEqual(closed, [9222]);
});

test('a verified released-probe port race closes the new process before advancing', async () => {
    const { host, closed, launched } = hostFixture({ race: true });
    const target = await host.launch({ launch: { executable: process.execPath }, basePort: 9222 });
    assert.equal(target.port, 9223);
    assert.deepEqual(launched, [9222, 9223]);
    assert.deepEqual(closed, [9222]);
});

test('startup cleanup failure reports the retained process and does not retry', async () => {
    const { host, launched } = hostFixture({ endpointFailure: true, closeSucceeds: false });
    await assert.rejects(host.launch({ launch: { executable: process.execPath }, basePort: 9222 }), (error) => {
        assert.ok(error instanceof DetailedError && isRecord(error.details));
        assert.equal(error.details.processId, 42);
        assert.equal(error.details.port, 9222);
        assert.equal(error.details.closeConfirmed, false);
        return true;
    });
    assert.deepEqual(launched, [9222]);
});

test('Chrome rejects every duplicate or non-loopback debugging address before launching', () => {
    for (const arguments_ of [
        ['--remote-debugging-address=127.0.0.1', '--remote-debugging-address=0.0.0.0'],
        ['--remote-debugging-address=0.0.0.0', '--remote-debugging-address=127.0.0.1'],
        ['--remote-debugging-address=127.0.0.1', '--remote-debugging-address=127.0.0.1'],
        ['--remote-debugging-address', '0.0.0.0'],
        ['--remote-debugging-address:0.0.0.0'],
    ])
        assert.throws(() => applyChromePreset(arguments_), /loopback|Duplicate/);
    assert.ok(applyChromePreset(['--remote-debugging-address', '127.0.0.1']).includes('127.0.0.1'));
});

test('official server receives a stable browser URL and privacy-safe defaults', () => {
    assert.deepEqual(buildServerArguments('http://127.0.0.1:30000', {}), [
        '--browserUrl=http://127.0.0.1:30000',
        '--categoryExtensions=true',
        '--no-usage-statistics',
        '--no-performance-crux',
    ]);
});

test('official server switches require explicit boolean environment overrides', () => {
    assert.deepEqual(
        buildServerArguments('http://127.0.0.1:30000', {
            DCT_EXTENSIONS: 'false',
            DCT_USAGE_STATISTICS: 'true',
            DCT_PERFORMANCE_CRUX: 'true',
        }),
        [
            '--browserUrl=http://127.0.0.1:30000',
            '--categoryExtensions=false',
            '--usage-statistics',
            '--performance-crux',
        ],
    );
    assert.throws(() => buildServerArguments('http://127.0.0.1:30000', { DCT_EXTENSIONS: 'yes' }), /boolean/i);
});

test('controller normal Close pauses routing and preserves identity on failure; busy Close does not signal', async () => {
    const events: string[] = [];
    let busy = false;
    const controller = createTargetController({
        entryId,
        router: {
            isBusy: () => busy,
            pause: () => {
                events.push('pause');
            },
            resume: () => {
                events.push('resume');
            },
            setTarget: () => {
                events.push('route');
            },
            clearTarget: () => {
                events.push('clear');
            },
        },
        host: {
            launch: async () => targetFixture(9222),
            close: async () => {
                events.push('close');
                return false;
            },
        },
        server: {
            ensure: async () => {},
            close: async () => {
                events.push('official-close');
            },
        },
    });
    const active = await controller.start({ launch: { executable: 'fixture' } });
    assert.ok(active.sessionId);
    busy = true;
    await assert.rejects(controller.stop({ sessionId: active.sessionId, disposition: 'Close' }), /busy/i);
    assert.deepEqual(events, ['route']);
    busy = false;
    await assert.rejects(controller.stop({ sessionId: active.sessionId, disposition: 'Close' }), (error: unknown) => {
        assert.ok(error instanceof DetailedError && isRecord(error.details));
        assert.deepEqual(error.details.retainedTargets, [{ processId: 42, port: 9222 }]);
        return true;
    });
    assert.deepEqual(events, ['route', 'pause', 'close', 'resume']);
    assert.equal(controller.status().sessionId, active.sessionId);
    assert.equal(controller.status().status, 'active');
});

test('controller route attachment failure normally closes only the newly launched target', async () => {
    const closed: number[] = [];
    const controller = createTargetController({
        entryId,
        router: {
            isBusy: () => false,
            setTarget: () => {
                throw new Error('route failed');
            },
            clearTarget: () => {},
        },
        host: {
            launch: async () => targetFixture(9222),
            close: async (target) => {
                closed.push(target.processId);
                return true;
            },
        },
        server: { ensure: async () => {}, close: async () => {} },
    });
    await assert.rejects(controller.start({ launch: { executable: 'fixture' } }), /route failed/);
    assert.deepEqual(closed, [42]);
    assert.equal(controller.status().status, 'idle');
});
