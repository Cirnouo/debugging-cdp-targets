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
import { isRecord } from '../src/shared/errors.ts';

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

test('window assertions reject accepted requests without an observed transition and stale identity', async () => {
    const { readWindowSample, assertWindowState } = await import('./smoke/window-evidence.ts');
    const sample = readWindowSample([windowFixture()], expectedWindow);
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

test('window evidence proves minimize and restore on the same owned disposable window', {
    skip: process.platform !== 'win32',
    timeout: 45_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-window-evidence-'));
    const native = createWindowsLauncher();
    let identity: ProcessTarget | undefined;
    try {
        const executable = path.join(directory, 'window.exe');
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
            env: { SystemRoot: process.env.SystemRoot ?? 'C:/Windows', DCT_TEST_WINDOW_LIFETIME_MS: '30000' },
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
        const sample = async (state: string, handle?: number) => {
            const result = await promisify(execFile)(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    fileURLToPath(new URL('./smoke/windows-window-evidence.ps1', import.meta.url)),
                    '-ApplicationPid',
                    String(child.pid),
                    '-State',
                    state,
                    '-ExecutablePath',
                    executable,
                    '-StartedAtUtc',
                    child.startedAtUtc,
                    ...(handle === undefined ? [] : ['-WindowHandle', String(handle)]),
                ],
                { windowsHide: true, shell: false },
            );
            const value: unknown = JSON.parse(result.stdout);
            assert.ok(Array.isArray(value));
            const windows = value.filter(isRecord).filter((item) => item.child === false && item.visible === true);
            assert.equal(windows.length, 1);
            const window = windows[0];
            assert.ok(window && typeof window.handle === 'number');
            return window;
        };
        const initial = await sample('None');
        assert.equal(initial.isIconic, false);
        const minimized = await sample('Minimize', Number(initial.handle));
        assert.equal(minimized.actionAccepted, true);
        assert.equal(minimized.stateReached, true);
        assert.equal(minimized.nativeError, 0);
        assert.equal(minimized.isIconic, true);
        assert.equal(minimized.processId, child.pid);
        assert.equal(minimized.handle, initial.handle);
        const restored = await sample('Restore', Number(initial.handle));
        assert.equal(restored.actionAccepted, true);
        assert.equal(restored.stateReached, true);
        assert.equal(restored.isIconic, false);
        assert.equal(restored.handle, initial.handle);
        await assert.rejects(sample('Minimize', 1), /window|handle/i);
    } finally {
        if (identity) await native.close(identity);
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-window-evidence-'));
        await rm(directory, { recursive: true, force: true });
    }
});
