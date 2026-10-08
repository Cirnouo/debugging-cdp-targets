import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWindowsLauncher } from '../src/adapters/windows-launch.ts';
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
