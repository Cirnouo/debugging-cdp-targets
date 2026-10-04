import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScriptCheckPlan } from '../tooling/check-scripts.ts';

const files = [
    'tooling/check-scripts.ts',
    'src/interface/mcp-bootstrap.ts',
    'src/adapters/windows-launch.ts',
    'src/adapters/windows-cdp-helper.ps1',
    'README.md',
];

test('checks every maintained TypeScript file and parses PowerShell with pwsh', () => {
    const plan = buildScriptCheckPlan({ files, platform: 'linux' });
    assert.deepEqual(
        plan.filter((step) => step.kind === 'typescript').map((step) => step.file),
        ['src/adapters/windows-launch.ts', 'src/interface/mcp-bootstrap.ts', 'tooling/check-scripts.ts'],
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

test('TypeScript uses a parser step rather than unsupported node --check', () => {
    const plan = buildScriptCheckPlan({
        files: ['src/interface/mcp-bootstrap.ts', 'plugins/example/dist/mcp-bootstrap.mjs'],
        platform: 'linux',
    });
    assert.deepEqual(
        plan.filter((step) => step.kind === 'typescript').map((step) => step.file),
        ['src/interface/mcp-bootstrap.ts'],
    );
    assert.deepEqual(
        plan.filter((step) => step.kind === 'node').map((step) => step.file),
        ['plugins/example/dist/mcp-bootstrap.mjs'],
    );
});

test('all maintained native helpers and smoke scripts receive both Windows parser checks', () => {
    const scripts = [
        'src/adapters/windows-native-helper.ps1',
        'tests/fixtures/compile-native-window.ps1',
        'tests/smoke/windows-window-evidence.ps1',
    ];
    const plan = buildScriptCheckPlan({ files: scripts, platform: 'win32' });
    for (const file of scripts)
        assert.deepEqual(
            plan.filter((step) => step.file === file).map((step) => step.executable),
            ['pwsh', 'powershell.exe'],
        );
});
