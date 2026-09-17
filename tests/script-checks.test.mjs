import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScriptCheckPlan } from '../tooling/check-scripts.mjs';

const files = [
    'tooling/check-scripts.mjs',
    'skills/debugging-cdp-targets/scripts/cdp-session.mjs',
    'skills/debugging-cdp-targets/scripts/hide-mcp-console.cjs',
    'skills/debugging-cdp-targets/scripts/windows-cdp-helper.ps1',
    'README.md',
];

test('checks every maintained JavaScript file and parses PowerShell with pwsh', () => {
    const plan = buildScriptCheckPlan({ files, platform: 'linux' });
    assert.deepEqual(
        plan.filter((step) => step.kind === 'node').map((step) => step.file),
        [
            'skills/debugging-cdp-targets/scripts/cdp-session.mjs',
            'skills/debugging-cdp-targets/scripts/hide-mcp-console.cjs',
            'tooling/check-scripts.mjs',
        ],
    );
    assert.deepEqual(
        plan.filter((step) => step.kind === 'powershell').map((step) => step.executable),
        ['pwsh'],
    );
});

test('also parses PowerShell with Windows PowerShell 5.1 on Windows', () => {
    const plan = buildScriptCheckPlan({ files, platform: 'win32' });
    assert.deepEqual(
        plan.filter((step) => step.kind === 'powershell').map((step) => step.executable),
        ['pwsh', 'powershell.exe'],
    );
});
