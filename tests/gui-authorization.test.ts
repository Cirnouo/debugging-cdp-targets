import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const helper = new URL('./gui-authorization.ts', import.meta.url).href;
const runner = new URL('../tooling/test-windows-interactive.ts', import.meta.url).href;
const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-gui-authorization-'));
    try {
        await run(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

async function denyChildProcesses(directory: string): Promise<string> {
    const preload = path.join(directory, 'deny-child-processes.mjs');
    await writeFile(
        preload,
        `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    childProcess[name] = () => { throw new Error('Authorization regression forbids external process acquisition.'); };
}
syncBuiltinESMExports();
`,
    );
    return pathToFileURL(preload).href;
}

test('GUI entry guard skips before effects and CI environment alone cannot authorize', async () => {
    await fixture(async (directory) => {
        const entry = path.join(directory, 'entry.mjs');
        const marker = path.join(directory, 'launched');
        await writeFile(
            entry,
            `import { requireGuiAuthorization } from ${JSON.stringify(helper)};
import { writeFile } from 'node:fs/promises';
const args = requireGuiAuthorization();
await writeFile(args[0], JSON.stringify(args));
`,
        );
        for (const env of [
            process.env,
            { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true', DCT_ALLOW_GUI: 'true' },
        ]) {
            const result = await execute(process.execPath, [entry, marker], { env, windowsHide: true });
            assert.match(result.stdout, /SKIP.*--allow-gui/);
            await assert.rejects(access(marker));
        }
        for (const flag of ['--allow-gui=true', '--allow-gui=false', '--ALLOW-GUI']) {
            const result = await execute(process.execPath, [entry, marker, flag], { windowsHide: true });
            assert.match(result.stdout, /SKIP.*--allow-gui/);
            await assert.rejects(access(marker));
        }
        await execute(process.execPath, [entry, marker, '--allow-gui', 'literal 空格', '--diagnostics', 'kept']);
        assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), [marker, 'literal 空格', '--diagnostics', 'kept']);
    });
});

test('interactive runner denies before reading files and forwards explicit argv to a real test subprocess', async () => {
    await fixture(async (directory) => {
        const entry = path.join(directory, 'runner.mjs');
        const selected = path.join(directory, 'selected.mjs');
        const marker = path.join(directory, 'ran');
        const environment = { ...process.env };
        delete environment.NODE_TEST_CONTEXT;
        await writeFile(
            entry,
            `import { runInteractiveTests } from ${JSON.stringify(runner)};
runInteractiveTests(process.argv.slice(2), [${JSON.stringify(selected)}]);
`,
        );
        const denied = await execute(process.execPath, [entry], {
            env: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true' },
            windowsHide: true,
        });
        assert.match(denied.stdout, /SKIP.*--allow-gui/);
        await writeFile(
            selected,
            `import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
test('observable forwarded authorization', async () => {
    assert.deepEqual(process.argv.slice(2), ['--allow-gui', 'literal 空格']);
    await writeFile(${JSON.stringify(marker)}, 'ran');
});
`,
        );
        await execute(process.execPath, [entry, '--allow-gui', 'literal 空格'], {
            windowsHide: true,
            env: environment,
        });
        assert.equal(await readFile(marker, 'utf8'), 'ran');
        await writeFile(
            selected,
            `import test from 'node:test';
test('failure reaches caller', () => { throw new Error('fixture-failure'); });
`,
        );
        await assert.rejects(
            execute(process.execPath, [entry, '--allow-gui'], { env: environment }),
            (error: unknown) => error instanceof Error && 'code' in error && error.code === 1,
        );
    });
});

test('real GUI smoke entrypoints default to successful skip before invalid arguments or resource acquisition', async () => {
    await fixture(async (directory) => {
        const preload = await denyChildProcesses(directory);
        for (const name of [
            'official-server',
            'entry-recovery',
            'timeout-isolation',
            'screenshot-layers',
            'screenshot-timeout-probe',
            'application-screenshot-probe',
            'readest-native',
            'windows-elevation',
            'windows-elevated-mcp',
        ]) {
            const result = await execute(
                process.execPath,
                ['--import', preload, `tests/smoke/${name}.ts`, '--invalid-fixture'],
                {
                    cwd: root,
                    windowsHide: true,
                    env: { ...process.env, CI: 'true' },
                },
            );
            assert.match(result.stdout, /SKIP.*--allow-gui/, name);
        }
    });
});

test('direct interactive node test invocation preserves all eighteen cases as authorization skips', async () => {
    await fixture(async (directory) => {
        const preload = await denyChildProcesses(directory);
        const files = ['screenshot-background-anchor', 'window-evidence', 'windows-native', 'windows-normal-close'].map(
            (name) => `tests/interactive/${name}.test.ts`,
        );
        const environment: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
        delete environment.NODE_TEST_CONTEXT;
        const result = await execute(
            process.execPath,
            ['--import', preload, '--test', '--test-reporter=tap', '--test-concurrency=1', ...files],
            {
                cwd: root,
                windowsHide: true,
                env: environment,
            },
        );
        assert.match(result.stdout, /# tests 18/);
        assert.match(result.stdout, /# skipped 18/);
        assert.match(result.stdout, /# fail 0/);
    });
});

test('direct PowerShell GUI fixture denies before compiling or creating resources', {
    skip: process.platform !== 'win32',
}, async () => {
    await fixture(async (directory) => {
        const output = path.join(directory, 'absent');
        const result = await execute(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                path.join(root, 'tests/fixtures/normal-close-window.ps1'),
                '-Directory',
                output,
                '-Mode',
                'normal',
            ],
            { windowsHide: true, env: { ...process.env, CI: 'true' } },
        );
        assert.match(result.stdout, /SKIP.*-AllowGui/);
        await assert.rejects(access(output));
        const noArguments = await execute(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                path.join(root, 'tests/fixtures/normal-close-window.ps1'),
            ],
            { windowsHide: true },
        );
        assert.match(noArguments.stdout, /SKIP.*-AllowGui/);
    });
});

test('direct PowerShell window mutations deny before identity validation while None remains passive', {
    skip: process.platform !== 'win32',
}, async () => {
    const command = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'tests/smoke/windows-window-evidence.ps1'),
        '-ApplicationPid',
        '2147483647',
    ];
    for (const state of ['Minimize', 'Restore', 'Foreground', 'Background']) {
        for (const env of [process.env, { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true' }]) {
            const result = await execute('powershell.exe', [...command, '-State', state], { env, windowsHide: true });
            assert.match(result.stdout, /SKIP.*-AllowGui/, state);
        }
    }
    const passive = await execute('powershell.exe', [...command, '-State', 'None'], { windowsHide: true });
    assert.deepEqual(JSON.parse(passive.stdout), []);
    await assert.rejects(
        execute('powershell.exe', [...command, '-State', 'Restore', '-AllowGui'], {
            windowsHide: true,
        }),
        /Window mutation requires the launched executable and creation time/,
    );
});

test('window sampler forwards GUI permission only to authorized mutation subprocess arguments', async () => {
    await fixture(async (directory) => {
        const entry = path.join(directory, 'window-sampler.mjs');
        const marker = path.join(directory, 'arguments.json');
        const sampler = new URL('./smoke/window-evidence.ts', import.meta.url).href;
        await writeFile(
            entry,
            `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
const calls = [];
const identity = { processId: 4100, executablePath: 'C:/Fixture/window.exe', startedAtUtc: '2026-10-05T00:00:00.000Z' };
const intercepted = () => { throw new Error('Use only the private promisified process boundary.'); };
intercepted[promisify.custom] = async (executable, args) => {
    calls.push({ executable, args });
    return { stdout: JSON.stringify([{ ...identity, handle: 120, child: false, visible: true, actualExecutablePath: identity.executablePath,
        isIconic: false, showCmd: 1, actionAccepted: null, nativeError: 0, stateReached: true }]), stderr: '' };
};
childProcess.execFile = intercepted;
syncBuiltinESMExports();
const { sampleWindow } = await import(${JSON.stringify(sampler)});
await sampleWindow(identity, 'Restore', 120);
await sampleWindow(identity, 'None', 120);
await writeFile(${JSON.stringify(marker)}, JSON.stringify(calls));
`,
        );
        for (const [flags, expected] of [
            [[], false],
            [['--allow-gui'], true],
        ] as const) {
            await execute(process.execPath, [entry, ...flags], {
                windowsHide: true,
                env: { ...process.env, CI: 'true' },
            });
            const calls: unknown = JSON.parse(await readFile(marker, 'utf8'));
            assert.ok(Array.isArray(calls) && calls.length === 2);
            for (const [index, call] of calls.entries()) {
                assert.ok(typeof call === 'object' && call !== null && 'args' in call && Array.isArray(call.args));
                assert.equal(call.args.includes('-AllowGui'), index === 0 && expected);
                assert.equal(call.args[call.args.indexOf('-State') + 1], index === 0 ? 'Restore' : 'None');
                assert.ok(call.args.includes('120'));
            }
        }
    });
});

test('window mutations skip without PID before binding effects but passive and authorized paths require valid PID', {
    skip: process.platform !== 'win32',
}, async () => {
    const command = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'tests/smoke/windows-window-evidence.ps1'),
    ];
    for (const state of ['Minimize', 'Restore', 'Foreground', 'Background']) {
        for (const env of [process.env, { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true' }]) {
            const denied = await execute('powershell.exe', [...command, '-State', state], { env, windowsHide: true });
            assert.match(denied.stdout, /SKIP.*-AllowGui/, state);
        }
        await assert.rejects(
            execute('powershell.exe', [...command, '-State', state, '-AllowGui'], {
                windowsHide: true,
            }),
            /ApplicationPid is required and must be positive/,
        );
    }
    for (const args of [[], ['-ApplicationPid', '0'], ['-ApplicationPid', '-1']]) {
        await assert.rejects(
            execute('powershell.exe', [...command, '-State', 'None', ...args], {
                windowsHide: true,
            }),
            /ApplicationPid is required and must be positive/,
        );
    }
});
