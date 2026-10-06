import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScreenshotTimeoutProbe, type ScreenshotTimeoutAdapter } from './smoke/screenshot-timeout-fixture.ts';

const fixture = {
    label: 'readme-background',
    url: 'https://example.test/pinned-readme',
    launch: { executable: 'C:/Fixture/chrome.exe', args: ['--user-data-dir={fixture}/profile'] },
    background: true,
    fullPage: true,
    colorScheme: 'light',
    viewport: '1280x900x1',
    evaluations: [{ function: '() => document.title' }, { function: '() => 1', waitForStableDom: false }],
};
const identity = {
    processId: 4100,
    executablePath: 'C:/Fixture/chrome.exe',
    startedAtUtc: '2026-10-05T00:00:00.0000001Z',
};
const window = {
    ...identity,
    actualExecutablePath: 'C:/Fixture/chrome.exe',
    handle: 120,
    child: false,
    visible: true,
    isIconic: false,
    showCmd: 1,
    actionAccepted: null,
    nativeError: 0,
    stateReached: true,
};

function boundary(
    options: {
        fail?: string;
        rejectCapture?: boolean;
        windows?: unknown[];
        closeFails?: boolean;
        blockedIdentity?: boolean;
    } = {},
) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const evidence: { kind: string; value: unknown }[] = [];
    let opened = 0;
    let closed = 0;
    let sampled = 0;
    const adapter: ScreenshotTimeoutAdapter = {
        async acquire() {
            opened += 1;
            if (options.blockedIdentity)
                throw Object.assign(new Error('Process/listener identity disagreed'), {
                    probeOutcome: 'blocked-evidence',
                });
            return {
                identity,
                async call(name, args) {
                    calls.push({ name, args });
                    if (options.fail === name) {
                        return { isError: true, content: [{ type: 'text', text: 'fixture handler failed' }] };
                    }
                    if (name === 'take_screenshot' && options.rejectCapture) throw new Error('MCP timeout: tools/call');
                    return {
                        content: [
                            {
                                type: 'text',
                                text: name === 'new_page' ? '1: baseline\n7: pinned-readme [selected]' : '1: baseline',
                            },
                        ],
                    };
                },
                async status() {
                    return { diagnostics: [] };
                },
                async sample() {
                    return options.windows?.[sampled++] ?? [window];
                },
                async capture(call) {
                    return call();
                },
                async png() {
                    return { width: 1280, height: 1800 };
                },
            };
        },
        async cleanup() {
            closed += 1;
            if (options.closeFails) throw new Error('Close retained fixture identity');
            return { connections: [], gatewayExitCode: 0 };
        },
        async record(kind, value) {
            evidence.push({ kind, value });
        },
    };
    return { adapter, calls, evidence, counts: () => ({ opened, closed }) };
}

test('malformed fixture is rejected before gateway acquisition', async () => {
    for (const changed of [
        { background: 'true' },
        { fullPage: 1 },
        { bringToFront: null },
        { colorScheme: 'system' },
        { viewport: 42 },
        { evaluations: [{ function: 3 }] },
        { evaluations: [{ function: '() => 1', waitForStableDom: 'false' }] },
        { launch: { executable: 'C:/Fixture/chrome.exe', args: ['--user-data-dir=C:/Old/profile'] } },
        { launch: { executable: 'C:/Fixture/chrome.exe', args: ['--user-data-dir={fixture}/../old'] } },
    ]) {
        const io = boundary();
        await assert.rejects(runScreenshotTimeoutProbe({ ...fixture, ...changed }, 'C:/Evidence/shot.png', io.adapter));
        assert.deepEqual(io.counts(), { opened: 0, closed: 0 });
    }
});

test('independent process or endpoint identity failure is blocked evidence and still cleans the gateway', async () => {
    const io = boundary({ blockedIdentity: true });
    assert.equal(
        (await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter)).outcome,
        'blocked-evidence',
    );
    assert.deepEqual(io.calls, []);
    assert.deepEqual(io.counts(), { opened: 1, closed: 1 });
});

test('omitted bringToFront skips selection while false preserves the official false argument', async () => {
    const omitted = boundary();
    const selected = boundary();
    assert.equal(
        (await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', omitted.adapter)).outcome,
        'success',
    );
    assert.equal(
        omitted.calls.some((call) => call.name === 'select_page'),
        false,
    );
    await runScreenshotTimeoutProbe({ ...fixture, bringToFront: false }, 'C:/Evidence/shot.png', selected.adapter);
    assert.deepEqual(
        selected.calls.find((call) => call.name === 'select_page'),
        {
            name: 'select_page',
            args: { pageId: 7, bringToFront: false },
        },
    );
    assert.deepEqual(omitted.calls.filter((call) => call.name === 'evaluate_script').slice(0, 2), [
        { name: 'evaluate_script', args: { pageId: 7, function: '() => document.title' } },
        { name: 'evaluate_script', args: { pageId: 7, function: '() => 1', waitForStableDom: false } },
    ]);
    assert.deepEqual(
        omitted.calls.find((call) => call.name === 'take_screenshot'),
        {
            name: 'take_screenshot',
            args: { pageId: 7, fullPage: true, filePath: 'C:/Evidence/shot.png' },
        },
    );
});

test('official tool errors stop dependent preparation and still attempt cleanup', async () => {
    const io = boundary({ fail: 'emulate' });
    const result = await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter);
    assert.equal(result.outcome, 'tool-error');
    assert.deepEqual(
        io.calls.map((call) => call.name),
        ['list_pages', 'new_page', 'emulate'],
    );
    assert.deepEqual(io.counts(), { opened: 1, closed: 1 });
});

test('failed capture is one shot and cleanup failure remains visible', async () => {
    const io = boundary({ rejectCapture: true, closeFails: true });
    const result = await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter);
    assert.equal(result.outcome, 'client-error');
    assert.equal(io.calls.filter((call) => call.name === 'take_screenshot').length, 1);
    assert.equal(result.cleanup.ok, false);
    assert.deepEqual(io.counts(), { opened: 1, closed: 1 });
});

test('native disagreement or initial minimized state blocks capture without mutation', async () => {
    for (const changed of [
        { processId: 4101 },
        { startedAtUtc: '2026-10-05T00:00:00.0000002Z' },
        { executablePath: 'C:/Other/chrome.exe' },
        { isIconic: true, showCmd: 2 },
    ]) {
        const io = boundary({ windows: [[{ ...window, ...changed }]] });
        assert.equal(
            (await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter)).outcome,
            'blocked-evidence',
        );
        assert.equal(
            io.calls.some((call) => call.name === 'take_screenshot'),
            false,
        );
        assert.equal(io.counts().closed, 1);
    }
});

test('replaced native HWND after capture cannot be reported as success', async () => {
    const io = boundary({ windows: [[window], [{ ...window, handle: 121 }]] });
    assert.equal(
        (await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter)).outcome,
        'blocked-evidence',
    );
    assert.equal(io.calls.filter((call) => call.name === 'take_screenshot').length, 1);
    assert.equal(io.counts().closed, 1);
});
