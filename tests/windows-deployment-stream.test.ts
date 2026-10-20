import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough, Writable } from 'node:stream';
import { after, mock, test } from 'node:test';

const forbidden = () => {
    throw new Error('Real process/native execution forbidden.');
};
mock.method(childProcess, 'spawn', forbidden);
const nativeSpawn = Object.getOwnPropertyDescriptor(childProcess.ChildProcess.prototype, 'spawn');
assert.ok(nativeSpawn);
Object.defineProperty(childProcess.ChildProcess.prototype, 'spawn', { ...nativeSpawn, value: forbidden });
mock.method(childProcess, 'execFile', forbidden);
mock.method(process, 'dlopen', forbidden);
syncBuiltinESMExports();
after(() => {
    Object.defineProperty(childProcess.ChildProcess.prototype, 'spawn', nativeSpawn);
    mock.restoreAll();
    syncBuiltinESMExports();
});
const { runWindowsDeploymentStream } = await import('../src/adapters/windows-deployment-stream.ts');

class Child extends EventEmitter {
    readonly pid = 42;
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly stdin: Writable;
    constructor(write: (bytes: Buffer, done: (error?: Error) => void) => void = (_bytes, done) => done()) {
        super();
        this.stdin = new Writable({
            write(bytes, _encoding, done) {
                write(bytes, done);
            },
            highWaterMark: 1,
        });
    }
    terminal(code = 0) {
        this.stdout.end();
        this.stderr.end();
        this.emit('exit', code, null);
        this.emit('close', code, null);
    }
}
async function* input() {
    yield Buffer.from('owned');
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('finite pump drains output above pipe capacity before stdin backpressure can complete', async () => {
    let child: Child;
    child = new Child((_bytes, done) => {
        // No output consumer means a blocked child cannot acknowledge this input write.
        if (child.stdout.write(Buffer.alloc(256 * 1024, 0x61))) done();
        else child.stdout.once('drain', done);
    });
    child.stdin.on('finish', () => child.terminal());
    const bytes = await runWindowsDeploymentStream(child, input(), { stdout: 512 * 1024, stderr: 65536 });
    assert.equal(bytes.length, 256 * 1024);
    assert.ok(bytes.every((byte) => byte === 0x61));
});

test('input EOF is sent without waiting for a reply or child exit', async () => {
    const child = new Child();
    child.stdin.on('finish', () => {
        child.stdout.write('reply');
        child.terminal();
    });
    assert.equal((await runWindowsDeploymentStream(child, input(), { stdout: 100, stderr: 100 })).toString(), 'reply');
});

test('source primary failure survives EPIPE and retains accounting until late actual terminal', async () => {
    const child = new Child();
    const source = new Error('independent source failed');
    async function* fail() {
        yield await Promise.reject<Buffer>(source);
    }
    let settled = false;
    const pending = runWindowsDeploymentStream(child, fail(), { stdout: 100, stderr: 100 }).finally(() => {
        settled = true;
    });
    const outcome = assert.rejects(pending, (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], source);
        return true;
    });
    await turn();
    assert.equal(settled, false);
    child.stdin.emit('error', Object.assign(new Error('pipe closed'), { code: 'EPIPE' }));
    child.terminal(1);
    await outcome;
});

test('output overflow stops bodies but continues draining until process and stdio terminal', async () => {
    const child = new Child();
    child.stdout.write(Buffer.alloc(200));
    let settled = false;
    const pending = runWindowsDeploymentStream(child, input(), { stdout: 100, stderr: 100 }).finally(() => {
        settled = true;
    });
    const outcome = assert.rejects(pending, /output|failures/);
    await turn();
    assert.equal(settled, false);
    child.stdout.write(Buffer.alloc(200));
    child.terminal(1);
    await outcome;
});

test('cancel stops feed without treating cancellation or close-before-exit as actual exit', async () => {
    const child = new Child();
    const controller = new AbortController();
    let settled = false;
    const pending = runWindowsDeploymentStream(child, input(), { stdout: 100, stderr: 100 }, controller.signal).finally(
        () => {
            settled = true;
        },
    );
    const outcome = assert.rejects(pending);
    controller.abort(new Error('detached'));
    child.emit('close', 0, null);
    child.stdout.end();
    child.stderr.end();
    await turn();
    assert.equal(settled, false);
    child.emit('exit', 0, null);
    await outcome;
});

test('early child rejection does not require stdin drain or replace native error with EPIPE', async () => {
    const child = new Child((_bytes, _done) => {});
    const pending = runWindowsDeploymentStream(child, input(), { stdout: 100, stderr: 100 });
    const outcome = assert.rejects(pending, (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        const first: unknown = error.errors[0];
        assert.ok(first instanceof Error && typeof first.cause === 'object' && first.cause !== null);
        assert.ok('stderr' in first.cause && Buffer.isBuffer(first.cause.stderr));
        assert.equal(first.cause.stderr.toString(), 'header rejected');
        return true;
    });
    await turn();
    child.stderr.write('header rejected');
    child.terminal(1);
    await outcome;
});

test('failure during a header write never requests the next source body and still owns iterator finally', async () => {
    const controller = new AbortController();
    const primary = new Error('header-phase failure'),
        close = new Error('source finally close failure');
    let requested = 0,
        closed = 0;
    async function* source() {
        try {
            requested++;
            yield Buffer.from('header');
            requested++;
            yield Buffer.from('body');
        } finally {
            closed++;
            await Promise.reject(close);
        }
    }
    const child = new Child((_bytes, done) => {
        controller.abort(primary);
        done();
    });
    child.stdin.once('close', () => child.terminal(1));
    await assert.rejects(
        runWindowsDeploymentStream(child, source(), { stdout: 100, stderr: 100 }, controller.signal),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors[0], primary);
            assert.ok(error.errors.includes(close));
            return true;
        },
    );
    assert.equal(requested, 1);
    assert.equal(closed, 1);
});
