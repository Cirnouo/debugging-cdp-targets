import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isRecord } from '../src/shared/errors.ts';

for (const failAt of ['writer', 'reader', 'pipe', 'target', 'resources', 'none'] as const) {
    test(`native handoff disposal drains remaining actions and joins ordinary creator after ${failAt}`, {
        skip: process.platform !== 'win32',
        timeout: 20_000,
    }, async (t) => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-test-'));
        const child = spawn(
            process.execPath,
            [fileURLToPath(new URL('./fixtures/native-resource-disposal-child.ts', import.meta.url)), directory],
            { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
        );
        const closed = new Promise<void>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => {
                if (code === 0 && signal === null) resolve();
                else reject(new Error('Ordinary creator fixture did not exit cleanly.'));
            });
        });
        void closed.catch(() => {});
        t.after(async () => {
            await writeFile(path.join(directory, 'pipe-closed'), 'ordinary cleanup');
            await closed;
            await rm(directory, { recursive: true, force: true });
        });
        await new Promise<void>((resolve, reject) => {
            child.once('error', reject);
            child.once('message', (message: unknown) => {
                if (isRecord(message) && message.ready === true) resolve();
                else reject(new Error('Creator fixture readiness unavailable.'));
            });
        });
        assert.ok(child.pid);
        const { stdout } = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./fixtures/native-resource-disposal-control.ps1', import.meta.url)),
                '-Directory',
                directory,
                '-CreatorPid',
                String(child.pid),
                '-FailAt',
                failAt,
            ],
            { windowsHide: true, shell: false, maxBuffer: 262144 },
        );
        const evidence: unknown = JSON.parse(stdout.trim());
        assert.ok(isRecord(evidence));
        assert.deepEqual(evidence.actions, [
            'writer',
            'reader',
            'pipe',
            'target',
            'resources',
            'join',
            'creator-identity',
        ]);
        assert.equal(evidence.creatorExit, 0);
        assert.equal(evidence.primaryPreserved, failAt !== 'none');
        assert.equal(evidence.cleanupFailures, failAt === 'none' ? 0 : 1);
        assert.equal(evidence.cleanupPreserved, failAt !== 'none');
        await closed;
    });
}
