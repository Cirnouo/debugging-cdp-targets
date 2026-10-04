import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createTargetHost } from '../src/adapters/target-host.ts';
import { createWindowsLauncher } from '../src/adapters/windows-launch.ts';
import type { ProcessTarget } from '../src/domains/cdp-target.ts';
import { isRecord } from '../src/shared/errors.ts';

test('Windows snapshot uses limited-query identity when MainModule access is denied', {
    skip: process.platform !== 'win32',
    timeout: 20_000,
}, async () => {
    const result = await promisify(execFile)(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL('./fixtures/snapshot-limited-access.ps1', import.meta.url)),
        ],
        { windowsHide: true, shell: false },
    );
    const evidence: unknown = JSON.parse(result.stdout.trim());
    assert.ok(isRecord(evidence) && isRecord(evidence.root));
    assert.equal(evidence.ok, true);
    assert.equal(evidence.root.exists, true);
    assert.match(String(evidence.root.executablePath), /powershell.exe$/i);
    assert.ok(Number.isFinite(Date.parse(String(evidence.root.startedAtUtc))));
    assert.equal(evidence.root.sessionId, evidence.currentSessionId);
    assert.ok(Array.isArray(evidence.processIds) && evidence.processIds.length > 0);
});

test('Windows native helper launches a disposable process with exact argv, cwd, environment and exit evidence', {
    skip: process.platform !== 'win32',
    timeout: 20_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-test-'));
    try {
        const file = path.join(directory, 'evidence.json');
        const args = ['space here', '', '中文', 'literal & value', 'quote"backslash\\'];
        const child = await createWindowsLauncher().launch({
            executablePath: process.execPath,
            arguments: [fileURLToPath(new URL('./fixtures/native-child.ts', import.meta.url)), file, ...args],
            cwd: directory,
            env: {
                ...Object.fromEntries(
                    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
                ),
                DCT_TEST_NATIVE: 'space 中文 & "literal"',
            },
        });
        if (child.exitCode === null)
            await new Promise<void>((resolve, reject) => {
                child.once('exit', resolve);
                child.onMonitorError(() => reject(new Error('Native process observer exited early.')));
            });
        assert.equal(child.exitCode, 0);
        const evidence: unknown = JSON.parse(await readFile(file, 'utf8'));
        assert.ok(isRecord(evidence));
        assert.equal(evidence.pid, child.pid);
        assert.notEqual(evidence.parent, child.pid);
        assert.equal(evidence.cwd, directory);
        assert.deepEqual(evidence.args, args);
        assert.equal(evidence.environment, 'space 中文 & "literal"');
        assert.equal(evidence.inputEnded, true, 'Application stdin must be NUL, independent of the monitor protocol.');
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-native-test-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('Windows GUI launch preserves visibility and closes normally; native manifest inspection distinguishes elevation', {
    skip: process.platform !== 'win32',
    timeout: 30_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-test-'));
    const compile = async (level: 'asInvoker' | 'requireAdministrator') => {
        const executable = path.join(directory, `${level}.exe`);
        const result = await promisify(execFile)(
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
                '-Level',
                level,
            ],
            { windowsHide: true, shell: false },
        );
        const evidence: unknown = JSON.parse(result.stdout.trim());
        assert.ok(isRecord(evidence));
        assert.equal(evidence.requiresElevation, level === 'requireAdministrator' && !evidence.currentElevation);
        return executable;
    };
    try {
        const executable = await compile('asInvoker');
        await compile('requireAdministrator');
        const marker = path.join(directory, 'visible');
        const native = createWindowsLauncher();
        const child = await native.launch({
            executablePath: executable,
            arguments: [marker],
            cwd: directory,
            env: { DCT_TEST_NATIVE: 'GUI 中文', SystemRoot: process.env.SystemRoot ?? 'C:/Windows' },
        });
        const deadline = Date.now() + 8000;
        for (;;) {
            try {
                assert.equal(Buffer.from(await readFile(marker, 'utf8'), 'base64').toString('utf8'), 'GUI 中文');
                break;
            } catch (error) {
                if (Date.now() >= deadline) throw error;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
        const result = await native.close({
            processId: child.pid,
            executablePath: executable,
            startedAtUtc: child.startedAtUtc,
            targetKind: 'generic-cdp',
            port: 9222,
        });
        assert.equal(result.closeRequested, true);
        assert.equal(result.processExited, true);
        assert.equal(result.closed, true);
        assert.equal(await readFile(`${marker}.closed`, 'utf8'), 'normal-close');
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-native-test-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('native GUI discovery is verified against its real process, listener and endpoint', {
    skip: process.platform !== 'win32',
    timeout: 45_000,
}, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-test-'));
    const executable = path.join(directory, 'discovery.exe');
    const host = createTargetHost();
    let target: Awaited<ReturnType<typeof host.launch>> | undefined;
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
        target = await host.launch({
            launch: {
                executable,
                args: [path.join(directory, 'visible')],
                cwd: directory,
                env: { DCT_TEST_CDP_PORT: '{port}', DCT_TEST_WINDOW_LIFETIME_MS: '60000' },
            },
            basePort: 21422,
        });
        assert.equal(target.browserProduct, 'DCTFixture/1.0');
        assert.match(target.webSocketDebuggerUrl ?? '', /\/devtools\/browser\/disposable-native$/);
        assert.equal(await host.health(target), 'healthy');
        assert.equal(await host.close(target), true);
        assert.equal(await host.health(target), 'gone');
    } finally {
        if (target && (await host.health(target)) !== 'gone') await host.close(target, { requireListener: false });
        target?.child?.disposeMonitor?.();
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-native-test-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('Windows native close accepts short executable paths while rejecting changed path and creation time', {
    skip: process.platform !== 'win32',
    timeout: 45_000,
}, async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-test-'));
    const native = createWindowsLauncher();
    let child: Awaited<ReturnType<typeof native.launch>> | undefined;
    context.after(async () => {
        // A failed assertion must remain visible. The disposable fixture has its own
        // bounded normal-close timer; never force-kill it or remove a live app's cwd.
        const cleanup = new AbortController();
        const deadline = setTimeout(() => cleanup.abort(new Error('Fixture exit was not observed.')), 35_000);
        let releaseMonitoring: (() => void) | undefined;
        try {
            if (child?.exitCode === null) {
                const exited = once(child, 'exit', { signal: cleanup.signal });
                releaseMonitoring = child.onMonitorError(() => cleanup.abort(new Error('Fixture observer failed.')));
                await exited;
            }
            assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-native-test-'));
            await rm(directory, { recursive: true, force: true });
        } finally {
            clearTimeout(deadline);
            releaseMonitoring?.();
            child?.disposeMonitor();
        }
    });
    const executable = path.join(directory, 'short-path-native.exe');
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
    const evidence: unknown = JSON.parse(compilation.stdout.trim());
    assert.ok(isRecord(evidence) && typeof evidence.shortPath === 'string');
    if (evidence.shortPath.toLowerCase() === executable.toLowerCase()) {
        context.skip('The test filesystem does not expose an 8.3 alias.');
        return;
    }
    const marker = path.join(directory, 'visible');
    child = await native.launch({
        executablePath: evidence.shortPath,
        arguments: [marker],
        cwd: directory,
        env: { SystemRoot: process.env.SystemRoot ?? 'C:/Windows', DCT_TEST_WINDOW_LIFETIME_MS: '30000' },
    });
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
    const target: ProcessTarget = {
        processId: child.pid,
        executablePath: evidence.shortPath,
        startedAtUtc: child.startedAtUtc,
        targetKind: 'generic-cdp',
        port: 9222,
    };
    await assert.rejects(native.close({ ...target, executablePath: path.join(directory, 'unrelated.exe') }));
    await assert.rejects(native.close({ ...target, startedAtUtc: '2000-01-01T00:00:00.000Z' }));
    assert.equal(child.exitCode, null);
    await assert.rejects(readFile(`${marker}.closed`), { code: 'ENOENT' });
    const result = await native.close(target);
    assert.equal(result.closeRequested, true);
    assert.equal(result.processExited, true);
    assert.equal(result.closed, true);
    assert.equal(await readFile(`${marker}.closed`, 'utf8'), 'normal-close');
});
