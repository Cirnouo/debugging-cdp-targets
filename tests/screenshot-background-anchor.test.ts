import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWindowsLauncher } from '../src/adapters/windows-launch.ts';
import type { ProcessTarget } from '../src/domains/cdp-target.ts';
import { createScreenshotBackgroundAnchor } from './smoke/screenshot-background-anchor.ts';
import { closeEvery } from './smoke/screenshot-fixture.ts';
import { sampleWindow, type WindowBounds, type WindowIdentity } from './smoke/window-evidence.ts';

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

test('actual owned opaque anchor covers native target bounds and hands off foreground with normal exit cleanup', {
    skip: process.platform !== 'win32',
    timeout: 90_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-owned-anchor-'));
    const native = createWindowsLauncher();
    let target: ProcessTarget | undefined;
    const markers: string[] = [];
    const identities: ProcessTarget[] = [];
    const records: { kind: string; value: unknown }[] = [];
    const executable = path.join(directory, 'anchor-窗口.exe');
    const start = async (bounds: WindowBounds) => {
        const marker = path.join(directory, `shown-${markers.length}`);
        markers.push(marker);
        const child = await native.launch({
            executablePath: executable,
            arguments: [marker],
            cwd: directory,
            env: {
                SystemRoot: process.env.SystemRoot ?? 'C:/Windows',
                DCT_TEST_WINDOW_X: String(bounds.x),
                DCT_TEST_WINDOW_Y: String(bounds.y),
                DCT_TEST_WINDOW_WIDTH: String(bounds.width),
                DCT_TEST_WINDOW_HEIGHT: String(bounds.height),
                DCT_TEST_WINDOW_NO_EXPIRY: 'true',
            },
        });
        const identity: ProcessTarget = {
            processId: child.pid,
            executablePath: executable,
            startedAtUtc: child.startedAtUtc,
            targetKind: 'generic-cdp',
            port: 0,
        };
        identities.push(identity);
        const deadline = Date.now() + 8000;
        for (;;) {
            try {
                await readFile(marker);
                return identity;
            } catch (error) {
                if (Date.now() >= deadline) throw error;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
    };
    const run = async (identity: WindowIdentity, state: string, handle?: number) => {
        const output = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./smoke/windows-window-evidence.ps1', import.meta.url)),
                '-ApplicationPid',
                String(identity.processId),
                '-ExecutablePath',
                identity.executablePath,
                '-StartedAtUtc',
                identity.startedAtUtc,
                '-State',
                state,
                ...(handle === undefined ? [] : ['-WindowHandle', String(handle)]),
            ],
            { windowsHide: true, shell: false },
        );
        return JSON.parse(output.stdout) as unknown;
    };
    const controller = createScreenshotBackgroundAnchor({
        launch: start,
        sample: (identity, handle) => run(identity, 'None', handle),
        foreground: (identity, handle) => run(identity, 'Foreground', handle),
        background: (identity, handle) => run(identity, 'Background', handle),
        close: (identity) => native.close({ ...identity, targetKind: 'generic-cdp', port: 0 }),
        record: async (kind, value) => {
            records.push({ kind, value });
        },
    });
    try {
        await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./fixtures/compile-native-window.ps1', import.meta.url)),
                '-Output',
                executable,
            ],
            { windowsHide: true, shell: false },
        );
        target = await start({ x: 77, y: 99, width: 700, height: 400 });
        const before = await sampleWindow(target, 'None');
        assert.deepEqual(before.bounds, { x: 77, y: 99, width: 700, height: 400 });
        await controller.prepare(target, before.handle);
        const after = await sampleWindow(target, 'None', before.handle);
        assert.equal(after.isIconic, false);
        assert.notEqual(after.foregroundHwnd, before.handle);
        assert.equal(
            records.some((record) => record.kind === 'anchor-handoff'),
            true,
        );
    } finally {
        const results = await closeEvery([
            () => controller.cleanup(),
            ...identities
                .filter((identity) => identity.processId === target?.processId)
                .map((identity) => () => native.close(identity)),
        ]);
        assert.ok(
            results.every((result) => result.status === 'fulfilled'),
            JSON.stringify(results),
        );
        for (const marker of markers) assert.equal(await readFile(`${marker}.closed`, 'utf8'), 'normal-close');
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-owned-anchor-'));
        await rm(directory, { recursive: true, force: true });
    }
});
