import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
    claudeContext,
    claudeEnvironment,
    claudeRequest,
    claudeSse,
    claudeToolResult,
    claudeVersion,
} from './smoke/claude-host.ts';
import { claudeCli, sandbox } from './smoke/claude-process.ts';

const temporary = path.resolve('isolated');
test('child environment discards auth/provider/proxy/Git state and relocates all user paths', () => {
    const result = claudeEnvironment(temporary, 'http://127.0.0.1:32123', {
        PATH: 'native',
        SystemRoot: 'Windows',
        ANTHROPIC_AUTH_TOKEN: 'secret',
        AWS_ACCESS_KEY_ID: 'secret',
        HTTP_PROXY: 'secret',
        CLAUDE_CODE_USE_BEDROCK: '1',
        NODE_OPTIONS: 'secret',
        GIT_DIR: 'secret',
        CODEX_HOME: 'secret',
    });
    assert.equal(result.PATH, 'native');
    for (const key of [
        'ANTHROPIC_AUTH_TOKEN',
        'AWS_ACCESS_KEY_ID',
        'HTTP_PROXY',
        'CLAUDE_CODE_USE_BEDROCK',
        'NODE_OPTIONS',
        'GIT_DIR',
        'CODEX_HOME',
    ])
        assert.equal(result[key], undefined);
    assert.equal(result.ANTHROPIC_API_KEY, 'sk-ant-synthetic-dct-smoke');
    for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'CLAUDE_CONFIG_DIR'])
        assert.ok(result[key]?.startsWith(temporary + path.sep));
});
test('provider rejects external/malformed endpoints instead of calling an account API', () => {
    for (const endpoint of [
        'https://api.anthropic.com',
        'http://localhost:32123',
        'http://127.0.0.2:32123',
        'http://user:pass@127.0.0.1:32123',
        'http://127.0.0.1:32123/v1',
        'http://127.0.0.1',
        'http://127.0.0.1:32123?x=1',
    ])
        assert.throws(() => claudeEnvironment(temporary, endpoint, {}), /loopback/);
});
test('actual host version must meet first supported release', () => {
    assert.equal(claudeVersion('2.1.283 (Claude Code)\n'), '2.1.283');
    assert.equal(claudeVersion('2.2.0 (Claude Code)'), '2.2.0');
    for (const version of [
        '2.1.282 (Claude Code)',
        '2.0.1000 (Claude Code)',
        'garbage',
        'codex 2.1.283',
        '2.1.283-extra (Claude Code)',
    ])
        assert.throws(() => claudeVersion(version), /Claude Code/);
});
test('model request validates actual unknown messages/tool schema boundaries', () => {
    const valid = {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'fixture' }],
        tools: [{ name: 'mcp__fixture__status', input_schema: { type: 'object' } }],
    };
    assert.deepEqual(claudeRequest(JSON.stringify(valid)), valid);
    for (const body of [
        'null',
        '{}',
        '{',
        JSON.stringify({ ...valid, messages: 'not-array' }),
        JSON.stringify({ ...valid, tools: [{ name: 1 }] }),
    ])
        assert.throws(() => claudeRequest(body));
});
test('tool results accept host text shapes and trailing host reminder but reject errors/malformed data', () => {
    const content = '{"entryId":"fixture","connections":[]}\n\n<system-reminder>host</system-reminder>';
    for (const result of [content, [{ type: 'text', text: content }]])
        assert.deepEqual(
            claudeToolResult(
                [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: result }] }],
                'call-1',
            ),
            { entryId: 'fixture', connections: [] },
        );
    for (const result of [{ is_error: true, content }, { content: 'invalid' }, { content: '{"x":1}garbage' }])
        assert.throws(() =>
            claudeToolResult(
                [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', ...result }] }],
                'call-1',
            ),
        );
    assert.throws(() => claudeToolResult([], 'missing'));
});
test('Anthropic SSE frames preserve structured tool input and terminate exactly once', () => {
    const frames = claudeSse('claude-sonnet-4-6', 1, {
        type: 'tool_use',
        name: 'mcp__fixture__status',
        id: 'call-1',
        input: { literal: 'quote"\\\n', _dct: { connectionId: 'c', sessionId: 's' } },
    })
        .trim()
        .split('\n\n')
        .map((frame) => JSON.parse(frame.split('\ndata: ')[1] ?? 'null'));
    assert.deepEqual(
        frames.map((frame) => frame.type),
        [
            'message_start',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'message_delta',
            'message_stop',
        ],
    );
    assert.deepEqual(JSON.parse(frames[2].delta.partial_json), {
        literal: 'quote"\\\n',
        _dct: { connectionId: 'c', sessionId: 's' },
    });
    assert.equal(frames[4].delta.stop_reason, 'tool_use');
    assert.ok(
        claudeSse('claude-sonnet-4-6', 2, { type: 'text', text: 'fixture' }).includes('"stop_reason":"end_turn"'),
    );
});

test('model context evidence excludes assistant repetitions and tool result text', () => {
    assert.deepEqual(
        claudeContext({
            model: 'fixture',
            tools: [],
            messages: [
                { role: 'user', content: 'submitted' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'hook reminder' },
                        { type: 'tool_result', content: 'result marker' },
                    ],
                },
                { role: 'assistant', content: [{ type: 'text', text: 'repeated hook reminder' }] },
            ],
        }),
        ['submitted', 'hook reminder'],
    );
});
test('PostToolUse context nested inside tool result survives independently of result payload', () => {
    const reminder = '<system-reminder>\nPostToolUse:fixture hook additional context: exited\n</system-reminder>';
    assert.deepEqual(
        claudeContext({
            model: 'fixture',
            tools: [],
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            content: [
                                { type: 'text', text: 'ordinary result' },
                                { type: 'text', text: reminder },
                            ],
                        },
                    ],
                },
            ],
        }),
        [reminder],
    );
});

test('lifecycle Hook context appended to scalar tool results is extracted without the operation payload', () => {
    const reminder =
        '<system-reminder>\nPostToolUse:fixture hook additional context: \nCDP lifecycle operation results: succeeded\n</system-reminder>';
    assert.deepEqual(
        claudeContext({
            model: 'fixture',
            tools: [],
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            content: `{"state":"accepted"}\n\n${reminder}\n\n<system-reminder>tokens</system-reminder>`,
                        },
                    ],
                },
            ],
        }),
        [reminder],
    );
});
test('malformed model message blocks fail closed before interpreting Hook evidence', () => {
    for (const message of [
        { role: 'developer', content: 'unexpected' },
        { role: 'user', content: [null] },
        { role: 'user', content: [{}] },
        { role: 'user', content: [{ type: 1 }] },
    ])
        assert.throws(() => claudeRequest(JSON.stringify({ model: 'fixture', messages: [message], tools: [] })));
});

test('CLI keeps synthetic provider responsive while a child requests token evidence', async () => {
    const { temporary } = await sandbox(process.cwd(), 'cli-regression');
    let observed = 0;
    const model = createServer((_request, response) => {
        observed++;
        response.end('local-token-evidence');
    });
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
    const address = model.address();
    assert.ok(address && typeof address !== 'string');
    try {
        const stdout = await claudeCli(
            process.execPath,
            [
                '-e',
                'fetch(process.env.ANTHROPIC_BASE_URL, { signal: AbortSignal.timeout(500) }).then(r => r.text()).then(console.log).catch(() => process.exitCode = 1)',
            ],
            temporary,
            `http://127.0.0.1:${address.port}`,
        );
        assert.equal(stdout.trim(), 'local-token-evidence');
        assert.equal(observed, 1);
    } finally {
        model.closeAllConnections();
        await new Promise<void>((resolve) => model.close(() => resolve()));
        await rm(temporary, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('CLI preserves process errors and timed-out fixtures exit before rejection', async () => {
    const { temporary } = await sandbox(process.cwd(), 'cli-failure');
    const endpoint = 'http://127.0.0.1:32123';
    try {
        await assert.rejects(
            () =>
                claudeCli(
                    process.execPath,
                    ['-e', "console.error('fixture failure'); process.exitCode = 7"],
                    temporary,
                    endpoint,
                ),
            /fixture failure/,
        );
        const pidFile = path.join(temporary, 'fixture-pid.json');
        await assert.rejects(
            () =>
                claudeCli(
                    process.execPath,
                    [
                        '-e',
                        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify(process.pid)); setInterval(() => {}, 1000);`,
                    ],
                    temporary,
                    endpoint,
                    1000,
                ),
            /timed out/,
        );
        const pid: unknown = JSON.parse(await readFile(pidFile, 'utf8'));
        assert.ok(typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0);
        assert.throws(() => process.kill(pid, 0), /ESRCH|not found|no such process/i);
    } finally {
        await rm(temporary, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('CLI captures complete piped output before accepting child completion', async () => {
    const { temporary } = await sandbox(process.cwd(), 'cli-output');
    try {
        const stdout = await claudeCli(
            process.execPath,
            ['-e', "process.stdout.end('fixture'.repeat(150000))"],
            temporary,
            'http://127.0.0.1:32123',
        );
        assert.equal(stdout, 'fixture'.repeat(150000));
    } finally {
        await rm(temporary, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
});

async function adversarialHost(
    mode: 'resistant' | 'callback' | 'initial-input' | 'next-input' | 'callback-error' | 'driver-cleanup',
    afterEvidence?: (pidFile: string) => Promise<void>,
    versionDelayMs = 0,
    hostReadyDelayMs = 0,
    privateHostStartupDelayMs = 0,
) {
    const { temporary } = await sandbox(process.cwd(), `adversarial-${mode}`);
    const fixture = path.join(temporary, 'private-fixture.ts');
    const pidFile = path.join(temporary, 'private-pid.json');
    await writeFile(
        fixture,
        `
import { writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) {
    await new Promise((resolve) => setTimeout(resolve, ${versionDelayMs}));
    console.log('2.1.283 (Claude Code)'); process.exit(0);
}
if (${privateHostStartupDelayMs} > 0) await new Promise((resolve) => setTimeout(resolve, ${privateHostStartupDelayMs}));
writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify(process.pid));
process.on('SIGTERM', () => {});
if (${hostReadyDelayMs} > 0) await new Promise((resolve) => setTimeout(resolve, ${hostReadyDelayMs}));
const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + String.fromCharCode(10);
const evidence = JSON.stringify({ type: 'fixture', label: 'private-child-evidence' }) + String.fromCharCode(10);
const mode = ${JSON.stringify(mode)};
if (mode === 'resistant' || mode === 'driver-cleanup') {
    if (mode === 'driver-cleanup') process.stdout.write('FIXTURE_READY' + String.fromCharCode(10));
    setInterval(() => {}, 1000);
}
else if (mode === 'initial-input') {
    process.stdout.write(evidence, () => process.stdin.destroy());
    setInterval(() => {}, 1000);
} else {
    process.stdin.once('data', () => {
        if (mode === 'callback') process.stdout.write(evidence + result, () => process.exit(0));
        else { process.stdin.destroy(); process.stdout.write(evidence + result); setInterval(() => {}, 1000); }
    });
}
if (['resistant', 'initial-input', 'next-input', 'callback', 'callback-error'].includes(mode) && process.send) process.send('fixture-ready');
`,
        'utf8',
    );
    const helper = pathToFileURL(path.resolve('tests/smoke/claude-process.ts')).href;
    const driver = `
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const cp = createRequire(import.meta.url)('node:child_process');
const original = cp.spawn;
const owned = new Set();
let cleaning;
let readyHost;
let resistantChild;
let resistantClosed = false;
const resistantSignals = [];
let initialWriteAttempted = false;
function cleanup() {
    return cleaning ??= Promise.all([...owned].map((child) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Private fixture cleanup did not close.')), 3000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGKILL');
    })));
}
async function fail(error) {
    console.error(error);
    try { await cleanup(); } catch (cleanupError) { console.error(cleanupError); }
    process.exit(1);
}
process.on('message', () => { void fail(new Error('Outer private driver deadline requested cleanup.')); });
process.on('uncaughtException', (error) => { void fail(error); });
process.on('unhandledRejection', (error) => { void fail(error); });
cp.spawn = (executable, args, options) => {
    const selectedReadyHost = readyHost && executable === process.execPath && (args[0] === '-p' || (${JSON.stringify(mode)} === 'resistant' && args.length === 1 && args[0] === ${JSON.stringify(fixture)}));
    const child = selectedReadyHost ? readyHost : original(executable, executable === process.execPath && ['--version', '-p'].includes(args[0]) ? [${JSON.stringify(fixture)}, ...args] : args, options);
    owned.add(child);
    child.once('close', () => owned.delete(child));
    if (${JSON.stringify(mode)} === 'driver-cleanup')
        child.stdout.once('data', () => { if (process.connected) process.send('fixture-ready'); });
    if (args[0] === '-p' && ${JSON.stringify(mode)} === 'initial-input') {
        // Make input closure race a real pending write after fixture evidence
        // has arrived, instead of relying on OS pipe buffering timing.
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (input, callback) => {
            child.stdout.once('data', () => {
                child.stdin.end();
                initialWriteAttempted = true;
                write(input, callback);
            });
            return true;
        };
    }
    if (args[0] === '-p' && ${JSON.stringify(mode)} === 'next-input')
        child.stdout.once('data', () => child.stdin.end());
    if (${JSON.stringify(mode)} === 'resistant') {
        resistantChild = child;
        child.once('close', () => { resistantClosed = true; });
        // Windows cannot trap SIGTERM; simulate refusal only at this private
        // process I/O boundary, retaining native final termination and close.
        const kill = child.kill.bind(child);
        child.kill = (signal) => {
            const accepted = process.platform === 'win32' && signal !== 'SIGKILL' ? false : kill(signal);
            resistantSignals.push({ signal, accepted });
            return accepted;
        };
    }
    return child;
};
if (['resistant', 'initial-input', 'next-input', 'callback', 'callback-error'].includes(${JSON.stringify(mode)})) {
    // Interpreter startup precedes these experiments. Return the real ready child
    // at the spawn I/O boundary so the unchanged 300ms/400ms budgets test failures
    // after PID evidence, signal handling and the mode handler are established.
    const hostArguments = ${JSON.stringify(mode)} === 'resistant' ? [${JSON.stringify(fixture)}] : [${JSON.stringify(fixture)}, '-p'];
    readyHost = original(process.execPath, hostArguments, {
        cwd: process.cwd(), env: process.env, windowsHide: true, shell: false,
        stdio: [${JSON.stringify(mode)} === 'resistant' ? 'ignore' : 'pipe', 'pipe', 'pipe', 'ipc'],
    });
    owned.add(readyHost);
    readyHost.once('close', () => owned.delete(readyHost));
    await new Promise((resolve, reject) => {
        readyHost.once('message', (message) => message === 'fixture-ready' ? resolve() : reject(new Error('Unexpected private fixture readiness message.')));
        readyHost.once('error', reject);
        readyHost.once('exit', () => reject(new Error('Private fixture exited before failure-experiment readiness.')));
    });
}
syncBuiltinESMExports();
const { claudeCli, claudeHost } = await import(${JSON.stringify(helper)});
const mode = ${JSON.stringify(mode)};
let completedTurns = 0;
if (mode === 'resistant' || mode === 'driver-cleanup') await assert.rejects(() => claudeCli(process.execPath, [${JSON.stringify(fixture)}], ${JSON.stringify(temporary)}, 'http://127.0.0.1:32123', mode === 'driver-cleanup' ? 30000 : 300), /timed out/);
else await assert.rejects(() => claudeHost(process.execPath, ${JSON.stringify(temporary)}, 'http://127.0.0.1:32123', [], mode === 'initial-input' ? 'input'.repeat(400000) : 'initial', () => {
    completedTurns++;
    return mode === 'callback' ? new Promise(() => {}) : mode === 'callback-error' ? Promise.reject(new Error('next-turn-callback-failure')) : Promise.resolve('next'.repeat(400000));
}, 400), mode === 'callback' ? /timed out/ : mode === 'callback-error' ? /next-turn-callback-failure/ : /EPIPE|stdin|write after end|stream/i);
if (mode === 'resistant') {
    assert.ok(readyHost);
    assert.equal(resistantChild, readyHost, 'CLI timeout must operate on the actual ready owned fixture.');
    assert.deepEqual(resistantSignals, [{ signal: 'SIGTERM', accepted: process.platform !== 'win32' }, { signal: 'SIGKILL', accepted: true }]);
    assert.equal(resistantClosed, true, 'Resistant fixture close must precede CLI timeout rejection.');
    assert.equal(owned.has(readyHost), false);
}
if (mode === 'initial-input') {
    assert.equal(initialWriteAttempted, true, 'The initial-input failure must follow a real write to the ended stream.');
    assert.equal(completedTurns, 0, 'Initial input must fail before any completed turn.');
}
if (mode === 'next-input') assert.equal(completedTurns, 1, 'The closed-stream failure must follow a completed initial turn.');
if (mode === 'callback' || mode === 'callback-error') assert.equal(completedTurns, 1, 'The callback failure must follow a completed initial turn.');
console.log('CONTROLLED_FAILURE');
await cleanup();
process.disconnect();
`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], {
        cwd: path.join(temporary, 'workspace'),
        env: claudeEnvironment(temporary, 'http://127.0.0.1:32123'),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '',
        stderr = '',
        watchdog = false;
    assert.ok(child.stdout && child.stderr);
    child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk;
    });
    let driverClosed = false;
    const closed = new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => {
            driverClosed = true;
            resolve(code);
        });
    });
    let stopping: Promise<void> | undefined;
    const stopDriver = () =>
        (stopping ??= (async () => {
            if (driverClosed) return;
            if (child.connected) child.send('cleanup', () => {});
            if (await completesWithin(closed, 5000)) return;
            child.kill('SIGKILL');
            assert.ok(await completesWithin(closed, 2000), 'Private driver cleanup did not close.');
        })());
    let rejectDeadline: ((error: Error) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject;
    });
    const expire = () => {
        watchdog = true;
        void stopDriver().then(
            () => rejectDeadline?.(new Error('Private helper failed to settle before its deadline.')),
            (error: unknown) => rejectDeadline?.(error instanceof Error ? error : new Error(String(error))),
        );
    };
    // Driver, version CLI and host interpreter startup precede the unchanged
    // helper deadlines. Allow scheduling under the full concurrent test suite.
    let timer = setTimeout(expire, 15_000);
    child.on('message', (message: unknown) => {
        if (mode === 'driver-cleanup' && message === 'fixture-ready') {
            clearTimeout(timer);
            timer = setTimeout(expire, 500);
        }
    });
    try {
        const code = await Promise.race([closed, deadline]);
        assert.equal(watchdog, false, `Private helper failed to settle: ${stderr}`);
        assert.equal(code, 0, stderr);
        assert.ok(stdout.includes('CONTROLLED_FAILURE'), stderr);
        const pid: unknown = JSON.parse(await readFile(pidFile, 'utf8'));
        assert.ok(typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0);
        assert.throws(() => process.kill(pid, 0), /ESRCH|not found|no such process/i);
        if (mode !== 'resistant') {
            assert.ok(
                (await readFile(path.join(temporary, 'stdout.jsonl'), 'utf8')).includes('private-child-evidence'),
            );
            assert.equal(await readFile(path.join(temporary, 'stderr.log'), 'utf8'), '');
        }
        await afterEvidence?.(pidFile);
    } finally {
        clearTimeout(timer);
        await stopDriver();
        await rm(temporary, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
}

async function completesWithin(completion: Promise<unknown>, milliseconds: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            completion.then(() => true),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

for (const mode of ['resistant', 'callback', 'initial-input', 'next-input', 'callback-error'] as const)
    test(`private child ${mode} failure is bounded, contained and retains transcript evidence`, () =>
        adversarialHost(mode));

test('slow interpreter version startup preserves the bounded callback failure and transcript', () =>
    adversarialHost('callback', undefined, 2700));

test('slow private resistant startup establishes PID and signal readiness before its bounded timeout', () =>
    adversarialHost('resistant', undefined, 0, 0, 1000));

test('slow private host startup preserves the controlled next-input write failure and transcript', () =>
    adversarialHost('next-input', undefined, 0, 1000));

test('slow private host startup preserves the controlled initial-input write failure and transcript', () =>
    adversarialHost('initial-input', undefined, 0, 1000));

for (const mode of ['callback', 'callback-error'] as const)
    test(`slow private host startup preserves the controlled ${mode} failure and transcript`, () =>
        adversarialHost(mode, undefined, 0, 1000));

test('outer watchdog requests owned fixture cleanup before its private driver closes', async () => {
    await assert.rejects(() => adversarialHost('driver-cleanup'), /Private helper failed to settle/);
});

test('stale fixture PID evidence cannot terminate an unrelated private sentinel', async () => {
    const { temporary } = await sandbox(process.cwd(), 'cleanup-sentinel');
    const sentinel = spawn(
        process.execPath,
        [
            '-e',
            "process.on('message', () => process.send('alive')); process.send('ready'); setInterval(() => {}, 1000)",
        ],
        {
            cwd: path.join(temporary, 'workspace'),
            env: claudeEnvironment(temporary, 'http://127.0.0.1:32123'),
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
    );
    const closed = new Promise<void>((resolve) => sentinel.once('close', () => resolve()));
    try {
        await new Promise<void>((resolve, reject) => {
            sentinel.once('message', () => resolve());
            sentinel.once('error', reject);
        });
        assert.ok(sentinel.pid);
        await adversarialHost('callback-error', async (pidFile) => writeFile(pidFile, JSON.stringify(sentinel.pid)));
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('Unrelated sentinel was terminated by stale PID evidence.')),
                500,
            );
            sentinel.once('message', () => {
                clearTimeout(timer);
                resolve();
            });
            sentinel.send('probe', (error) => {
                if (error) {
                    clearTimeout(timer);
                    reject(error);
                }
            });
        });
    } finally {
        sentinel.kill('SIGKILL');
        await closed;
        await rm(temporary, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
});
