import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeEnvironment, claudeVersion, record } from './claude-host.ts';

function privateChildDeadline(child: ChildProcess, timeoutMs: number, description: string) {
    let closed = false;
    let reason: Error | undefined;
    let signalFailure: unknown;
    let finalSignal: NodeJS.Timeout | undefined;
    let cleanupDeadline: NodeJS.Timeout | undefined;
    let rejectFailure: (error: Error) => void = () => {};
    const failed = new Promise<never>((_resolve, reject) => {
        rejectFailure = reject;
    });
    // Failure can precede the caller attaching its completion race.
    void failed.catch(() => {});
    function signal(signalName: NodeJS.Signals) {
        try {
            child.kill(signalName);
        } catch (error) {
            signalFailure = error;
        }
    }
    function fail(error: unknown) {
        if (reason) return;
        reason = error instanceof Error ? error : new Error(String(error));
        if (closed) {
            rejectFailure(reason);
            return;
        }
        child.stdin?.destroy();
        // These signals identify only the private Claude/Node child spawned by
        // this smoke helper. They are never used to close target applications.
        signal('SIGTERM');
        finalSignal = setTimeout(() => {
            if (!closed) signal('SIGKILL');
        }, 250);
        cleanupDeadline = setTimeout(() => {
            child.stdout?.destroy();
            child.stderr?.destroy();
            child.unref();
            rejectFailure(
                new AggregateError(
                    [reason, ...(signalFailure ? [signalFailure] : [])],
                    `Private smoke child cleanup was not confirmed for PID ${child.pid}.`,
                ),
            );
        }, 750);
    }
    const completion = new Promise<number | null>((resolve) => {
        child.once('close', (code) => {
            closed = true;
            clearTimeout(finalSignal);
            clearTimeout(cleanupDeadline);
            if (reason) rejectFailure(reason);
            resolve(code);
        });
    });
    child.on('error', fail);
    child.stdin?.on('error', fail);
    const timeout = setTimeout(() => fail(new Error(description)), timeoutMs);
    return {
        completion,
        failed,
        fail,
        get reason() {
            return reason;
        },
        dispose() {
            clearTimeout(timeout);
            clearTimeout(finalSignal);
            clearTimeout(cleanupDeadline);
        },
    };
}

export async function sandbox(repository: string, label: string) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), `dct-claude-${label}-`));
    const relative = path.relative(repository, temporary);
    assert.ok(
        relative.startsWith('..') || path.isAbsolute(relative),
        'Claude workspace must be outside the repository.',
    );
    await Promise.all(
        ['home', 'config', 'workspace', 'temp', 'appdata', 'localappdata'].map((folder) =>
            mkdir(path.join(temporary, folder)),
        ),
    );
    return { temporary, workspace: path.join(temporary, 'workspace') };
}

export async function claudeCli(
    executable: string,
    args: string[],
    temporary: string,
    endpoint: string,
    timeoutMs = 60_000,
) {
    const child = spawn(executable, args, {
        cwd: path.join(temporary, 'workspace'),
        env: claudeEnvironment(temporary, endpoint),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
        stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
    });
    const deadline = privateChildDeadline(child, timeoutMs, `Actual isolated Claude CLI timed out: ${args.join(' ')}`);
    let code: number | null;
    try {
        code = await Promise.race([deadline.completion, deadline.failed]);
        if (deadline.reason) await deadline.failed;
    } catch (error) {
        await writeFile(
            path.join(temporary, 'cli-failure.json'),
            JSON.stringify({ args, stdout, stderr, error: String(error) }, null, 4),
        );
        throw error;
    } finally {
        deadline.dispose();
    }
    assert.equal(code, 0, stderr || stdout);
    return stdout;
}

export async function claudeHost(
    executable: string,
    temporary: string,
    endpoint: string,
    extra: string[],
    prompt: string,
    afterResult?: (index: number) => Promise<string | undefined>,
    timeoutMs = 90_000,
) {
    const version = claudeVersion(await claudeCli(executable, ['--version'], temporary, endpoint));
    const args = [
        '-p',
        '--no-session-persistence',
        '--no-chrome',
        '--model',
        'claude-sonnet-4-6',
        '--tools',
        '',
        '--permission-mode',
        'dontAsk',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--setting-sources',
        'user',
        '--include-hook-events',
        '--debug-file',
        path.join(temporary, 'debug.log'),
        ...extra,
    ];
    const env = claudeEnvironment(temporary, endpoint);
    await writeFile(
        path.join(temporary, 'launch.json'),
        JSON.stringify({ executable, args, cwd: path.join(temporary, 'workspace'), env }, null, 4),
    );
    const child = spawn(executable, args, {
        cwd: path.join(temporary, 'workspace'),
        env,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const events: Record<string, unknown>[] = [];
    let stdout = '',
        stderr = '',
        pending = '',
        count = 0,
        failure: unknown;
    let processing = Promise.resolve();
    const deadline = privateChildDeadline(child, timeoutMs, 'Actual isolated Claude timed out.');
    const send = (text: string): Promise<void> => {
        if (deadline.reason || child.stdin.destroyed || child.stdin.writableEnded)
            return Promise.reject(new Error('Actual isolated Claude stdin closed before input delivery.'));
        return new Promise((resolve, reject) => {
            child.stdin.write(
                `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`,
                (error) => (error ? reject(error) : resolve()),
            );
        });
    };
    child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        pending += chunk.toString();
        while (pending.includes('\n')) {
            const index = pending.indexOf('\n');
            const line = pending.slice(0, index);
            pending = pending.slice(index + 1);
            if (!line.trim()) continue;
            processing = processing
                .then(async () => {
                    const event: unknown = JSON.parse(line);
                    assert.ok(record(event));
                    events.push(event);
                    if (event.type === 'result') {
                        assert.equal(event.is_error, false, JSON.stringify(event));
                        assert.equal(event.subtype, 'success', JSON.stringify(event));
                        count++;
                        const next = await afterResult?.(count);
                        if (next) await send(next);
                        else child.stdin.end();
                    }
                })
                .catch((error: unknown) => {
                    deadline.fail(error);
                });
        }
    });
    child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    let code: number | null | undefined;
    try {
        code = await Promise.race([
            (async () => {
                try {
                    await send(prompt);
                    const value = await deadline.completion;
                    await processing;
                    if (deadline.reason) await deadline.failed;
                    return value;
                } catch (error) {
                    deadline.fail(error);
                    return await deadline.failed;
                }
            })(),
            deadline.failed,
        ]);
    } catch (error) {
        failure = error;
    } finally {
        deadline.dispose();
        await Promise.all([
            writeFile(path.join(temporary, 'stdout.jsonl'), stdout),
            writeFile(path.join(temporary, 'stderr.log'), stderr),
        ]);
    }
    if (failure) throw failure;
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '', 'Unexpected actual Claude stderr.');
    assert.ok(count > 0, 'Actual Claude omitted a successful turn result.');
    const init = events.find((event) => event.type === 'system' && event.subtype === 'init');
    assert.ok(init && init.apiKeySource === 'ANTHROPIC_API_KEY');
    assert.equal(init.claude_code_version, version);
    assert.equal(path.resolve(String(init.cwd)), path.join(temporary, 'workspace'));
    assert.equal(init.analytics_disabled, true);
    assert.equal(init.product_feedback_disabled, true);
    assert.ok(record(init.memory_paths) && typeof init.memory_paths.auto === 'string');
    const memory = path.relative(path.join(temporary, 'config'), init.memory_paths.auto);
    assert.ok(
        memory && !memory.startsWith('..') && !path.isAbsolute(memory),
        'Actual Claude memory must stay in isolated configuration.',
    );
    return { version, events, init };
}
