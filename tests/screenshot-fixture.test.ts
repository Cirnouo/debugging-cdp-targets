import assert from 'node:assert/strict';
import { test } from 'node:test';

const fixture = () => ({
    label: 'fixture',
    targetKind: 'generic-cdp',
    launch: {
        executable: 'C:/Fixture/app.exe',
        args: ['--user-data-dir={fixture}/profile', '--enable-features=Other:param/value', '--'],
    },
    candidateArgs: [
        '--user-data-dir={fixture}/profile',
        '--enable-features=Other:param/value,CDPScreenshotNewSurface',
        '--',
    ],
    pageTitle: 'Synthetic fixture',
    fixtureFiles: { 'workspace/Capture.txt': 'Synthetic only' },
});

test('screenshot fixture requires an explicit isolated single-feature comparison', async () => {
    const { parseScreenshotFixture } = await import('./smoke/screenshot-fixture.ts');
    assert.deepEqual(parseScreenshotFixture(fixture()).candidateArgs, fixture().candidateArgs);
    for (const candidateArgs of [
        [...fixture().candidateArgs, '--new-argument'],
        [
            '--user-data-dir={fixture}/profile',
            '--enable-features=Other:param/value',
            '--',
            '--enable-features=CDPScreenshotNewSurface',
        ],
        [
            '--user-data-dir={fixture}/profile',
            '--enable-features=Other:param/value',
            '--enable-features=CDPScreenshotNewSurface',
            '--',
        ],
        [
            '--user-data-dir={fixture}/profile',
            '--enable-features=Other:param/value,CDPScreenshotNewSurface:mode/value',
            '--',
        ],
    ])
        assert.throws(() => parseScreenshotFixture({ ...fixture(), candidateArgs }));
    for (const alternate of ['/enable-features=Other', '-enable-features=Other', '--ENABLE-FEATURES=Other']) {
        const args = ['--user-data-dir={fixture}/profile', alternate];
        assert.throws(() =>
            parseScreenshotFixture({
                ...fixture(),
                launch: { ...fixture().launch, args },
                candidateArgs: [...args, '--enable-features=CDPScreenshotNewSurface'],
            }),
        );
    }
    assert.throws(() =>
        parseScreenshotFixture({ ...fixture(), launch: { executable: 'C:/Fixture/app.exe', args: [] } }),
    );
    const disabled = {
        ...fixture(),
        launch: {
            ...fixture().launch,
            args: ['--user-data-dir={fixture}/profile', '--disable-features=CDPScreenshotNewSurface'],
        },
    };
    assert.throws(() =>
        parseScreenshotFixture({
            ...disabled,
            candidateArgs: [...disabled.launch.args, '--enable-features=CDPScreenshotNewSurface'],
        }),
    );
    for (const file of ['../escape', 'C:/escape', '/escape', 'workspace/../escape']) {
        assert.throws(() => parseScreenshotFixture({ ...fixture(), fixtureFiles: { [file]: 'data' } }));
    }
});

test('screenshot comparison rejects effective whitespace and field-trial target conflicts', async () => {
    const { parseScreenshotFixture } = await import('./smoke/screenshot-fixture.ts');
    for (const switch_ of [
        '--disable-features=Other, CDPScreenshotNewSurface',
        '--enable-features=Other,CDPScreenshotNewSurface.Group',
        ' --enable-features=Other',
        '--enable-features=Other ',
    ]) {
        const args = ['--user-data-dir={fixture}/profile', switch_];
        assert.throws(() =>
            parseScreenshotFixture({
                ...fixture(),
                launch: { ...fixture().launch, args },
                candidateArgs: [
                    args[0],
                    switch_.startsWith('--enable-features=') ? `${switch_},CDPScreenshotNewSurface` : switch_,
                    ...(!switch_.startsWith('--enable-features=') ? ['--enable-features=CDPScreenshotNewSurface'] : []),
                ],
            }),
        );
    }
    const valid = fixture();
    valid.launch.args[1] = '--enable-features= Other:param/value';
    valid.candidateArgs[1] = '--enable-features= Other:param/value,CDPScreenshotNewSurface';
    assert.equal(parseScreenshotFixture(valid).candidateArgs[1], valid.candidateArgs[1]);
});

test('screenshot diagnostics reject old, malformed, ambiguous and stale-session events', async () => {
    const { screenshotPhase } = await import('./smoke/screenshot-fixture.ts');
    const old = { sessionId: 'session', phase: 'cdp-screenshot', outcome: 'completed', elapsedMs: 50 };
    const anchor = { sessionId: 'session', phase: 'identity-check', outcome: 'completed', elapsedMs: 40 };
    const shot = { ...old, elapsedMs: 20 };
    assert.equal(screenshotPhase([old, anchor], [old, anchor, shot], 'session'), 20);
    assert.equal(screenshotPhase([anchor], [anchor, anchor, shot], 'session'), undefined);
    assert.equal(screenshotPhase([anchor], [shot], 'session'), undefined);
    for (const after of [
        [old, anchor],
        [old, anchor, { ...shot, elapsedMs: '20' }],
        [old, anchor, { ...shot, sessionId: 'stale' }],
    ])
        assert.throws(() => screenshotPhase([anchor], after, 'session'));
});

test('screenshot pixels prove fresh dimensions and color rather than file presence', async () => {
    const { assertPixels } = await import('./smoke/screenshot-fixture.ts');
    const evidence = { width: 320, height: 120, pixels: [{ x: 20, y: 90, r: 0, g: 255, b: 0, a: 255 }] };
    assertPixels(evidence, { width: 320, height: 120, points: [{ x: 20, y: 90 }], color: [0, 255, 0] });
    assert.throws(() =>
        assertPixels(
            { ...evidence, pixels: [{ ...evidence.pixels[0], a: 0 }] },
            { width: 320, height: 120, points: [{ x: 20, y: 90 }], color: [0, 255, 0] },
        ),
    );
    assert.throws(() =>
        assertPixels(
            { ...evidence, width: 1 },
            { width: 320, height: 120, points: [{ x: 20, y: 90 }], color: [0, 255, 0] },
        ),
    );
    assert.throws(() =>
        assertPixels(
            { ...evidence, pixels: [{ x: 20, y: 90, r: 255, g: 255, b: 0, a: 255 }] },
            { width: 320, height: 120, points: [{ x: 20, y: 90 }], color: [0, 255, 0] },
        ),
    );
    assert.throws(() =>
        assertPixels(
            { ...evidence, pixels: [] },
            { width: 320, height: 120, points: [{ x: 20, y: 90 }], color: [0, 255, 0] },
        ),
    );
});

test('fractional display geometry predicts the exact decoded viewport, fullPage and element dimensions', async () => {
    const { screenshotSize, assertPixels } = await import('./smoke/screenshot-fixture.ts');
    const geometry = {
        width: 1026,
        height: 802,
        fullWidth: 1026,
        fullHeight: 1042,
        dpr: 1.25,
        viewport: { x: 0, y: 0, width: 1025.5999755859375, height: 802.4000244140625 },
        content: { x: 0, y: 0, width: 1010.4000244140625, height: 1042 },
        element: { x: 8, y: 8, width: 320, height: 120 },
        visualViewport: { scale: 1, pageLeft: 0, pageTop: 0 },
    };
    for (const [shape, dimensions] of [
        ['viewport', { width: 1282, height: 1003 }],
        ['fullPage', { width: 1263, height: 1303 }],
        ['element', { width: 400, height: 150 }],
    ] as const) {
        const expected = screenshotSize(shape, geometry);
        assert.deepEqual(expected, dimensions);
        assertPixels({ ...dimensions, pixels: [] }, { ...expected, points: [], color: [255, 255, 0] });
        assert.throws(() =>
            assertPixels(
                { ...dimensions, width: dimensions.width + 1, pixels: [] },
                { ...expected, points: [], color: [255, 255, 0] },
            ),
        );
    }
    assert.deepEqual(
        screenshotSize('element', { ...geometry, element: { x: 8.4, y: 8.6, width: 320.4, height: 120.2 } }),
        { width: 401, height: 150 },
    );
});

test('later screenshot timeouts retain the same peer and stop before another capture', async () => {
    const { screenshotShapes } = await import('./smoke/screenshot-fixture.ts');
    for (const failedCell of ['B-fullPage', 'B-element', 'C-viewport', 'C-fullPage', 'C-element']) {
        const completed: string[] = [];
        const probes: string[] = [];
        let pending = false;
        const peer = {
            async read() {
                assert.equal(pending, true);
                await Promise.resolve();
                assert.equal(pending, true);
                probes.push(failedCell);
                return 'same connected peer';
            },
        };
        for (const phase of ['A', 'B', 'C']) {
            const timedOut = await screenshotShapes(phase, false, peer, async (shape, availablePeer) => {
                const cell = `${phase}-${shape}`;
                if (cell !== failedCell) {
                    completed.push(cell);
                    return { timeout: false };
                }
                pending = true;
                const screenshot = new Promise<{ timeout: boolean }>((resolve) => {
                    setImmediate(() => {
                        pending = false;
                        resolve({ timeout: true });
                    });
                });
                if (availablePeer) await availablePeer.read();
                return screenshot;
            });
            if (timedOut) break;
        }
        assert.deepEqual(probes, [failedCell], 'The first stalled later mode did not prove a pending peer.');
        assert.equal(completed.includes(failedCell), false);
        assert.equal(pending, false);
    }
});

test('normal baseline and all candidate timeouts cannot pass a minimized compatibility comparison', async () => {
    const { screenshotShapes } = await import('./smoke/screenshot-fixture.ts');
    for (const [phase, candidate, failAt] of [
        ['A', false, 'viewport'],
        ['A', false, 'fullPage'],
        ['A', false, 'element'],
        ['A', true, 'viewport'],
        ['B', true, 'fullPage'],
        ['C', true, 'element'],
    ] as const) {
        const captures: string[] = [];
        await assert.rejects(() =>
            screenshotShapes(phase, candidate, undefined, async (shape) => {
                captures.push(shape);
                return { timeout: shape === failAt };
            }),
        );
        assert.equal(captures.at(-1), failAt, 'Capture continued after an invalid timeout.');
    }
});

test('cell preparation explicitly restores only a confirmed initially minimized owned window', async () => {
    const { prepareScreenshotWindow } = await import('./smoke/screenshot-fixture.ts');
    const initial = {
        processId: 17,
        executablePath: 'C:/Fixture/app.exe',
        startedAtUtc: '2026-10-05T08:36:34.3639620Z',
        handle: 23,
        isIconic: true,
        showCmd: 2,
        actionAccepted: null,
        nativeError: 0,
        stateReached: true,
    };
    const normal = { ...initial, isIconic: false, showCmd: 9, actionAccepted: true };
    const restored = await prepareScreenshotWindow(initial, async (handle) => {
        assert.equal(handle, 23);
        return normal;
    });
    assert.deepEqual(restored, normal);
    assert.deepEqual(await prepareScreenshotWindow(normal, async () => assert.fail('Unrequested Restore')), normal);
    await assert.rejects(() => prepareScreenshotWindow(initial, async () => ({ ...normal, handle: 24 })));
    await assert.rejects(() => prepareScreenshotWindow(initial, async () => ({ ...initial, actionAccepted: true })));
    await assert.rejects(() =>
        prepareScreenshotWindow(initial, async () => ({ ...normal, actionAccepted: false, nativeError: 5 })),
    );
});

test('screenshot geometry rejects lost precision, unmeasured root overflow and viewport zoom', async () => {
    const { readScreenshotGeometry } = await import('./smoke/screenshot-fixture.ts');
    const observed = {
        dpr: 1.25,
        viewport: { x: 0, y: 0, width: 1025.5999755859375, height: 802.4000244140625 },
        root: { rect: { x: 0, y: 0, width: 1010.4000244140625, height: 1042 }, scrollWidth: 1010, scrollHeight: 1042 },
        element: { x: 8, y: 8, width: 320, height: 120 },
        visualViewport: { scale: 1, pageLeft: 0, pageTop: 0 },
    };
    assert.equal(readScreenshotGeometry(observed).viewport.width, 1025.5999755859375);
    for (const malformed of [
        { ...observed, dpr: Infinity },
        { ...observed, viewport: { ...observed.viewport, width: NaN } },
        { ...observed, root: { ...observed.root, scrollWidth: 1200 } },
        { ...observed, root: { ...observed.root, scrollHeight: 2000 } },
        { ...observed, visualViewport: { ...observed.visualViewport, scale: 1.2 } },
        { ...observed, visualViewport: { ...observed.visualViewport, pageTop: 10 } },
        { ...observed, root: { ...observed.root, rect: { ...observed.root.rect, y: -10 } } },
        { ...observed, element: { ...observed.element, width: 0 } },
    ])
        assert.throws(() => readScreenshotGeometry(malformed));
});

test('screenshot cleanup starts every peer even when one Close fails', async () => {
    const { closeEvery } = await import('./smoke/screenshot-fixture.ts');
    const visited: string[] = [];
    const results = await closeEvery([
        async () => {
            visited.push('failed');
            throw new Error('Normal Close refused');
        },
        async () => {
            visited.push('peer');
            return 'actual-exit';
        },
    ]);
    assert.deepEqual(visited, ['failed', 'peer']);
    assert.equal(results[0]?.status, 'rejected');
    assert.equal(results[1]?.status, 'fulfilled');
});
