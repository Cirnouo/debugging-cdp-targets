import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createOfficialConnection, interruptedOfficialCall } from '../../src/adapters/mcp-bridge.ts';
import { buildServerArguments } from '../../src/adapters/official-server.ts';
import { createPlatformAdapter, validateProcessIdentity } from '../../src/adapters/platform-process.ts';
import { createTargetHost } from '../../src/adapters/target-host.ts';
import { type ProcessTarget, validateCdpIdentity } from '../../src/domains/cdp-target.ts';
import type { ConnectionStatus } from '../../src/domains/control-contract.ts';
import type { ApplicationLaunch } from '../../src/domains/launch-command.ts';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import { closeSmokeConnection, lifecycleClient, readStatus } from './lifecycle-client.ts';
import { createClient } from './mcp-client.ts';
import {
    assertPixels,
    closeEvery,
    expandFixture,
    parseScreenshotFixture,
    prepareScreenshotWindow,
    readScreenshotGeometry,
    screenshotPhase,
    screenshotShapes,
    screenshotSize,
} from './screenshot-fixture.ts';
import { assertWindowState, sampleWindow } from './window-evidence.ts';

assert.equal(process.platform, 'win32', 'This opt-in window/PNG acceptance requires Windows.');
const configPath = process.argv[2];
const outputParent = process.argv[3];
assert.ok(
    configPath && outputParent && path.isAbsolute(configPath) && path.isAbsolute(outputParent),
    'Supply absolute fixture JSON and evidence parent paths.',
);
const fixture = parseScreenshotFixture(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
await mkdir(outputParent, { recursive: true });
const folder = await mkdtemp(path.join(outputParent, `${fixture.label}-`));
const root = fileURLToPath(new URL('../..', import.meta.url));
const platform = createPlatformAdapter();
const evidence: Record<string, unknown>[] = [];
const save = () =>
    writeFile(path.join(folder, 'evidence.json'), `${JSON.stringify({ fixture: fixture.label, evidence }, null, 4)}\n`);
console.log(JSON.stringify({ folder }));

interface Route {
    identity: ProcessTarget;
    call(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
    schema(name: string): Record<string, unknown>;
    status?(): Promise<Record<string, unknown>>;
    close(): Promise<unknown>;
}
function text(result: Record<string, unknown>) {
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.ok(Array.isArray(result.content));
    return result.content
        .filter(isRecord)
        .flatMap((item) => (item.type === 'text' && typeof item.text === 'string' ? [item.text] : []))
        .join('\n');
}
function returned(result: Record<string, unknown>) {
    const match = text(result).match(/```json\s*([\s\S]*?)\s*```/);
    assert.ok(match?.[1], 'Official evaluation has no JSON readback.');
    const value: unknown = JSON.parse(match[1]);
    assert.ok(isRecord(value));
    return value;
}
function properties(schema: Record<string, unknown>) {
    assert.ok(isRecord(schema.properties));
    return schema.properties;
}
async function evaluate(route: Route, pageId: number, function_: string) {
    const fields = properties(route.schema('evaluate_script'));
    assert.ok('function' in fields && 'pageId' in fields);
    return route.call('evaluate_script', {
        pageId,
        function: function_,
        ...('waitForStableDom' in fields ? { waitForStableDom: false } : {}),
    });
}
async function page(route: Route) {
    const ids = [...text(await route.call('list_pages')).matchAll(/^(\d+):/gm)].map((match) => Number(match[1]));
    const matches: { pageId: number; metadata: Record<string, unknown> }[] = [];
    for (const pageId of ids) {
        const metadata = returned(
            await evaluate(
                route,
                pageId,
                '() => ({title:document.title,userAgent:navigator.userAgent,appVersion:globalThis.app?.getVersion?.() ?? null})',
            ),
        );
        if (typeof metadata.title === 'string' && metadata.title.includes(fixture.pageTitle))
            matches.push({ pageId, metadata });
    }
    assert.equal(matches.length, 1, 'Expected one matching owned main-window renderer.');
    const selected = matches[0];
    assert.ok(selected);
    evidence.push({
        renderer: selected,
        identity: route.identity,
        association: 'One visible owned root and one matching main renderer; no new_page.',
    });
    return selected.pageId;
}
async function initialize(directory: string, candidate: boolean) {
    for (const name of ['profile', 'extensions', 'workspace', 'vault/.obsidian', 'output'])
        await mkdir(path.join(directory, name), { recursive: true });
    for (const [file, contents] of Object.entries(fixture.fixtureFiles)) {
        const destination = path.resolve(directory, file);
        assert.ok(destination.startsWith(`${directory}${path.sep}`));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, contents.replaceAll('{fixture}', directory.replaceAll('\\', '/')), { flag: 'wx' });
    }
    return expandFixture(
        { ...fixture.launch, args: candidate ? fixture.candidateArgs : (fixture.launch.args ?? []) },
        directory,
    );
}
async function inspect(summary: ConnectionStatus, launch: ApplicationLaunch, started: number) {
    assert.ok(summary.processId && summary.port && summary.targetKind);
    const snapshot = await platform.snapshot(summary.processId, summary.port);
    assert.ok(snapshot.root.exists);
    assert.ok(
        Date.parse(snapshot.root.startedAtUtc) >= started - 1000 &&
            Date.parse(snapshot.root.startedAtUtc) <= Date.now(),
    );
    const identity: ProcessTarget = {
        processId: summary.processId,
        port: summary.port,
        targetKind: summary.targetKind,
        executablePath: launch.executable,
        startedAtUtc: snapshot.root.startedAtUtc,
    };
    validateProcessIdentity(snapshot, identity);
    const response = await fetch(`http://127.0.0.1:${identity.port}/json/version`, {
        signal: AbortSignal.timeout(5000),
    });
    assert.ok(response.ok);
    const endpoint: unknown = await response.json();
    validateCdpIdentity({
        endpoint,
        port: identity.port,
        listeners: snapshot.listeners,
        processIds: snapshot.processIds,
        targetKind: identity.targetKind,
    });
    evidence.push({ verifiedTarget: identity, endpoint });
    return identity;
}
function schemaMap(tools: unknown) {
    assert.ok(Array.isArray(tools));
    const schemas = new Map<string, Record<string, unknown>>();
    for (const tool of tools) {
        assert.ok(isRecord(tool) && typeof tool.name === 'string' && isRecord(tool.inputSchema));
        schemas.set(tool.name, tool.inputSchema);
    }
    return (name: string) => {
        const schema = schemas.get(name);
        assert.ok(schema, `Required tool missing: ${name}`);
        return schema;
    };
}
async function direct(
    launch: ApplicationLaunch,
    directory: string,
    register: (action: () => Promise<unknown>) => void,
): Promise<Route> {
    const host = createTargetHost();
    const target = await host.launch(
        { isolation: { mode: 'none' }, launch, targetKind: fixture.targetKind, basePort: 20222 },
        {
            onCreated: (created) => {
                evidence.push({
                    acquiredDirectTarget: {
                        processId: created.processId,
                        executablePath: created.executablePath,
                        startedAtUtc: created.startedAtUtc,
                    },
                });
                register(async () => {
                    assert.equal(await host.close(created, { requireListener: false }), true);
                    return { processId: created.processId, actualExit: true };
                });
            },
        },
    );
    const url = `http://127.0.0.1:${target.port}`;
    const upstream = await createOfficialConnection(url, {
        args: buildServerArguments(url, process.env, ['--workspace', directory]),
        onAcquired: (resource) =>
            register(async () => {
                await resource.close();
                return { upstreamClosed: true };
            }),
    });
    return {
        identity: target,
        schema: schemaMap(upstream.tools),
        async call(name, args = {}) {
            const result = await upstream.call(name, args);
            assert.ok(isRecord(result));
            return result;
        },
        async close() {
            const results = await closeEvery([
                () => upstream.close(),
                async () => {
                    assert.equal(await host.close(target, { requireListener: false }), true);
                },
            ]);
            assert.ok(
                results.every((result) => result.status === 'fulfilled'),
                'Direct cleanup failed.',
            );
            return { actualExit: true, upstreamClosed: true };
        },
    };
}
function gateway() {
    const client = createClient(path.join(root, 'plugins/codex/debugging-cdp-targets/dist/mcp-bootstrap.mjs'));
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await client.request('tools/call', { name, arguments: args }, 90_000);
        assert.ok(isRecord(result));
        return result;
    };
    const control = lifecycleClient(tool);
    let entryId = '';
    const owned: ConnectionStatus[] = [];
    const selected = async (connectionId: string) => {
        const result = (await tool('dct_connection_status', { entryId, connectionId, include: ['diagnostics'] }))
            .structuredContent;
        assert.ok(isRecord(result));
        return result;
    };
    return {
        async initialize() {
            await client.request('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'screenshot-acceptance', version: '0.1.0' },
            });
            client.notify('notifications/initialized');
            const initial = readStatus((await tool('dct_connection_status')).structuredContent);
            assert.ok('connections' in initial && initial.connections.length === 0);
            entryId = initial.entryId;
        },
        async start(launch: ApplicationLaunch, directory: string): Promise<Route> {
            const started = Date.now();
            const summary = await control({
                isolation: { mode: 'none' },
                action: 'start',
                entryId,
                requestId: randomUUID(),
                targetKind: fixture.targetKind,
                launch,
                basePort: 20222,
                mcpArgs: ['--workspace', directory],
            });
            assert.ok(!('connections' in summary) && summary.sessionId);
            owned.push(summary);
            const identity = await inspect(summary, launch, started);
            const details = (
                await tool('dct_connection_status', {
                    entryId,
                    connectionId: summary.connectionId,
                    toolNames: ['evaluate_script', 'list_pages', 'take_snapshot', 'take_screenshot'],
                })
            ).structuredContent;
            assert.ok(isRecord(details) && Array.isArray(details.toolAvailability));
            return {
                identity,
                schema: schemaMap(details.toolAvailability),
                status: () => selected(summary.connectionId),
                call: (name, args = {}) =>
                    tool(name, { ...args, _dct: { connectionId: summary.connectionId, sessionId: summary.sessionId } }),
                close: () =>
                    closeSmokeConnection(control, {
                        action: 'stop',
                        entryId,
                        connectionId: summary.connectionId,
                        sessionId: summary.sessionId ?? '',
                        requestId: randomUUID(),
                        disposition: 'Close',
                    }),
            };
        },
        async close() {
            try {
                assert.ok(entryId, 'Gateway did not initialize; only stdio exit can be observed.');
                let connections = owned;
                let statusFailure: unknown;
                try {
                    const current = readStatus((await tool('dct_connection_status', { entryId })).structuredContent);
                    assert.ok('connections' in current);
                    connections = current.connections;
                } catch (error) {
                    statusFailure = error;
                }
                const results = await closeEvery(
                    connections.map((connection) => async () => {
                        assert.ok(connection.sessionId);
                        return closeSmokeConnection(control, {
                            action: 'stop',
                            entryId,
                            connectionId: connection.connectionId,
                            sessionId: connection.sessionId,
                            requestId: randomUUID(),
                            disposition: 'Close',
                        });
                    }),
                );
                evidence.push({
                    gatewayCloseResults: results,
                    statusFailure: statusFailure === undefined ? undefined : errorMessage(statusFailure),
                });
                const final = readStatus((await tool('dct_connection_status', { entryId })).structuredContent);
                evidence.push({ gatewayCleanup: results, finalStatus: final, owned });
                await save();
                assert.ok(
                    results.every((result) => result.status === 'fulfilled'),
                    'Close failed; every peer was attempted.',
                );
                assert.ok('connections' in final && final.connections.length === 0, 'Gateway resources remain.');
                assert.equal(statusFailure, undefined, 'Cleanup status failed; known peers were still closed.');
            } finally {
                await client.close();
                evidence.push({ gatewayExit: { code: client.child.exitCode, signal: client.child.signalCode } });
                assert.equal(client.child.exitCode, 0, 'Gateway stdio exit failed.');
            }
        },
    };
}
async function marker(route: Route, pageId: number, phase: string, color: number[]) {
    const nonce = `${fixture.label}-${phase}-${randomUUID()}`;
    const result = returned(
        await evaluate(
            route,
            pageId,
            `() => {
        let mark = document.getElementById('dct-screenshot-marker');
        if (!mark) { mark = document.createElement('button'); mark.id = 'dct-screenshot-marker'; document.body.appendChild(mark); }
        mark.textContent = ${JSON.stringify(nonce)}; mark.setAttribute('aria-label', ${JSON.stringify(nonce)});
        mark.style.cssText = 'all:initial;display:block;position:fixed;left:8px;top:8px;width:320px;height:120px;border:0;padding:0;z-index:2147483647;opacity:1;color:black;font:16px monospace;background:rgb(${color.join(',')});';
        let bottom = document.getElementById('dct-screenshot-bottom');
        if (!bottom) { bottom = document.createElement('div'); bottom.id = 'dct-screenshot-bottom'; document.body.appendChild(bottom); }
        const bottomY = innerHeight + 80;
        document.documentElement.style.minHeight = (innerHeight + 240) + 'px';
        document.body.style.minHeight = (innerHeight + 240) + 'px';
        bottom.style.cssText = 'all:initial;display:block;position:absolute;left:8px;top:' + bottomY + 'px;width:320px;height:120px;z-index:2147483647;opacity:1;background:rgb(${color.join(',')});';
        return { nonce:mark.textContent,color:getComputedStyle(mark).backgroundColor,bottomY };
    }`,
        ),
    );
    assert.equal(result.nonce, nonce);
    assert.equal(result.color, `rgb(${color.join(', ')})`);
    assert.ok(typeof result.bottomY === 'number' && Number.isFinite(result.bottomY));
    return {
        nonce,
        bottomY: Number(result.bottomY),
        color,
    };
}
async function geometry(route: Route, pageId: number) {
    const observed = returned(
        await evaluate(
            route,
            pageId,
            `() => {
        const rect = (element) => { const r = element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
        const probe = document.createElement('div');
        probe.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:0;pointer-events:none;';
        let viewport;
        document.body.appendChild(probe);
        try { viewport = rect(probe); } finally { probe.remove(); }
        const extent = (element) => ({rect:rect(element),scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight,clientWidth:element.clientWidth,clientHeight:element.clientHeight});
        const v = visualViewport;
        return {dpr:devicePixelRatio,viewport,root:extent(document.documentElement),body:extent(document.body),element:rect(document.getElementById('dct-screenshot-marker')),visualViewport:{width:v.width,height:v.height,scale:v.scale,pageLeft:v.pageLeft,pageTop:v.pageTop},innerWidth,innerHeight};
    }`,
        ),
    );
    return { ...readScreenshotGeometry(observed), observed };
}
async function pixels(
    file: string,
    size: { width: number; height: number },
    points: { x: number; y: number }[],
    color: number[],
) {
    const result = await promisify(execFile)(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL('./windows-png-evidence.ps1', import.meta.url)),
            '-ImagePath',
            file,
            '-Points',
            points.map((point) => `${point.x},${point.y}`).join(';'),
        ],
        { windowsHide: true, shell: false },
    );
    const value: unknown = JSON.parse(result.stdout);
    assertPixels(value, { ...size, points, color });
    return value;
}
async function screenshot(
    route: Route,
    pageId: number,
    directory: string,
    phase: string,
    shape: string,
    minimized: boolean,
    handle: number,
    patch: Awaited<ReturnType<typeof marker>>,
    candidate: boolean,
    peer?: { route: Route; pageId: number },
) {
    const fields = properties(route.schema('take_screenshot'));
    for (const field of ['pageId', 'format', 'filePath', 'fullPage', 'uid']) assert.ok(field in fields);
    const args: Record<string, unknown> = {
        pageId,
        format: 'png',
        filePath: path.join(directory, 'output', `${phase}-${shape}.png`),
    };
    if (shape === 'fullPage') args.fullPage = true;
    if (shape === 'element') {
        const line = text(await route.call('take_snapshot', { pageId }))
            .split('\n')
            .filter((line) => line.includes(patch.nonce));
        assert.equal(line.length, 1);
        args.uid = line[0]?.match(/uid=(\S+)/)?.[1];
        assert.ok(typeof args.uid === 'string', 'Fresh uid missing.');
    }
    const geometryBefore = await geometry(route, pageId);
    const size = screenshotSize(shape, geometryBefore);
    evidence.push({ phase, shape, geometryBefore, expectedSize: size });
    const before = await sampleWindow(route.identity, 'None', handle);
    assertWindowState(before, minimized ? 'minimized' : 'normal');
    const diagnosticBefore = route.status ? await route.status() : undefined;
    const started = performance.now();
    let pending = true;
    let elapsedMs = 0;
    const shot = route
        .call('take_screenshot', args)
        .then(
            (result) => ({ result }),
            (error: unknown) => ({ error }),
        )
        .finally(() => {
            elapsedMs = performance.now() - started;
            pending = false;
        });
    let peerDuring: unknown;
    if (
        peer &&
        (await Promise.race([
            shot.then(() => false),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1000)),
        ]))
    ) {
        const whilePending = pending;
        const peerBefore = await sampleWindow(peer.route.identity, 'None');
        const peerStatusBefore = await peer.route.status?.();
        const peerStarted = performance.now();
        const peerPages = text(await peer.route.call('list_pages'));
        assert.ok(peerPages.includes(`${peer.pageId}:`));
        const result = returned(await evaluate(peer.route, peer.pageId, '() => ({title:document.title})'));
        const peerElapsedMs = performance.now() - peerStarted;
        const completedWhilePending = pending;
        assert.ok(
            peerElapsedMs < 20_000 && typeof result.title === 'string' && result.title.includes(fixture.pageTitle),
        );
        const peerAfter = await sampleWindow(peer.route.identity, 'None', peerBefore.handle);
        assertWindowState(peerAfter, 'normal', peerBefore);
        const peerStatusAfter = await peer.route.status?.();
        assert.equal(peerStatusBefore?.sessionId, peerStatusAfter?.sessionId);
        assert.equal(peerStatusBefore?.processId, peerStatusAfter?.processId);
        assert.equal(peerStatusBefore?.port, peerStatusAfter?.port);
        assert.equal(peerStatusBefore?.connectionId, peerStatusAfter?.connectionId);
        assert.equal(peerStatusAfter?.upstreamStatus, 'connected');
        peerDuring = {
            whilePending,
            completedWhilePending,
            peerElapsedMs,
            result,
            peerBefore,
            peerAfter,
            peerStatusBefore,
            peerStatusAfter,
        };
    }
    const outcome = await shot;
    const after = await sampleWindow(route.identity, 'None', handle);
    assertWindowState(after, minimized ? 'minimized' : 'normal', before);
    const diagnosticAfter = route.status ? await route.status() : undefined;
    evidence.push({
        phase,
        shape,
        minimized,
        before,
        after,
        elapsedMs,
        identity: route.identity,
        filePath: args.filePath,
        diagnosticBefore,
        diagnosticAfter,
        peerDuring,
        outcome: 'error' in outcome ? errorMessage(outcome.error) : outcome.result,
    });
    await save();
    if ('error' in outcome) {
        if (interruptedOfficialCall(outcome.error) === 'upstream-timeout') return { timeout: true };
        throw outcome.error;
    }
    if (
        isRecord(outcome.result.structuredContent) &&
        outcome.result.structuredContent.code === 'CONNECTION_RECOVERY_REQUIRED'
    ) {
        assert.equal(outcome.result.structuredContent.reason, 'upstream-timeout');
        assert.equal(outcome.result.structuredContent.upstreamClosed, true);
        assert.equal(diagnosticAfter?.upstreamStatus, 'quarantined');
        assert.ok(
            peer &&
                isRecord(peerDuring) &&
                peerDuring.whilePending === true &&
                peerDuring.completedWhilePending === true,
            'Peer not checked while pending.',
        );
        const afterPeerStarted = performance.now();
        const peerAfter = returned(await evaluate(peer.route, peer.pageId, '() => ({title:document.title})'));
        assert.ok(text(await peer.route.call('list_pages')).includes(`${peer.pageId}:`));
        const afterPeerMs = performance.now() - afterPeerStarted;
        assert.ok(afterPeerMs < 20_000, 'Peer did not respond promptly after quarantine.');
        assert.ok(typeof peerAfter.title === 'string' && peerAfter.title.includes(fixture.pageTitle));
        assert.ok(isRecord(peerDuring.peerBefore) && typeof peerDuring.peerBefore.handle === 'number');
        const peerNativeAfter = await sampleWindow(peer.route.identity, 'None', peerDuring.peerBefore.handle);
        assertWindowState(peerNativeAfter, 'normal');
        const peerStatusAfter = await peer.route.status?.();
        assert.ok(isRecord(peerDuring.peerStatusBefore));
        assert.equal(peerStatusAfter?.sessionId, peerDuring.peerStatusBefore.sessionId);
        assert.equal(peerStatusAfter?.connectionId, peerDuring.peerStatusBefore.connectionId);
        assert.equal(peerStatusAfter?.processId, peerDuring.peerStatusBefore.processId);
        assert.equal(peerStatusAfter?.port, peerDuring.peerStatusBefore.port);
        assert.equal(peerStatusAfter?.upstreamStatus, 'connected');
        const retained = await sampleWindow(route.identity, 'None', handle);
        assertWindowState(retained, minimized ? 'minimized' : 'normal', before);
        const gatedStarted = performance.now();
        const rejected = await evaluate(route, pageId, '() => ({title:document.title})');
        assert.ok(performance.now() - gatedStarted < 20_000, 'Quarantined route did not reject promptly.');
        assert.equal(rejected.isError, true);
        assert.ok(isRecord(rejected.structuredContent));
        assert.equal(rejected.structuredContent.upstreamStatus, 'quarantined');
        assert.equal(rejected.structuredContent.status, 'lost');
        assert.equal(rejected.structuredContent.connectionId, diagnosticAfter?.connectionId);
        assert.equal(rejected.structuredContent.entryId, diagnosticAfter?.entryId);
        assert.equal(rejected.structuredContent.sessionId, diagnosticAfter?.sessionId);
        assert.equal(rejected.structuredContent.nextAction, 'inspect-connection-error');
        evidence.push({
            isolation: {
                peerAfter,
                afterPeerMs,
                peerNativeAfter,
                peerStatusAfter,
                retained,
                rejected,
                pendingCleanup: 'Observable quarantine; pending-map clearing covered by router regressions.',
            },
        });
        return { timeout: true };
    }
    text(outcome.result);
    const geometryAfter = await geometry(route, pageId);
    evidence.push({ phase, shape, geometryAfter });
    assert.deepEqual(screenshotSize(shape, geometryAfter), size, 'Screenshot geometry changed during capture.');
    const points = [20, 40, 60].map((x) => ({
        x: Math.round((x + (shape === 'element' ? 0 : geometryBefore.element.x)) * geometryBefore.dpr),
        y: Math.round((90 + (shape === 'element' ? 0 : geometryBefore.element.y)) * geometryBefore.dpr),
    }));
    if (shape === 'fullPage') {
        assert.ok(
            geometryBefore.content.height > geometryBefore.viewport.height,
            'fullPage fixture has no content below the viewport.',
        );
        points.push(
            ...[20, 40, 60].map((x) => ({
                x: Math.round((x + 8) * geometryBefore.dpr),
                y: Math.round((patch.bottomY + 90) * geometryBefore.dpr),
            })),
        );
    }
    evidence.push({ phase, shape, image: await pixels(String(args.filePath), size, points, patch.color) });
    if (route.status) {
        if (candidate) assert.ok(elapsedMs < 20_000, 'Complete gateway screenshot exceeded threshold.');
        assert.ok(
            typeof diagnosticAfter?.sessionId === 'string' && diagnosticAfter.sessionId === diagnosticBefore?.sessionId,
        );
        const screenshotPhaseMs = screenshotPhase(
            diagnosticBefore?.diagnostics,
            diagnosticAfter.diagnostics,
            diagnosticAfter.sessionId,
            candidate,
        );
        if (candidate && screenshotPhaseMs === undefined)
            assert.ok(elapsedMs < 5000, 'Phase unavailable and complete screenshot does not supply a stronger bound.');
        evidence.push({
            phase,
            shape,
            screenshotPhaseMs,
            attribution:
                screenshotPhaseMs === undefined
                    ? 'unavailable; history overlap ambiguous or overwritten'
                    : 'new phase after observed history',
        });
    } else if (candidate) assert.ok(elapsedMs < 5000, 'Direct screenshot exceeded threshold.');
    return { timeout: false };
}

let failed = false;
let blocked = false;
for (const routeName of ['direct-official', 'packaged-gateway']) {
    if (blocked) break;
    for (const candidate of [false, true]) {
        const directory = await mkdtemp(path.join(folder, `${routeName}-${candidate ? 'candidate' : 'baseline'}-`));
        const launch = await initialize(directory, candidate);
        let route: Route | undefined;
        let entry: Awaited<ReturnType<typeof gateway>> | undefined;
        let peer: { route: Route; pageId: number } | undefined;
        const cleanup: (() => Promise<unknown>)[] = [];
        try {
            if (routeName === 'packaged-gateway') {
                entry = gateway();
                await entry.initialize();
                route = await entry.start(launch, directory);
            } else route = await direct(launch, directory, (action) => cleanup.push(action));
            const ownedRoute = route;
            const pageId = await page(route);
            const initialWindow = await sampleWindow(route.identity, 'None');
            evidence.push({ preparation: { routeName, candidate, identity: ownedRoute.identity, initialWindow } });
            let window = await prepareScreenshotWindow(initialWindow, (handle) =>
                sampleWindow(ownedRoute.identity, 'Restore', handle),
            );
            evidence.push({
                preparation: {
                    routeName,
                    candidate,
                    identity: ownedRoute.identity,
                    action: initialWindow.isIconic ? 'SW_RESTORE' : 'None',
                    initialWindow,
                    preparedWindow: window,
                },
            });
            if (!candidate && entry) {
                const peerDirectory = await mkdtemp(path.join(folder, 'peer-'));
                const peerRoute = await entry.start(await initialize(peerDirectory, true), peerDirectory);
                peer = { route: peerRoute, pageId: await page(peerRoute) };
                const peerInitialWindow = await sampleWindow(peerRoute.identity, 'None');
                evidence.push({
                    preparation: {
                        routeName,
                        role: 'peer',
                        identity: peerRoute.identity,
                        initialWindow: peerInitialWindow,
                    },
                });
                const peerPreparedWindow = await prepareScreenshotWindow(peerInitialWindow, (handle) =>
                    sampleWindow(peerRoute.identity, 'Restore', handle),
                );
                evidence.push({
                    preparation: {
                        routeName,
                        role: 'peer',
                        identity: peerRoute.identity,
                        action: peerInitialWindow.isIconic ? 'SW_RESTORE' : 'None',
                        initialWindow: peerInitialWindow,
                        preparedWindow: peerPreparedWindow,
                    },
                });
            }
            for (const [phase, color] of [
                ['A', [255, 255, 0]],
                ['B', [0, 255, 0]],
                ['C', [0, 128, 255]],
            ] as const) {
                if (phase === 'B') {
                    const ownAction = fixture.minimizeFunction
                        ? returned(await evaluate(route, pageId, fixture.minimizeFunction))
                        : undefined;
                    evidence.push({ minimizeControl: ownAction });
                    try {
                        window = await sampleWindow(
                            route.identity,
                            ownAction?.minimizeRequested === true ? 'None' : 'Minimize',
                            window.handle,
                        );
                        if (ownAction?.minimizeRequested === true) {
                            const deadline = Date.now() + 5000;
                            while (!window.isIconic && Date.now() < deadline)
                                window = await sampleWindow(route.identity, 'None', window.handle);
                        }
                        assertWindowState(window, 'minimized');
                    } catch (error) {
                        blocked = true;
                        evidence.push({
                            routeName,
                            candidate,
                            outcome: 'blocked',
                            reason: errorMessage(error),
                            window,
                        });
                        throw error;
                    }
                }
                const patch = await marker(route, pageId, phase, [...color]);
                const timedOut = await screenshotShapes(phase, candidate, peer, async (shape, activePeer) => {
                    return screenshot(
                        ownedRoute,
                        pageId,
                        directory,
                        phase,
                        shape,
                        phase !== 'A',
                        window.handle,
                        patch,
                        candidate,
                        activePeer,
                    );
                });
                if (timedOut) {
                    evidence.push({
                        routeName,
                        candidate,
                        baseline: 'Reproduced official screenshot timeout',
                        remainingModes: 'Not run after timeout; no replay/restart.',
                    });
                    break;
                }
            }
            evidence.push({ routeName, candidate, outcome: 'completed', directory });
        } catch (error) {
            failed = true;
            evidence.push({
                routeName,
                candidate,
                outcome: blocked ? 'blocked' : 'failed',
                reason: errorMessage(error),
                directory,
            });
        } finally {
            const selectedEntry = entry;
            const results = await closeEvery([...cleanup, ...(selectedEntry ? [() => selectedEntry.close()] : [])]);
            evidence.push({
                routeName,
                candidate,
                cleanup: results.map((result) =>
                    result.status === 'fulfilled'
                        ? { status: result.status, value: result.value }
                        : { status: result.status, reason: errorMessage(result.reason) },
                ),
            });
            if (results.some((result) => result.status === 'rejected')) failed = true;
            await save();
        }
        if (blocked) break;
    }
}
console.log(JSON.stringify({ folder, failed, blocked }));
if (failed) process.exitCode = 1;
