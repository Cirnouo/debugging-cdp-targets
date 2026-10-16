import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
    createNativeResourceAssembly,
    type NativeAssemblyCompile,
    type NativeAssemblyScope,
} from './fixtures/native-resource-assembly.ts';
import { createNativeResourceLog } from './fixtures/native-resource-log.ts';
import { retainExitWitness } from './fixtures/native-resource-witness.ts';

function gate<T = void>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
class Child extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
}
function compiler() {
    const started = gate();
    const child = new Child();
    let complete: Parameters<NativeAssemblyCompile>[2] = () => {};
    let output = '';
    let count = 0;
    const compile: NativeAssemblyCompile = (args, options, callback) => {
        count++;
        assert.deepEqual(options, { windowsHide: true, shell: false, timeout: 60_000, maxBuffer: 262144 });
        assert.equal(args.at(-2), '-NativeAssembly');
        output = args.at(-1) ?? '';
        complete = callback;
        started.resolve();
        return child;
    };
    return {
        compile,
        started,
        child,
        count: () => count,
        output: () => output,
        fail: (error: Error) => complete(error, ''),
        missing() {
            complete(null, 'dct-native-assembly-ready');
            child.emit('close', 0, null);
        },
        async succeed(
            content = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(126)]),
            receipt = 'dct-native-assembly-ready',
            close = true,
        ) {
            await writeFile(output, content);
            complete(null, receipt);
            if (close) child.emit('close', 0, null);
        },
    };
}

test('one gated compilation precedes all case consumers and disposal rejects future cases', async () => {
    const io = compiler();
    const owner = createNativeResourceAssembly({ platform: 'win32', compile: io.compile });
    let consumers = 0;
    const use = (scope: { nativeAssembly: string }) => {
        consumers++;
        return scope.nativeAssembly;
    };
    const first = owner.run(use);
    const second = owner.run(use);
    await io.started.promise;
    assert.equal(consumers, 0);
    assert.equal(io.count(), 1);
    await io.succeed(undefined, undefined, false);
    assert.equal(consumers, 0, 'compiler callback cannot substitute for physical close');
    io.child.emit('close', 0, null);
    assert.equal(await first, await second);
    assert.equal(consumers, 2);
    const assembly = await first;
    assert.equal(await owner.run(use), assembly);
    assert.equal(io.count(), 1);
    assert.match(assembly, /中文 \[owned\]/);
    await owner.dispose();
    await assert.rejects(access(path.dirname(assembly)), { code: 'ENOENT' });
    await assert.rejects(owner.run(use), /closing/);
});

for (const failure of ['compiler', 'timeout', 'partial', 'missing', 'receipt'] as const) {
    test(`preparation ${failure} fails closed without retry and retains its owned output`, async () => {
        const io = compiler();
        const owner = createNativeResourceAssembly({ platform: 'win32', compile: io.compile });
        let consumers = 0;
        const action = () => {
            consumers++;
        };
        const pending = owner.run(action);
        const rejected = assert.rejects(pending, /retained/);
        await io.started.promise;
        if (failure === 'compiler' || failure === 'timeout') io.fail(new Error(failure));
        else if (failure === 'missing') {
            io.missing();
        } else
            await io.succeed(
                failure === 'partial' ? Buffer.from('MZ') : undefined,
                failure === 'receipt' ? '' : undefined,
            );
        await rejected;
        await assert.rejects(owner.run(action), /retained/);
        assert.equal(io.count(), 1);
        assert.equal(consumers, 0);
        const directory = path.dirname(io.output());
        assert.equal(owner.retainedDirectory, directory);
        await owner.dispose();
        await access(directory);
        // A callback rejection/timeout cannot establish compiler descendant exit.
        io.child.emit('close', 1, null);
        await access(directory);
        await rm(directory, { recursive: true, force: true });
    });
}

test('non-Windows preparation does not acquire a directory or invoke PowerShell', async () => {
    const io = compiler();
    const owner = createNativeResourceAssembly({ platform: 'linux', compile: io.compile });
    await assert.rejects(
        owner.run(() => assert.fail('consumer launched')),
        /Windows/,
    );
    assert.equal(io.count(), 0);
    assert.equal(owner.retainedDirectory, undefined);
    await owner.dispose();
});

test('disposal waits for pending case continuation and its late cleanup witness physical close', async () => {
    const io = compiler();
    let caseSettled = false;
    let helperClosed = false;
    const owner = createNativeResourceAssembly({
        platform: 'win32',
        compile: io.compile,
        remove: async (directory) => {
            assert.equal(caseSettled, true, 'case continuation must settle before directory removal');
            assert.equal(helperClosed, true, 'late DLL helper must physically close before directory removal');
            await rm(directory, { recursive: true, force: true });
        },
    });
    const entered = gate();
    const late = gate();
    const registered = gate();
    const child = new Child();
    const action = owner.run(async (scope) => {
        entered.resolve();
        await late.promise;
        scope.trackChild(child);
        registered.resolve();
        caseSettled = true;
    });
    await io.started.promise;
    await io.succeed();
    await entered.promise;
    let removed = false;
    const disposal = owner.dispose().then(() => {
        removed = true;
    });
    void disposal.catch(() => {});
    await access(io.output());
    assert.equal(removed, false);
    late.resolve();
    await registered.promise;
    await action;
    await access(io.output());
    assert.equal(removed, false);
    helperClosed = true;
    child.emit('close', 0, null);
    await disposal;
    await assert.rejects(access(io.output()), { code: 'ENOENT' });
});

test('rejected witness evidence and partial case failure retain assembly until actual helper close', async () => {
    const io = compiler();
    let helperClosed = false;
    const owner = createNativeResourceAssembly({
        platform: 'win32',
        compile: io.compile,
        remove: async (directory) => {
            assert.equal(helperClosed, true, 'rejected evidence cannot release a DLL still used by a helper');
            await rm(directory, { recursive: true, force: true });
        },
    });
    const child = new Child();
    const observed = gate();
    const primary = new Error('partial initialization');
    const action = owner.run(async (scope) => {
        const log = createNativeResourceLog('group-normal', { sink: () => {} });
        const witness = retainExitWitness(123, 'root', 'initial-arming', log, () => child, scope);
        child.stderr.emit('error', new Error('pipe failed'));
        await assert.rejects(witness.armed);
        await assert.rejects(witness.exited);
        observed.resolve();
        throw primary;
    });
    const failed = assert.rejects(action, (error: unknown) => error === primary);
    await io.started.promise;
    await io.succeed();
    await observed.promise;
    await failed;
    let removed = false;
    const disposal = owner.dispose().then(() => {
        removed = true;
    });
    void disposal.catch(() => {});
    assert.equal((await readFile(io.output())).subarray(0, 2).toString(), 'MZ');
    assert.equal(removed, false);
    helperClosed = true;
    child.emit('close', 1, null);
    await disposal;
    await assert.rejects(access(io.output()), { code: 'ENOENT' });
});

test('a settled case cannot launch a future witness while the owner is closing', async () => {
    const io = compiler();
    const owner = createNativeResourceAssembly({ platform: 'win32', compile: io.compile });
    const acquired = owner.run((scope) => scope);
    await io.started.promise;
    await io.succeed();
    const scope: NativeAssemblyScope = await acquired;
    const closing = owner.dispose();
    let spawns = 0;
    const log = createNativeResourceLog('group-normal', { sink: () => {} });
    try {
        const witness = retainExitWitness(
            123,
            'late',
            'late-arming',
            log,
            () => {
                spawns++;
                return new Child();
            },
            scope,
        );
        await assert.rejects(witness.exited);
    } catch (error) {
        assert.match(String(error), /settled/);
    }
    assert.equal(spawns, 0, 'stale lease must be rejected before PowerShell is created');
    await closing;
});
