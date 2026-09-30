import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const runtime = await import('../src/domains/launch-command.mjs');
const { createCdpRouter } = await import('../src/adapters/cdp-router.mjs');
const { createTargetController } = await import('../src/application/target-controller.mjs');
const { choosePort, validateCdpIdentity } = await import('../src/domains/cdp-target.mjs');
const { createTargetHost } = await import('../src/adapters/target-host.mjs');
const { applyChromePreset } = await import('../src/adapters/target-host.mjs');
const { buildServerArguments } = await import('../src/adapters/official-server.mjs');
const { createControlServer, sendControlRequest } = await import('../src/adapters/control-ipc.mjs');
const { parseControlArguments } = await import('../src/interface/control-arguments.mjs');
const { startPluginRuntime } = await import('../src/application/plugin-runtime.mjs');

test('npm acquisition children hide their Windows console without altering stdio', async () => {
    const { hiddenOptions } = await import('../src/adapters/hide-npm-console.cjs');
    const stdio = ['ignore', 'pipe', 'pipe'];
    assert.deepEqual(hiddenOptions({ stdio }), { stdio, windowsHide: true });
});

test('launch command substitutes a selected CDP port without a shell', () => {
    const command = runtime.parseLaunchCommand({
        template: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port={port} --flag',
        port: 9223,
        environment: {},
    });
    assert.deepEqual(command, {
        executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        arguments: ['--remote-debugging-port=9223', '--flag'],
    });
});

test('launch command appends Chrome CDP switch when no placeholder is present', () => {
    const command = runtime.parseLaunchCommand({
        template: '"%BROWSER%" --new-window',
        port: 9223,
        environment: { BROWSER: 'C:\\Chrome\\chrome.exe' },
    });
    assert.deepEqual(command, {
        executable: 'C:\\Chrome\\chrome.exe',
        arguments: ['--new-window', '--remote-debugging-port=9223'],
    });
});

test('launch command rejects fixed conflicting debugging ports', () => {
    assert.throws(
        () =>
            runtime.parseLaunchCommand({
                template: 'chrome --remote-debugging-port=9222',
                port: 9223,
                environment: {},
            }),
        /conflict/i,
    );
});

test('launch command rejects shell operators and unresolved variables', () => {
    for (const template of ['chrome && whoami', 'chrome | more', '"%MISSING%"']) {
        assert.throws(() => runtime.parseLaunchCommand({ template, port: 9222, environment: {} }));
    }
});

test('launch command rejects duplicate port sources and debugging pipe mode', () => {
    for (const template of [
        'chrome --remote-debugging-port=9222 --remote-debugging-port={port}',
        'chrome --remote-debugging-port={port} --remote-debugging-pipe',
        'chrome --remote-debugging-port=9222 --app-port={port}',
    ]) {
        assert.throws(() => runtime.parseLaunchCommand({ template, port: 9223 }));
    }
});

test('launch command preserves separate, equals, colon port templates and quoted environment values', () => {
    const fixtures = [
        ['app --debug {port}', ['--debug', '9223']],
        ['app --debug={port}', ['--debug=9223']],
        ['app --debug:{port}', ['--debug:9223']],
        ['app --profile="%PROFILE%" --debug={port}', ['--profile=C:\\a b', '--debug=9223']],
    ];
    for (const [template, expected] of fixtures) {
        assert.deepEqual(
            runtime.parseLaunchCommand({ template, port: 9223, environment: { PROFILE: 'C:\\a b' } }).arguments,
            expected,
        );
    }
});

test('CDP router rewrites discovery URLs and forwards WebSocket frames', async (context) => {
    const target = http.createServer((request, response) => {
        response.setHeader('content-type', 'application/json');
        if (request.url === '/json/version') {
            response.end(
                JSON.stringify({
                    Browser: 'Chrome/153.0.0.0',
                    webSocketDebuggerUrl: `ws://127.0.0.1:${target.address().port}/devtools/browser/test`,
                }),
            );
            return;
        }
        response.end(
            JSON.stringify([
                {
                    id: 'page',
                    webSocketDebuggerUrl: `ws://127.0.0.1:${target.address().port}/devtools/page/page`,
                },
            ]),
        );
    });
    const targetWebSockets = new WebSocketServer({ server: target });
    targetWebSockets.on('connection', (socket) => socket.on('message', (message) => socket.send(message)));
    await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
    context.after(async () => {
        for (const socket of targetWebSockets.clients) socket.terminate();
        targetWebSockets.close();
        await new Promise((resolve) => target.close(resolve));
    });

    const router = await createCdpRouter();
    context.after(() => router.close());
    const empty = await fetch(`${router.url}/json/version`);
    assert.equal(empty.status, 503);

    router.setTarget({ port: target.address().port });
    const version = await (await fetch(`${router.url}/json/version`)).json();
    const pages = await (await fetch(`${router.url}/json/list`)).json();
    assert.equal(new URL(version.webSocketDebuggerUrl).port, String(router.port));
    assert.equal(new URL(pages[0].webSocketDebuggerUrl).port, String(router.port));

    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    socket.send(JSON.stringify({ id: 7, method: 'Browser.getVersion' }));
    const message = await new Promise((resolve) => socket.once('message', resolve));
    assert.equal(JSON.parse(message.toString()).id, 7);
    socket.close();
});

test('CDP router rejects a switch while a request is in flight and invalidates old sockets', async (context) => {
    const target = http.createServer((_request, response) => response.end('{}'));
    const targetWebSockets = new WebSocketServer({ server: target });
    targetWebSockets.on('connection', (socket) => socket.on('message', () => {}));
    await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
    context.after(async () => {
        for (const socket of targetWebSockets.clients) socket.terminate();
        targetWebSockets.close();
        await new Promise((resolve) => target.close(resolve));
    });
    const router = await createCdpRouter();
    context.after(() => router.close());
    router.setTarget({ port: target.address().port });
    const socket = new WebSocket(`ws://127.0.0.1:${router.port}/devtools/browser/test`);
    await new Promise((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ id: 9, method: 'Page.enable' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(router.isBusy(), true);
    assert.throws(() => router.setTarget({ port: target.address().port }), /busy/i);
    router.clearTarget();
    await new Promise((resolve) => socket.once('close', resolve));
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

test('target controller switches a verified target and keeps the previous one only by explicit choice', async () => {
    const events = [];
    const router = {
        isBusy: () => false,
        setTarget: (target) => events.push(`route:${target.port}`),
        clearTarget: () => events.push('route:none'),
    };
    let nextPort = 9222;
    const host = {
        launch: async () => ({ port: nextPort++, processId: nextPort + 100 }),
        close: async (target) => {
            events.push(`close:${target.port}`);
            return true;
        },
    };
    const controller = createTargetController({ router, host });
    assert.deepEqual(controller.status(), { status: 'none' });
    await controller.start({ launchCommand: 'chrome' });
    await controller.switch({ launchCommand: 'other', disposition: 'Keep' });
    assert.deepEqual(events, ['route:9222', 'route:9223']);
    assert.equal(controller.status().port, 9223);
    const stopped = await controller.stop({ disposition: 'Close' });
    assert.equal(stopped.status, 'none');
    assert.deepEqual(events, ['route:9222', 'route:9223', 'close:9223', 'route:none']);
});

test('target controller rejects switching without a disposition or while CDP is busy', async () => {
    let busy = false;
    const controller = createTargetController({
        router: {
            isBusy: () => busy,
            setTarget: () => {},
            clearTarget: () => {},
        },
        host: { launch: async () => ({ port: 9222 }), close: async () => true },
    });
    await controller.start({ launchCommand: 'chrome' });
    await assert.rejects(controller.switch({ launchCommand: 'other' }), /Close or Keep/);
    busy = true;
    await assert.rejects(controller.switch({ launchCommand: 'other', disposition: 'Keep' }), /busy/i);
});

test('target disposition pauses routing and failed normal close reports both retained targets', async () => {
    const events = [];
    let port = 9222;
    const controller = createTargetController({
        router: {
            isBusy: () => false,
            pause: () => events.push('pause'),
            resume: () => events.push('resume'),
            setTarget: (target) => events.push(`route:${target.port}`),
            clearTarget: () => events.push('clear'),
        },
        host: {
            launch: async () => ({ port: port++, processId: port }),
            close: async (target) => {
                events.push(`close:${target.port}`);
                return false;
            },
        },
    });
    await controller.start({});
    await assert.rejects(controller.switch({ disposition: 'Close' }), (error) => {
        assert.deepEqual(
            error.details.retainedTargets.map((target) => target.port),
            [9222, 9223],
        );
        return true;
    });
    assert.deepEqual(events, ['route:9222', 'pause', 'close:9222', 'close:9223', 'resume']);
    assert.equal(controller.status().port, 9222);
});

test('target exiting after attachment invalidates routing and frees the in-memory slot', async () => {
    const child = new EventEmitter();
    const events = [];
    const controller = createTargetController({
        router: { isBusy: () => false, setTarget: () => {}, clearTarget: () => events.push('clear') },
        host: { launch: async () => ({ child, port: 9222 }), close: async () => true },
    });
    await controller.start({});
    child.emit('exit', 0);
    assert.equal(controller.status().status, 'none');
    assert.deepEqual(events, ['clear']);
});

test('port allocation skips occupied and operating-system reserved ports', async () => {
    const visited = [];
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
    const fixture = fileURLToPath(new URL('./fixtures/fake-cdp-target.mjs', import.meta.url));
    const command = `"${process.execPath}" "${fixture}" --remote-debugging-port={port}`;
    const host = createTargetHost();
    const target = await host.launch({ launchCommand: command, targetKind: 'generic-cdp', basePort: 19000 });
    context.after(() => process.kill(target.processId, 'SIGTERM'));
    assert.equal(target.port >= 19000, true);
    assert.equal(target.browserProduct, 'Chrome/153.0.0.0');
    assert.equal(target.executablePath.toLowerCase(), path.resolve(process.execPath).toLowerCase());
});

function hostFixture({ endpointFailure = false, closeSucceeds = true, race = false } = {}) {
    const closed = [];
    const launched = [];
    let clock = 0;
    const platform = {
        reservedRanges: async () => [],
        snapshot: async (pid, port) => ({
            root: {
                exists: true,
                executablePath: process.execPath,
                identity: 'fixture',
                startedAtUtc: '2026-09-30T00:00:00Z',
            },
            processIds: [pid],
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
            return { pid: 42, exitCode: null };
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
    await assert.rejects(host.launch({ launchCommand: `"${process.execPath}"`, basePort: 9222 }), /CDP/);
    assert.deepEqual(closed, [9222]);
});

test('a verified released-probe port race closes the new process before advancing', async () => {
    const { host, closed, launched } = hostFixture({ race: true });
    const target = await host.launch({ launchCommand: `"${process.execPath}"`, basePort: 9222 });
    assert.equal(target.port, 9223);
    assert.deepEqual(launched, [9222, 9223]);
    assert.deepEqual(closed, [9222]);
});

test('startup cleanup failure reports the retained process and does not retry', async () => {
    const { host, launched } = hostFixture({ endpointFailure: true, closeSucceeds: false });
    await assert.rejects(host.launch({ launchCommand: `"${process.execPath}"`, basePort: 9222 }), (error) => {
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

test('per-user IPC rejects a second live controller without replacing the first', async (context) => {
    const endpoint =
        process.platform === 'win32' ? `\\\\.\\pipe\\dct-unique-${process.pid}` : `/tmp/dct-unique-${process.pid}.sock`;
    const controller = { status: () => ({ status: 'none' }) };
    const first = await createControlServer({ controller, endpoint });
    context.after(() => first.close());
    await assert.rejects(createControlServer({ controller, endpoint }), /already active|EADDRINUSE/);
    assert.equal((await sendControlRequest(endpoint, { action: 'status' })).ok, true);
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

test('local control IPC dispatches management commands without writing a session file', async (context) => {
    const received = [];
    const controller = {
        status: () => ({ status: 'none' }),
        start: async (options) => {
            received.push(options);
            return { status: 'active', port: 9222 };
        },
        switch: async () => ({ status: 'active', port: 9223 }),
        stop: async () => ({ status: 'none' }),
    };
    const endpoint =
        process.platform === 'win32'
            ? `\\\\.\\pipe\\dct-test-${process.pid}`
            : path.join(process.env.TMPDIR ?? '/tmp', `dct-test-${process.pid}.sock`);
    const server = await createControlServer({ controller, endpoint });
    context.after(() => server.close());
    assert.deepEqual(await sendControlRequest(endpoint, { action: 'status' }), {
        ok: true,
        result: { status: 'none' },
    });
    assert.deepEqual(await sendControlRequest(endpoint, { action: 'start', launchCommand: 'chrome' }), {
        ok: true,
        result: { status: 'active', port: 9222 },
    });
    assert.deepEqual(received, [{ launchCommand: 'chrome', targetKind: undefined, basePort: undefined }]);
    assert.equal((await sendControlRequest(endpoint, { action: 'resume' })).ok, false);
});

test('public control parser accepts only status, start, switch, and stop', () => {
    assert.deepEqual(parseControlArguments(['start', '--launch-command', 'chrome', '--target-kind', 'chrome']), {
        action: 'start',
        launchCommand: 'chrome',
        targetKind: 'chrome',
        basePort: 9222,
    });
    assert.deepEqual(parseControlArguments(['stop', '--disposition', 'Keep']), {
        action: 'stop',
        disposition: 'Keep',
    });
    assert.throws(() => parseControlArguments(['invoke', '--', 'list_pages']), /unknown/i);
    assert.throws(() => parseControlArguments(['resume']), /unknown/i);
    assert.throws(() => parseControlArguments(['switch', '--launch-command', 'chrome']), /disposition/i);
    assert.throws(
        () => parseControlArguments(['start', '--launch-command', 'one', '--launch-command', 'two']),
        /Duplicate/,
    );
});

test('control entry rejects invalid grammar before contacting any user MCP connection', () => {
    const entry = fileURLToPath(new URL('../src/interface/control.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [entry, 'invalid-action'], {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
    });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
        ok: false,
        error: 'Unknown action. Use status, start, switch, or stop.',
    });
});

test('plugin runtime exposes no target initially and closes it after official Server exits', async () => {
    const events = [];
    const child = new EventEmitter();
    const runtime = await startPluginRuntime({
        createRouter: async () => ({
            url: 'http://127.0.0.1:30000',
            isBusy: () => false,
            setTarget: () => {},
            clearTarget: () => events.push('route:none'),
            close: async () => events.push('router:closed'),
        }),
        createHost: () => ({
            launch: async () => ({ port: 9222 }),
            close: async () => {
                events.push('target:closed');
                return true;
            },
        }),
        createControl: async ({ controller }) => {
            assert.deepEqual(controller.status(), { status: 'none' });
            await controller.start({ launchCommand: 'chrome' });
            return { close: async () => events.push('control:closed') };
        },
        startServer: async (url) => {
            assert.equal(url, 'http://127.0.0.1:30000');
            return child;
        },
    });
    child.emit('exit', 0);
    await runtime.closed;
    assert.deepEqual(events, ['target:closed', 'route:none', 'control:closed', 'router:closed']);
});

test('official Server startup failure rolls back a target launched while package acquisition was pending', async () => {
    const events = [];
    await assert.rejects(
        startPluginRuntime({
            createRouter: async () => ({
                isBusy: () => false,
                setTarget: () => {},
                clearTarget: () => events.push('clear'),
                close: async () => events.push('router'),
            }),
            createHost: () => ({
                launch: async () => ({ port: 9222 }),
                close: async () => {
                    events.push('target');
                    return true;
                },
            }),
            createControl: async ({ controller }) => {
                await controller.start({});
                return { close: async () => events.push('control') };
            },
            startServer: async () => {
                throw new Error('Acquisition failed');
            },
        }),
        /Acquisition failed/,
    );
    assert.deepEqual(events, ['target', 'clear', 'control', 'router']);
});
