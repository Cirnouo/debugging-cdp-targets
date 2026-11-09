import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';

type DeploymentChild = EventEmitter & {
    readonly pid?: number | undefined;
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
};

/** Own one already spawned fixed deployment child through actual exit and all stdio terminals. */
export async function runWindowsDeploymentStream(
    child: DeploymentChild,
    input: AsyncIterable<Buffer>,
    maximum: Readonly<{ stdout: number; stderr: number }>,
    signal?: AbortSignal,
): Promise<Buffer> {
    if (
        !Number.isSafeInteger(maximum.stdout) ||
        maximum.stdout < 1 ||
        maximum.stdout > 16 * 1024 * 1024 ||
        !Number.isSafeInteger(maximum.stderr) ||
        maximum.stderr < 1 ||
        maximum.stderr > 65536
    )
        throw new Error('Invalid deployment pipe bounds.');
    const failures: unknown[] = [];
    const output: Buffer[] = [];
    const errorOutput: Buffer[] = [];
    const nativeCause = { stderr: Buffer.alloc(0), bytes: 0 };
    let outputSize = 0;
    let errorSize = 0;
    let stopped = false;
    let inputEnded = false;
    let inputFinished = false;
    let exited = false;
    let spawnFailed = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let resolveExit = () => {};
    const actualExit = new Promise<void>((resolve) => {
        resolveExit = resolve;
    });
    function stop() {
        stopped = true;
        if (!child.stdin.destroyed) child.stdin.destroy();
    }
    function fail(error: unknown) {
        if (!failures.includes(error)) failures.push(error);
        stop();
    }
    const abort = () => fail(signal?.reason ?? new Error('Deployment input cancelled.'));
    function drain(stream: Readable, errors: boolean): Promise<void> {
        return new Promise((resolve) => {
            let ended = false;
            stream.on('data', (bytes: unknown) => {
                if (!Buffer.isBuffer(bytes)) {
                    fail(new Error('Invalid deployment pipe data.'));
                    return;
                }
                if (errors) {
                    const available = Math.max(0, maximum.stderr - errorSize);
                    if (available) errorOutput.push(Buffer.from(bytes.subarray(0, available)));
                    errorSize += bytes.length;
                    if (errorSize === bytes.length && bytes.length)
                        fail(new Error('Deployment helper reported an error.', { cause: nativeCause }));
                    if (errorSize > maximum.stderr && errorSize - bytes.length <= maximum.stderr)
                        fail(new Error('Deployment stderr exceeds bound.'));
                } else {
                    outputSize += bytes.length;
                    if (outputSize <= maximum.stdout) output.push(Buffer.from(bytes));
                    else if (outputSize - bytes.length <= maximum.stdout)
                        fail(new Error('Deployment output exceeds bound.'));
                }
                // Keep draining after failure without retaining any additional bytes.
            });
            stream.on('error', fail);
            stream.once('end', () => {
                ended = true;
                resolve();
            });
            stream.once('close', () => {
                if (!ended) fail(new Error('Deployment output closed before EOF.'));
                resolve();
            });
        });
    }
    // Attach all readers/terminal observers before requesting the first source chunk.
    const stdout = drain(child.stdout, false);
    const stderr = drain(child.stderr, true);
    const stdin = new Promise<void>((resolve) => {
        child.stdin.once('finish', () => {
            inputFinished = true;
            resolve();
        });
        child.stdin.once('close', resolve);
        child.stdin.on('error', fail);
    });
    child.on('error', (error: Error) => {
        spawnFailed = child.pid === undefined;
        fail(error);
    });
    child.once('exit', (code: number | null, termination: NodeJS.Signals | null) => {
        exited = true;
        exitCode = code;
        exitSignal = termination;
        if (code !== 0 || termination) fail(new Error(`Deployment helper exit ${code}/${termination}.`));
        else if (!inputEnded) fail(new Error('Deployment helper exited before input EOF.'));
        resolveExit();
    });
    const closed = new Promise<void>((resolve) => {
        child.once('close', (code: number | null, termination: NodeJS.Signals | null) => {
            if (spawnFailed && !exited) resolveExit();
            if (exited && (exitCode !== code || exitSignal !== termination))
                fail(new Error('Deployment exit/close results disagree.'));
            resolve();
        });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    async function write(bytes: Buffer) {
        if (stopped) return;
        await new Promise<void>((resolve, reject) => {
            const error = (problem: Error) => {
                cleanup();
                reject(problem);
            };
            const close = () => {
                cleanup();
                reject(new Error('Deployment input closed during write.'));
            };
            const cleanup = () => {
                child.stdin.removeListener('error', error);
                child.stdin.removeListener('close', close);
            };
            child.stdin.once('error', error);
            child.stdin.once('close', close);
            // Callback completion is the writable's backpressure/ownership barrier.
            child.stdin.write(bytes, (problem?: Error | null) => {
                cleanup();
                if (problem) reject(problem);
                else resolve();
            });
        });
    }
    const feed = (async () => {
        let iterator: AsyncIterator<Buffer> | undefined;
        let completed = false;
        try {
            iterator = input[Symbol.asyncIterator]();
            while (!stopped) {
                const next = await iterator.next();
                if (next.done) {
                    completed = true;
                    break;
                }
                if (stopped) break;
                const bytes = next.value;
                if (!Buffer.isBuffer(bytes)) throw new Error('Invalid deployment source chunk.');
                await write(bytes);
            }
            if (!stopped && completed) {
                inputEnded = true;
                child.stdin.end();
            }
        } catch (error) {
            fail(error);
        } finally {
            if (iterator && !completed && iterator.return) {
                try {
                    await iterator.return();
                } catch (error) {
                    fail(error);
                }
            }
        }
    })();
    try {
        await Promise.all([feed, actualExit, closed, stdout, stderr, stdin]);
        nativeCause.stderr = Buffer.concat(errorOutput);
        nativeCause.bytes = errorSize;
        if (!failures.length && (!exited || exitCode !== 0 || exitSignal || !inputEnded || !inputFinished))
            fail(new Error('Incomplete deployment helper terminal.'));
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, 'Deployment stream/resource failures.');
        return Buffer.concat(output, outputSize);
    } finally {
        signal?.removeEventListener('abort', abort);
    }
}
