import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import {
    type ApplicationScreenshotFixture,
    type ApplicationScreenshotFixtureIO,
    type PreparedApplicationScreenshotFixture,
    parseApplicationScreenshotFixture,
    prepareApplicationScreenshotFixture,
} from './application-screenshot-fixture.ts';
import type { McpRequestInterval } from './mcp-client.ts';
import { cancelledPassiveSample } from './screenshot-capture-observer.ts';
import { assertPixels, closeEvery, readScreenshotGeometry, screenshotSize } from './screenshot-fixture.ts';
import type { ScreenshotTimeoutRoute, WindowCondition } from './screenshot-timeout-fixture.ts';
import { assertWindowState, readWindowSample, type WindowIdentity, type WindowSample } from './window-evidence.ts';

export interface PayloadIO {
    listFiles(root: string): Promise<string[]>;
    readFile(file: string): Promise<Uint8Array>;
}
export interface ApplicationProbeConfig {
    fixture: ApplicationScreenshotFixture;
    payload: { root: string; receipt: unknown };
    mainWindow: { className: string; titleIncludes: string };
    identityFunction: string;
    preflight: { status: 'approved' | 'blocked'; reason: string };
}
export interface ApplicationProbeRoute {
    identity: WindowIdentity;
    qualify(): Promise<unknown>;
    call(name: string, args: Record<string, unknown>, interval?: McpRequestInterval): Promise<Record<string, unknown>>;
    status(): Promise<unknown>;
    sample(handle?: number): Promise<unknown>;
    condition(condition: WindowCondition, handle: number): Promise<unknown>;
    capture: ScreenshotTimeoutRoute['capture'];
    png(file: string, points: { x: number; y: number }[], size: { width: number; height: number }): Promise<unknown>;
}
export interface ApplicationProbeAdapter {
    payloadIO: PayloadIO;
    fixtureIO?: ApplicationScreenshotFixtureIO;
    inheritedEnvironment?: Record<string, string | undefined>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    record(kind: string, value: unknown): Promise<void>;
    acquire(
        prepared: PreparedApplicationScreenshotFixture,
        payload: { root: string; inventoryDigest: string },
    ): Promise<ApplicationProbeRoute>;
    cleanup(): Promise<{ ok: boolean; [key: string]: unknown }>;
}
export interface ApplicationProbeOptions {
    arm: 'baseline' | 'candidate';
    condition: WindowCondition;
    mode: 'qualification' | 'viewport' | 'fullPage';
    parentDirectory: string;
    nonce: string;
}
export interface ApplicationProbeResult {
    outcome: string;
    capture?: { outcome: string; result?: Record<string, unknown>; error?: string };
    failures: { kind: string; error: string }[];
    cleanup?: { ok: boolean; [key: string]: unknown };
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const absolute = (value: string) => path.isAbsolute(value) || path.win32.isAbsolute(value);
const samePath = (left: string, right: string) =>
    path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
const captureErrorOutcome = (error: unknown) =>
    isRecord(error) && typeof error.captureOutcome === 'string'
        ? error.captureOutcome
        : errorMessage(error).startsWith('MCP timeout:')
          ? 'client-timeout'
          : /target session exited|target session exited or closed/.test(errorMessage(error))
            ? 'session-ended'
            : 'client-error';

function rendererDataPaths(prepared: PreparedApplicationScreenshotFixture) {
    const profile = (prepared.launch.args ?? [])
        .find((arg) => arg.startsWith('--user-data-dir='))
        ?.slice('--user-data-dir='.length);
    assert.ok(profile, 'Reviewed expanded profile carrier is unavailable.');
    const confined = (file: string) => {
        const relative = path.win32.relative(prepared.directory, file);
        assert.ok(
            absolute(file) && relative && relative !== '..' && !relative.startsWith('..\\') && !absolute(relative),
            'Renderer data path must be a fresh fixture descendant.',
        );
        return file;
    };
    confined(profile);
    const profileFile = `${path.win32.relative(prepared.directory, profile).replaceAll('\\', '/')}/obsidian.json`;
    const text = prepared.fixture.fixtureFiles[profileFile];
    assert.ok(typeof text === 'string', 'Synthetic Obsidian profile configuration is missing.');
    const settings: unknown = JSON.parse(text.replaceAll('{fixture}', prepared.directory));
    assert.ok(isRecord(settings) && isRecord(settings.vaults), 'Synthetic vault configuration is missing.');
    const opened = Object.values(settings.vaults)
        .filter(isRecord)
        .filter((vault) => vault.open === true);
    assert.equal(opened.length, 1, 'Exactly one synthetic open vault is required.');
    const vaultPath = opened[0]?.path;
    assert.ok(typeof vaultPath === 'string', 'Synthetic vault path is missing.');
    confined(vaultPath);
    const vaultFile = `${path.win32.relative(prepared.directory, vaultPath).replaceAll('\\', '/')}/.obsidian/app.json`;
    assert.ok(
        typeof prepared.fixture.fixtureFiles[vaultFile] === 'string',
        'Synthetic vault initialization is missing.',
    );
    return { userData: profile, vaultPath };
}

export async function verifySealedApplicationPayload(
    payload: { root: string; receipt: unknown },
    io: PayloadIO,
): Promise<{ root: string; inventoryDigest: string }> {
    assert.ok(absolute(payload.root), 'An explicit absolute sealed payload root is required.');
    const value = payload.receipt;
    assert.ok(isRecord(value));
    assert.equal(value.source, 'eef90b4d974600c3a6697d40dc76e99037466315', 'Unexpected sealed source.');
    assert.equal(value.subtree, 'plugins/codex/debugging-cdp-targets');
    assert.ok(typeof value.createdAtUtc === 'string' && Number.isFinite(Date.parse(value.createdAtUtc)));
    assert.ok(typeof value.archiveSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.archiveSha256));
    assert.ok(typeof value.inventoryDigest === 'string' && /^[a-f0-9]{64}$/.test(value.inventoryDigest));
    assert.ok(Array.isArray(value.files) && value.files.length > 0);
    const files = value.files.map((file: unknown) => {
        assert.ok(isRecord(file));
        assert.ok(
            typeof file.path === 'string' && file.path.length > 0 && !file.path.includes('\\') && !absolute(file.path),
        );
        assert.ok(
            file.path
                .split('/')
                .every(
                    (part) =>
                        part &&
                        part !== '.' &&
                        part !== '..' &&
                        !/[<>:"|?*\x00-\x1f]/.test(part) &&
                        !/[. ]$/.test(part),
                ),
        );
        assert.ok(typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes >= 0);
        assert.ok(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256));
        assert.deepEqual(Object.keys(file).sort(), ['bytes', 'path', 'sha256']);
        return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
    });
    assert.equal(new Set(files.map((file) => file.path.toLowerCase())).size, files.length, 'Duplicate inventory path.');
    assert.deepEqual(
        files,
        [...files].sort((a, b) => a.path.localeCompare(b.path, 'en')),
        'Inventory must retain canonical order.',
    );
    assert.equal(hash(JSON.stringify(files)), value.inventoryDigest, 'Sealed inventory digest changed.');
    assert.ok(
        files.some((file) => file.path === 'dist/mcp-bootstrap.mjs'),
        'Sealed bootstrap is missing.',
    );
    const observed = await io.listFiles(payload.root);
    assert.deepEqual(
        [...observed].sort((a, b) => a.localeCompare(b, 'en')),
        files.map((file) => file.path),
        'Complete sealed file inventory changed.',
    );
    for (const file of files) {
        const bytes = await io.readFile(path.join(payload.root, file.path));
        assert.equal(bytes.length, file.bytes, 'Sealed file size changed.');
        assert.equal(hash(bytes), file.sha256, 'Sealed file bytes changed.');
    }
    return { root: payload.root, inventoryDigest: value.inventoryDigest };
}

export function parseApplicationProbeConfig(
    value: unknown,
    environment?: Record<string, string | undefined>,
): ApplicationProbeConfig {
    assert.ok(isRecord(value) && isRecord(value.payload) && isRecord(value.mainWindow) && isRecord(value.preflight));
    assert.deepEqual(Object.keys(value).sort(), ['fixture', 'identityFunction', 'mainWindow', 'payload', 'preflight']);
    const fixture = parseApplicationScreenshotFixture(value.fixture, environment);
    if (fixture.application === 'obsidian')
        assert.equal(
            fixture.page.url,
            'app://obsidian.md/index.html',
            'Only the known Obsidian main renderer can qualify.',
        );
    assert.ok(typeof value.payload.root === 'string' && absolute(value.payload.root));
    assert.ok(typeof value.mainWindow.className === 'string' && value.mainWindow.className.trim().length > 0);
    assert.ok(typeof value.mainWindow.titleIncludes === 'string' && value.mainWindow.titleIncludes.trim().length > 0);
    assert.ok(typeof value.identityFunction === 'string' && value.identityFunction.trim().length > 0);
    assert.ok(value.preflight.status === 'approved' || value.preflight.status === 'blocked');
    assert.ok(typeof value.preflight.reason === 'string' && value.preflight.reason.trim().length > 0);
    if (fixture.application === 'readest')
        assert.equal(
            value.preflight.status,
            'blocked',
            'The selected Readest candidate is blocked before acquisition.',
        );
    return {
        fixture,
        payload: { root: value.payload.root, receipt: value.payload.receipt },
        mainWindow: { className: value.mainWindow.className, titleIncludes: value.mainWindow.titleIncludes },
        identityFunction: value.identityFunction,
        preflight: { status: value.preflight.status, reason: value.preflight.reason },
    };
}

export function readOfficialEvaluation(result: Record<string, unknown>): unknown {
    assert.ok(Array.isArray(result.content));
    const json = result.content
        .filter(isRecord)
        .flatMap((item) =>
            typeof item.text === 'string'
                ? [...item.text.matchAll(/```json\s*([\s\S]*?)\s*```/g)].map((match) => match[1])
                : [],
        );
    assert.equal(json.length, 1, 'Expected one official JSON evaluation value.');
    assert.ok(json[0]);
    return JSON.parse(json[0]) as unknown;
}

export function selectApplicationMainWindow(
    raw: unknown,
    identity: WindowIdentity,
    selector: ApplicationProbeConfig['mainWindow'],
    handle?: number,
): WindowSample {
    assert.ok(Array.isArray(raw));
    const roots = raw.filter(isRecord).filter((item) => item.child === false && item.visible === true);
    // Verify every visible owned-root record before selector filtering can conceal a foreign identity.
    for (const item of roots) {
        const sample = readWindowSample([item], identity);
        assert.ok(
            sample.actualExecutablePath && samePath(sample.actualExecutablePath, identity.executablePath),
            'Observed native executable differs.',
        );
    }
    const main = roots.filter(
        (item) =>
            item.windowClass === selector.className &&
            typeof item.title === 'string' &&
            item.title.includes(selector.titleIncludes),
    );
    assert.equal(main.length, 1, 'Declared main HWND is missing or ambiguous.');
    const sample = readWindowSample(main, identity, handle);
    assert.ok(sample.actualExecutablePath && samePath(sample.actualExecutablePath, identity.executablePath));
    return sample;
}

function markerFunction(color: 'yellow' | 'green', nonce: string) {
    const rgb = color === 'yellow' ? '255,255,0' : '0,255,0';
    return `() => { const id = 'DCT_APPLICATION_MARKER'; document.documentElement.style.cssText='margin:0;padding:0;overflow:hidden;'; document.body.style.cssText='margin:0;padding:0;'; let e=document.getElementById(id); if(!e){e=document.createElement('div');e.id=id;document.body.replaceChildren(e);} e.dataset.nonce=${JSON.stringify(nonce)}; e.style.cssText='position:absolute;left:0;top:0;width:'+innerWidth+'px;height:'+(innerHeight*2)+'px;background:rgb(${rgb});z-index:2147483647;opacity:1;'; document.documentElement.style.height=(innerHeight*2)+'px'; document.body.style.height=(innerHeight*2)+'px'; scrollTo(0,0); const box=r=>({x:r.x,y:r.y,width:r.width,height:r.height}); return {nonce:e.dataset.nonce,color:getComputedStyle(e).backgroundColor,dpr:devicePixelRatio,viewport:{x:0,y:0,width:innerWidth,height:innerHeight},root:{rect:{x:0,y:0,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},element:box(e.getBoundingClientRect()),visualViewport:{scale:visualViewport.scale,pageLeft:visualViewport.pageLeft,pageTop:visualViewport.pageTop}}; }`;
}

export async function runApplicationScreenshotProbe(
    value: unknown,
    options: ApplicationProbeOptions,
    adapter: ApplicationProbeAdapter,
): Promise<ApplicationProbeResult> {
    const failures: ApplicationProbeResult['failures'] = [];
    let config: ApplicationProbeConfig;
    let payload: { root: string; inventoryDigest: string };
    try {
        assert.ok(['baseline', 'candidate'].includes(options.arm));
        assert.ok(['foreground-normal', 'background-normal', 'minimized'].includes(options.condition));
        assert.ok(['qualification', 'viewport', 'fullPage'].includes(options.mode));
        assert.ok(absolute(options.parentDirectory) && /^[a-zA-Z0-9-]+$/.test(options.nonce));
        config = parseApplicationProbeConfig(value, adapter.inheritedEnvironment);
        await adapter.record('preflight', config.preflight);
        if (config.preflight.status === 'blocked') {
            const result = {
                outcome: 'preflight-blocked',
                failures: [{ kind: 'preflight', error: config.preflight.reason }],
            };
            await adapter.record('final', result);
            return result;
        }
        payload = await verifySealedApplicationPayload(config.payload, adapter.payloadIO);
        await adapter.record('sealed-payload-verified', payload);
    } catch (error) {
        const result = { outcome: 'preflight-blocked', failures: [{ kind: 'preflight', error: errorMessage(error) }] };
        await adapter.record('final', result);
        return result;
    }
    let outcome = 'qualification-blocked';
    let capture: ApplicationProbeResult['capture'];
    let captureRequestError: unknown;
    let cleanup: ApplicationProbeResult['cleanup'];
    let route: ApplicationProbeRoute | undefined;
    let quarantine = false;
    const fail = async (kind: string, error: unknown) => {
        const failure = { kind, error: errorMessage(error) };
        failures.push(failure);
        await adapter.record('observation-error', failure);
    };
    const observe = async (kind: string, action: () => Promise<unknown>) => {
        try {
            return await action();
        } catch (error) {
            await fail(kind, error);
            return undefined;
        }
    };
    const call = async (name: string, args: Record<string, unknown>, interval?: McpRequestInterval) => {
        assert.ok(route && !quarantine, 'Quarantined routes cannot receive official requests.');
        await adapter.record('official-request', { name, arguments: args });
        let raw: Record<string, unknown>;
        try {
            raw = await route.call(name, args, interval);
        } catch (error) {
            if (name === 'take_screenshot') {
                captureRequestError = error;
                capture = {
                    outcome: captureErrorOutcome(error),
                    error: errorMessage(error),
                };
                await adapter.record('capture-raw', capture);
            }
            throw error;
        }
        // Raw capture persistence precedes observation work, including observer completion.
        if (name === 'take_screenshot') {
            capture = {
                outcome:
                    isRecord(raw.structuredContent) && raw.structuredContent.code === 'CONNECTION_RECOVERY_REQUIRED'
                        ? 'quarantine'
                        : raw.isError === true
                          ? 'tool-error'
                          : 'success',
                result: raw,
            };
            await adapter.record('capture-raw', capture);
        } else await adapter.record('official-result', { name, result: raw });
        if (isRecord(raw.structuredContent) && raw.structuredContent.code === 'CONNECTION_RECOVERY_REQUIRED') {
            quarantine = true;
            const error = Object.assign(new Error('Gateway quarantined route.'), { captureOutcome: 'quarantine' });
            if (name === 'take_screenshot') captureRequestError = error;
            throw error;
        }
        if (raw.isError === true) {
            const error = Object.assign(new Error(`Official ${name} returned isError:true.`), {
                captureOutcome: 'tool-error',
            });
            if (name === 'take_screenshot') captureRequestError = error;
            throw error;
        }
        return raw;
    };
    try {
        const screenshotFile = 'screenshot.png';
        assert.ok(
            Object.keys(config.fixture.fixtureFiles).every(
                (file) => file.split(/[\\/]/)[0]?.toLowerCase() !== screenshotFile,
            ),
            'Screenshot output collides with a fixture path.',
        );
        const prepared = await prepareApplicationScreenshotFixture(config.fixture, options.arm, {
            parentDirectory: options.parentDirectory,
            ...(adapter.fixtureIO === undefined ? {} : { io: adapter.fixtureIO }),
            ...(adapter.inheritedEnvironment === undefined
                ? {}
                : { inheritedEnvironment: adapter.inheritedEnvironment }),
        });
        await adapter.record('prepared-fixture', prepared);
        const filePath = path.join(prepared.directory, screenshotFile);
        await adapter.record('screenshot-output', { workspace: prepared.directory, filePath });
        const expectedData = rendererDataPaths(prepared);
        await adapter.record('expected-renderer-data', expectedData);
        route = await adapter.acquire(prepared, payload);
        await adapter.record('runtime-qualification', await route.qualify());
        const listed = await call('list_pages', {});
        assert.ok(Array.isArray(listed.content));
        const text = listed.content
            .filter(isRecord)
            .flatMap((item) => (typeof item.text === 'string' ? [item.text] : []))
            .join('\n');
        const ids = [...text.matchAll(/^(\d+):/gm)].map((match) => Number(match[1]));
        assert.equal(new Set(ids).size, ids.length, 'Duplicate existing page ID.');
        assert.ok(ids.length > 0, 'No existing renderer IDs are available.');
        const pages: { pageId: number; value: unknown }[] = [];
        const now = adapter.now ?? Date.now;
        const sleep = adapter.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        const deadline = now() + 8000;
        for (;;) {
            pages.length = 0;
            for (const pageId of ids) {
                const evaluated = readOfficialEvaluation(
                    await call('evaluate_script', {
                        pageId,
                        function: `() => (${config.identityFunction})(${JSON.stringify(prepared.directory)})`,
                        waitForStableDom: false,
                    }),
                );
                await adapter.record('existing-page-identity', { pageId, evaluated });
                if (
                    isRecord(evaluated) &&
                    evaluated.url === config.fixture.page.url &&
                    (config.fixture.page.title === undefined ||
                        (typeof evaluated.title === 'string' && evaluated.title.includes(config.fixture.page.title))) &&
                    (config.fixture.page.identity === undefined ||
                        evaluated.identity === config.fixture.page.identity) &&
                    typeof evaluated.userData === 'string' &&
                    samePath(evaluated.userData, expectedData.userData) &&
                    typeof evaluated.vaultPath === 'string' &&
                    samePath(evaluated.vaultPath, expectedData.vaultPath)
                )
                    pages.push({ pageId, value: evaluated });
            }
            if (pages.length > 0 || now() >= deadline) break;
            await sleep(Math.min(100, deadline - now()));
        }
        assert.equal(pages.length, 1, 'Existing main renderer is missing or ambiguous.');
        const pageId = pages[0]?.pageId;
        assert.ok(pageId !== undefined);
        const selected = selectApplicationMainWindow(await route.sample(), route.identity, config.mainWindow);
        await adapter.record('main-renderer-qualified', { page: pages[0], window: selected });
        if (options.mode === 'qualification') outcome = 'qualified';
        else {
            await call('evaluate_script', {
                pageId,
                function: markerFunction('yellow', options.nonce),
                waitForStableDom: false,
            });
            await adapter.record('marker-initial', { color: 'yellow', nonce: options.nonce });
            const validate = (raw: unknown) => {
                assert.ok(route);
                const observed = selectApplicationMainWindow(raw, route.identity, config.mainWindow, selected.handle);
                assertWindowState(observed, options.condition === 'minimized' ? 'minimized' : 'normal', selected);
                assert.ok(observed.foregroundHwnd !== undefined);
                if (options.condition === 'foreground-normal') assert.equal(observed.foregroundHwnd, observed.handle);
                if (options.condition === 'background-normal')
                    assert.notEqual(observed.foregroundHwnd, observed.handle);
                return observed;
            };
            await adapter.record(
                'native-condition',
                validate(await route.condition(options.condition, selected.handle)),
            );
            const green = readOfficialEvaluation(
                await call('evaluate_script', {
                    pageId,
                    function: markerFunction('green', options.nonce),
                    waitForStableDom: false,
                }),
            );
            assert.ok(isRecord(green));
            assert.equal(green.nonce, options.nonce, 'Fresh cell nonce did not read back.');
            assert.equal(green.color, 'rgb(0, 255, 0)', 'Fresh opaque green did not read back.');
            const geometry = readScreenshotGeometry(green);
            assert.ok(
                geometry.content.height > geometry.viewport.height,
                'Full document marker must extend below the viewport.',
            );
            await adapter.record('marker-green', green);
            const size = screenshotSize(options.mode, geometry);
            const points = [
                { x: 2, y: 2 },
                { x: size.width - 3, y: 2 },
                { x: 2, y: Math.round(geometry.viewport.height * geometry.dpr) - 3 },
                { x: size.width - 3, y: Math.round(geometry.viewport.height * geometry.dpr) - 3 },
                ...(options.mode === 'fullPage' ? [{ x: Math.floor(size.width / 2), y: size.height - 3 }] : []),
            ];
            const before = validate(await route.sample(selected.handle));
            await adapter.record('native-before', before);
            await adapter.record('status-before', await route.status());
            let pending = false;
            let completed = 0;
            const intervals: unknown[] = [];
            const active = route;
            try {
                await active.capture(
                    (interval) =>
                        call(
                            'take_screenshot',
                            { pageId, fullPage: options.mode === 'fullPage', filePath },
                            {
                                dispatched() {
                                    pending = true;
                                    intervals.push({ phase: 'dispatched', monotonicMs: performance.now() });
                                    interval.dispatched();
                                },
                                settled() {
                                    pending = false;
                                    intervals.push({ phase: 'settled', monotonicMs: performance.now() });
                                    interval.settled();
                                },
                            },
                        ),
                    selected.handle,
                    (action) =>
                        observe('native-during', async () => {
                            const startedPending = pending;
                            const start = performance.now();
                            let validated = false;
                            try {
                                const raw = await action();
                                if (raw === cancelledPassiveSample) return;
                                const observed = validate(raw);
                                validated = true;
                                await adapter.record('native-during', observed);
                            } finally {
                                const qualified = validated && startedPending && pending;
                                if (qualified) completed += 1;
                                intervals.push({ phase: 'sample', start, end: performance.now(), qualified });
                            }
                        }).then(() => {}),
                );
                outcome = 'success';
            } catch (error) {
                if (capture === undefined) {
                    capture = { outcome: captureErrorOutcome(error), error: errorMessage(error) };
                    await adapter.record('capture-raw', capture);
                } else if (error !== captureRequestError) await fail('capture-observer', error);
                outcome = capture.outcome;
            }
            await adapter.record('capture-interval', {
                basis: 'Local MCP dispatch/settlement, not CDP method timing.',
                completed,
                intervals,
            });
            if (completed === 0)
                await fail(
                    'native-during',
                    new Error('No fully validated native sample completed inside pending MCP interval.'),
                );
            if (capture?.outcome === 'success')
                await observe('png', async () => {
                    const png = await active.png(filePath, points, size);
                    await adapter.record('png', png);
                    assert.ok(
                        isRecord(png) &&
                            typeof png.sha256 === 'string' &&
                            /^[a-f0-9]{64}$/.test(png.sha256) &&
                            typeof png.bytes === 'number' &&
                            png.bytes > 0,
                    );
                    assertPixels(png.decoded, { ...size, points, color: [0, 255, 0] });
                });
            if (!quarantine)
                await observe('status-after', async () => adapter.record('status-after', await active.status()));
            await observe('native-after', async () =>
                adapter.record('native-after', validate(await active.sample(selected.handle))),
            );
            if (capture?.outcome === 'success' && failures.length > 0) outcome = 'evidence-insufficient';
        }
    } catch (error) {
        await fail('qualification', error);
    } finally {
        try {
            cleanup = await adapter.cleanup();
        } catch (error) {
            cleanup = { ok: false, error: errorMessage(error) };
        }
        await adapter.record('cleanup', cleanup);
    }
    const result = {
        outcome,
        ...(capture === undefined ? {} : { capture }),
        failures,
        ...(cleanup === undefined ? {} : { cleanup }),
    };
    await adapter.record('final', result);
    return result;
}

export async function cleanupApplicationResources<T>(io: {
    connections: T[];
    close(connection: T): Promise<unknown>;
    witness(connection: T): Promise<unknown>;
    anchor(): Promise<unknown>;
    final(): Promise<unknown>;
    shutdown(): Promise<unknown>;
}): Promise<{ ok: boolean; retained: boolean; failures: string[]; final?: unknown; exit?: unknown }> {
    const failures: string[] = [];
    const receipts = await closeEvery([
        ...io.connections.map((connection, index) => async () => {
            try {
                await io.close(connection);
            } catch (error) {
                failures.push(`connection[${index}] Close: ${errorMessage(error)}`);
            }
            try {
                const witness = await io.witness(connection);
                assert.ok(
                    isRecord(witness) &&
                        witness.processExited === true &&
                        witness.identityVerified === true &&
                        witness.waitResult === 0 &&
                        witness.waitError === 0 &&
                        typeof witness.exitCode === 'number',
                    'Missing identity-bound actual exit proof.',
                );
            } catch (error) {
                failures.push(`connection[${index}] witness: ${errorMessage(error)}`);
            }
        }),
        io.anchor,
    ]);
    for (const result of receipts)
        if (result.status === 'rejected') failures.push(`anchor: ${errorMessage(result.reason)}`);
    let final: unknown;
    try {
        final = await io.final();
        assert.ok(
            isRecord(final) && Array.isArray(final.connections) && final.connections.length === 0,
            'Gateway retains connections.',
        );
    } catch (error) {
        failures.push(errorMessage(error));
    }
    let exit: unknown;
    if (failures.length === 0) {
        try {
            exit = await io.shutdown();
            assert.ok(
                isRecord(exit) && exit.code === 0 && exit.signal === null,
                'Gateway actual stdio exit was not zero.',
            );
        } catch (error) {
            failures.push(errorMessage(error));
        }
    }
    return {
        ok: failures.length === 0,
        retained: failures.length > 0,
        failures,
        ...(final === undefined ? {} : { final }),
        ...(exit === undefined ? {} : { exit }),
    };
}
