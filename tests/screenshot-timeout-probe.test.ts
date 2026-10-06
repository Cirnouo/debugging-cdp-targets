import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    correlateNativeTabs,
    runScreenshotTimeoutProbe,
    type ScreenshotTimeoutAdapter,
} from './smoke/screenshot-timeout-fixture.ts';

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
        recoveryCapture?: boolean;
        afterDiagnosticsFails?: boolean;
    } = {},
) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const evidence: { kind: string; value: unknown }[] = [];
    let opened = 0;
    let closed = 0;
    let sampled = 0;
    let statusCalls = 0;
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
                    if (name === 'take_screenshot' && options.recoveryCapture)
                        return {
                            isError: true,
                            structuredContent: { code: 'CONNECTION_RECOVERY_REQUIRED', reason: 'upstream-timeout' },
                            content: [{ type: 'text', text: 'Gateway requires explicit recovery.' }],
                        };
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
                    if (statusCalls++ === 1 && options.afterDiagnosticsFails)
                        throw new Error('After diagnostics unavailable');
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

test('native tab provider agreement permits only a unique observed page-title match', () => {
    const reliable = {
        status: 'supported',
        incomplete: false,
        tabs: [
            { name: 'README', selected: true },
            { name: 'New Tab', selected: false },
        ],
    };
    assert.equal(correlateNativeTabs({ uia: reliable, msaa: reliable }, 'README').correlation, 'unique-title-match');
    assert.equal(
        correlateNativeTabs(
            { uia: reliable, msaa: { ...reliable, tabs: [{ name: 'Other', selected: true }] } },
            'README',
        ).correlation,
        'unknown',
    );
});

for (const [reason, ambiguous] of [
    [
        'multiple-selected',
        {
            status: 'supported',
            incomplete: false,
            tabs: [
                { name: 'New Tab', selected: true },
                { name: 'Other', selected: true },
            ],
        },
    ],
    [
        'duplicate-selected-title',
        {
            status: 'supported',
            incomplete: false,
            tabs: [
                { name: 'New Tab', selected: true },
                { name: 'New Tab', selected: false },
            ],
        },
    ],
    ['incomplete', { status: 'unknown', incomplete: true, tabs: [{ name: 'Other', selected: true }] }],
] as const) {
    test(`native ${reason} provider remains unknown even when the other provider matches`, () => {
        const result = correlateNativeTabs(
            {
                uia: { status: 'supported', incomplete: false, tabs: [{ name: 'README', selected: true }] },
                msaa: ambiguous,
            },
            'README',
        );
        assert.equal(result.correlation, 'unknown');
        assert.equal(result.providers.find((provider) => provider.provider === 'msaa')?.reason, reason);
    });
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

// biome-ignore lint/suspicious/noTemplateCurlyInString: Exercise a literal production launch substitution token.
for (const token of ['%DCT_PROBE_ESCAPE%', '${DCT_PROBE_ESCAPE}']) {
    test(`profile ${token} substitution is rejected before gateway acquisition`, async () => {
        const io = boundary();
        await assert.rejects(
            runScreenshotTimeoutProbe(
                {
                    ...fixture,
                    launch: {
                        executable: 'C:/Fixture/chrome.exe',
                        args: [`--user-data-dir={fixture}/profile/${token}/old`],
                    },
                },
                'C:/Evidence/shot.png',
                io.adapter,
            ),
        );
        assert.deepEqual(io.counts(), { opened: 0, closed: 0 });
    });
}

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

for (const options of [
    { recoveryCapture: true, expected: 'recovery-required', error: 'Gateway requires explicit recovery.' },
    { rejectCapture: true, expected: 'client-error', error: 'MCP timeout: tools/call' },
]) {
    test(`${options.expected} survives failed required after-window evidence`, async () => {
        const io = boundary({ ...options, windows: [[window], [{ ...window, handle: 121 }]] });
        const result = await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter);
        assert.equal(result.outcome, options.expected);
        assert.equal(result.error, options.error);
        assert.equal(result.capture?.outcome, options.expected);
        assert.equal(result.capture?.error, options.error);
        assert.equal(result.observations.ok, false);
        assert.equal(result.observations.errors[0]?.kind, 'native-after');
        assert.match(result.observations.errors[0]?.error ?? '', /visible top-level window/);
        assert.equal(io.calls.filter((call) => call.name === 'take_screenshot').length, 1);
        assert.equal(io.counts().closed, 1);
    });
}

for (const options of [
    { recoveryCapture: true, expected: 'recovery-required' },
    { rejectCapture: true, expected: 'client-error' },
    { expected: 'blocked-evidence' },
]) {
    test(`after-diagnostics failure keeps ${options.expected} capture separate and still samples the window`, async () => {
        const io = boundary({ ...options, afterDiagnosticsFails: true });
        const result = await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter);
        assert.equal(result.outcome, options.expected);
        assert.equal(result.capture?.outcome, options.expected === 'blocked-evidence' ? 'success' : options.expected);
        if (options.expected !== 'blocked-evidence') {
            assert.equal(
                result.error,
                options.expected === 'recovery-required'
                    ? 'Gateway requires explicit recovery.'
                    : 'MCP timeout: tools/call',
            );
            assert.equal(result.capture?.error, result.error);
        }
        assert.deepEqual(result.observations.errors, [
            { kind: 'diagnostics-after', error: 'After diagnostics unavailable' },
        ]);
        assert.equal(io.evidence.filter((event) => event.kind === 'native-validated').length, 2);
        assert.equal(io.calls.filter((call) => call.name === 'take_screenshot').length, 1);
        assert.equal(io.counts().closed, 1);
    });
}
