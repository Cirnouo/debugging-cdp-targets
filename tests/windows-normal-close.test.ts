import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isRecord } from '../src/shared/errors.ts';

for (const mode of [
    'enumeration-failure',
    'pid-failure',
    'owner-failure',
    'style-failure',
    'rectangle-failure',
    'stale-pid',
    'stale-hwnd',
    'stale-visible',
    'changed-during-selection',
    'lost-during-selection',
    'lost-while-invisible',
    'lost-while-disabled',
    'lost-while-owned',
    'lost-while-child',
    'lost-while-tool',
    'lost-while-zero-area',
    'pid-changed-while-invisible',
    'no-candidate',
    'child',
    'foreign-pid',
    'multiple',
    'minimized-zero',
]) {
    test(`Windows normal Close fails closed or selects one GUI at native I/O boundary: ${mode}`, {
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
                fileURLToPath(new URL('./fixtures/normal-close-boundary.ps1', import.meta.url)),
                '-Mode',
                mode,
            ],
            { windowsHide: true, shell: false },
        );
        const evidence: unknown = JSON.parse(stdout.trim());
        assert.ok(isRecord(evidence));
        const eligible = mode === 'foreign-pid' || mode === 'multiple' || mode === 'minimized-zero';
        assert.equal(
            evidence.messages,
            eligible ? 1 : 0,
            'A failed or stale selection must never send WM_CLOSE or retry another HWND.',
        );
        assert.equal(evidence.requested, eligible);
        assert.equal(
            evidence.selected,
            eligible ? 1 : 0,
            'Selection must preserve the first qualifying system-order window.',
        );
        if (
            mode.endsWith('failure') ||
            mode.startsWith('stale-') ||
            mode.endsWith('during-selection') ||
            mode.includes('-while-')
        )
            assert.equal(typeof evidence.failure, 'string');
        else assert.equal(evidence.failure, null);
    });
}
