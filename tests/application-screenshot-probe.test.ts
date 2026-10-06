import assert from 'node:assert/strict';
import childProcess, { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import {
    type ApplicationProbeAdapter,
    type ApplicationProbeConfig,
    cleanupApplicationResources,
    runApplicationScreenshotProbe,
    selectApplicationMainWindow,
    verifySealedApplicationPayload,
} from './smoke/application-screenshot-core.ts';
import {
    qualifyApplicationBrowserArguments,
    readApplicationProcessEvidence,
    startApplicationExitWitness,
} from './smoke/application-screenshot-native.ts';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const files = [{ path: 'dist/mcp-bootstrap.mjs', bytes: 4, sha256: sha('code') }];
const receipt = {
    source: 'eef90b4d974600c3a6697d40dc76e99037466315',
    subtree: 'plugins/codex/debugging-cdp-targets',
    createdAtUtc: '2026-10-07T00:00:00.000Z',
    archiveSha256: 'a'.repeat(64),
    inventoryDigest: sha(JSON.stringify(files)),
    files,
};
const config: ApplicationProbeConfig = {
    fixture: {
        application: 'obsidian',
        source: { executable: 'C:/Fixture/obsidian.exe', sha256: sha('app') },
        baseline: {
            executable: 'C:/Fixture/obsidian.exe',
            args: ['--user-data-dir={fixture}/profile', '--remote-debugging-port={port}'],
            cwd: '{fixture}/profile',
            env: {},
        },
        candidate: {
            executable: 'C:/Fixture/obsidian.exe',
            args: [
                '--user-data-dir={fixture}/profile',
                '--remote-debugging-port={port}',
                '--enable-features=CDPScreenshotNewSurface',
            ],
            cwd: '{fixture}/profile',
            env: {},
        },
        fixtureFiles: {
            'profile/obsidian.json': JSON.stringify({
                vaults: { 'synthetic-id': { path: '{fixture}/synthetic-vault', open: true } },
            }),
            'synthetic-vault/.obsidian/app.json': '{}',
        },
        page: { url: 'app://obsidian.md/index.html', title: 'synthetic-vault', identity: 'synthetic-id' },
    },
    payload: { root: 'C:/Evidence/sealed', receipt },
    mainWindow: { className: 'Chrome_WidgetWin_1', titleIncludes: 'synthetic-vault' },
    identityFunction:
        '(fixtureDirectory) => ({url:location.href,title:document.title,identity:"synthetic-id",userData:fixtureDirectory+"/profile",vaultPath:fixtureDirectory+"/synthetic-vault"})',
    preflight: { status: 'approved', reason: 'External static guards passed.' },
};
const identity = {
    processId: 4400,
    executablePath: 'C:/Fixture/obsidian.exe',
    startedAtUtc: '2026-10-07T00:00:00.0000001Z',
};
const window = {
    ...identity,
    actualExecutablePath: identity.executablePath,
    handle: 123,
    windowClass: 'Chrome_WidgetWin_1',
    title: 'synthetic-vault - Obsidian',
    child: false,
    visible: true,
    isIconic: false,
    showCmd: 1,
    actionAccepted: null,
    nativeError: 0,
    stateReached: true,
    foregroundHwnd: 123,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
};
const geometry = {
    nonce: 'cell-1',
    color: 'rgb(0, 255, 0)',
    dpr: 1.25,
    viewport: { x: 0, y: 0, width: 100, height: 100 },
    root: { rect: { x: 0, y: 0, width: 100, height: 200 }, scrollWidth: 100, scrollHeight: 200 },
    element: { x: 0, y: 0, width: 100, height: 200 },
    visualViewport: { scale: 1, pageLeft: 0, pageTop: 0 },
};
function jsonResult(value: unknown) {
    return { content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` }] };
}
function boundary(
    options: {
        pages?: number[];
        missing?: boolean;
        captureError?: boolean;
        sessionExit?: boolean;
        quarantine?: boolean;
        fast?: boolean;
        postError?: boolean;
        badPixel?: boolean;
        badDimensions?: boolean;
        acquireError?: boolean;
        rendererPaths?: Record<string, unknown>;
        observerError?: boolean;
        directory?: string;
        workspaceConfinement?: boolean;
    } = {},
) {
    const events: { kind: string; value: unknown }[] = [];
    const sequence: string[] = [];
    let capture = 0;
    let opened = 0;
    let closed = 0;
    let after = false;
    let now = 0;
    const adapter: ApplicationProbeAdapter = {
        now: () => now,
        async sleep(ms) {
            now += ms;
        },
        payloadIO: {
            async listFiles() {
                return files.map((file) => file.path);
            },
            async readFile() {
                return Buffer.from('code');
            },
        },
        fixtureIO: {
            async readFile() {
                return Buffer.from('app');
            },
            async createFreshDirectory() {
                sequence.push('fixture');
                return options.directory ?? 'C:/Evidence/cell-1';
            },
            async writeFile() {},
        },
        async record(kind, value) {
            events.push({ kind, value });
            sequence.push(kind);
        },
        async acquire() {
            opened += 1;
            sequence.push('acquire');
            if (options.acquireError) throw new Error('partial start failure');
            return {
                identity,
                async qualify() {
                    sequence.push('qualify');
                    return { actualProfile: 'C:/Evidence/cell-1/profile' };
                },
                async call(name, args, interval) {
                    sequence.push(name);
                    if (name === 'list_pages')
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: (options.pages ?? [7])
                                        .map((id) => `${id}: app://obsidian.md/index.html`)
                                        .join('\n'),
                                },
                            ],
                        };
                    if (name === 'evaluate_script') {
                        const expression = String(args.function);
                        events.push({ kind: 'evaluate-function', value: expression });
                        if (expression.includes('DCT_APPLICATION_MARKER')) {
                            if (expression.includes('255,255,0')) return jsonResult({ installed: true });
                            return jsonResult(geometry);
                        }
                        return jsonResult({
                            url: options.missing ? 'app://obsidian.md/help.html' : config.fixture.page.url,
                            title: 'synthetic-vault',
                            identity: 'synthetic-id',
                            ...(options.rendererPaths ?? {
                                userData: `${options.directory ?? 'C:/Evidence/cell-1'}/profile`,
                                vaultPath: `${options.directory ?? 'C:/Evidence/cell-1'}/synthetic-vault`,
                            }),
                        });
                    }
                    assert.equal(name, 'take_screenshot');
                    capture += 1;
                    events.push({ kind: 'capture-file-path', value: args.filePath });
                    assert.deepEqual(Object.keys(args).sort(), ['filePath', 'fullPage', 'pageId']);
                    interval?.dispatched();
                    await pendingSample?.();
                    interval?.settled();
                    after = true;
                    if (options.workspaceConfinement) {
                        assert.ok(typeof args.filePath === 'string');
                        const relative = path.win32.relative(options.directory ?? 'C:/Evidence/cell-1', args.filePath);
                        if (
                            !relative ||
                            relative === '..' ||
                            relative.startsWith('..\\') ||
                            path.win32.isAbsolute(relative)
                        )
                            return {
                                isError: true,
                                content: [
                                    {
                                        type: 'text',
                                        text: 'Access denied: path is outside configured workspace roots.',
                                    },
                                ],
                            };
                    }
                    if (options.captureError) throw new Error('MCP timeout: tools/call');
                    if (options.sessionExit) throw new Error('The target session exited during the official call.');
                    if (options.quarantine)
                        return { isError: true, structuredContent: { code: 'CONNECTION_RECOVERY_REQUIRED' } };
                    return { content: [{ type: 'text', text: 'saved' }] };
                },
                async status() {
                    sequence.push('status');
                    if (after && options.postError) throw new Error('crashed after capture');
                    return {};
                },
                async sample() {
                    sequence.push('sample');
                    return [window];
                },
                async condition() {
                    sequence.push('condition');
                    return [window];
                },
                async capture(call, _handle, observe) {
                    pendingSample = options.fast ? undefined : () => observe(async () => [window]);
                    let result: Record<string, unknown> | undefined;
                    let primaryError: unknown;
                    try {
                        result = await call({ dispatched() {}, settled() {} });
                    } catch (error) {
                        primaryError = error;
                    }
                    if (options.observerError) throw new Error('observer completion failed after settlement');
                    if (primaryError !== undefined) throw primaryError;
                    assert.ok(result);
                    return result;
                },
                async png(file, points, size) {
                    sequence.push('png');
                    events.push({ kind: 'decoded-file-path', value: file });
                    return {
                        sha256: 'b'.repeat(64),
                        bytes: 42,
                        decoded: {
                            ...size,
                            width: options.badDimensions ? size.width + 1 : size.width,
                            pixels: points.map((point) => ({
                                ...point,
                                r: options.badPixel ? 255 : 0,
                                g: 255,
                                b: 0,
                                a: 255,
                            })),
                        },
                    };
                },
            };
        },
        async cleanup() {
            closed += 1;
            sequence.push('cleanup');
            return { ok: true };
        },
    };
    let pendingSample: (() => Promise<void>) | undefined;
    return { adapter, events, sequence, counts: () => ({ capture, opened, closed }) };
}
const run = (
    io: ReturnType<typeof boundary>,
    selected: unknown = config,
    mode: 'qualification' | 'viewport' | 'fullPage' = 'viewport',
) =>
    runApplicationScreenshotProbe(
        selected,
        {
            arm: 'candidate',
            condition: 'foreground-normal',
            mode,
            parentDirectory: 'C:/Evidence',
            nonce: 'cell-1',
        },
        io.adapter,
    );

test('sealed inventory validates every file and refuses changed extra missing escaped and reordered files', async () => {
    const io = boundary().adapter.payloadIO;
    assert.equal((await verifySealedApplicationPayload(config.payload, io)).inventoryDigest, receipt.inventoryDigest);
    for (const bad of [
        { ...receipt, source: '0'.repeat(40) },
        { ...receipt, inventoryDigest: '0'.repeat(64) },
        { ...receipt, files: [{ ...files[0], path: '../escape' }] },
    ])
        await assert.rejects(verifySealedApplicationPayload({ root: config.payload.root, receipt: bad }, io));
    await assert.rejects(
        verifySealedApplicationPayload(config.payload, {
            ...io,
            async listFiles() {
                return [...files.map((file) => file.path), 'extra'];
            },
        }),
    );
    await assert.rejects(
        verifySealedApplicationPayload(config.payload, {
            ...io,
            async listFiles() {
                return [];
            },
        }),
    );
    await assert.rejects(
        verifySealedApplicationPayload(config.payload, {
            ...io,
            async readFile() {
                return Buffer.from('bad');
            },
        }),
    );
});

test('sealed receipt refuses duplicate case aliases and noncanonical inventory order before reads', async () => {
    let reads = 0;
    const io = {
        async listFiles() {
            return [];
        },
        async readFile() {
            reads += 1;
            return Buffer.from('');
        },
    };
    const entries = [
        { path: 'z', bytes: 0, sha256: sha('') },
        { path: 'dist/mcp-bootstrap.mjs', bytes: 0, sha256: sha('') },
    ];
    for (const selected of [entries, [files[0], { ...files[0], path: 'DIST/MCP-BOOTSTRAP.MJS' }]]) {
        await assert.rejects(
            verifySealedApplicationPayload(
                {
                    root: config.payload.root,
                    receipt: { ...receipt, files: selected, inventoryDigest: sha(JSON.stringify(selected)) },
                },
                io,
            ),
        );
    }
    assert.equal(reads, 0);
});
test('sealed failure and Readest preflight block acquire no fixture gateway or application', async () => {
    const bad = boundary();
    const result = await run(bad, {
        ...config,
        payload: { ...config.payload, receipt: { ...receipt, inventoryDigest: '0'.repeat(64) } },
    });
    assert.equal(result.outcome, 'preflight-blocked');
    assert.deepEqual(bad.counts(), { capture: 0, opened: 0, closed: 0 });
    assert.ok(!bad.sequence.includes('fixture'));
    const blocked = boundary();
    const blockedResult = await run(blocked, {
        ...config,
        preflight: { status: 'blocked', reason: 'Protocol registration changes user configuration.' },
    });
    assert.equal(blockedResult.outcome, 'preflight-blocked');
    assert.deepEqual(blocked.counts(), { capture: 0, opened: 0, closed: 0 });
});
test('main HWND requires a unique declared class and title rather than largest bounds', () => {
    assert.equal(
        selectApplicationMainWindow(
            [window, { ...window, handle: 124, windowClass: 'Auxiliary', width: 9000 }],
            identity,
            config.mainWindow,
        ).handle,
        123,
    );
    for (const raw of [
        [],
        [window, { ...window, handle: 124 }],
        [{ ...window, title: 'other' }],
        [{ ...window, actualExecutablePath: 'C:/Fixture/foreign.exe' }],
    ])
        assert.throws(() => selectApplicationMainWindow(raw, identity, config.mainWindow));
});
test('qualification selects only one existing main renderer and takes zero screenshots', async () => {
    const io = boundary();
    const result = await run(io, config, 'qualification');
    assert.equal(result.outcome, 'qualified');
    assert.deepEqual(io.counts(), { capture: 0, opened: 1, closed: 1 });
    assert.ok(!io.sequence.includes('condition'));
    assert.ok(!io.sequence.includes('marker-initial'));
    for (const options of [{ pages: [7, 8] }, { missing: true }, { pages: [] }]) {
        const failing = boundary(options);
        assert.equal((await run(failing, config, 'qualification')).outcome, 'qualification-blocked');
        assert.equal(failing.counts().capture, 0);
    }
});

test('renderer identity receives the exact fresh directory as a safely encoded function argument', async () => {
    const directory = "C:/Evidence/cell-1');globalThis.injected=true;('";
    const io = boundary({ directory });
    const result = await run(
        io,
        { ...config, identityFunction: 'fixtureDirectory => ({received:fixtureDirectory})' },
        'qualification',
    );
    assert.equal(result.outcome, 'qualified');
    const expression = io.events.find((event) => event.kind === 'evaluate-function')?.value;
    assert.equal(typeof expression, 'string');
    const context = { injected: false };
    const evaluated: unknown = runInNewContext(`(${expression})()`, context);
    assert.ok(typeof evaluated === 'object' && evaluated !== null && 'received' in evaluated);
    assert.equal(evaluated.received, directory);
    assert.equal(context.injected, false);
});

test('opaque renderer identity cannot substitute for actual fresh profile and synthetic vault adoption', async () => {
    for (const rendererPaths of [
        {},
        { userData: '{fixture}/profile', vaultPath: '{fixture}/synthetic-vault' },
        { userData: 'C:/Fixture/old-profile', vaultPath: 'C:/Evidence/cell-1/synthetic-vault' },
        { userData: 'C:/Evidence/cell-1/profile', vaultPath: 'C:/Fixture/old-vault' },
        { userData: 'C:/Evidence/cell-1/profile' },
        { vaultPath: 'C:/Evidence/cell-1/synthetic-vault' },
    ]) {
        const io = boundary({ rendererPaths });
        assert.equal((await run(io)).outcome, 'qualification-blocked');
        assert.deepEqual(io.counts(), { capture: 0, opened: 1, closed: 1 });
        assert.ok(!io.sequence.includes('marker-initial'));
    }
});

test('Obsidian helper or starter URLs are refused before acquisition', async () => {
    const io = boundary();
    const result = await run(
        io,
        {
            ...config,
            fixture: { ...config.fixture, page: { ...config.fixture.page, url: 'app://obsidian.md/help.html' } },
        },
        'qualification',
    );
    assert.equal(result.outcome, 'preflight-blocked');
    assert.equal(io.counts().opened, 0);
});
test('formal capture installs yellow before condition and reads fresh green after condition then captures once', async () => {
    const io = boundary();
    const result = await run(io, config, 'fullPage');
    assert.equal(result.outcome, 'success');
    assert.equal(io.counts().capture, 1);
    assert.ok(io.sequence.indexOf('marker-initial') < io.sequence.indexOf('condition'));
    assert.ok(io.sequence.indexOf('condition') < io.sequence.indexOf('marker-green'));
    assert.ok(io.sequence.indexOf('marker-green') < io.sequence.indexOf('take_screenshot'));
    assert.ok(!io.sequence.some((name) => ['new_page', 'select_page', 'emulate'].includes(name)));
});

test('both formal arms capture and decode the same PNG inside the fresh declared workspace', async () => {
    const directory = 'C:/Evidence/formal-cell/application-screenshot-fresh';
    for (const arm of ['baseline', 'candidate'] as const) {
        const io = boundary({ directory, workspaceConfinement: true });
        const result = await runApplicationScreenshotProbe(
            config,
            {
                arm,
                condition: 'foreground-normal',
                mode: 'viewport',
                parentDirectory: 'C:/Evidence/formal-cell',
                nonce: 'cell-1',
            },
            io.adapter,
        );
        assert.equal(result.outcome, 'success');
        assert.deepEqual(io.counts(), { capture: 1, opened: 1, closed: 1 });
        const file = path.join(directory, 'screenshot.png');
        assert.equal(io.events.find((event) => event.kind === 'capture-file-path')?.value, file);
        assert.equal(io.events.find((event) => event.kind === 'decoded-file-path')?.value, file);
        assert.deepEqual(io.events.find((event) => event.kind === 'screenshot-output')?.value, {
            workspace: directory,
            filePath: file,
        });
        assert.ok(io.sequence.indexOf('screenshot-output') < io.sequence.indexOf('acquire'));
    }
});

test('fixture collision with the fixed screenshot file or its directory blocks before acquisition', async () => {
    for (const file of ['screenshot.png', 'SCREENSHOT.PNG', 'screenshot.png/child.txt', 'SCREENSHOT.PNG\\child.txt']) {
        const io = boundary();
        const result = await run(io, {
            ...config,
            fixture: { ...config.fixture, fixtureFiles: { ...config.fixture.fixtureFiles, [file]: 'fixture text' } },
        });
        assert.equal(result.outcome, 'qualification-blocked');
        assert.ok(
            result.failures.some((failure) => /Screenshot output collides with a fixture path/.test(failure.error)),
        );
        assert.deepEqual(io.counts(), { capture: 0, opened: 0, closed: 1 });
        assert.ok(!io.sequence.includes('acquire'));
        assert.ok(!io.sequence.includes('marker-initial'));
    }
});
test('fast capture preserves PNG with evidence-insufficient and raw result precedes post observation crash', async () => {
    for (const options of [{ fast: true }, { postError: true }]) {
        const io = boundary(options);
        const result = await run(io);
        assert.equal(result.capture?.outcome, 'success');
        assert.equal(result.outcome, 'evidence-insufficient');
        assert.ok(io.sequence.includes('png'));
        assert.ok(io.sequence.indexOf('capture-raw') < io.sequence.indexOf('png'));
        assert.equal(io.counts().capture, 1);
    }
});

test('observer completion failure preserves the primary successful or failed capture without replay', async () => {
    for (const captureError of [false, true]) {
        const io = boundary({ observerError: true, captureError });
        const result = await run(io);
        assert.equal(result.capture?.outcome, captureError ? 'client-timeout' : 'success');
        assert.equal(result.outcome, captureError ? 'client-timeout' : 'evidence-insufficient');
        assert.equal(io.counts().capture, 1);
        assert.equal(io.events.filter((event) => event.kind === 'capture-raw').length, 1);
        assert.ok(
            result.failures.some(
                (failure) => failure.kind === 'capture-observer' && failure.error.includes('observer completion'),
            ),
        );
        if (captureError) {
            assert.match(result.capture?.error ?? '', /MCP timeout/);
            assert.ok(!io.sequence.includes('png'));
        } else {
            assert.deepEqual(result.capture?.result, { content: [{ type: 'text', text: 'saved' }] });
            const png = io.events.find((event) => event.kind === 'png')?.value;
            assert.ok(typeof png === 'object' && png !== null && 'sha256' in png && 'bytes' in png);
            assert.equal(png.sha256, 'b'.repeat(64));
            assert.equal(png.bytes, 42);
        }
    }
});
test('wrong opaque pixels and fullPage dimensions remain distinct screenshot evidence failures', async () => {
    for (const options of [{ badPixel: true }, { badDimensions: true }]) {
        const io = boundary(options);
        const result = await run(io, config, 'fullPage');
        assert.equal(result.capture?.outcome, 'success');
        assert.ok(result.failures.some((failure) => failure.kind === 'png'));
        assert.equal(io.counts().capture, 1);
    }
});
test('capture error is never replayed and quarantine prevents subsequent official route calls', async () => {
    for (const options of [{ captureError: true }, { quarantine: true }]) {
        const io = boundary(options);
        const result = await run(io);
        assert.equal(io.counts().capture, 1);
        assert.equal(result.capture?.outcome, options.quarantine ? 'quarantine' : 'client-timeout');
        assert.equal(io.counts().closed, 1);
        if (options.quarantine)
            assert.ok(!io.sequence.slice(io.sequence.indexOf('take_screenshot') + 1).includes('status'));
        if (options.quarantine) {
            const rawCapture = io.events.find((event) => event.kind === 'capture-raw');
            assert.ok(
                rawCapture &&
                    typeof rawCapture.value === 'object' &&
                    rawCapture.value !== null &&
                    'outcome' in rawCapture.value,
            );
            assert.equal(rawCapture.value.outcome, 'quarantine');
        }
    }
});

test('a reported session exit stays distinct from the client receipt deadline', async () => {
    const io = boundary({ sessionExit: true });
    const result = await run(io);
    assert.equal(result.capture?.outcome, 'session-ended');
    assert.equal(io.counts().capture, 1);
    assert.ok(io.events.some((event) => event.kind === 'capture-raw'));
});
test('partial acquisition still enters cleanup', async () => {
    const io = boundary({ acquireError: true });
    assert.equal((await run(io)).outcome, 'qualification-blocked');
    assert.equal(io.counts().closed, 1);
});
test('cleanup attempts every target and anchor and retains gateway on Close or exit uncertainty', async () => {
    for (const fail of ['target', 'anchor', 'witness', 'final']) {
        const calls: string[] = [];
        const result = await cleanupApplicationResources({
            connections: ['one', 'two'],
            async close(connection) {
                calls.push(connection);
                if (fail === 'target' && connection === 'one') throw new Error('Close denied');
                return {};
            },
            async witness(connection) {
                calls.push(`exit-${connection}`);
                return {
                    processExited: fail !== 'witness',
                    identityVerified: true,
                    waitResult: 0,
                    waitError: 0,
                    exitCode: 0,
                };
            },
            async anchor() {
                calls.push('anchor');
                if (fail === 'anchor') throw new Error('anchor Close denied');
                return {};
            },
            async final() {
                calls.push('final');
                if (fail === 'final') throw new Error('status unavailable');
                return { connections: [] };
            },
            async shutdown() {
                calls.push('shutdown');
                return { code: 0, signal: null };
            },
        });
        assert.equal(result.ok, false);
        assert.ok(calls.includes('one') && calls.includes('two') && calls.includes('anchor'));
        assert.ok(!calls.includes('shutdown'));
        assert.equal(result.retained, true);
    }
});

test('cleanup retains both Close and rejected or invalid witness reasons for the same resource', async () => {
    for (const invalidWitness of [false, true]) {
        const calls: string[] = [];
        const result = await cleanupApplicationResources({
            connections: ['one', 'two'],
            async close(connection) {
                calls.push(`close-${connection}`);
                if (connection === 'one') throw new Error('normal Close denied');
            },
            async witness(connection) {
                calls.push(`witness-${connection}`);
                if (connection === 'one' && !invalidWitness) throw new Error('exit witness unavailable');
                return {
                    processExited: connection !== 'one',
                    identityVerified: true,
                    waitResult: 0,
                    waitError: 0,
                    exitCode: 0,
                };
            },
            async anchor() {
                calls.push('anchor');
            },
            async final() {
                return { connections: [] };
            },
            async shutdown() {
                calls.push('shutdown');
                return { code: 0, signal: null };
            },
        });
        assert.equal(result.retained, true);
        assert.ok(
            result.failures.some(
                (failure) => failure.includes('connection[0] Close') && failure.includes('normal Close denied'),
            ),
        );
        assert.ok(
            result.failures.some(
                (failure) =>
                    failure.includes('connection[0] witness') &&
                    failure.includes(invalidWitness ? 'actual exit proof' : 'exit witness unavailable'),
            ),
        );
        assert.deepEqual([...calls].sort(), ['anchor', 'close-one', 'close-two', 'witness-one', 'witness-two']);
        for (const resource of ['one', 'two'])
            assert.ok(calls.indexOf(`close-${resource}`) < calls.indexOf(`witness-${resource}`));
    }
});

test('read-only browser evidence rejects stale identity incomplete argv hashes version and privilege values', () => {
    const observed = {
        identity,
        commandLine:
            'obsidian.exe --user-data-dir=C:/Evidence/cell-1/profile --remote-debugging-port=20222 --enable-features=SharedArrayBuffer,CDPScreenshotNewSurface',
        argv: [
            identity.executablePath,
            '--user-data-dir=C:/Evidence/cell-1/profile',
            '--remote-debugging-port=20222',
            '--enable-features=SharedArrayBuffer,CDPScreenshotNewSurface',
        ],
        file: { sha256: sha('app'), fileVersion: '1.0.0', productVersion: '1.0.0' },
        elevated: false,
        identityVerifiedBefore: true,
        identityVerifiedAfter: true,
    };
    const verified = readApplicationProcessEvidence(observed, identity);
    assert.deepEqual(verified, observed);
    for (const invalid of [
        { ...observed, identity: { ...identity, startedAtUtc: '2026-10-06T00:00:00Z' } },
        { ...observed, argv: [] },
        { ...observed, elevated: 'false' },
        { ...observed, file: { ...observed.file, sha256: 'bad' } },
        { ...observed, identityVerifiedAfter: false },
    ])
        assert.throws(() => readApplicationProcessEvidence(invalid, identity));
    qualifyApplicationBrowserArguments(verified, {
        application: 'obsidian',
        profile: 'C:/Evidence/cell-1/profile',
        port: 20222,
        candidate: true,
    });
    for (const argv of [
        observed.argv.slice(0, 3),
        [...observed.argv, '--disable-features=CDPScreenshotNewSurface'],
        observed.argv.map((arg) => (arg.includes('user-data-dir') ? '--user-data-dir=C:/Fixture/old' : arg)),
        [...observed.argv, '--remote-debugging-port=20223'],
    ])
        assert.throws(() =>
            qualifyApplicationBrowserArguments(
                { ...verified, argv },
                { application: 'obsidian', profile: 'C:/Evidence/cell-1/profile', port: 20222, candidate: true },
            ),
        );
});

test('observed Obsidian browser token must prove the approved ordinary route', () => {
    const elevated = readApplicationProcessEvidence(
        {
            identity,
            commandLine: 'fixture',
            argv: [
                identity.executablePath,
                '--user-data-dir=C:/Evidence/cell-1/profile',
                '--remote-debugging-port=20222',
                '--enable-features=CDPScreenshotNewSurface',
            ],
            file: { sha256: sha('app'), fileVersion: '1', productVersion: '1' },
            elevated: true,
            identityVerifiedBefore: true,
            identityVerifiedAfter: true,
        },
        identity,
    );
    assert.throws(
        () =>
            qualifyApplicationBrowserArguments(elevated, {
                application: 'obsidian',
                profile: 'C:/Evidence/cell-1/profile',
                port: 20222,
                candidate: true,
            }),
        /ordinary privileges/,
    );
});

test('observed feature argv uses the strict effective grammar without mutating the receipt', () => {
    const carrier = [
        identity.executablePath,
        '--user-data-dir=C:/Evidence/cell-1/profile',
        '--remote-debugging-port=20222',
    ];
    const processEvidence = (argv: string[]) =>
        readApplicationProcessEvidence(
            {
                identity,
                commandLine: 'fixture',
                argv,
                file: { sha256: sha('app'), fileVersion: '1', productVersion: '1' },
                elevated: false,
                identityVerifiedBefore: true,
                identityVerifiedAfter: true,
            },
            identity,
        );
    const target = 'CDPScreenshotNewSurface';
    for (const candidate of [false, true]) {
        const qualify = (observed: ReturnType<typeof readApplicationProcessEvidence>) =>
            qualifyApplicationBrowserArguments(observed, {
                application: 'obsidian',
                profile: 'C:/Evidence/cell-1/profile',
                port: 20222,
                candidate,
            });
        for (const invalid of [
            [`--enable-features=${target}`, `--disable-features= ${target}`],
            [`--enable-features=${target}`, '--enable-features=Unrelated'],
            [`--enable-features=${target}`, `--disable-features=${target}.Group`],
            [`--enable-features=${target}`, '--disable-features=Unrelated', '--disable-features=Other'],
            [`--enable-features= ${target}`],
            [`--enable-features=*${target}`],
            [`--enable-features=${target}<Trial`],
            [`--enable-features=${target}.Group`],
            [`--enable-features=${target}:key/value`],
            [`--enable-features=${target},${target}`],
            [`--enable-features=${target}`, '--Enable-Features=Other'],
            [`--enable-features=${target}`, ' --disable-features=Other'],
            ['--enable-features', target],
            [`--enable-features=${target}`, '--single-argument'],
            [`--enable-features=${target}`, ' -- '],
            ['--enable-features=Other::bad'],
            ['--enable-features=Other\u0085'],
        ]) {
            const argv = [...carrier, ...invalid];
            const observed = processEvidence(argv);
            const original = structuredClone(observed);
            assert.throws(() => qualify(observed), `accepted ${JSON.stringify(invalid)}`);
            assert.deepEqual(observed, original);
        }
        const valid = [
            ...carrier,
            `--enable-features=SharedArrayBuffer${candidate ? `,${target}` : ''}`,
            '--',
            `--disable-features=${target}`,
        ];
        const observed = processEvidence(valid);
        const original = structuredClone(observed);
        qualify(observed);
        assert.deepEqual(observed, original);
        assert.throws(() =>
            qualify(processEvidence(candidate ? carrier : [...carrier, `--enable-features=${target}`])),
        );
    }
});

test('passive exit witness drains observed output delivered after child exit before close', async (t) => {
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });
    const fake = Object.assign(child, { stdout, stderr, stdin });
    const observed = {
        event: 'observed',
        receipts: [
            { ...identity, processExited: true, identityVerified: true, waitResult: 0, waitError: 0, exitCode: 0 },
        ],
    };
    stdin.on('finish', () => {
        child.emit('exit', 0, null);
        setImmediate(() => {
            stdout.end(`${JSON.stringify(observed)}\n`);
            stderr.end();
            child.emit('close', 0, null);
        });
    });
    const replaced = t.mock.method(childProcess, 'spawn', () => {
        queueMicrotask(() => stdout.write(`${JSON.stringify({ event: 'armed' })}\n`));
        return fake;
    });
    syncBuiltinESMExports();
    try {
        const records: unknown[] = [];
        const witness = startApplicationExitWitness([identity], async (_kind, value) => {
            await new Promise<void>((resolve) => setImmediate(resolve));
            records.push(value);
        });
        await witness.armed;
        assert.deepEqual(await witness.finish(), observed);
        assert.deepEqual(records, [{ event: 'armed' }, observed]);
    } finally {
        replaced.mock.restore();
        syncBuiltinESMExports();
    }
});

test('passive exit witness preserves record writer failure and nonzero child exit evidence', async (t) => {
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });
    const fake = Object.assign(child, { stdout, stderr, stdin });
    stdin.on('finish', () => {
        child.emit('exit', 7, null);
        setImmediate(() => {
            stdout.end(`${JSON.stringify({ event: 'observed' })}\n`);
            stderr.end('native witness error');
            child.emit('close', 7, null);
        });
    });
    const replaced = t.mock.method(childProcess, 'spawn', () => {
        queueMicrotask(() => stdout.write(`${JSON.stringify({ event: 'armed' })}\n`));
        return fake;
    });
    syncBuiltinESMExports();
    try {
        const witness = startApplicationExitWitness([identity], async (_kind, value) => {
            if (typeof value === 'object' && value !== null && 'event' in value && value.event === 'observed')
                throw new Error('evidence writer failed');
        });
        await witness.armed;
        await assert.rejects(witness.finish(), (error) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /evidence writer failed/);
            assert.match(error.message, /code=7/);
            assert.match(error.message, /native witness error/);
            return true;
        });
    } finally {
        replaced.mock.restore();
        syncBuiltinESMExports();
    }
});

test('passive exit witness rejects absent arm or terminal output and malformed drained output', async (t) => {
    for (const scenario of [
        { armed: true, output: '', error: /Missing final observed receipt/ },
        { armed: true, output: 'invalid JSON\n', error: /record\/output/ },
        { armed: false, output: `${JSON.stringify({ event: 'observed' })}\n`, error: /Missing armed receipt/ },
    ]) {
        const child = new EventEmitter();
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const stdin = new Writable({
            write(_chunk, _encoding, callback) {
                callback();
            },
        });
        const fake = Object.assign(child, { stdout, stderr, stdin });
        stdin.on('finish', () => {
            child.emit('exit', 0, null);
            setImmediate(() => {
                stdout.end(scenario.output);
                stderr.end();
                child.emit('close', 0, null);
            });
        });
        const replaced = t.mock.method(childProcess, 'spawn', () => {
            if (scenario.armed) queueMicrotask(() => stdout.write(`${JSON.stringify({ event: 'armed' })}\n`));
            return fake;
        });
        syncBuiltinESMExports();
        try {
            const witness = startApplicationExitWitness([identity], async () => {});
            if (scenario.armed) await witness.armed;
            await assert.rejects(witness.finish(), scenario.error);
        } finally {
            replaced.mock.restore();
            syncBuiltinESMExports();
        }
    }
});

test('application native evidence parses and its read-only C# compiles without inspecting any application', {
    skip: process.platform !== 'win32',
}, async () => {
    const output = await promisify(execFile)(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "$source = [IO.File]::ReadAllText($env:DCT_APPLICATION_EVIDENCE_SCRIPT); $tokens = $null; $errors = $null; [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -ne 0) { throw 'PowerShell parse error.' }; $match = [regex]::Match($source, \"(?s)Add-Type @'\\r?\\n(.*?)\\r?\\n'@\"); if (!$match.Success) { throw 'Native evidence definition missing.' }; Add-Type -TypeDefinition $match.Groups[1].Value -ErrorAction Stop; [DctApplicationEvidence]::Arguments('fixture.exe --user-data-dir=\"C:/Fixture/data path\"') | ConvertTo-Json -Compress",
        ],
        {
            windowsHide: true,
            shell: false,
            timeout: 10_000,
            env: {
                ...process.env,
                DCT_APPLICATION_EVIDENCE_SCRIPT: fileURLToPath(
                    new URL('./smoke/windows-application-evidence.ps1', import.meta.url),
                ),
            },
        },
    );
    const argv: unknown = JSON.parse(output.stdout);
    assert.deepEqual(argv, ['fixture.exe', '--user-data-dir=C:/Fixture/data path']);
});
