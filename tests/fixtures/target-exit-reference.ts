import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { waitForTargetExit } from '../../src/adapters/platform-process.ts';
import type { ManagedTarget } from '../../src/domains/cdp-target.ts';

const mode = process.argv[2];
if (mode === 'application') {
    // This private fixture naturally exits even when its observing subprocess ends early.
    setTimeout(() => {}, 250);
} else {
    if (!['single', 'cancel-one', 'cancel-all'].includes(mode ?? '')) throw new Error('Unknown fixture mode.');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'application'], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
    });
    await once(child, 'spawn');
    assert.ok(child.pid);
    child.unref();
    const target: ManagedTarget = {
        processId: child.pid,
        port: 9222,
        executablePath: process.execPath,
        startedAtUtc: new Date().toISOString(),
        targetKind: 'generic-cdp',
        child,
    };
    const abort = new AbortController();
    const cancellation = new Error('Only this waiter was cancelled.');
    const first = waitForTargetExit(target, abort.signal);
    const remaining = mode === 'cancel-one' ? waitForTargetExit(target) : undefined;
    console.log(JSON.stringify({ phase: 'waiting', processId: child.pid, exitListeners: child.listenerCount('exit') }));
    if (mode === 'single') {
        await first;
    } else {
        const cancelled = first.catch((error: unknown) => assert.equal(error, cancellation));
        abort.abort(cancellation);
        await cancelled;
        if (remaining) await remaining;
        else assert.equal(child.exitCode, null, 'Cancelling observation must preserve the live private fixture.');
    }
    console.log(JSON.stringify({ phase: mode === 'cancel-all' ? 'cancelled' : 'exited', exitCode: child.exitCode }));
}
