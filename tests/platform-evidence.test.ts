import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveUnixExecutable, validateProcessIdentity } from '../src/adapters/platform-process.ts';

test('Darwin resolves absolute executable evidence from lsof text mappings, not a relative ps name', async () => {
    const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const run = async () => ({
        code: 0,
        stdout: `p42\nnthe wrong relative name\nn${executable}\nn/usr/lib/libobjc.dylib\n`,
        stderr: '',
    });
    assert.equal(await resolveUnixExecutable({ platform: 'darwin', pid: 42, comm: 'Google Chrome', run }), executable);
    await assert.rejects(
        resolveUnixExecutable({ platform: 'darwin', pid: 42, comm: 'another app', run }),
        /unverifiable/,
    );
});

test('process identity rejects executable, session, and creation-time mismatches', () => {
    const target = {
        executablePath: process.execPath,
        startedAtUtc: '2026-09-30T00:00:00Z',
        targetKind: 'generic-cdp' as const,
    };
    const evidence = {
        root: {
            exists: true as const,
            executablePath: process.execPath,
            sessionId: 1,
            startedAtUtc: target.startedAtUtc,
        },
        currentSessionId: 1,
    };
    assert.doesNotThrow(() => validateProcessIdentity(evidence, target));
    for (const changed of [
        { executablePath: '/wrong/path' },
        { sessionId: 2 },
        { startedAtUtc: '2026-09-30T00:00:05Z' },
    ]) {
        assert.throws(() => validateProcessIdentity({ ...evidence, root: { ...evidence.root, ...changed } }, target));
    }
});
