import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    correlateNativeTabs,
    runScreenshotTimeoutProbe,
    type ScreenshotTimeoutAdapter,
    type ScreenshotTimeoutFixture,
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
        conditionResult?: unknown;
        duringWindow?: unknown;
        duringFailure?: boolean;
        duringTiming?: 'before' | 'pending' | 'after' | 'crossing';
    } = {},
) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const evidence: { kind: string; value: unknown }[] = [];
    const acquiredFixtures: ScreenshotTimeoutFixture[] = [];
    const transitions: { condition: string; handle: number }[] = [];
    const sequence: string[] = [];
    let opened = 0;
    let closed = 0;
    let sampled = 0;
    let statusCalls = 0;
    let finishCapture: (() => void) | undefined;
    const adapter: ScreenshotTimeoutAdapter = {
        async acquire(selectedFixture) {
            opened += 1;
            acquiredFixtures.push(selectedFixture);
            if (options.blockedIdentity)
                throw Object.assign(new Error('Process/listener identity disagreed'), {
                    probeOutcome: 'blocked-evidence',
                });
            return {
                identity,
                async call(name, args, interval) {
                    sequence.push(name);
                    calls.push({ name, args });
                    if (name === 'take_screenshot') {
                        interval?.dispatched();
                        await new Promise<void>((resolve) => {
                            finishCapture = resolve;
                        });
                        interval?.settled();
                    }
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
                    sequence.push('sample');
                    return options.windows?.[sampled++] ?? [window];
                },
                async condition(condition, handle) {
                    sequence.push('condition');
                    transitions.push({ condition, handle });
                    return (
                        options.conditionResult ?? [
                            {
                                ...window,
                                foregroundHwnd: condition === 'foreground-normal' ? 120 : 300,
                                isIconic: condition === 'minimized',
                                showCmd: condition === 'minimized' ? 2 : 4,
                            },
                        ]
                    );
                },
                async capture(call, _handle, observe) {
                    const sample = () =>
                        observe(async () => {
                            if (options.duringFailure) throw new Error('Passive native sampler unavailable');
                            if (options.duringTiming === 'crossing') {
                                finishCapture?.();
                                await pending;
                            }
                            return options.duringWindow;
                        });
                    if (options.duringTiming === 'before') await sample();
                    const pending = call({ dispatched() {}, settled() {} });
                    // Let the real call pass its request evidence write and enter the held request.
                    while (!finishCapture) await new Promise<void>((resolve) => setImmediate(resolve));
                    if (
                        (options.duringWindow !== undefined || options.duringFailure) &&
                        options.duringTiming !== 'before' &&
                        options.duringTiming !== 'after'
                    )
                        await sample();
                    finishCapture();
                    if (options.duringTiming === 'after') {
                        await pending;
                        await sample();
                    }
                    return pending;
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
    return { adapter, calls, evidence, acquiredFixtures, transitions, sequence, counts: () => ({ opened, closed }) };
}

test('omitted native condition preserves the original passive sequence without mutation', async () => {
    const io = boundary();
    const result = await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter);
    assert.equal(result.outcome, 'success');
    assert.deepEqual(io.sequence, [
        'list_pages',
        'new_page',
        'emulate',
        'evaluate_script',
        'evaluate_script',
        'evaluate_script',
        'sample',
        'take_screenshot',
        'sample',
    ]);
    assert.deepEqual(io.transitions, []);
});

for (const duringTiming of ['before', 'after', 'crossing'] as const) {
    test(`controlled capture excludes a successful native sample ${duringTiming} the request interval`, async () => {
        const expected = { ...window, foregroundHwnd: 300 };
        const io = boundary({
            windows: [[window], [expected], [expected]],
            duringWindow: [expected],
            duringTiming,
        });
        const result = await runScreenshotTimeoutProbe(
            { ...fixture, windowCondition: 'background-normal' },
            'C:/Evidence/shot.png',
            io.adapter,
        );
        assert.equal(result.outcome, 'blocked-evidence');
        assert.equal(result.capture?.outcome, 'success');
        assert.ok(result.capture?.result);
        assert.match(result.observations.errors.at(-1)?.error ?? '', /during|in-flight/);
        assert.equal(io.calls.filter((call) => call.name === 'take_screenshot').length, 1);
    });
}

for (const condition of ['foreground-normal', 'background-normal', 'minimized'] as const) {
    test(`explicit ${condition} applies only to the verified HWND after metadata and before capture`, async () => {
        const expected = {
            ...window,
            foregroundHwnd: condition === 'foreground-normal' ? 120 : 300,
            isIconic: condition === 'minimized',
            showCmd: condition === 'minimized' ? 2 : 4,
        };
        const io = boundary({ windows: [[window], [expected], [expected]], duringWindow: [expected] });
        const result = await runScreenshotTimeoutProbe(
            { ...fixture, windowCondition: condition },
            'C:/Evidence/shot.png',
            io.adapter,
        );
        assert.equal(result.outcome, 'success');
        assert.deepEqual(io.transitions, [{ condition, handle: 120 }]);
        assert.deepEqual(io.sequence.slice(3, 9), [
            'evaluate_script',
            'evaluate_script',
            'evaluate_script',
            'sample',
            'condition',
            'sample',
        ]);
        assert.equal(result.observations.ok, true);
        assert.equal(io.counts().closed, 1);
    });
}

test('malformed native conditions are rejected before acquisition', async () => {
    for (const windowCondition of [null, true, 'background', '', {}, ['minimized']]) {
        const io = boundary();
        await assert.rejects(
            runScreenshotTimeoutProbe({ ...fixture, windowCondition }, 'C:/Evidence/shot.png', io.adapter),
        );
        assert.deepEqual(io.counts(), { opened: 0, closed: 0 });
    }
});

test('controlled capture without any during-window observation retains the screenshot but blocks required evidence', async () => {
    const expected = { ...window, foregroundHwnd: 300 };
    const io = boundary({ windows: [[window], [expected], [expected]] });
    const result = await runScreenshotTimeoutProbe(
        { ...fixture, windowCondition: 'background-normal' },
        'C:/Evidence/shot.png',
        io.adapter,
    );
    assert.equal(result.outcome, 'blocked-evidence');
    assert.equal(result.capture?.outcome, 'success');
    assert.equal(result.observations.errors[0]?.kind, 'native-during');
});

test('controlled condition refuses mismatched process identity before any mutation', async () => {
    for (const changed of [
        { processId: 4101 },
        { startedAtUtc: '2026-10-05T00:00:00.0000002Z' },
        { executablePath: 'C:/Other/chrome.exe' },
        { handle: 0 },
    ]) {
        const io = boundary({ windows: [[{ ...window, ...changed }]] });
        const result = await runScreenshotTimeoutProbe(
            { ...fixture, windowCondition: 'background-normal' },
            'C:/Evidence/shot.png',
            io.adapter,
        );
        assert.equal(result.outcome, 'blocked-evidence');
        assert.deepEqual(io.transitions, []);
        assert.equal(
            io.calls.some((call) => call.name === 'take_screenshot'),
            false,
        );
        assert.equal(io.counts().closed, 1);
    }
});

test('failed native transition blocks capture and preserves normal Close', async () => {
    for (const changed of [
        { actionAccepted: false, nativeError: 5 },
        { stateReached: false },
        { handle: 121 },
        { foregroundHwnd: 120 },
        { isIconic: true, showCmd: 2 },
    ]) {
        const io = boundary({ conditionResult: [{ ...window, foregroundHwnd: 300, ...changed }] });
        const result = await runScreenshotTimeoutProbe(
            { ...fixture, windowCondition: 'background-normal' },
            'C:/Evidence/shot.png',
            io.adapter,
        );
        assert.equal(result.outcome, 'blocked-evidence');
        assert.equal(
            io.calls.some((call) => call.name === 'take_screenshot'),
            false,
        );
        assert.equal(io.counts().closed, 1);
    }
});

for (const phase of ['before', 'during', 'after'] as const) {
    test(`background condition loss ${phase} capture invalidates required evidence`, async () => {
        const expected = { ...window, foregroundHwnd: 300 };
        const lost = { ...window, foregroundHwnd: 120 };
        const io = boundary({
            windows: [[window], [phase === 'before' ? lost : expected], [phase === 'after' ? lost : expected]],
            duringWindow: [phase === 'during' ? lost : expected],
        });
        const result = await runScreenshotTimeoutProbe(
            { ...fixture, windowCondition: 'background-normal' },
            'C:/Evidence/shot.png',
            io.adapter,
        );
        assert.equal(result.outcome, 'blocked-evidence');
        assert.equal(io.calls.filter((call) => call.name === 'take_screenshot').length, phase === 'before' ? 0 : 1);
        if (phase !== 'before') {
            assert.equal(result.capture?.outcome, 'success');
            assert.ok(result.capture?.result);
            assert.equal(result.observations.ok, false);
            assert.equal(result.observations.errors[0]?.kind, `native-${phase}`);
        }
    });
}

for (const recoveryCapture of [false, true]) {
    test(`passive sampling failure invalidates observations while preserving ${recoveryCapture ? 'quarantine' : 'successful capture'}`, async () => {
        const io = boundary({ duringFailure: true, recoveryCapture });
        const result = await runScreenshotTimeoutProbe(fixture, 'C:/Evidence/shot.png', io.adapter);
        assert.equal(result.outcome, recoveryCapture ? 'recovery-required' : 'blocked-evidence');
        assert.equal(result.capture?.outcome, recoveryCapture ? 'recovery-required' : 'success');
        assert.ok(result.capture?.result);
        assert.equal(result.observations.ok, false);
        assert.deepEqual(result.observations.errors, [
            { kind: 'native-during', error: 'Passive native sampler unavailable' },
        ]);
        assert.equal(io.calls.filter((call) => call.name === 'take_screenshot').length, 1);
        assert.equal(io.counts().closed, 1);
    });
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

// biome-ignore lint/suspicious/noTemplateCurlyInString: Exercise a literal production launch substitution token.
for (const token of ['%DCT_PROBE_ESCAPE%', '${DCT_PROBE_ESCAPE}']) {
    test(`evidence directory ${token} cannot introduce a profile substitution before acquisition`, async () => {
        const io = boundary();
        await assert.rejects(
            runScreenshotTimeoutProbe(fixture, `C:/Fresh/${token}/readme-background-AbCd12/screenshot.png`, io.adapter),
        );
        assert.deepEqual(io.counts(), { opened: 0, closed: 0 });
    });
}

test('legitimate evidence directory preserves the explicitly expanded launch argv', async () => {
    const io = boundary();
    await runScreenshotTimeoutProbe(
        {
            ...fixture,
            launch: {
                executable: 'C:/Fixture/chrome.exe',
                args: ['--user-data-dir={fixture}/profile', '--no-first-run', '--disable-features=ChromeAppInstaller'],
            },
        },
        'C:/Fresh/readme-background-AbCd12/screenshot.png',
        io.adapter,
    );
    assert.deepEqual(io.acquiredFixtures[0]?.launch, {
        executable: 'C:/Fixture/chrome.exe',
        args: [
            '--user-data-dir=C:/Fresh/readme-background-AbCd12/profile',
            '--no-first-run',
            '--disable-features=ChromeAppInstaller',
        ],
    });
    assert.equal(io.counts().opened, 1);
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
