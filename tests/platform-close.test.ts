import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlatformAdapter } from '../src/adapters/platform-process.ts';
import type { ProcessEvidence, ProcessTarget } from '../src/domains/cdp-target.ts';
import { DetailedError, errorDetails } from '../src/shared/errors.ts';

const target: ProcessTarget = {
    processId: 601,
    port: 9222,
    executablePath: process.execPath,
    startedAtUtc: '2026-10-04T00:00:00Z',
    targetKind: 'generic-cdp',
};
function fixture(listeners: ProcessEvidence['listeners'], failure = false, denied = false) {
    let closed = false;
    let requests = 0;
    const platform = createPlatformAdapter({
        platform: 'win32',
        snapshot: async () => ({
            root: closed
                ? { exists: false }
                : {
                      exists: true,
                      executablePath: target.executablePath,
                      startedAtUtc: target.startedAtUtc,
                      sessionId: 1,
                  },
            currentSessionId: 1,
            processIds: closed ? [] : [601],
            listeners,
        }),
        closeWindows: async () => {
            requests++;
            if (denied) {
                const error = new DetailedError('Authorization cancelled.');
                error.details = { phase: 'awaiting-permission', nativeError: 1223, closeRequested: false };
                throw error;
            }
            closed = !failure;
            return { closed, processExited: closed, closeRequested: true, phase: 'wait-exit', nativeError: 0 };
        },
    });
    return { platform, requests: () => requests };
}
test('a vanished listener permits normal close using the retained process identity', async () => {
    const f = fixture([]);
    assert.equal(await f.platform.close(target), true);
    assert.equal(f.requests(), 1);
});
test('a foreign listener is distinguished and never receives the close request', async () => {
    const f = fixture([{ localAddress: '127.0.0.1', owningProcess: 900 }]);
    await assert.rejects(
        f.platform.close(target),
        (error: unknown) => errorDetails(error)?.listenerState === 'foreign',
    );
    assert.equal(f.requests(), 0);
    assert.equal(await f.platform.close(target, { requireListener: false }), true);
    assert.equal(f.requests(), 1);
});
test('application refusal and elevated-close cancellation retain precise stages and allow retry', async () => {
    const f = fixture([], true);
    await assert.rejects(f.platform.close(target), (error: unknown) => {
        assert.deepEqual(errorDetails(error), {
            phase: 'wait-exit',
            nativeError: 0,
            closeRequested: true,
            processExited: false,
            listenerState: 'absent',
        });
        return true;
    });
    const denied = fixture([], false, true);
    for (let i = 0; i < 2; i++)
        await assert.rejects(denied.platform.close(target), (error: unknown) => {
            assert.equal(errorDetails(error)?.nativeError, 1223);
            assert.equal(errorDetails(error)?.listenerState, 'absent');
            return true;
        });
    assert.equal(denied.requests(), 2);
});

test('Unix normal close waits for verifiable exit across disappearing executable mappings', async () => {
    let snapshots = 0;
    const signals: number[] = [];
    const platform = createPlatformAdapter({
        platform: 'darwin',
        requestUnixClose: (pid) => {
            signals.push(pid);
        },
        sleep: async () => {},
        snapshot: async () => {
            snapshots += 1;
            if (snapshots === 2) throw new Error('The Darwin executable path is unverifiable or ambiguous.');
            return {
                root:
                    snapshots === 1
                        ? {
                              exists: true,
                              executablePath: target.executablePath,
                              startedAtUtc: target.startedAtUtc,
                              sessionId: 1,
                          }
                        : { exists: false },
                currentSessionId: 1,
                processIds: snapshots === 1 ? [target.processId] : [],
                listeners: [],
            };
        },
    });
    assert.equal(await platform.close(target), true);
    assert.deepEqual(signals, [target.processId]);
    assert.equal(snapshots, 3);
});

test('Unix close never signals unverifiable identities and bounds incomplete exit evidence', async () => {
    for (const fault of ['before-signal', 'after-signal', 'changed-identity']) {
        let snapshots = 0;
        const signals: number[] = [];
        const failure = new Error('The Darwin executable path is unverifiable or ambiguous.');
        const platform = createPlatformAdapter({
            platform: 'darwin',
            requestUnixClose: (pid) => {
                signals.push(pid);
            },
            sleep: async () => {},
            snapshot: async () => {
                snapshots += 1;
                if (fault === 'before-signal' || (snapshots > 1 && fault === 'after-signal')) throw failure;
                return {
                    root: {
                        exists: true,
                        executablePath: target.executablePath,
                        startedAtUtc: snapshots > 1 ? '2026-10-04T00:00:05Z' : target.startedAtUtc,
                        sessionId: 1,
                    },
                    currentSessionId: 1,
                    processIds: [target.processId],
                    listeners: [],
                };
            },
        });
        await assert.rejects(
            platform.close(target),
            fault === 'changed-identity' ? /creation time changed/ : (error: unknown) => error === failure,
        );
        assert.deepEqual(signals, fault === 'before-signal' ? [] : [target.processId]);
        assert.ok(snapshots <= 51);
    }
});
