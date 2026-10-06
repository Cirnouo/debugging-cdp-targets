import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWindowsLauncher } from '../src/adapters/windows-launch.ts';
import type { ProcessTarget } from '../src/domains/cdp-target.ts';
import { isRecord } from '../src/shared/errors.ts';
import type { WindowIdentity } from './smoke/window-evidence.ts';
import { assertWindowState, readWindowSample, sampleWindow } from './smoke/window-evidence.ts';

const windowFixture = () => ({
    handle: 120,
    processId: 4100,
    child: false,
    visible: true,
    executablePath: 'C:/Fixture/window.exe',
    startedAtUtc: '2026-10-05T00:00:00.000Z',
    isIconic: true,
    showCmd: 2,
    actionAccepted: true,
    nativeError: 0,
    stateReached: true,
});
const expectedWindow = {
    processId: 4100,
    executablePath: 'C:/Fixture/window.exe',
    startedAtUtc: '2026-10-05T00:00:00.000Z',
};

test('controlled native background records NOACTIVATE transitions and preserves Unicode stdout', {
    skip: process.platform !== 'win32',
    timeout: 90_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-window-condition-'));
    const native = createWindowsLauncher();
    let identity: ProcessTarget | undefined;
    try {
        const executable = path.join(directory, '窗口-résumé-Ελληνικά-😀.exe');
        const compilation = await promisify(execFile)(
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
        const compiled: unknown = JSON.parse(compilation.stdout);
        assert.ok(isRecord(compiled) && typeof compiled.shortPath === 'string');
        const shortFile = await stat(compiled.shortPath, { bigint: true });
        const executableFile = await stat(executable, { bigint: true });
        assert.deepEqual(
            { dev: shortFile.dev, ino: shortFile.ino },
            { dev: executableFile.dev, ino: executableFile.ino },
        );
        const marker = path.join(directory, 'shown');
        const child = await native.launch({
            executablePath: executable,
            arguments: [marker],
            cwd: directory,
            env: { SystemRoot: process.env.SystemRoot ?? 'C:/Windows', DCT_TEST_WINDOW_LIFETIME_MS: '120000' },
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
        const initial = await sampleWindow(identity, 'None');
        const selected = identity;
        const run = (state: string, handle: number, changed: Partial<WindowIdentity> = {}) =>
            promisify(execFile)(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    fileURLToPath(new URL('./smoke/windows-window-evidence.ps1', import.meta.url)),
                    '-ApplicationPid',
                    String(selected.processId),
                    '-ExecutablePath',
                    changed.executablePath ?? selected.executablePath,
                    '-StartedAtUtc',
                    changed.startedAtUtc ?? selected.startedAtUtc,
                    '-State',
                    state,
                    '-WindowHandle',
                    String(handle),
                ],
                { windowsHide: true, shell: false, encoding: 'buffer' },
            );
        for (const state of ['Foreground', 'Background', 'Minimize']) {
            await assert.rejects(
                run(state, initial.handle, { executablePath: path.join(directory, 'foreign.exe') }),
                /executable identity changed/i,
            );
            await assert.rejects(
                run(state, initial.handle, {
                    startedAtUtc: selected.startedAtUtc.replace(
                        /(\d)Z$/,
                        (_, digit: string) => `${digit === '9' ? '8' : Number(digit) + 1}Z`,
                    ),
                }),
                /creation time changed/i,
            );
            await assert.rejects(run(state, 1), /window|handle/i);
            assertWindowState(await sampleWindow(selected, 'None', initial.handle), 'normal', initial);
        }
        const backgroundOutput = await run('Background', initial.handle);
        assert.notDeepEqual([...backgroundOutput.stdout.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
        assert.ok(backgroundOutput.stdout.includes(Buffer.from(path.basename(executable), 'utf8')));
        const backgroundRaw: unknown = JSON.parse(backgroundOutput.stdout.toString('utf8'));
        const background = readWindowSample(backgroundRaw, selected, initial.handle);
        assert.equal(background.stateReached, true, JSON.stringify(backgroundRaw));
        assertWindowState(background, 'normal', initial);
        assert.notEqual(background.foregroundHwnd, initial.handle);
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
        const passive = await run('None', initial.handle);
        const passiveRaw: unknown = JSON.parse(passive.stdout.toString('utf8'));
        const passiveSample = readWindowSample(passiveRaw, selected, initial.handle);
        assert.equal(passiveSample.actionAccepted, null);
        assertWindowState(passiveSample, 'normal', background);
        assert.notEqual(passiveSample.foregroundHwnd, initial.handle);
        const minimizedRaw: unknown = JSON.parse((await run('Minimize', initial.handle)).stdout.toString('utf8'));
        assertWindowState(readWindowSample(minimizedRaw, selected, initial.handle), 'minimized', initial);
        const stillMinimized = await sampleWindow(selected, 'None', initial.handle);
        assertWindowState(stillMinimized, 'minimized', initial);
        assert.equal(stillMinimized.actionAccepted, null);
    } finally {
        if (identity) {
            await native.close(identity);
        }
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-window-condition-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('passive selected-tab observer preserves Unicode window title in actual PowerShell JSON stdout', {
    skip: process.platform !== 'win32',
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
                fileURLToPath(new URL('./fixtures/compile-native-window.ps1', import.meta.url)),
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
                fileURLToPath(new URL('./smoke/windows-selected-tab-evidence.ps1', import.meta.url)),
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

test('window assertions reject accepted requests without an observed transition and stale identity', async () => {
    const { readWindowSample, assertWindowState } = await import('./smoke/window-evidence.ts');
    const sample = readWindowSample([windowFixture()], expectedWindow);
    assert.equal(sample.actualExecutablePath, undefined);
    const actual = readWindowSample(
        [{ ...windowFixture(), actualExecutablePath: 'C:/FIXTUR~1/WINDOW.EXE' }],
        expectedWindow,
    );
    assert.equal(actual.actualExecutablePath, 'C:/FIXTUR~1/WINDOW.EXE');
    assert.equal(actual.executablePath, 'C:/Fixture/window.exe');
    assertWindowState(sample, 'minimized');
    for (const changed of [
        { isIconic: false, showCmd: 1 },
        { stateReached: false },
        { actionAccepted: false, nativeError: 5 },
        { showCmd: 1 },
        { nativeError: 5 },
    ]) {
        const value = readWindowSample([{ ...windowFixture(), ...changed }], expectedWindow);
        assert.throws(() => assertWindowState(value, 'minimized'));
    }
    for (const changed of [
        { processId: 4101 },
        { executablePath: 'C:/Other/window.exe' },
        { actualExecutablePath: 12 },
        { actualExecutablePath: '' },
        { startedAtUtc: '2026-10-05T00:00:01.000Z' },
        { isIconic: 'true' },
    ])
        assert.throws(() => readWindowSample([{ ...windowFixture(), ...changed }], expectedWindow));
    assert.throws(() =>
        readWindowSample([{ ...windowFixture(), startedAtUtc: '2026-10-05T00:00:00.0000002Z' }], {
            ...expectedWindow,
            startedAtUtc: '2026-10-05T00:00:00.0000001Z',
        }),
    );
    assert.throws(() => assertWindowState({ ...sample, isIconic: false, showCmd: 6 }, 'normal'));
    assert.throws(() => readWindowSample([], expectedWindow));
    assert.throws(() => readWindowSample([windowFixture(), { ...windowFixture(), handle: 121 }], expectedWindow));
    assert.throws(() => readWindowSample([windowFixture()], expectedWindow, 121));
    const replacement = readWindowSample([{ ...windowFixture(), handle: 121 }], expectedWindow);
    assert.throws(() => assertWindowState(replacement, 'minimized', sample));
    const readOnly = readWindowSample([{ ...windowFixture(), actionAccepted: null }], expectedWindow);
    assertWindowState(readOnly, 'minimized', sample);
});

for (const executableIdentity of ['long', 'short'] as const) {
    test(`window evidence proves minimize and restore using ${executableIdentity} owned executable identity`, {
        skip: process.platform !== 'win32',
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
                    fileURLToPath(new URL('./fixtures/compile-native-window.ps1', import.meta.url)),
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
