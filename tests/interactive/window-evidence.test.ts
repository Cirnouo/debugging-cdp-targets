import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWindowsLauncher } from '../../src/adapters/windows-launch.ts';
import type { ProcessTarget } from '../../src/domains/cdp-target.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { createOwnedNativeFixtures } from '../fixtures/owned-native-fixtures.ts';
import { createScreenshotBackgroundAnchor } from '../smoke/screenshot-background-anchor.ts';
import { closeEvery } from '../smoke/screenshot-fixture.ts';
import type { WindowIdentity } from '../smoke/window-evidence.ts';
import { assertWindowState, readWindowSample, sampleWindow } from '../smoke/window-evidence.ts';

assert.equal(process.platform, 'win32', 'Interactive Windows tests require Windows and an interactive desktop.');

test('controlled native background records NOACTIVATE transitions and preserves Unicode stdout', {
    timeout: 90_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-window-condition-'));
    const native = createWindowsLauncher();
    const executable = path.join(directory, '窗口-résumé-Ελληνικά-😀.exe');
    const markers: string[] = [];
    const readyMarkers = new Map<number, string>();
    const records: { kind: string; value: unknown }[] = [];
    const fixtures = createOwnedNativeFixtures({
        async launch(bounds) {
            const marker = path.join(directory, `shown-${markers.length}`);
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
                    DCT_TEST_WINDOW_LIFETIME_MS: '120000',
                },
            });
            markers.push(marker);
            const identity: WindowIdentity = {
                processId: child.pid,
                executablePath: executable,
                startedAtUtc: child.startedAtUtc,
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
    const run = (identity: WindowIdentity, state: string, handle?: number, changed: Partial<WindowIdentity> = {}) =>
        promisify(execFile)(
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
                changed.executablePath ?? identity.executablePath,
                '-StartedAtUtc',
                changed.startedAtUtc ?? identity.startedAtUtc,
                '-State',
                state,
                ...(handle === undefined ? [] : ['-WindowHandle', String(handle)]),
            ],
            { windowsHide: true, shell: false, encoding: 'buffer' },
        );
    const sample = async (identity: WindowIdentity, state: string, handle?: number) =>
        JSON.parse((await run(identity, state, handle)).stdout.toString('utf8')) as unknown;
    const controller = createScreenshotBackgroundAnchor({
        launch: fixtures.start,
        sample: (identity, handle) => sample(identity, 'None', handle),
        foreground: (identity, handle) => sample(identity, 'Foreground', handle),
        background: (identity, handle) => sample(identity, 'Background', handle),
        close: fixtures.close,
        record: async (kind, value) => {
            records.push({ kind, value });
        },
    });
    try {
        const compilation = await promisify(execFile)(
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
        const compiled: unknown = JSON.parse(compilation.stdout);
        assert.ok(isRecord(compiled) && typeof compiled.shortPath === 'string');
        const shortFile = await stat(compiled.shortPath, { bigint: true });
        const executableFile = await stat(executable, { bigint: true });
        assert.deepEqual(
            { dev: shortFile.dev, ino: shortFile.ino },
            { dev: executableFile.dev, ino: executableFile.ino },
        );
        const selected = await fixtures.start({ x: 77, y: 99, width: 320, height: 120 });
        const initial = await sampleWindow(selected, 'None');
        for (const state of ['Foreground', 'Background', 'Minimize']) {
            await assert.rejects(
                run(selected, state, initial.handle, { executablePath: path.join(directory, 'foreign.exe') }),
                /executable identity changed/i,
            );
            await assert.rejects(
                run(selected, state, initial.handle, {
                    startedAtUtc: selected.startedAtUtc.replace(
                        /(\d)Z$/,
                        (_, digit: string) => `${digit === '9' ? '8' : Number(digit) + 1}Z`,
                    ),
                }),
                /creation time changed/i,
            );
            await assert.rejects(run(selected, state, 1), /window|handle/i);
            assertWindowState(await sampleWindow(selected, 'None', initial.handle), 'normal', initial);
        }
        const foregroundRaw = await sample(selected, 'Foreground', initial.handle);
        const foreground = readWindowSample(foregroundRaw, selected, initial.handle);
        assertWindowState(foreground, 'normal', initial);
        assert.equal(foreground.foregroundHwnd, initial.handle);
        await assert.rejects(
            run(selected, 'Background', initial.handle),
            /requires an already normal background owned window/i,
        );
        await controller.prepare(selected, initial.handle);
        const handoff = records.find((record) => record.kind === 'anchor-handoff')?.value;
        assert.ok(isRecord(handoff) && isRecord(handoff.anchor) && isRecord(handoff.target));
        assert.notEqual(handoff.anchor.processId, selected.processId);
        assert.equal(handoff.anchor.foregroundHwnd, handoff.anchor.handle);
        assert.equal(handoff.target.foregroundHwnd, handoff.anchor.handle);
        await controller.observe(selected, initial.handle);
        const backgroundOutput = await run(selected, 'Background', initial.handle);
        assert.notDeepEqual([...backgroundOutput.stdout.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
        assert.ok(backgroundOutput.stdout.includes(Buffer.from(path.basename(executable), 'utf8')));
        const backgroundRaw: unknown = JSON.parse(backgroundOutput.stdout.toString('utf8'));
        const background = readWindowSample(backgroundRaw, selected, initial.handle);
        assert.equal(background.stateReached, true, JSON.stringify(backgroundRaw));
        assertWindowState(background, 'normal', initial);
        assert.notEqual(background.foregroundHwnd, initial.handle);
        assert.equal(background.foregroundHwnd, handoff.anchor.handle);
        assert.ok(Array.isArray(backgroundRaw));
        const root = backgroundRaw.find((item: unknown) => isRecord(item) && item.handle === initial.handle);
        assert.ok(isRecord(root) && Array.isArray(root.transitions));
        assert.deepEqual(
            root.transitions.map((step: unknown) => (isRecord(step) ? step.action : undefined)),
            ['bottom-noactivate'],
        );
        for (const step of root.transitions) {
            assert.ok(isRecord(step) && isRecord(step.before) && isRecord(step.after));
            for (const sample of [step.before, step.after]) {
                assert.equal(sample.handle, initial.handle);
                assert.equal(sample.processId, selected.processId);
                assert.equal(sample.executablePath, executable);
                assert.equal(sample.startedAtUtc, selected.startedAtUtc);
                assert.equal(typeof sample.foregroundHwnd, 'number');
            }
            assert.equal(step.actionAccepted, true);
            assert.equal(step.stateReached, true);
        }
        const passive = await run(selected, 'None', initial.handle);
        const passiveRaw: unknown = JSON.parse(passive.stdout.toString('utf8'));
        const passiveSample = readWindowSample(passiveRaw, selected, initial.handle);
        assert.equal(passiveSample.actionAccepted, null);
        assertWindowState(passiveSample, 'normal', background);
        assert.notEqual(passiveSample.foregroundHwnd, initial.handle);
        const minimizedRaw: unknown = JSON.parse(
            (await run(selected, 'Minimize', initial.handle)).stdout.toString('utf8'),
        );
        assertWindowState(readWindowSample(minimizedRaw, selected, initial.handle), 'minimized', initial);
        const stillMinimized = await sampleWindow(selected, 'None', initial.handle);
        assertWindowState(stillMinimized, 'minimized', initial);
        assert.equal(stillMinimized.actionAccepted, null);
    } finally {
        const results = await closeEvery([() => controller.cleanup()]);
        results.push(...(await fixtures.cleanup()));
        assert.ok(
            results.every((result) => result.status === 'fulfilled'),
            JSON.stringify(results),
        );
        for (const marker of markers) assert.equal(await readFile(`${marker}.closed`, 'utf8'), 'normal-close');
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-window-condition-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('passive selected-tab observer preserves Unicode window title in actual PowerShell JSON stdout', {
    timeout: 60_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-window-unicode-'));
    const native = createWindowsLauncher();
    let identity: ProcessTarget | undefined;
    const title = '新建标签页 · résumé · Ελληνικά · 😀';
    try {
        const executable = path.join(directory, 'unicode-window.exe');
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
        const marker = path.join(directory, 'shown');
        const child = await native.launch({
            executablePath: executable,
            arguments: [marker],
            cwd: directory,
            env: {
                SystemRoot: process.env.SystemRoot ?? 'C:/Windows',
                DCT_TEST_WINDOW_TITLE: title,
                DCT_TEST_WINDOW_LIFETIME_MS: '60000',
            },
        });
        identity = {
            processId: child.pid,
            executablePath: executable,
            startedAtUtc: child.startedAtUtc,
            targetKind: 'generic-cdp',
            port: 0,
        };
        const deadline = Date.now() + 8000;
        for (;;) {
            try {
                await readFile(marker);
                break;
            } catch (error) {
                if (Date.now() >= deadline) throw error;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
        const before = await sampleWindow(identity, 'None');
        assertWindowState(before, 'normal');
        const output = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('../smoke/windows-selected-tab-evidence.ps1', import.meta.url)),
                '-ApplicationPid',
                String(identity.processId),
                '-ExecutablePath',
                identity.executablePath,
                '-StartedAtUtc',
                identity.startedAtUtc,
                '-WindowHandle',
                String(before.handle),
            ],
            { windowsHide: true, shell: false, encoding: 'buffer' },
        );
        const observed: unknown = JSON.parse(output.stdout.toString('utf8'));
        assert.ok(isRecord(observed));
        assert.equal(observed.windowTitle, title);
        assert.equal(observed.ownedHwnd, before.handle);
        const after = await sampleWindow(identity, 'None', before.handle);
        assertWindowState(after, 'normal', before);
    } finally {
        if (identity) await native.close(identity);
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-window-unicode-'));
        await rm(directory, { recursive: true, force: true });
    }
});

for (const executableIdentity of ['long', 'short'] as const) {
    test(`window evidence proves minimize and restore using ${executableIdentity} owned executable identity`, {
        timeout: 90_000,
    }, async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-window-evidence-'));
        const native = createWindowsLauncher();
        let identity: ProcessTarget | undefined;
        try {
            const compiledExecutable = path.join(directory, 'window-evidence-fixture.exe');
            const compilation = await promisify(execFile)(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    fileURLToPath(new URL('../fixtures/compile-native-window.ps1', import.meta.url)),
                    '-Output',
                    compiledExecutable,
                ],
                { windowsHide: true, shell: false },
            );
            const evidence: unknown = JSON.parse(compilation.stdout);
            assert.ok(isRecord(evidence) && typeof evidence.shortPath === 'string');
            assert.equal(evidence.requiresElevation, false);
            const executable = executableIdentity === 'short' ? evidence.shortPath : compiledExecutable;
            if (executableIdentity === 'short') {
                assert.notEqual(
                    executable.toLowerCase(),
                    compiledExecutable.toLowerCase(),
                    'A real 8.3 alias is required.',
                );
                assert.match(executable, /~\d/);
            }
            const marker = path.join(directory, 'shown');
            const child = await native.launch({
                executablePath: executable,
                arguments: [marker],
                cwd: directory,
                env: { SystemRoot: process.env.SystemRoot ?? 'C:/Windows', DCT_TEST_WINDOW_LIFETIME_MS: '60000' },
            });
            identity = {
                processId: child.pid,
                executablePath: executable,
                startedAtUtc: child.startedAtUtc,
                targetKind: 'generic-cdp',
                port: 0,
            };
            const deadline = Date.now() + 8000;
            for (;;) {
                try {
                    await readFile(marker);
                    break;
                } catch (error) {
                    if (Date.now() >= deadline) throw error;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            }
            const sample = (
                state: 'None' | 'Minimize' | 'Restore',
                handle?: number,
                changed?: Partial<WindowIdentity>,
            ) =>
                sampleWindow(
                    { processId: child.pid, executablePath: executable, startedAtUtc: child.startedAtUtc, ...changed },
                    state,
                    handle,
                );
            const initial = await sample('None');
            assert.ok('actualExecutablePath' in initial && typeof initial.actualExecutablePath === 'string');
            const actualFile = await stat(initial.actualExecutablePath, { bigint: true });
            const compiledFile = await stat(compiledExecutable, { bigint: true });
            assert.ok(actualFile.ino > 0n, 'Native executable evidence requires a real file identity.');
            assert.deepEqual(
                { dev: actualFile.dev, ino: actualFile.ino },
                { dev: compiledFile.dev, ino: compiledFile.ino },
            );
            assert.equal(initial.executablePath, executable);
            assert.equal(initial.isIconic, false);
            assertWindowState(initial, 'normal');
            assert.match(child.startedAtUtc, /\.\d{7}Z$/);
            const changedCreationTime = child.startedAtUtc.replace(
                /(\d)Z$/,
                (_, digit: string) => `${digit === '9' ? '8' : Number(digit) + 1}Z`,
            );
            await assert.rejects(
                sample('Minimize', initial.handle, { executablePath: path.join(directory, 'unrelated.exe') }),
                /executable identity changed/i,
            );
            await assert.rejects(
                sample('Minimize', initial.handle, { startedAtUtc: changedCreationTime }),
                /creation time changed/i,
            );
            await assert.rejects(sample('Minimize', 1), /window|handle/i);
            const unchanged = await sample('None', initial.handle);
            assertWindowState(unchanged, 'normal', initial);
            assert.equal(child.exitCode, null);
            const minimized = await sample('Minimize', Number(initial.handle));
            assert.equal(minimized.actionAccepted, true);
            assert.equal(minimized.stateReached, true);
            assert.equal(minimized.nativeError, 0);
            assert.equal(minimized.isIconic, true);
            assert.equal(minimized.processId, child.pid);
            assert.equal(minimized.handle, initial.handle);
            assert.equal(minimized.actualExecutablePath, initial.actualExecutablePath);
            assertWindowState(minimized, 'minimized', initial);
            const restored = await sample('Restore', Number(initial.handle));
            assert.equal(restored.actionAccepted, true);
            assert.equal(restored.stateReached, true);
            assert.equal(restored.isIconic, false);
            assert.equal(restored.handle, initial.handle);
            assert.equal(restored.actualExecutablePath, initial.actualExecutablePath);
            assertWindowState(restored, 'normal', initial);
        } finally {
            if (identity) await native.close(identity);
            assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-window-evidence-'));
            await rm(directory, { recursive: true, force: true });
        }
    });
}
