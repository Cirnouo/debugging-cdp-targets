import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const helperPath = 'src/adapters/windows-cdp-helper.ps1';
const powershellParser = [
    '$tokens = $null',
    '$parseErrors = $null',
    '[System.Management.Automation.Language.Parser]::ParseFile($env:CDP_TARGETS_POWERSHELL_FILE, [ref] $tokens, [ref] $parseErrors) | Out-Null',
    'if ($parseErrors.Count -gt 0) {',
    '    $parseErrors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }',
    '    exit 1',
    '}',
].join('\n');

export function buildScriptCheckPlan({ files, platform }) {
    const plan = files
        .filter((filePath) => /\.(?:cjs|js|mjs)$/.test(filePath))
        .sort()
        .map((file) => ({ kind: 'node', executable: process.execPath, file }));
    if (files.includes(helperPath)) {
        plan.push({ kind: 'powershell', executable: 'pwsh', file: helperPath });
        if (platform === 'win32') {
            plan.push({ kind: 'powershell', executable: 'powershell.exe', file: helperPath });
        }
    }
    return plan;
}

function maintainedFiles(root) {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter((file) => file && existsSync(path.join(root, file)))
        .map((filePath) => filePath.replaceAll('\\', '/'));
}

function runStep(root, step) {
    const absolute = path.join(root, ...step.file.split('/'));
    const arguments_ =
        step.kind === 'node'
            ? ['--check', absolute]
            : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', powershellParser];
    const result = spawnSync(step.executable, arguments_, {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CDP_TARGETS_POWERSHELL_FILE: absolute },
        windowsHide: true,
    });
    if (result.error) {
        throw new Error(`${step.executable} could not run for ${step.file}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(
            `${step.executable} syntax check failed for ${step.file}:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
        );
    }
}

function run() {
    const root = process.cwd();
    const plan = buildScriptCheckPlan({ files: maintainedFiles(root), platform: process.platform });
    try {
        for (const step of plan) {
            runStep(root, step);
        }
        const nodeCount = plan.filter((step) => step.kind === 'node').length;
        const powershellCount = plan.filter((step) => step.kind === 'powershell').length;
        console.log(
            `Script syntax checks passed (${nodeCount} JavaScript files, ${powershellCount} PowerShell parsers).`,
        );
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedPath) {
    run();
}
