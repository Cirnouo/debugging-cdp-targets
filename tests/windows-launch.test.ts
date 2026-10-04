import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createWindowsLauncher } from '../src/adapters/windows-launch.ts';
import { errorDetails } from '../src/shared/errors.ts';

function fixture() {
    const helper = Object.assign(new ChildProcess(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    Object.defineProperty(helper, 'pid', { value: 501 });
    let input = '';
    helper.stdin.on('data', (chunk: Buffer) => {
        input += chunk.toString();
    });
    const launcher = createWindowsLauncher({ spawn: () => helper });
    const emit = (value: unknown) => helper.stdout.write(`${JSON.stringify(value)}\n`);
    return { helper, launcher, emit, input: () => input };
}
const launch = {
    executablePath: 'C:/Apps/app.exe',
    arguments: ['a b', '&', '中文'],
    cwd: 'C:/Apps',
    env: { PATH: 'C:/Windows', SECRET: 'literal value' },
};
const identity = {
    event: 'started',
    processId: 601,
    executablePath: launch.executablePath,
    startedAtUtc: '2026-10-04T00:00:00Z',
    elevated: true,
};

test('native launcher passes structured environment privately and tracks the real application rather than its helper', async () => {
    const f = fixture();
    const phases: string[] = [];
    const pending = f.launcher.launch(launch, { onPhase: (phase) => phases.push(phase) });
    f.emit({ event: 'phase', phase: 'awaiting-permission' });
    f.emit(identity);
    const child = await pending;
    assert.equal(child.pid, 601);
    assert.equal(child.startedAtUtc, identity.startedAtUtc);
    assert.equal(child.elevated, true);
    assert.deepEqual(JSON.parse(f.input().trim()).launch.env, launch.env);
    assert.deepEqual(phases, ['awaiting-permission']);
    let exited = false;
    child.once('exit', () => {
        exited = true;
    });
    f.helper.emit('close', 0);
    assert.equal(exited, false);
    assert.equal(child.exitCode, null);
    assert.equal(child.monitoringFailure, 'native-helper-exited');
});

test('only a native process-exit event proves application exit; authorization cancellation retains its category', async () => {
    const f = fixture();
    const pending = f.launcher.launch(launch);
    f.emit(identity);
    f.emit({ event: 'exited', processId: 601, exitCode: 0 });
    const child = await pending;
    assert.equal(child.exitCode, 0);
    const denied = fixture();
    const attempt = denied.launcher.launch(launch);
    denied.emit({ event: 'error', phase: 'permission', nativeError: 1223, category: 'authorization-cancelled' });
    await assert.rejects(attempt, (error: unknown) => {
        assert.equal(errorDetails(error)?.nativeError, 1223);
        assert.equal(errorDetails(error)?.category, 'authorization-cancelled');
        assert.ok(!JSON.stringify(error).includes('literal value'));
        return true;
    });
});

test('cancel during native authorization is delivered and a raced creation still returns its real identity for cleanup', async () => {
    const f = fixture();
    const abort = new AbortController();
    const pending = f.launcher.launch(launch, { signal: abort.signal });
    abort.abort();
    assert.ok(f.input().includes('{"cancel":true}'));
    f.emit(identity);
    assert.equal((await pending).pid, 601);
    const denied = fixture();
    const failure = denied.launcher.launch(launch);
    denied.emit({ event: 'error', phase: 'launch', nativeError: 5, category: 'access-denied' });
    await assert.rejects(failure, (error: unknown) => errorDetails(error)?.nativeError === 5);
    assert.equal(denied.input().split('\n').filter(Boolean).length, 1);
});

test('malformed helper output is private and a late application identity remains available for cleanup', async () => {
    const f = fixture();
    const pending = f.launcher.launch(launch);
    f.helper.stdout.write('private-application-output\n');
    f.emit(identity);
    const child = await pending;
    assert.equal(child.pid, identity.processId);
    assert.equal(child.monitoringFailure, 'native-helper-exited');
    assert.equal(f.helper.stdin.writableEnded, true);

    const absent = fixture();
    const failed = absent.launcher.launch(launch);
    absent.helper.stdout.write('private-application-output\n');
    absent.helper.emit('close', 1);
    await assert.rejects(failed, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid native process evidence/);
        assert.ok(!error.message.includes('private-application-output'));
        return true;
    });
});

test('releasing native observation ends only the helper transport, without reporting application exit', async () => {
    const f = fixture();
    const pending = f.launcher.launch(launch);
    f.emit(identity);
    const child = await pending;
    child.disposeMonitor();
    child.disposeMonitor();
    assert.equal(f.helper.stdin.writableEnded, true);
    f.helper.emit('close', 0);
    assert.equal(child.exitCode, null);
    assert.equal(child.monitoringFailure, undefined);
});
