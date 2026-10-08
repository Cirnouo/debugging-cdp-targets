import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWindowsLauncher } from '../../src/adapters/windows-launch.ts';
import type { ProcessTarget } from '../../src/domains/cdp-target.ts';
import { createOwnedNativeFixtures } from '../fixtures/owned-native-fixtures.ts';
import { createScreenshotBackgroundAnchor } from '../smoke/screenshot-background-anchor.ts';
import { closeEvery } from '../smoke/screenshot-fixture.ts';
import { sampleWindow, type WindowIdentity } from '../smoke/window-evidence.ts';

assert.equal(process.platform, 'win32', 'Interactive Windows tests require Windows and an interactive desktop.');

test('actual owned opaque anchor covers native target bounds and hands off foreground with normal exit cleanup', {
    timeout: 90_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-owned-anchor-'));
    const native = createWindowsLauncher();
    const markers: string[] = [];
    const readyMarkers = new Map<number, string>();
    const records: { kind: string; value: unknown }[] = [];
    const executable = path.join(directory, 'anchor-窗口.exe');
    const fixtures = createOwnedNativeFixtures({
        async launch(bounds) {
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
            readyMarkers.set(identity.processId, marker);
            return identity;
        },
        async ready(identity) {
            const marker = readyMarkers.get(identity.processId);
            assert.ok(marker);
            const deadline = Date.now() + 8000;
            for (;;) {
                try {
                    await readFile(marker);
                    return;
                } catch (error) {
                    if (Date.now() >= deadline) throw error;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            }
        },
        close: (identity) => native.close({ ...identity, targetKind: 'generic-cdp', port: 0 }),
    });
    const run = async (identity: WindowIdentity, state: string, handle?: number) => {
        const output = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('../smoke/windows-window-evidence.ps1', import.meta.url)),
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
        launch: fixtures.start,
        sample: (identity, handle) => run(identity, 'None', handle),
        foreground: (identity, handle) => run(identity, 'Foreground', handle),
        background: (identity, handle) => run(identity, 'Background', handle),
        close: fixtures.close,
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
                fileURLToPath(new URL('../fixtures/compile-native-window.ps1', import.meta.url)),
                '-Output',
                executable,
            ],
            { windowsHide: true, shell: false },
        );
        const target = await fixtures.start({ x: 77, y: 99, width: 700, height: 400 });
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
        const results = await closeEvery([() => controller.cleanup()]);
        results.push(...(await fixtures.cleanup()));
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
