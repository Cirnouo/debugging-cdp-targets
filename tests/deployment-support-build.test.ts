import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { after, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspect, promisify } from 'node:util';
import { isRecord } from '../src/shared/errors.ts';
import {
    ownedDeploymentPe,
    ownedWindowsDeploymentCompiler,
    ownedWindowsDeploymentNative,
} from './fixtures/deployment-support.ts';

const fixedWindows = process.platform === 'win32' && process.arch === 'x64';

const forbidden = () => {
    throw new Error('Real deployment support process/native execution forbidden.');
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
const { inspectWindowsDeploymentExecutable, buildWindowsDeploymentSupport } = await import(
    '../src/adapters/windows-deployment-support.ts'
);
const { openDeploymentNativeAuthority, createFreshDeploymentRoot } = await import(
    '../src/adapters/app-deployment-native.ts'
);
const { createFreshDeploymentInstallation } = await import('../src/adapters/app-deployment.ts');
const { encodeWindowsDeploymentCopyHeader } = await import('../src/adapters/windows-deployment-protocol.ts');

test('support build refuses non-PE, wrong architecture, native entry, library and unknown CLR before materialization', () => {
    assert.deepEqual(inspectWindowsDeploymentExecutable(ownedDeploymentPe()), {
        machine: 'x64',
        runtime: 'v4.0.30319',
    });
    const mutations = [
        (bytes: Buffer) => bytes.writeUInt16LE(0x14c, 0x84),
        (bytes: Buffer) => bytes.writeUInt16LE(0x2022, 0x96),
        (bytes: Buffer) => bytes.writeUInt32LE(0, 0x214),
        (bytes: Buffer) => bytes.writeUInt32LE(3, 0x210),
        (bytes: Buffer) => bytes.writeUInt32LE(0x11, 0x210),
        (bytes: Buffer) => bytes.write('v2.0.50727\0', 0x290),
        (bytes: Buffer) => bytes.writeUInt32LE(0xfffffff0, 0x19c),
    ];
    for (const mutate of mutations) {
        const bytes = ownedDeploymentPe();
        mutate(bytes);
        assert.throws(() => inspectWindowsDeploymentExecutable(bytes));
    }
    assert.throws(() => inspectWindowsDeploymentExecutable(Buffer.from('not executable')));
});

test('pre-native guard also rejects execFile custom-promisify retained executors', async () => {
    await assert.rejects(async () => promisify(childProcess.execFile)(process.execPath, ['--version']), /forbidden/);
});

test('fixed builder owns both real source sets, refuses concurrent build and releases only owned artifacts', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    const support = await buildWindowsDeploymentSupport();
    assert.equal(fixture.compiles(), 2);
    const sourceDirectory = fileURLToPath(new URL('../src/adapters/', import.meta.url));
    assert.deepEqual(
        support.receipt.inputs.filter((input) => input.path.endsWith('.cs')).map((input) => input.path),
        ['windows-deployment-authority.cs', 'windows-deployment-create.cs'].map((name) =>
            path.join(sourceDirectory, name),
        ),
    );
    for (const input of support.receipt.inputs.filter((input) => input.path.endsWith('.cs')))
        assert.equal(
            input.sha256,
            createHash('sha256')
                .update(await fs.readFile(input.path))
                .digest('hex'),
        );
    await assert.rejects(buildWindowsDeploymentSupport(), /exist|collision|busy/i);
    assert.deepEqual((await fs.readdir(fixture.outputs)).sort(), [
        '.windows-deployment-build.lock',
        'windows-deployment-create.exe',
        'windows-deployment-query.exe',
    ]);
    await support.release();
    assert.deepEqual(await fs.readdir(fixture.outputs), []);
});

test('unsupported build architecture rejects before compiler or source filesystem selection', {
    skip: !fixedWindows,
}, async () => {
    const architecture = Object.getOwnPropertyDescriptor(process, 'arch');
    assert.ok(architecture);
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    try {
        await assert.rejects(buildWindowsDeploymentSupport(), /Windows x64/);
    } finally {
        Object.defineProperty(process, 'arch', architecture);
    }
});

test('fresh root with valid UTF-16 but unrepresentable UTF-8 native reply refuses before all fresh effects', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentNative(t);
    const directory = `C:\\${Array.from({ length: 60 }, (_, index) => '界'.repeat(216) + 'a'.repeat(index < 47 ? 8 : 7)).join('\\')}a`;
    await assert.rejects(createFreshDeploymentRoot(directory), /reply|record/);
    assert.equal(fixture.compiles(), 0);
    assert.equal(fixture.queries(), 0);
    assert.equal(fixture.mutations(), 0);
    assert.deepEqual(await fs.readdir(fixture.outputs), []);
});

test('compiler input drift during the first controlled compilation rejects before executable materialization', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    const compile = childProcess.execFile;
    t.mock.method(childProcess, 'execFile', (...args: Parameters<typeof childProcess.execFile>) => {
        const callback = args.at(-1);
        if (typeof callback !== 'function') throw new Error('Controlled compiler callback is required.');
        return Reflect.apply(compile, childProcess, [
            ...args.slice(0, -1),
            async (...reply: unknown[]) => {
                await fs.appendFile(path.join(fixture.root, 'csc.exe'), 'changed');
                Reflect.apply(callback, undefined, reply);
            },
        ]);
    });
    syncBuiltinESMExports();
    try {
        await assert.rejects(buildWindowsDeploymentSupport(), /changed|Unsafe deployment build input/);
    } catch (error) {
        try {
            const diagnostic = inspect(
                { assertion: error, actual: isRecord(error) ? error.actual : undefined },
                {
                    showHidden: true,
                    customInspect: false,
                    getters: false,
                    depth: 12,
                    maxArrayLength: 64,
                    maxStringLength: 16384,
                    compact: false,
                    breakLength: 120,
                },
            );
            const maximum = 16384;
            const truncated = '\n[diagnostic truncated at 16384 characters]';
            t.diagnostic(
                diagnostic.length > maximum
                    ? `${diagnostic.slice(0, maximum - truncated.length)}${truncated}`
                    : diagnostic,
            );
        } catch {
            // Diagnostics must never replace the original assertion failure.
        }
        throw error;
    }
    assert.equal(fixture.compiles(), 1);
    assert.deepEqual(await fs.readdir(fixture.outputs), []);
});

test('post-build replacement rejects before spawn and release never unlinks a foreign identity', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    const support = await buildWindowsDeploymentSupport();
    const query = path.join(fixture.outputs, 'windows-deployment-query.exe');
    await fs.rename(query, path.join(fixture.outputs, 'retained-original'));
    await fs.writeFile(query, ownedDeploymentPe());
    await assert.rejects(support.query(['C:\\owned']), /identity|changed|replacement/i);
    await assert.rejects(support.release(), /identity|changed|replacement/i);
    assert.ok((await fs.readdir(fixture.outputs)).includes('windows-deployment-query.exe'));
});

test('materialization rejects a same-byte replacement between exclusive descriptor close and first readback record', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    const acquire = fs.open;
    const query = path.join(fixture.outputs, 'windows-deployment-query.exe');
    let closes = 0;
    let original: BigIntStats | undefined;
    let replacement: BigIntStats | undefined;
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await acquire(...args);
        if (String(args[0]).endsWith('windows-deployment-query.exe') && args[1] === 'wx') {
            original = await handle.stat({ bigint: true });
            const close = handle.close.bind(handle);
            handle.close = async () => {
                closes++;
                await close();
                const expectedBytes = await fs.readFile(query);
                await fs.rename(query, path.join(fixture.outputs, 'retained-original'));
                await fs.writeFile(query, expectedBytes);
                replacement = await fs.lstat(query, { bigint: true });
                assert.ok(original && replacement.ino !== original.ino);
                assert.equal(replacement.nlink, 1n);
                assert.deepEqual(await fs.readFile(query), expectedBytes);
            };
        }
        return handle;
    });
    syncBuiltinESMExports();
    let accepted = false;
    let failure: unknown;
    try {
        const support = await buildWindowsDeploymentSupport();
        accepted = true;
        await support.release();
    } catch (error) {
        failure = error;
    }
    let retained: BigIntStats | undefined;
    try {
        retained = await fs.lstat(query, { bigint: true });
    } catch (error) {
        assert.ok(isRecord(error) && error.code === 'ENOENT');
    }
    t.diagnostic(
        JSON.stringify({ accepted, closes, replacementRetained: !!retained, controlledCompiles: fixture.compiles() }),
    );
    assert.equal(accepted, false, 'A same-byte foreign inode must never become a successful owned artifact.');
    assert.ok(failure instanceof Error);
    assert.match(failure.message, /materialization.*identity|identity.*materialization/i);
    assert.equal(closes, 1);
    assert.equal(fixture.compiles(), 1);
    assert.ok(retained && replacement && retained.dev === replacement.dev && retained.ino === replacement.ino);
    assert.deepEqual(await fs.readFile(query), ownedDeploymentPe());
});

test('materialization descriptor stat failure closes the actual owned handle and aggregates a real close failure', {
    skip: !fixedWindows,
}, async (t) => {
    for (const closeFails of [false, true])
        await t.test(closeFails ? 'stat and close' : 'stat only', async (context) => {
            const fixture = await ownedWindowsDeploymentCompiler(context),
                acquire = fs.open;
            const primary = new Error('materialization descriptor stat failure');
            const secondary = new Error('materialization actual close failure');
            let closes = 0,
                accepted = false,
                failure: unknown;
            context.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
                const handle = await acquire(...args);
                if (String(args[0]).endsWith('windows-deployment-query.exe') && args[1] === 'wx') {
                    const close = handle.close.bind(handle);
                    handle.stat = async () => {
                        throw primary;
                    };
                    handle.close = async () => {
                        closes++;
                        await close();
                        if (closeFails) throw secondary;
                    };
                }
                return handle;
            });
            syncBuiltinESMExports();
            try {
                const support = await buildWindowsDeploymentSupport();
                accepted = true;
                await support.release();
            } catch (error) {
                failure = error;
            }
            assert.equal(accepted, false, 'Materialization cannot succeed without its actual descriptor identity.');
            if (closeFails) {
                assert.ok(failure instanceof AggregateError);
                assert.deepEqual(failure.errors, [primary, secondary]);
            } else assert.equal(failure, primary);
            assert.equal(closes, 1);
            assert.equal(fixture.compiles(), 1);
            assert.deepEqual(await fs.readdir(fixture.outputs), ['windows-deployment-query.exe']);
        });
});

test('existing executable is never a fallback or adopted compiler output', { skip: !fixedWindows }, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    await fs.writeFile(path.join(fixture.outputs, 'windows-deployment-query.exe'), ownedDeploymentPe());
    await assert.rejects(buildWindowsDeploymentSupport(), /exist|collision/i);
    assert.equal(fixture.compiles(), 0);
});

test('reservation stat failure still closes its owned handle without deleting an unverified named identity', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    const acquire = fs.open;
    const primary = new Error('reservation identity unavailable');
    let closes = 0;
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await acquire(...args);
        if (String(args[0]).endsWith('.windows-deployment-build.lock')) {
            const close = handle.close.bind(handle);
            t.mock.method(handle, 'stat', async () => {
                throw primary;
            });
            t.mock.method(handle, 'close', async () => {
                closes++;
                await close();
            });
        }
        return handle;
    });
    syncBuiltinESMExports();
    await assert.rejects(buildWindowsDeploymentSupport(), (error: unknown) => error === primary);
    assert.equal(closes, 1);
    assert.deepEqual(await fs.readdir(fixture.outputs), ['.windows-deployment-build.lock']);
});

type ReservationCloseOutcome = { attempted: number; fulfilled: number; rejected: unknown[] };

async function closeOwnedReservation(outcome: ReservationCloseOutcome, close: () => Promise<void>) {
    outcome.attempted++;
    try {
        await close();
        outcome.fulfilled++;
    } catch (error) {
        outcome.rejected.push(error);
        throw error;
    }
}

function requireReservationClosed(outcome: ReservationCloseOutcome) {
    if (outcome.rejected.length === 1) throw outcome.rejected[0];
    if (outcome.rejected.length) throw new AggregateError(outcome.rejected, 'Owned reservation close failures.');
    assert.equal(outcome.attempted, 1);
    assert.equal(outcome.fulfilled, 1);
}

async function requireReservationReplacement(release: () => Promise<void>) {
    try {
        await release();
    } catch (error) {
        if (
            error instanceof AggregateError &&
            error.errors.length === 1 &&
            error.errors[0] instanceof Error &&
            error.errors[0].message === 'Deployment build reservation identity changed.'
        )
            return;
        throw error;
    }
    assert.fail('Expected the foreign reservation identity rejection.');
}

async function withOwnedUseLease(
    body: (own: (lease: Readonly<{ release(): Promise<void> }>) => void) => Promise<void>,
    close: () => Promise<void>,
) {
    let lease: Readonly<{ release(): Promise<void> }> | undefined;
    const failures: unknown[] = [];
    let failed = false;
    try {
        await body((value) => {
            assert.equal(lease, undefined);
            lease = value;
        });
    } catch (error) {
        failed = true;
        failures.push(error);
    }
    if (lease) {
        try {
            await lease.release();
        } catch (error) {
            failed = true;
            failures.push(error);
        }
    }
    try {
        await close();
    } catch (error) {
        failed = true;
        failures.push(error);
    }
    if (failed) {
        if (failures.length === 1) throw failures[0];
        throw new AggregateError(failures, 'Owned reader body and cleanup failures.');
    }
}

test('foreign reservation replacement is retained while the original owned descriptor still closes', {
    skip: !fixedWindows,
}, async (t) => {
    const closeSentinel = new Error('Controlled original close rejection.');
    const unexpected = new AggregateError(
        [new Error('Deployment build reservation identity changed.'), closeSentinel],
        'Deployment support identity/cleanup failures.',
    );
    // The former broad validator accepts this extra close failure; the used boundary must reject it.
    await assert.rejects(Promise.reject(unexpected), /cleanup/);
    await assert.rejects(
        requireReservationReplacement(() => Promise.reject(unexpected)),
        (error) => {
            assert.equal(error, unexpected);
            assert.equal(unexpected.errors[1], closeSentinel);
            return true;
        },
    );
    const rejected: ReservationCloseOutcome = { attempted: 0, fulfilled: 0, rejected: [] };
    await assert.rejects(
        closeOwnedReservation(rejected, async () => {
            throw closeSentinel;
        }),
        (error) => {
            assert.equal(error, closeSentinel);
            return true;
        },
    );
    assert.deepEqual([rejected.attempted, rejected.fulfilled], [1, 0]);
    assert.throws(
        () => requireReservationClosed(rejected),
        (error) => error === closeSentinel,
    );
    const deferred = Promise.withResolvers<void>();
    const unresolved: ReservationCloseOutcome = { attempted: 0, fulfilled: 0, rejected: [] };
    const pending = closeOwnedReservation(unresolved, () => deferred.promise);
    try {
        assert.equal(unresolved.fulfilled, 0);
        assert.throws(() => requireReservationClosed(unresolved));
    } finally {
        deferred.resolve();
    }
    await pending;
    requireReservationClosed(unresolved);
    const fixture = await ownedWindowsDeploymentCompiler(t);
    const acquire = fs.open;
    const closes: ReservationCloseOutcome = { attempted: 0, fulfilled: 0, rejected: [] };
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await acquire(...args);
        if (String(args[0]).endsWith('.windows-deployment-build.lock')) {
            const close = handle.close.bind(handle);
            t.mock.method(handle, 'close', () => closeOwnedReservation(closes, close));
        }
        return handle;
    });
    syncBuiltinESMExports();
    const support = await buildWindowsDeploymentSupport();
    const name = path.join(fixture.outputs, '.windows-deployment-build.lock');
    await fs.rename(name, `${name}-retained`);
    await fs.writeFile(name, 'foreign');
    await requireReservationReplacement(() => support.release());
    requireReservationClosed(closes);
    assert.equal(await fs.readFile(name, 'utf8'), 'foreign');
    t.diagnostic(
        JSON.stringify({
            reservationCloseAttempts: closes.attempted,
            fulfilled: closes.fulfilled,
            rejected: closes.rejected.length,
        }),
    );
});

test('early native rejection is observed while post-spawn artifact reads are pending', {
    skip: !fixedWindows,
}, async (t) => {
    await ownedWindowsDeploymentCompiler(t);
    const support = await buildWindowsDeploymentSupport();
    t.mock.method(childProcess, 'spawn', () => {
        const child = Object.assign(new EventEmitter(), {
            pid: 42,
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            stdin: new Writable({
                write(_bytes, _encoding, done) {
                    done();
                },
            }),
        });
        queueMicrotask(() => {
            child.stderr.end('rejected header');
            child.stdout.end();
            child.emit('exit', 1, null);
            child.emit('close', 1, null);
        });
        return child;
    });
    syncBuiltinESMExports();
    await assert.rejects(support.query(['C:\\owned']), /helper|stream/);
    await support.release();
});

test('fixed compiler references may have stable hardlinks without weakening one-link generated outputs', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    await fs.link(path.join(fixture.root, 'System.dll'), path.join(fixture.root, 'owned-system-alias'));
    const support = await buildWindowsDeploymentSupport();
    await fs.link(
        path.join(fixture.outputs, 'windows-deployment-query.exe'),
        path.join(fixture.outputs, 'owned-output-alias'),
    );
    await assert.rejects(support.query(['C:\\owned']), /input|identity|changed/);
    await assert.rejects(support.release());
});

test('normal Windows admission refuses missing delivered support before any helper or build fallback', {
    skip: !fixedWindows,
}, async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dct-source-admission-')));
    try {
        await assert.rejects(openDeploymentNativeAuthority(root, false), /build-only|delivered/i);
        assert.deepEqual(await fs.readdir(root), []);
    } finally {
        await fs.rm(root, { recursive: true });
    }
});

test('compiler input read and close failures retain the original cause without compilation or materialization', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    const acquire = fs.open;
    const primary = new Error('owned read failure'),
        secondary = new Error('owned close failure');
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await acquire(...args);
        if (String(args[0]).endsWith('csc.exe')) {
            const close = handle.close.bind(handle);
            t.mock.method(handle, 'read', async () => {
                throw primary;
            });
            t.mock.method(handle, 'close', async () => {
                await close();
                throw secondary;
            });
        }
        return handle;
    });
    syncBuiltinESMExports();
    await assert.rejects(buildWindowsDeploymentSupport(), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [primary, secondary]);
        return true;
    });
    assert.equal(fixture.compiles(), 0);
    assert.deepEqual(await fs.readdir(fixture.outputs), []);
});

test('failed parallel reference acquisition still owns delayed reads and preserves every failure', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    const acquire = fs.open;
    const first = new Error('first reference failed'),
        late = new Error('late reference failed');
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let entered = () => {};
    const reading = new Promise<void>((resolve) => {
        entered = resolve;
    });
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await acquire(...args);
        if (String(args[0]).endsWith('mscorlib.dll'))
            t.mock.method(handle, 'read', async () => {
                throw first;
            });
        if (String(args[0]).endsWith('System.dll'))
            t.mock.method(handle, 'read', async () => {
                entered();
                await gate;
                throw late;
            });
        return handle;
    });
    syncBuiltinESMExports();
    let settled = false;
    const outcome = buildWindowsDeploymentSupport().then(
        () => {
            settled = true;
            return undefined;
        },
        (error: unknown) => {
            settled = true;
            return error;
        },
    );
    await reading;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const early = settled;
    release();
    const error = await outcome;
    assert.equal(early, false);
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [first, late]);
    assert.equal(fixture.compiles(), 0);
});

function mutationReply(name: string) {
    const parts = [Buffer.from('DCTQRS1\n01000000', 'ascii').subarray(0, 8), Buffer.from([1, 0, 0, 0])];
    const text = (value: string) => {
        const body = Buffer.from(value);
        const size = Buffer.alloc(4);
        size.writeUInt32LE(body.length);
        parts.push(size, body);
    };
    for (const value of ['S-1-5-21-101', 'S-1-5-21-101', name, '1', '2', '1', '0']) text(value);
    parts.push(Buffer.from([1, 1, 0]));
    text('NTFS');
    parts.push(Buffer.from('080000000300000001000000', 'hex'));
    text('S-1-5-21-101');
    parts.push(Buffer.from('ff011f000300000000000000', 'hex'));
    return Buffer.concat(parts);
}

test('actual fresh factory owns fixed compiler lifetime, samples reader anew and rejects changed ACL with stable identity', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentNative(t);
    const directory = path.join(fixture.root, 'managed');
    const native = await createFreshDeploymentRoot(directory);
    assert.equal(fixture.compiles(), 2);
    assert.equal(fixture.mutations(), 1);
    assert.equal(fixture.queries(), 2);
    const createBefore = fixture.queries();
    await native.createDirectory('.deployment');
    assert.equal(fixture.queries() - createBefore, 2);
    const before = fixture.queries();
    const reader = await native.openReaderAuthority();
    assert.equal(fixture.queries() - before, 1);
    const stats = await fs.lstat(directory, { bigint: true });
    const entriesBefore = fixture.queries();
    await reader.entries([
        { file: directory, stats, purpose: 'directory' },
        { file: directory, stats, purpose: 'directory' },
    ]);
    assert.equal(fixture.queries() - entriesBefore, 1);
    fixture.patch((name, facts) => (name === directory ? { ...facts, sid: 'S-1-1-0' } : facts));
    await assert.rejects(native.openReaderAuthority(), /authority|unsafe|ACL/);
    await assert.rejects(native.verifyParent(path.join(directory, '.deployment', 'state.json')));
    await native.close();
    assert.deepEqual(await fs.readdir(fixture.outputs), []);
    assert.ok((await fs.lstat(directory)).isDirectory());
});

test('actual fresh-context Windows reader consumes account, owner, ACL, identity, volume and closed-codec fences', {
    skip: !fixedWindows,
}, async (t) => {
    const bodySentinel = new Error('Controlled reader body rejection.');
    const leaseSentinel = new Error('Controlled own lease rejection.');
    const nativeSentinel = new Error('Controlled support cleanup rejection.');
    for (const cleanupFails of [false, true]) {
        const order: string[] = [];
        await assert.rejects(
            withOwnedUseLease(
                async (own) => {
                    own({
                        async release() {
                            order.push('lease');
                            if (cleanupFails) throw leaseSentinel;
                        },
                    });
                    order.push('body');
                    throw bodySentinel;
                },
                async () => {
                    order.push('native');
                    if (cleanupFails) throw nativeSentinel;
                },
            ),
            (error) => {
                if (!cleanupFails) assert.equal(error, bodySentinel);
                else {
                    assert.ok(error instanceof AggregateError);
                    assert.equal(error.errors.length, 3);
                    assert.equal(error.errors[0], bodySentinel);
                    assert.equal(error.errors[1], leaseSentinel);
                    assert.equal(error.errors[2], nativeSentinel);
                }
                return true;
            },
        );
        assert.deepEqual(order, ['body', 'lease', 'native']);
    }
    for (const failing of ['lease', 'native'] as const) {
        const order: string[] = [];
        const sentinel = failing === 'lease' ? leaseSentinel : nativeSentinel;
        await assert.rejects(
            withOwnedUseLease(
                async (own) => {
                    own({
                        async release() {
                            order.push('lease');
                            if (failing === 'lease') throw sentinel;
                        },
                    });
                },
                async () => {
                    order.push('native');
                    if (failing === 'native') throw sentinel;
                },
            ),
            (error) => error === sentinel,
        );
        assert.deepEqual(order, ['lease', 'native']);
    }
    // A falsy thrown value must remain a failure rather than becoming a successful outcome.
    await assert.rejects(
        withOwnedUseLease(
            () => Promise.reject(undefined),
            async () => {},
        ),
        (error) => error === undefined,
    );
    const success: string[] = [];
    await withOwnedUseLease(
        async (own) => {
            own({
                async release() {
                    success.push('lease');
                },
            });
            success.push('body');
        },
        async () => {
            success.push('native');
        },
    );
    assert.deepEqual(success, ['body', 'lease', 'native']);
    const fixture = await ownedWindowsDeploymentNative(t);
    const directory = path.join(fixture.root, 'managed');
    const native = await createFreshDeploymentInstallation(directory);
    await withOwnedUseLease(
        async (own) => {
            await native.createDirectory('.deployment');
            const installation = {
                schemaVersion: 1,
                installationId: '0dd7224c-51a2-41b3-914d-01171c139ac2',
                kind: 'portable',
                platform: 'win32',
                architecture: 'x64',
                root: { realPath: directory, device: String(native.root.dev), inode: String(native.root.ino) },
            };
            const identity = createHash('sha256').update(JSON.stringify(installation)).digest('hex');
            const state = {
                schemaVersion: 1,
                installationIdentity: identity,
                phase: 'active',
                selectedBuildId: 'a'.repeat(64),
                selectedManifestSha256: 'b'.repeat(64),
            };
            for (const [name, bytes] of [
                ['installation.json', `${JSON.stringify(installation)}\n`],
                ['state.json', `${JSON.stringify(state)}\n`],
                ['operation.lock', ''],
                ['use.lock', ''],
            ]) {
                assert.ok(name !== undefined && bytes !== undefined);
                await fs.writeFile(path.join(directory, '.deployment', name), bytes);
            }
            const reader = await native.openReader(() => true);
            assert.equal('commit' in reader, false);
            const lease = await reader.tryAcquire('use');
            assert.ok(lease);
            own(lease);
            assert.deepEqual(await reader.read(lease), state);
            for (const patch of [
                { inode: '18446744073709551615' },
                { reparse: true },
                { filesystem: 'SMB' },
                { account: 'S-1-5-21-102' },
                { owner: 'S-1-5-21-102' },
                { protected: false },
                { sid: 'S-1-1-0' },
            ]) {
                fixture.patch((name, facts) =>
                    name === path.join(directory, '.deployment', 'use.lock') ? { ...facts, ...patch } : facts,
                );
                await assert.rejects(reader.read(lease));
                await assert.rejects(native.openReader(() => true));
            }
            fixture.patch((_name, facts) => facts);
            fixture.suffix(Buffer.from([0]));
            await assert.rejects(
                native.openReader(() => true),
                /Trailing/,
            );
            fixture.suffix(Buffer.alloc(0));
            const name = path.join(directory, '.deployment', 'use.lock');
            await fs.rename(name, `${name}-retained`);
            await fs.writeFile(name, '');
            await assert.rejects(reader.read(lease), /identity/);
        },
        () => native.close(),
    );
    t.diagnostic('Own use lease release and native support cleanup fulfilled once.');
});

test('actual fresh-context batches keep purpose predicates and reject unsafe non-target second-chunk facts', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await ownedWindowsDeploymentNative(t);
    const directory = path.join(fixture.root, 'managed');
    const native = await createFreshDeploymentRoot(directory);
    try {
        const reader = await native.openReaderAuthority();
        const checks = [];
        for (let index = 0; index < 129; index++) {
            const file = path.join(directory, `f${String(index).padStart(3, '0')}`);
            await fs.writeFile(file, 'owned');
            checks.push({ file, stats: await fs.lstat(file, { bigint: true }), purpose: 'document' as const });
        }
        let before = fixture.queries();
        await reader.entries(checks);
        assert.equal(fixture.queries() - before, 2);
        const last = checks[128];
        assert.ok(last);
        fixture.patch((name, facts) => (name === last.file ? { ...facts, sid: 'S-1-1-0' } : facts));
        before = fixture.queries();
        await assert.rejects(reader.entries(checks));
        assert.equal(fixture.queries() - before, 2);
        fixture.patch((_name, facts) => facts);
        const first = checks[0];
        assert.ok(first);
        await assert.rejects(reader.entries([first, { ...first, purpose: 'directory' }]));
    } finally {
        await native.close();
    }
});

test('fixed mutator uses exact finite stdin with fixed argv and rejects replies for a different target', {
    skip: !fixedWindows,
}, async (t) => {
    await ownedWindowsDeploymentCompiler(t);
    const support = await buildWindowsDeploymentSupport();
    let responsePath = 'C:\\owned';
    t.mock.method(
        childProcess,
        'spawn',
        (executable: string, args: readonly string[], options: { shell: boolean; windowsHide: boolean }) => {
            assert.ok(executable.endsWith('windows-deployment-create.exe'));
            assert.deepEqual(args, ['mutate']);
            assert.equal(options.shell, false);
            assert.equal(options.windowsHide, true);
            const input: Buffer[] = [];
            const child = Object.assign(new EventEmitter(), {
                pid: 42,
                stdout: new PassThrough(),
                stderr: new PassThrough(),
                stdin: new Writable({
                    write(bytes, _encoding, done) {
                        input.push(Buffer.from(bytes));
                        done();
                    },
                }),
            });
            child.stdin.on('finish', () => {
                assert.equal(
                    Buffer.concat(input).toString('hex'),
                    '4443544d5554310a080000000b0000006372656174652d726f6f7408000000433a5c6f776e65640000000000000000010000003100000000000000000100000032',
                );
                child.stdout.end(mutationReply(responsePath));
                child.stderr.end();
                child.emit('exit', 0, null);
                child.emit('close', 0, null);
            });
            return child;
        },
    );
    syncBuiltinESMExports();
    const request = {
        root: 'C:\\owned',
        relative: '',
        destination: '',
        device: '1',
        inode: '',
        sourceInode: '',
        parentInode: '2',
    };
    const result = await support.mutate('create-root', request);
    assert.ok(typeof result === 'object' && result !== null && 'inode' in result && result.inode === '2');
    responsePath = 'C:\\foreign';
    await assert.rejects(support.mutate('create-root', request), /path|coverage/);
    await support.release();
});

test('fixed copy entry sends one complete header/body stream and decodes only its exact created inventory', {
    skip: !fixedWindows,
}, async (t) => {
    await ownedWindowsDeploymentCompiler(t);
    const support = await buildWindowsDeploymentSupport();
    const stage = '.staging/0dd7224c-51a2-41b3-914d-01171c139ac2/payload';
    const manifest = Buffer.from('{"schemaVersion":1,"platform":"win32","architecture":"x64","entries":[]}\n');
    const header = encodeWindowsDeploymentCopyHeader({
        root: 'C:\\owned',
        stage,
        device: '1',
        entries: [],
        manifest,
        parents: [
            { relative: '', inode: '2' },
            { relative: '.staging', inode: '3' },
            { relative: stage.slice(0, -8), inode: '4' },
            { relative: stage, inode: '5' },
        ],
    });
    let starts = 0;
    t.mock.method(childProcess, 'spawn', (name: string, args: readonly string[]) => {
        starts++;
        assert.ok(name.endsWith('windows-deployment-create.exe'));
        assert.deepEqual(args, ['copy']);
        const chunks: Buffer[] = [];
        const child = Object.assign(new EventEmitter(), {
            pid: 42,
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            stdin: new Writable({
                write(bytes, _encoding, done) {
                    chunks.push(Buffer.from(bytes));
                    done();
                },
            }),
        });
        child.stdin.on('finish', () => {
            assert.deepEqual(Buffer.concat(chunks), Buffer.concat([header, manifest, manifest]));
            chunks.length = 0;
            child.stdout.end(
                Buffer.from(
                    '444354435052310a01000000150000007061796c6f61642d6d616e69666573742e6a736f6e01000000000000000900000000000000014900000000000000',
                    'hex',
                ),
            );
            child.stderr.end();
            child.emit('exit', 0, null);
            child.emit('close', 0, null);
        });
        return child;
    });
    syncBuiltinESMExports();
    async function* bodies() {
        yield manifest;
        yield manifest;
    }
    try {
        assert.deepEqual(await support.copy(header, bodies()), [
            { path: 'payload-manifest.json', type: 'file', device: '1', inode: '9', bytes: 73 },
        ]);
        assert.equal(starts, 1);
    } finally {
        await support.release();
    }
});

test('fixed copy protocol rejects a premature result before requesting source bodies and still waits for actual terminal', {
    skip: !fixedWindows,
}, async (t) => {
    await ownedWindowsDeploymentCompiler(t);
    const support = await buildWindowsDeploymentSupport();
    const stage = '.staging/0dd7224c-51a2-41b3-914d-01171c139ac2/payload';
    const manifest = Buffer.from('{"schemaVersion":1,"platform":"win32","architecture":"x64","entries":[]}\n');
    const header = encodeWindowsDeploymentCopyHeader({
        root: 'C:\\owned',
        stage,
        device: '1',
        entries: [],
        manifest,
        parents: [
            { relative: '', inode: '2' },
            { relative: '.staging', inode: '3' },
            { relative: stage.slice(0, -8), inode: '4' },
            { relative: stage, inode: '5' },
        ],
    });
    let requested = 0,
        terminals = 0;
    t.mock.method(childProcess, 'spawn', () => {
        let first = true;
        const child = Object.assign(new EventEmitter(), {
            pid: 42,
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            stdin: new Writable({
                write(_bytes, _encoding, done) {
                    if (first) {
                        first = false;
                        child.stdout.write('malformed early result');
                    }
                    done();
                },
            }),
        });
        const finish = (code: number) => {
            if (terminals) return;
            terminals++;
            child.stdout.end();
            child.stderr.end();
            child.emit('exit', code, null);
            child.emit('close', code, null);
        };
        child.stdin.on('finish', () => finish(0));
        child.stdin.on('close', () => finish(1));
        return child;
    });
    syncBuiltinESMExports();
    async function* bodies() {
        requested++;
        yield manifest;
        requested++;
        yield manifest;
    }
    try {
        await assert.rejects(support.copy(header, bodies()));
        assert.equal(requested, 0);
        assert.equal(terminals, 1);
    } finally {
        await support.release();
    }
});

test('copy body count failure preserves the underlying source finally close failure', {
    skip: !fixedWindows,
}, async (t) => {
    await ownedWindowsDeploymentCompiler(t);
    const support = await buildWindowsDeploymentSupport();
    const stage = '.staging/0dd7224c-51a2-41b3-914d-01171c139ac2/payload';
    const manifest = Buffer.from('{"schemaVersion":1,"platform":"win32","architecture":"x64","entries":[]}\n');
    const header = encodeWindowsDeploymentCopyHeader({
        root: 'C:\\owned',
        stage,
        device: '1',
        entries: [],
        manifest,
        parents: [
            { relative: '', inode: '2' },
            { relative: '.staging', inode: '3' },
            { relative: stage.slice(0, -8), inode: '4' },
            { relative: stage, inode: '5' },
        ],
    });
    t.mock.method(childProcess, 'spawn', () => {
        const child = Object.assign(new EventEmitter(), {
            pid: 42,
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            stdin: new Writable({
                write(_bytes, _encoding, done) {
                    done();
                },
            }),
        });
        child.stdin.on('close', () => {
            child.stdout.end();
            child.stderr.end();
            child.emit('exit', 1, null);
            child.emit('close', 1, null);
        });
        return child;
    });
    syncBuiltinESMExports();
    const close = new Error('owned source close failed');
    async function* bodies() {
        try {
            yield Buffer.alloc(147);
        } finally {
            await Promise.reject(close);
        }
    }
    const retained = (error: unknown): boolean =>
        error === close || (error instanceof AggregateError && error.errors.some(retained));
    try {
        await assert.rejects(support.copy(header, bodies()), retained);
    } finally {
        await support.release();
    }
});
