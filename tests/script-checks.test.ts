import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScriptCheckPlan } from '../tooling/check-scripts.ts';

const files = [
    'tooling/check-scripts.ts',
    'src/interface/control.ts',
    'src/adapters/hide-npm-console.ts',
    'src/adapters/windows-cdp-helper.ps1',
    'README.md',
];

test('checks every maintained TypeScript file and parses PowerShell with pwsh', () => {
    const plan = buildScriptCheckPlan({ files, platform: 'linux' });
    assert.deepEqual(
        plan.filter((step) => step.kind === 'typescript').map((step) => step.file),
        ['src/adapters/hide-npm-console.ts', 'src/interface/control.ts', 'tooling/check-scripts.ts'],
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
        files: ['src/interface/control.ts', 'plugins/example/dist/control.mjs'],
        platform: 'linux',
    });
    assert.deepEqual(
        plan.filter((step) => step.kind === 'typescript').map((step) => step.file),
        ['src/interface/control.ts'],
    );
    assert.deepEqual(
        plan.filter((step) => step.kind === 'node').map((step) => step.file),
        ['plugins/example/dist/control.mjs'],
    );
});
