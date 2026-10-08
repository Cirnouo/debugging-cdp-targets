import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScreenshotBackgroundAnchor } from './smoke/screenshot-background-anchor.ts';

const chrome = {
    processId: 4100,
    executablePath: 'C:/Fixture/chrome.exe',
    startedAtUtc: '2026-10-05T00:00:00.0000001Z',
};
const anchor = {
    processId: 4200,
    executablePath: 'C:/Fixture/anchor.exe',
    startedAtUtc: '2026-10-05T00:00:01.0000001Z',
};
const window = (identity: typeof chrome, handle: number, foregroundHwnd: number) => ({
    ...identity,
    actualExecutablePath: identity.executablePath,
    handle,
    foregroundHwnd,
    child: false,
    visible: true,
    x: 10,
    y: 20,
    width: 1280,
    height: 900,
    isIconic: false,
    showCmd: 1,
    actionAccepted: null,
    nativeError: 0,
    stateReached: true,
});

function boundary(
    changed: {
        initial?: unknown;
        foreground?: unknown;
        target?: unknown;
        background?: unknown;
        passive?: unknown;
        closeFails?: boolean;
    } = {},
) {
    const calls: string[] = [];
    const records: { kind: string; value: unknown }[] = [];
    let targetSamples = 0;
    let anchorSamples = 0;
    const control = createScreenshotBackgroundAnchor({
        async launch(bounds) {
            assert.deepEqual(bounds, { x: 10, y: 20, width: 1280, height: 900 });
            calls.push('launch');
            return anchor;
        },
        async sample(identity, handle) {
            calls.push(`sample:${identity.processId}:${handle ?? 'discover'}`);
            return identity.processId === 4200
                ? anchorSamples++ === 0
                    ? (changed.initial ?? [window(anchor, 200, 120)])
                    : (changed.passive ?? [window(anchor, 200, 200)])
                : targetSamples++ === 0
                  ? [window(chrome, 120, 120)]
                  : (changed.target ?? [window(chrome, 120, 200)]);
        },
        async foreground(identity, handle) {
            calls.push(`foreground:${identity.processId}:${handle}`);
            return changed.foreground ?? [{ ...window(anchor, 200, 200), actionAccepted: true }];
        },
        async background(identity, handle) {
            calls.push(`background:${identity.processId}:${handle}`);
            return changed.background ?? [{ ...window(chrome, 120, 200), actionAccepted: true }];
        },
        async close(identity) {
            calls.push(`close:${identity.processId}`);
            if (changed.closeFails) throw new Error('Anchor normal Close failed');
            return { processExited: true, exitCode: 0 };
        },
        async record(kind, value) {
            records.push({ kind, value });
        },
    });
    return { control, calls, records };
}

test('owned anchor handoff verifies both identities and foregrounds only the related anchor before background mutation', async () => {
    const io = boundary();
    const result = await io.control.prepare(chrome, 120);
    assert.deepEqual(result, [{ ...window(chrome, 120, 200), actionAccepted: true }]);
    assert.deepEqual(io.calls, [
        'sample:4100:120',
        'launch',
        'sample:4200:discover',
        'foreground:4200:200',
        'sample:4100:120',
        'background:4100:120',
    ]);
    await io.control.cleanup();
    assert.equal(io.calls.at(-1), 'close:4200');
    assert.equal(
        io.records.some((record) => record.kind === 'anchor-handoff'),
        true,
    );
});

for (const changed of [
    { processId: 4201 },
    { executablePath: 'C:/Other/anchor.exe' },
    { startedAtUtc: '2026-10-05T00:00:01.0000002Z' },
    { handle: 0 },
]) {
    test(`anchor identity refusal before foreground mutation ${JSON.stringify(changed)}`, async () => {
        const io = boundary({ initial: [{ ...window(anchor, 200, 120), ...changed }] });
        await assert.rejects(io.control.prepare(chrome, 120));
        assert.deepEqual(io.calls, ['sample:4100:120', 'launch', 'sample:4200:discover']);
        await io.control.cleanup();
        assert.equal(io.calls.at(-1), 'close:4200');
    });
}

test('denied anchor foreground and stale target refuse background mutation and retain anchor cleanup', async () => {
    for (const changed of [
        { foreground: [{ ...window(anchor, 200, 120), actionAccepted: false, nativeError: 5 }] },
        { foreground: [window(anchor, 201, 201)] },
        { target: [window(chrome, 121, 200)] },
        { target: [{ ...window(chrome, 120, 200), isIconic: true, showCmd: 2 }] },
        { target: [window(chrome, 120, 120)] },
        { foreground: [{ ...window(anchor, 200, 200), width: 1000 }] },
    ]) {
        const io = boundary(changed);
        await assert.rejects(io.control.prepare(chrome, 120));
        assert.equal(
            io.calls.some((call) => call.startsWith('background:')),
            false,
        );
        await io.control.cleanup();
        assert.equal(io.calls.at(-1), 'close:4200');
    }
});

test('lost anchor handoff after background mutation refuses state proof', async () => {
    const io = boundary({ background: [window(chrome, 120, 120)] });
    await assert.rejects(io.control.prepare(chrome, 120));
    await io.control.cleanup();
});

test('anchor cleanup uncertainty blocks another acquisition and retains the normal Close identity', async () => {
    const io = boundary({ closeFails: true });
    await io.control.prepare(chrome, 120);
    await assert.rejects(io.control.cleanup(), /normal Close failed/);
    await assert.rejects(io.control.prepare(chrome, 120), /cleanup|already/i);
    assert.equal(io.calls.filter((call) => call === 'launch').length, 1);
    await assert.rejects(io.control.cleanup(), /normal Close failed/);
    assert.equal(io.calls.filter((call) => call === 'close:4200').length, 2);
});

test('passive anchor observation rejects identity, foreground or geometric coverage loss without refocusing', async () => {
    for (const passive of [
        [window(anchor, 201, 201)],
        [window(anchor, 200, 120)],
        [{ ...window(anchor, 200, 200), width: 1000 }],
    ]) {
        const io = boundary({ passive });
        await io.control.prepare(chrome, 120);
        await assert.rejects(io.control.observe(chrome, 120));
        assert.equal(io.calls.filter((call) => call.startsWith('foreground:')).length, 1);
        assert.equal(io.calls.filter((call) => call.startsWith('background:')).length, 1);
        await io.control.cleanup();
    }
});
