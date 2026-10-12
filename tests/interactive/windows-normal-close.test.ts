import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isRecord } from '../../src/shared/errors.ts';

assert.equal(process.platform, 'win32', 'Interactive Windows tests require Windows and an interactive desktop.');

for (const mode of [
    'event',
    'normal',
    'minimized',
    'transparent',
    'frameless',
    'zero-area',
    'tool',
    'disabled',
    'owned',
    'multiple',
]) {
    test(`normal Close selects the first ordinary owned GUI for ${mode}`, { timeout: 20_000 }, async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-normal-close-'));
        try {
            const { stdout } = await promisify(execFile)(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    fileURLToPath(new URL('../fixtures/normal-close-window.ps1', import.meta.url)),
                    '-Directory',
                    directory,
                    '-Mode',
                    mode,
                ],
                { windowsHide: true, shell: false },
            );
            const evidence: unknown = JSON.parse(stdout.trim());
            assert.ok(isRecord(evidence) && isRecord(evidence.result));
            if (mode === 'event') {
                assert.notEqual(evidence.gui, evidence.excluded);
                assert.equal(
                    evidence.oldMain,
                    evidence.excluded,
                    '.NET must reproduce the actual event-target misselection.',
                );
            }
            assert.deepEqual(
                evidence.closes,
                ['gui'],
                'Only the first eligible GUI must receive exactly one WM_CLOSE.',
            );
            assert.equal(evidence.expired, false, 'GUI Close, rather than fixture expiry, must cause actual exit.');
            assert.equal(evidence.result.closeRequested, true);
            assert.equal(evidence.result.processExited, true);
            assert.equal(evidence.result.waitResult, 0);
            assert.equal(evidence.exitCode, 0);
        } finally {
            assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-normal-close-'));
            await rm(directory, { recursive: true, force: true });
        }
    });
}
