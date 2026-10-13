import assert from 'node:assert/strict';
import { type ChildProcess, execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWindowsLauncher } from '../src/adapters/windows-launch.ts';
import { isRecord } from '../src/shared/errors.ts';
import {
    finishNativeResourceFixture,
    retainNativeResourceFixture,
    withNativeResourceCleanup,
} from './fixtures/native-resource-cleanup.ts';
import {
    createNativeResourceLog,
    type NativeResourceLog,
    type NativeResourceVariant,
    safeExitCode,
    safeSignal,
} from './fixtures/native-resource-log.ts';

async function nativeResourceCase(variant: NativeResourceVariant, action: (log: NativeResourceLog) => Promise<void>) {
    const log = createNativeResourceLog(variant);
    try {
        await log.step('fixture', undefined, () => action(log));
    } finally {
        log.finish();
    }
}

function observeHelper<T>(
    log: NativeResourceLog,
    pending: Promise<T> & { child: ChildProcess },
    detachedLaunch = false,
) {
    if (detachedLaunch) {
        pending.child.once('spawn', () => log.event('END', 'launch'));
        pending.child.once('error', () => log.event('FAILURE', 'launch'));
    }
    pending.child.once('close', (code, signal) =>
        log.event('CLOSE', 'launch', undefined, { closeCode: safeExitCode(code), signal: safeSignal(signal) }),
    );
    log.observe('additional-exit', undefined, pending);
    return pending;
}

test('failed fixture cleanup retains its coordination directory until independent actual-exit evidence settles', {
    timeout: 5_000,
}, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-resources-'));
    let exited = () => {};
    const exit = new Promise<void>((resolve) => {
        exited = resolve;
    });
    let disposed = false;
    let entered = () => {};
    const barrier = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const cleaning = finishNativeResourceFixture(directory, {
        waitForExit: () => {
            entered();
            return exit;
        },
        disposeMonitor: () => {
            disposed = true;
        },
    });
    t.after(async () => {
        exited();
        await cleaning;
    });
    await barrier;
    assert.equal(disposed, false);
    await access(directory);
    exited();
    await cleaning;
    await assert.rejects(access(directory), { code: 'ENOENT' });
});

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

for (const [abandon, failure] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
] as const) {
    test(`native resource group covers descendants created after root exit${abandon ? ' without kill on monitor close' : ''}${failure ? ' with failed assertion cleanup' : ''}`, {
        skip: process.platform !== 'win32',
        timeout: 25_000,
    }, async (t) => {
        await nativeResourceCase(
            abandon
                ? failure
                    ? 'group-abandoned-body-failure'
                    : 'group-abandoned'
                : failure
                  ? 'group-body-failure'
                  : 'group-normal',
            async (log) => {
                const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-resources-'));
                const primary = new Error('Injected assertion before late child release.');
                const run = async () => {
                    const child = await log.step('launch', 'root', () =>
                        createWindowsLauncher().launch({
                            executablePath: process.execPath,
                            arguments: [
                                fileURLToPath(new URL('./fixtures/native-resource-child.ts', import.meta.url)),
                                'root',
                                directory,
                            ],
                            cwd: directory,
                            env: Object.fromEntries(
                                Object.entries(process.env).filter(
                                    (entry): entry is [string, string] => entry[1] !== undefined,
                                ),
                            ),
                        }),
                    );
                    const retained = await retainNativeResourceFixture(directory, log);
                    await withNativeResourceCleanup(
                        log,
                        async () => {
                            await retained.releaseRoot();
                            await log.step('root-exit', 'root', async () => {
                                if (child.exitCode === null)
                                    await new Promise<void>((resolve, reject) => {
                                        child.once('exit', resolve);
                                        child.onMonitorError(() => reject(new Error('Root observation failed.')));
                                    });
                                log.event('END', 'root-exit', 'root', {
                                    ...(child.exitCode !== null ? { applicationExitCode: child.exitCode } : {}),
                                    rootExitSource: 'native-handle',
                                });
                            });
                            assert.equal(child.exitCode, 0);
                            let completed = false;
                            const resources = log.observe('resource-wait', undefined, () =>
                                child.waitForResourcesClosed().then(() => {
                                    completed = true;
                                }),
                            );
                            void resources.catch(() => {});
                            assert.equal(child.monitorDisposed, false);
                            if (abandon) {
                                child.disposeMonitor();
                                await assert.rejects(resources);
                            }
                            if (failure) throw primary;
                            await log.step('late-release', 'late', () =>
                                writeFile(path.join(directory, 'launch-late'), 'after actual root exit'),
                            );
                            await retained.armLate(t.signal);
                            assert.equal(completed, false);
                            await log.step('finish-release', 'late', async () => {
                                await writeFile(path.join(directory, 'finish'), 'ordinary child exit');
                                await waitForFile(directory, 'late-finished', t.signal);
                            });
                            if (!abandon) await resources;
                            assert.equal(child.exitCode, 0);
                        },
                        () => retained.finish(() => child.disposeMonitor()),
                    );
                };
                if (failure) await assert.rejects(run(), (error: unknown) => error === primary);
                else await run();
                await assert.rejects(access(directory), { code: 'ENOENT' });
            },
        );
    });
}

test('authenticated creator pulls only job assignment rights while the original monitor retains group observation', {
    skip: process.platform !== 'win32',
    timeout: 20_000,
}, async (t) => {
    await nativeResourceCase('creator-handoff', async (log) => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-handoff-'));
        log.event('BEGIN', 'launch');
        const pending = observeHelper(
            log,
            promisify(execFile)(
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
            ),
            true,
        );
        void pending.catch(() => {});
        const retained = await retainNativeResourceFixture(directory, log);
        await withNativeResourceCleanup(
            log,
            async () => {
                await retained.releaseRoot();
                await log.step('root-exit', 'root', async () => {
                    await waitForFile(directory, 'handoff-root-exited', t.signal);
                    assert.equal(await readFile(path.join(directory, 'handoff-root-exited'), 'utf8'), '0');
                    log.event('END', 'root-exit', 'root', {
                        applicationExitCode: 0,
                        rootExitSource: 'handoff-receipt',
                    });
                });
                await log.step('late-release', 'late', () =>
                    writeFile(path.join(directory, 'launch-late'), 'after original handle root exit'),
                );
                await retained.armLate(t.signal);
                await log.step('finish-release', 'late', () =>
                    writeFile(path.join(directory, 'finish'), 'ordinary descendant exit'),
                );
                const { stdout } = await pending;
                const evidence: unknown = JSON.parse(stdout.trim());
                assert.ok(isRecord(evidence));
                assert.equal(evidence.rootExit, 0);
                assert.equal(evidence.closed, true);
                assert.equal(evidence.active, 0);
                assert.equal(evidence.creatorQueryError, 5);
                assert.equal(evidence.creatorExit, 0);
            },
            () => retained.finish(() => {}, pending),
        );
    });
});

for (const failure of ['none', 'before-late', 'before-witness'] as const) {
    test(`receiver process exit reclaims an unadopted root duplicate without terminating descendants: ${failure}`, {
        skip: process.platform !== 'win32',
        timeout: 25_000,
    }, async (t) => {
        await nativeResourceCase(
            failure === 'none'
                ? 'receiver-none'
                : failure === 'before-late'
                  ? 'receiver-before-late'
                  : 'receiver-before-witness',
            async (log) => {
                const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-handoff-'));
                const primary = new Error('Injected receiver assertion before child witness arming.');
                const run = async () => {
                    const { stdout } = await log.step('launch', undefined, () =>
                        observeHelper(
                            log,
                            promisify(execFile)(
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
                            ),
                        ),
                    );
                    const retained = await retainNativeResourceFixture(directory, log);
                    await withNativeResourceCleanup(
                        log,
                        async () => {
                            await retained.releaseRoot();
                            const receiver: unknown = JSON.parse(stdout.trim());
                            assert.ok(isRecord(receiver));
                            assert.equal(receiver.received, true);
                            if (failure === 'before-late') throw primary;
                            await log.step('late-release', 'late', () =>
                                writeFile(path.join(directory, 'launch-late'), 'after receiver process exited'),
                            );
                            if (failure === 'before-witness') {
                                await log.step('late-ready-wait', 'late', () =>
                                    waitForFile(directory, 'late-ready', t.signal),
                                );
                                throw primary;
                            }
                            await retained.armLate(t.signal);
                            await log.step('finish-release', 'late', () =>
                                writeFile(path.join(directory, 'finish'), 'ordinary descendant exit'),
                            );
                        },
                        () => retained.finish(),
                    );
                };
                if (failure !== 'none') await assert.rejects(run(), (error: unknown) => error === primary);
                else await run();
                await assert.rejects(access(directory), { code: 'ENOENT' });
            },
        );
    });
}

test('a lost created packet keeps acquisition pending after creator exit until the original native job is empty', {
    skip: process.platform !== 'win32',
    timeout: 20_000,
}, async (t) => {
    await nativeResourceCase('lost-packet', async (log) => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-handoff-'));
        log.event('BEGIN', 'launch');
        const pending = observeHelper(
            log,
            promisify(execFile)(
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
            ),
            true,
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
        const retained = await retainNativeResourceFixture(directory, log);
        await withNativeResourceCleanup(
            log,
            async () => {
                await retained.releaseRoot();
                await waitForFile(directory, 'middle-ready', t.signal);
                await log.step('late-release', 'late', () =>
                    writeFile(path.join(directory, 'launch-late'), 'created identity packet was lost'),
                );
                await retained.armLate(t.signal);
                assert.equal(completed, false);
                await log.step('finish-release', 'late', () =>
                    writeFile(path.join(directory, 'finish'), 'ordinary descendants exit'),
                );
                const evidence: unknown = JSON.parse((await pending).stdout.trim());
                assert.deepEqual(evidence, {
                    event: 'acquisition-settled',
                    applicationMayExist: false,
                    creationPending: false,
                });
            },
            () => retained.finish(() => {}, pending),
        );
    });
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
