import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWindowsLauncher } from '../src/adapters/windows-launch.ts';
import { isRecord } from '../src/shared/errors.ts';

async function waitForFile(directory: string, name: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const watcher = watch(directory);
    const abort = () => watcher.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
        await new Promise<void>((resolve, reject) => {
            const check = () => {
                void access(path.join(directory, name)).then(resolve, () => {});
            };
            watcher.on('change', check);
            watcher.on('error', reject);
            watcher.on('close', () => reject(signal?.reason ?? new Error('Fixture observation closed.')));
            check();
        });
    } finally {
        signal?.removeEventListener('abort', abort);
        watcher.close();
    }
}

for (const [mode, closed, error, queries, waits] of [
    ['zero-notification', true, 0, 3, 2],
    ['missing-notification', true, 0, 2, 1],
    ['cancel', false, 0, 2, 2],
    ['query-error', false, 5, 1, 0],
    ['port-error', false, 6, 1, 1],
    ['invalid-timeout', false, 258, 1, 1],
    ['acquisition-cancelled', true, 0, 3, 2],
    ['foreign-key', false, -1, 1, 1],
] as const) {
    test(`native resource accounting remains authoritative across ${mode}`, {
        skip: process.platform !== 'win32',
        timeout: 15_000,
    }, async () => {
        const { stdout } = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./fixtures/native-resource-boundary.ps1', import.meta.url)),
                '-Mode',
                mode,
            ],
            { windowsHide: true, shell: false },
        );
        const evidence: unknown = JSON.parse(stdout.trim());
        assert.ok(isRecord(evidence));
        assert.equal(evidence.closed, closed);
        assert.equal(evidence.error, error);
        assert.equal(evidence.queries, queries);
        assert.equal(evidence.waits, waits);
    });
}

for (const mode of [
    'foreign-pid',
    'foreign-time',
    'foreign-executable',
    'foreign-job',
    'stale-monitor',
    'local-dispose',
    'equivalent-slashes',
]) {
    test(`native resource handoff validates identity and closes only owned duplicates: ${mode}`, {
        skip: process.platform !== 'win32',
        timeout: 15_000,
    }, async () => {
        const { stdout } = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./fixtures/native-resource-identity.ps1', import.meta.url)),
                '-Mode',
                mode,
            ],
            { windowsHide: true, shell: false },
        );
        const evidence: unknown = JSON.parse(stdout.trim());
        assert.ok(isRecord(evidence));
        assert.equal(evidence.rejected, mode !== 'local-dispose' && mode !== 'equivalent-slashes');
        assert.equal(
            evidence.duplicateOpen,
            mode === 'foreign-job' || mode === 'stale-monitor' || mode === 'equivalent-slashes',
        );
        assert.equal(evidence.originalOpen, true);
        assert.equal(evidence.active, 0);
    });
}

for (const abandon of [false, true]) {
    test(`native resource group covers descendants created after root exit${abandon ? ' without kill on monitor close' : ''}`, {
        skip: process.platform !== 'win32',
        timeout: 20_000,
    }, async (t) => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-resources-'));
        const child = await createWindowsLauncher().launch({
            executablePath: process.execPath,
            arguments: [
                fileURLToPath(new URL('./fixtures/native-resource-child.ts', import.meta.url)),
                'root',
                directory,
            ],
            cwd: directory,
            env: Object.fromEntries(
                Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
        });
        try {
            if (child.exitCode === null)
                await new Promise<void>((resolve, reject) => {
                    child.once('exit', resolve);
                    child.onMonitorError(() => reject(new Error('Root observation failed.')));
                });
            assert.equal(child.exitCode, 0);
            let completed = false;
            const resources = child.waitForResourcesClosed().then(() => {
                completed = true;
            });
            void resources.catch(() => {});
            assert.equal(child.monitorDisposed, false);
            if (abandon) {
                child.disposeMonitor();
                await assert.rejects(resources);
            }
            await writeFile(path.join(directory, 'launch-late'), 'after actual root exit');
            await waitForFile(directory, 'late-ready', t.signal);
            assert.equal(completed, false);
            const latePid = Number(await readFile(path.join(directory, 'late-ready'), 'utf8'));
            const witness = execFile(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    fileURLToPath(new URL('./fixtures/native-resource-witness.ps1', import.meta.url)),
                    '-OwnedPid',
                    String(latePid),
                ],
                { windowsHide: true, shell: false },
            );
            let output = '';
            const witnessed = new Promise<void>((resolve, reject) => {
                witness.once('error', reject);
                witness.once('close', (code) => {
                    if (code !== 0) reject(new Error('Passive child witness failed.'));
                    else {
                        const receipt: unknown = JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? 'null');
                        assert.ok(isRecord(receipt));
                        assert.equal(receipt.pid, latePid);
                        assert.equal(receipt.exitCode, 0);
                        resolve();
                    }
                });
            });
            await new Promise<void>((resolve) => {
                witness.stdout?.on('data', (chunk: Buffer) => {
                    output += chunk.toString();
                    if (output.includes('\n')) resolve();
                });
            });
            await writeFile(path.join(directory, 'finish'), 'ordinary child exit');
            await waitForFile(directory, 'late-finished', t.signal);
            await witnessed;
            if (!abandon) await resources;
            assert.equal(child.exitCode, 0);
        } finally {
            await writeFile(path.join(directory, 'launch-late'), 'cleanup ordinary exit');
            await writeFile(path.join(directory, 'finish'), 'cleanup ordinary exit');
            child.disposeMonitor();
            assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-native-resources-'));
            await rm(directory, { recursive: true, force: true });
        }
    });
}

test('authenticated creator pulls only job assignment rights while the original monitor retains group observation', {
    skip: process.platform !== 'win32',
    timeout: 20_000,
}, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-handoff-'));
    const pending = promisify(execFile)(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL('./fixtures/native-resource-handoff.ps1', import.meta.url)),
            '-Directory',
            directory,
            '-NodePath',
            process.execPath,
        ],
        { windowsHide: true, shell: false },
    );
    void pending.catch(() => {});
    try {
        await waitForFile(directory, 'handoff-root-exited', t.signal);
        assert.equal(await readFile(path.join(directory, 'handoff-root-exited'), 'utf8'), '0');
        await writeFile(path.join(directory, 'launch-late'), 'after original handle root exit');
        await waitForFile(directory, 'late-ready', t.signal);
        await writeFile(path.join(directory, 'finish'), 'ordinary descendant exit');
        const { stdout } = await pending;
        const evidence: unknown = JSON.parse(stdout.trim());
        assert.ok(isRecord(evidence));
        assert.equal(evidence.rootExit, 0);
        assert.equal(evidence.closed, true);
        assert.equal(evidence.active, 0);
        assert.equal(evidence.creatorQueryError, 5);
        assert.equal(evidence.creatorExit, 0);
    } finally {
        await writeFile(path.join(directory, 'launch-late'), 'cleanup ordinary exit');
        await writeFile(path.join(directory, 'finish'), 'cleanup ordinary exit');
        await pending;
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-native-handoff-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('receiver process exit reclaims an unadopted root duplicate without terminating descendants', {
    skip: process.platform !== 'win32',
    timeout: 20_000,
}, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-handoff-'));
    try {
        const { stdout } = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./fixtures/native-resource-handoff.ps1', import.meta.url)),
                '-Directory',
                directory,
                '-NodePath',
                process.execPath,
                '-ReceiverExit',
            ],
            { windowsHide: true, shell: false },
        );
        const receiver: unknown = JSON.parse(stdout.trim());
        assert.ok(isRecord(receiver));
        assert.equal(receiver.received, true);
        await writeFile(path.join(directory, 'launch-late'), 'after receiver process exited');
        await waitForFile(directory, 'late-ready', t.signal);
        const latePid = Number(await readFile(path.join(directory, 'late-ready'), 'utf8'));
        const witness = promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./fixtures/native-resource-witness.ps1', import.meta.url)),
                '-OwnedPid',
                String(latePid),
            ],
            { windowsHide: true, shell: false },
        );
        await Promise.race([
            new Promise<void>((resolve) => witness.child.stdout?.once('data', () => resolve())),
            witness.then(() => {
                throw new Error('Witness ended before arming.');
            }),
        ]);
        await writeFile(path.join(directory, 'finish'), 'ordinary descendant exit');
        const receipt: unknown = JSON.parse((await witness).stdout.trim().split(/\r?\n/).at(-1) ?? 'null');
        assert.ok(isRecord(receipt));
        assert.equal(receipt.pid, latePid);
        assert.equal(receipt.exitCode, 0);
    } finally {
        await writeFile(path.join(directory, 'launch-late'), 'cleanup ordinary exit');
        await writeFile(path.join(directory, 'finish'), 'cleanup ordinary exit');
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-native-handoff-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('a lost created packet keeps acquisition pending after creator exit until the original native job is empty', {
    skip: process.platform !== 'win32',
    timeout: 20_000,
}, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-handoff-'));
    const pending = promisify(execFile)(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL('./fixtures/native-resource-handoff.ps1', import.meta.url)),
            '-Directory',
            directory,
            '-NodePath',
            process.execPath,
            '-LostPacket',
        ],
        { windowsHide: true, shell: false },
    );
    let completed = false;
    void pending.then(
        () => {
            completed = true;
        },
        () => {
            completed = true;
        },
    );
    try {
        await waitForFile(directory, 'middle-ready', t.signal);
        await writeFile(path.join(directory, 'launch-late'), 'created identity packet was lost');
        await waitForFile(directory, 'late-ready', t.signal);
        assert.equal(completed, false);
        await writeFile(path.join(directory, 'finish'), 'ordinary descendants exit');
        const evidence: unknown = JSON.parse((await pending).stdout.trim());
        assert.deepEqual(evidence, {
            event: 'acquisition-settled',
            applicationMayExist: false,
            creationPending: false,
        });
    } finally {
        await writeFile(path.join(directory, 'launch-late'), 'cleanup ordinary exit');
        await writeFile(path.join(directory, 'finish'), 'cleanup ordinary exit');
        await pending;
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('dct-native-handoff-'));
        await rm(directory, { recursive: true, force: true });
    }
});

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

test('a failed native launch supplies no-app acquisition proof before its helper closes', {
    skip: process.platform !== 'win32',
    timeout: 15_000,
}, async () => {
    await assert.rejects(
        createWindowsLauncher().launch({
            executablePath: path.join(os.tmpdir(), 'dct-deliberately-missing', 'missing.exe'),
            arguments: [],
            cwd: os.tmpdir(),
            env: Object.fromEntries(
                Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
        }),
    );
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
