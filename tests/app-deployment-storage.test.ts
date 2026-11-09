import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import filesystem, { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock, type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    type DeploymentLease,
    openDeploymentWriterInstallation as productionOpenWriter,
} from '../src/adapters/app-deployment.ts';
import { isRecord } from '../src/shared/errors.ts';
import { deploymentAdvisoryLock } from './fixtures/deployment-advisory-lock.ts';
import { createDeploymentStoreFixture } from './fixtures/deployment-store.ts';

const selection = { selectedBuildId: 'a'.repeat(64), selectedManifestSha256: 'b'.repeat(64) };
const next = { type: 'select', selectedBuildId: 'c'.repeat(64), selectedManifestSha256: 'd'.repeat(64) };
function rejectionReason(
    error: unknown,
    expression: RegExp,
    ErrorType: typeof import('../src/adapters/app-deployment.ts').DeploymentCommitError,
) {
    const reason = error instanceof ErrorType ? error.cause : error;
    return reason instanceof Error && expression.test(reason.message);
}
async function fixture() {
    // Verify/load the actual-host vendor before installing any controlled Windows mapping.
    const tryLock = await deploymentAdvisoryLock();
    return { ...(await createDeploymentStoreFixture()), tryLock };
}
test('unsupported native permission/filesystem roles refuse before creating or adopting deployment metadata', async () => {
    const rawDirectory = await mkdtemp(path.join(tmpdir(), 'dct-deployment-unsupported-'));
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
        const directory = await filesystem.realpath(rawDirectory);
        assert.ok(path.isAbsolute(directory));
        assert.equal(path.resolve(directory), directory);
        assert.equal(await filesystem.realpath(directory), directory);
        Object.defineProperty(process, 'platform', { value: 'aix', configurable: true });
        await assert.rejects(productionOpenWriter(directory, { tryLock: () => true }), /unsupported/i);
        assert.deepEqual(await readdir(directory), []);
    } finally {
        if (platform) Object.defineProperty(process, 'platform', platform);
        await rm(rawDirectory, { recursive: true });
    }
});

test('enrolled store binds physical root, exact metadata and independently owned leases', async () => {
    const own = await fixture();
    try {
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: own.tryLock });
        assert.equal(store.identity, own.identity);
        const operation = await store.tryAcquire('operation');
        assert.ok(operation);
        const reader = await store.tryAcquire('use');
        assert.ok(reader);
        assert.deepEqual(await store.read(reader), own.state);
        assert.equal(await store.tryAcquire('operation'), undefined);
        await assert.rejects(store.commit(reader, own.state, next), (error: unknown) =>
            rejectionReason(error, /operation/i, own.deployment.DeploymentCommitError),
        );
        await assert.rejects(store.tryAcquire('deletion'), /operation/i);
        const foreign = await own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: own.tryLock });
        await assert.rejects(foreign.read(operation), /lease/i);
        const committed = await store.commit(operation, own.state, next);
        assert.equal(committed.selectedBuildId, next.selectedBuildId);
        await assert.rejects(store.commit(operation, own.state, next), (error: unknown) =>
            rejectionReason(error, /stale/i, own.deployment.DeploymentCommitError),
        );
        await reader.release();
        await assert.rejects(store.read(reader), /lease/i);
        await operation.release();
        assert.deepEqual((await readdir(own.envelope)).sort(), [
            'installation.json',
            'operation.lock',
            'state.json',
            'use.lock',
        ]);
    } finally {
        await own.cleanup();
    }
});

test('removing fences new readers and deletion waits for every actual open shared descriptor', async () => {
    const own = await fixture();
    try {
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: own.tryLock });
        const operation = await store.tryAcquire('operation');
        const reader = await store.tryAcquire('use');
        assert.ok(operation);
        assert.ok(reader);
        const removing = await store.commit(operation, own.state, { type: 'begin-removal' });
        await assert.rejects(store.tryAcquire('use'), /fenced/i);
        assert.equal(await store.tryAcquire('deletion', operation), undefined);
        await assert.rejects(store.commit(operation, removing, { type: 'finish-removal' }), (error: unknown) =>
            rejectionReason(error, /deletion/i, own.deployment.DeploymentCommitError),
        );
        await reader.release();
        const deletion = await store.tryAcquire('deletion', operation);
        assert.ok(deletion);
        await assert.rejects(store.commit(operation, removing, { type: 'cancel-removal' }), (error: unknown) =>
            rejectionReason(error, /deletion/i, own.deployment.DeploymentCommitError),
        );
        await assert.rejects(operation.release(), /deletion/i);
        assert.equal(await store.tryAcquire('use'), undefined);
        const removed = await store.commit(operation, removing, { type: 'finish-removal' }, deletion);
        assert.equal(removed.phase, 'removed');
        await deletion.release();
        await operation.release();
        await assert.rejects(store.tryAcquire('use'), /fenced/i);
    } finally {
        await own.cleanup();
    }
});

test('cancellation excludes deletion acquisition throughout its asynchronous flush', {
    timeout: 20000,
}, async () => {
    const own = await fixture();
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let pause = false;
    let operation: DeploymentLease | undefined;
    let deletion: DeploymentLease | undefined;
    let cancellation: Promise<void> | undefined;
    try {
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: own.tryLock,
            stateIO: {
                flush: async (handle) => {
                    await handle.sync();
                    if (pause) {
                        entered.resolve();
                        await resume.promise;
                    }
                },
            },
        });
        operation = await store.tryAcquire('operation');
        assert.ok(operation);
        const removing = await store.commit(operation, own.state, { type: 'begin-removal' });
        pause = true;
        let cancelledPhase: string | undefined;
        cancellation = store.commit(operation, removing, { type: 'cancel-removal' }).then((state) => {
            cancelledPhase = state.phase;
        });
        await Promise.race([
            entered.promise,
            cancellation.then(() => {
                throw new Error('Cancellation bypassed its controlled flush.');
            }),
        ]);
        const admission = await store.tryAcquire('deletion', operation).then(
            (lease) => ({ lease }),
            (error: unknown) => ({ error }),
        );
        if ('lease' in admission) deletion = admission.lease;
        resume.resolve();
        await cancellation;
        assert.equal(cancelledPhase, 'active');
        assert.equal(deletion, undefined, 'Successful cancellation must not coexist with a returned deletion lease.');
        await assert.rejects(store.tryAcquire('deletion', operation), /fence/i);
        await assert.rejects(store.tryAcquire('deletion'), /operation/i);
        pause = false;
        assert.equal(
            (await store.commit(operation, await store.read(operation), { type: 'begin-removal' })).phase,
            'removing',
        );
    } finally {
        resume.resolve();
        await cancellation?.catch(() => {});
        await deletion?.release();
        await operation?.release();
        await own.cleanup();
    }
});

test('pending deletion acquisition excludes cancellation before it owns an open descriptor', {
    timeout: 20000,
}, async () => {
    const own = await fixture();
    const opening = Promise.withResolvers<void>();
    const openResume = Promise.withResolvers<void>();
    const flushing = Promise.withResolvers<void>();
    const flushResume = Promise.withResolvers<void>();
    const originalOpen = filesystem.open;
    let gated = false;
    let pauseFlush = false;
    let operation: DeploymentLease | undefined;
    let deletion: DeploymentLease | undefined;
    let acquisition: Promise<void> | undefined;
    let cancellation: Promise<{ phase: string } | { error: unknown }> | undefined;
    const boundary = mock.method(filesystem, 'open', async (...args: Parameters<typeof filesystem.open>) => {
        if (gated && args[0] === path.join(own.envelope, 'use.lock')) {
            gated = false;
            opening.resolve();
            await openResume.promise;
        }
        return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: own.tryLock,
            stateIO: {
                flush: async (handle) => {
                    await handle.sync();
                    if (pauseFlush) {
                        flushing.resolve();
                        await flushResume.promise;
                    }
                },
            },
        });
        operation = await store.tryAcquire('operation');
        assert.ok(operation);
        const removing = await store.commit(operation, own.state, { type: 'begin-removal' });
        gated = true;
        acquisition = store.tryAcquire('deletion', operation).then((lease) => {
            deletion = lease;
        });
        await Promise.race([
            opening.promise,
            acquisition.then(() => {
                throw new Error('Deletion bypassed its controlled open.');
            }),
        ]);
        pauseFlush = true;
        cancellation = store.commit(operation, removing, { type: 'cancel-removal' }).then(
            (state) => ({ phase: state.phase }),
            (error: unknown) => ({ error }),
        );
        // Old code reaches flush while deletion is pending; fixed admission rejects before any state work.
        await Promise.race([flushing.promise, cancellation]);
        openResume.resolve();
        await acquisition;
        flushResume.resolve();
        const outcome = await cancellation;
        assert.ok(deletion);
        assert.ok('error' in outcome, 'Pending deletion authority must prevent cancellation from committing active.');
        assert.equal((await store.read(deletion)).phase, 'removing');
        await deletion.release();
        deletion = undefined;
        pauseFlush = false;
        assert.equal((await store.commit(operation, removing, { type: 'cancel-removal' })).phase, 'active');
    } finally {
        openResume.resolve();
        flushResume.resolve();
        await acquisition?.catch(() => {});
        await cancellation?.catch(() => {});
        await deletion?.release();
        await operation?.release();
        boundary.mock.restore();
        syncBuiltinESMExports();
        await own.cleanup();
    }
});

test('pre-replacement flush failure retains old state while uncertain replacement never claims rollback', async () => {
    const own = await fixture();
    try {
        const before = await own.deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: own.tryLock,
            stateIO: {
                flush: async () => {
                    throw new Error('controlled disk-full');
                },
            },
        });
        const lease = await before.tryAcquire('operation');
        assert.ok(lease);
        await assert.rejects(
            before.commit(lease, own.state, next),
            (error: unknown) =>
                error instanceof own.deployment.DeploymentCommitError && error.outcome === 'not-committed',
        );
        assert.deepEqual(await before.read(lease), own.state);
        await lease.release();
        const oldBytes = await readFile(path.join(own.envelope, 'state.json'));
        const controlledRefusal = Object.assign(new Error('controlled replacement refusal'), { code: 'EPERM' });
        let replacementCalls = 0;
        const refused = await own.deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: own.tryLock,
            stateIO: {
                replace: async () => {
                    replacementCalls++;
                    throw controlledRefusal;
                },
            },
        });
        const refusedLease = await refused.tryAcquire('operation');
        assert.ok(refusedLease);
        try {
            await assert.rejects(
                refused.commit(refusedLease, own.state, next),
                (error: unknown) =>
                    error instanceof own.deployment.DeploymentCommitError &&
                    error.outcome === 'indeterminate' &&
                    error.cause === controlledRefusal,
            );
            assert.equal(replacementCalls, 1);
            assert.deepEqual(await readFile(path.join(own.envelope, 'state.json')), oldBytes);
            assert.deepEqual(await refused.read(refusedLease), own.state);
            assert.equal(replacementCalls, 1);
            assert.deepEqual((await readdir(own.envelope)).sort(), [
                'installation.json',
                'operation.lock',
                'state.json',
                'use.lock',
            ]);
        } finally {
            await refusedLease.release();
        }
        const after = await own.deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: own.tryLock,
            stateIO: {
                replace: async (from, to) => {
                    await rename(from, to);
                    throw new Error('controlled uncertain rename response');
                },
            },
        });
        const writer = await after.tryAcquire('operation');
        assert.ok(writer);
        await assert.rejects(
            after.commit(writer, own.state, next),
            (error: unknown) =>
                error instanceof own.deployment.DeploymentCommitError && error.outcome === 'indeterminate',
        );
        assert.equal((await after.read(writer)).selectedBuildId, next.selectedBuildId);
        await writer.release();
        assert.deepEqual((await readdir(own.envelope)).sort(), [
            'installation.json',
            'operation.lock',
            'state.json',
            'use.lock',
        ]);
    } finally {
        await own.cleanup();
    }
});

test('a replaced temporary inode cannot become selection or authorize deletion of a foreign name', async () => {
    const own = await fixture();
    let replacement: string | undefined;
    try {
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: own.tryLock,
            stateIO: {
                flush: async (handle) => {
                    await handle.sync();
                    const name = (await readdir(own.envelope)).find((item) => item.startsWith('.state-'));
                    assert.ok(name);
                    replacement = path.join(own.envelope, name);
                    await rename(replacement, `${replacement}.original`);
                    await writeFile(replacement, 'foreign temporary inode', { flag: 'wx' });
                },
            },
        });
        const operation = await store.tryAcquire('operation');
        assert.ok(operation);
        await assert.rejects(
            store.commit(operation, own.state, next),
            (error: unknown) =>
                error instanceof own.deployment.DeploymentCommitError && error.outcome === 'not-committed',
        );
        assert.deepEqual(await store.read(operation), own.state);
        assert.ok(replacement);
        assert.equal((await lstat(replacement)).isFile(), true);
        assert.equal(await readFile(replacement, 'utf8'), 'foreign temporary inode');
        await operation.release();
    } finally {
        await own.cleanup();
    }
});

test('readback failure retains the committed removal fence and reports indeterminate outcome', async () => {
    const own = await fixture();
    try {
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: own.tryLock,
            stateIO: {
                replace: async (from, to) => {
                    await rename(from, to);
                    own.fail(to, new Error('Controlled readback authority refusal.'));
                },
            },
        });
        const operation = await store.tryAcquire('operation');
        assert.ok(operation);
        await assert.rejects(
            store.commit(operation, own.state, { type: 'begin-removal' }),
            (error: unknown) =>
                error instanceof own.deployment.DeploymentCommitError && error.outcome === 'indeterminate',
        );
        const bytes = await readFile(path.join(own.envelope, 'state.json'), 'utf8');
        assert.equal(JSON.parse(bytes).phase, 'removing');
        own.fail(path.join(own.envelope, 'state.json'));
        assert.equal((await store.read(operation)).phase, 'removing');
        await operation.release();
    } finally {
        await own.cleanup();
    }
});

test('a separate leased reader acknowledges complete selections between default atomic commits', {
    timeout: 20000,
}, async () => {
    const own = await fixture();
    const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./fixtures/deployment-state-reader.ts', import.meta.url)), own.physical, own.directory],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true },
    );
    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
    });
    const closed = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<Error>();
    let protocolFailure: Error | undefined;
    let exit: readonly [number | null, NodeJS.Signals | null] | undefined;
    let stopping = false;
    let expected = { ordinal: 0, result: Promise.withResolvers<unknown>() };
    let awaiting = true;
    const observations: unknown[] = [];
    function fail(error: Error) {
        protocolFailure ??= error;
        failed.resolve(protocolFailure);
    }
    child.on('message', (message: unknown) => {
        if (
            stopping ||
            !awaiting ||
            !isRecord(message) ||
            Object.keys(message).length !== 3 ||
            message.type !== 'sample' ||
            message.ordinal !== expected.ordinal ||
            !isRecord(message.state)
        ) {
            fail(new Error('Unexpected reader acknowledgement or ordinal.'));
            return;
        }
        awaiting = false;
        expected.result.resolve(message.state);
    });
    child.on('error', fail);
    child.on('disconnect', () => {
        if (!stopping) fail(new Error('Reader fixture disconnected before stop.'));
    });
    child.on('exit', (code, signal) => {
        exit = [code, signal];
        if (!stopping) fail(new Error(`Reader fixture exited before stop: ${code}/${signal}: ${stderr}`));
    });
    child.on('close', () => closed.resolve());
    async function observe(state: unknown) {
        const actual = await Promise.race([
            expected.result.promise,
            failed.promise.then((error) => {
                throw error;
            }),
        ]);
        if (protocolFailure) throw protocolFailure;
        assert.deepEqual(actual, state);
        observations.push(actual);
    }
    async function send(message: string | { type: 'sample'; ordinal: number }) {
        await new Promise<void>((resolve, reject) => {
            child.send(message, (error: Error | null) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }
    const failures: unknown[] = [];
    let operation: DeploymentLease | undefined;
    try {
        await observe(own.state);
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: own.tryLock });
        operation = await store.tryAcquire('operation');
        assert.ok(operation);
        let current = await store.read(operation);
        let commits = 0;
        for (let index = 0; index < 11; index++) {
            if (protocolFailure) throw protocolFailure;
            current = await store.commit(operation, current, index % 2 === 0 ? next : { type: 'select', ...selection });
            commits++;
            const selected = index % 2 === 0 ? next : selection;
            assert.deepEqual(current, {
                ...own.state,
                selectedBuildId: selected.selectedBuildId,
                selectedManifestSha256: selected.selectedManifestSha256,
            });
            if (protocolFailure) throw protocolFailure;
            expected = { ordinal: index + 1, result: Promise.withResolvers<unknown>() };
            awaiting = true;
            await send({ type: 'sample', ordinal: expected.ordinal });
            await observe(current);
        }
        assert.equal(commits, 11);
        assert.equal(observations.length, 12);
        assert.deepEqual(
            new Set(
                observations.map((value) => {
                    assert.ok(isRecord(value));
                    return `${value.selectedBuildId}:${value.selectedManifestSha256}`;
                }),
            ),
            new Set([
                `${selection.selectedBuildId}:${selection.selectedManifestSha256}`,
                `${next.selectedBuildId}:${next.selectedManifestSha256}`,
            ]),
        );
    } catch (error) {
        failures.push(error);
    } finally {
        try {
            if (child.connected) {
                stopping = true;
                await send('stop');
            }
        } catch (error) {
            failures.push(error);
            try {
                if (child.connected) child.disconnect();
            } catch (disconnectError) {
                failures.push(disconnectError);
            }
        }
        await closed.promise;
        try {
            assert.ok(exit, stderr);
            assert.equal(exit[0], 0, stderr);
            assert.equal(exit[1], null, stderr);
        } catch (error) {
            failures.push(error);
        }
        if (protocolFailure && !failures.includes(protocolFailure)) failures.push(protocolFailure);
        try {
            await operation?.release();
        } catch (error) {
            failures.push(error);
        }
        try {
            await own.cleanup();
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length) throw new AggregateError(failures, 'Coordinated reader regression failed.');
});

test('stale root or lock identity and malformed bounded metadata fail without replacing state', async () => {
    const own = await fixture();
    const moved = `${own.directory}-moved`;
    try {
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: own.tryLock });
        const stateFile = path.join(own.envelope, 'state.json');
        const originalState = await readFile(stateFile);
        const descriptors = own.descriptors.length;
        // Cache identity before mutation, without demanding a directory move over an open lease.
        await rename(own.directory, moved);
        await mkdir(own.directory, { mode: 0o700 });
        await assert.rejects(store.tryAcquire('operation'), /identity/i);
        assert.equal(own.descriptors.length, descriptors);
        assert.deepEqual(await readdir(own.directory), []);
        assert.deepEqual(await readFile(path.join(moved, '.deployment', 'state.json')), originalState);
        await rm(own.directory, { recursive: true });
        await rename(moved, own.directory);
        assert.deepEqual(await readFile(stateFile), originalState);
        const operation = await store.tryAcquire('operation');
        assert.ok(operation);
        await rename(path.join(own.envelope, 'operation.lock'), path.join(own.envelope, 'held.lock'));
        await writeFile(path.join(own.envelope, 'operation.lock'), '', { flag: 'wx', mode: 0o600 });
        await assert.rejects(store.commit(operation, own.state, next), (error: unknown) =>
            rejectionReason(error, /identity/i, own.deployment.DeploymentCommitError),
        );
        await operation.release();
        assert.equal(
            JSON.parse(await readFile(path.join(own.envelope, 'state.json'), 'utf8')).selectedBuildId,
            selection.selectedBuildId,
        );
        await writeFile(path.join(own.envelope, 'state.json'), ' '.repeat(65536));
        await assert.rejects(
            own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: own.tryLock }),
            /bound/i,
        );
        await writeFile(
            path.join(own.envelope, 'state.json'),
            `${JSON.stringify(own.state).slice(0, -1)},"phase":"active"}\n`,
        );
        await assert.rejects(
            own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: own.tryLock }),
            /canonical/i,
        );
        await unlink(path.join(own.envelope, 'state.json'));
        await writeFile(path.join(own.envelope, 'state.json'), `${JSON.stringify(own.state)}\n`);
        own.fail(path.join(own.envelope, 'state.json'), new Error('Controlled reparse refusal.'));
        await assert.rejects(own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: own.tryLock }));
    } finally {
        await own.cleanup();
    }
});

type ReadBoundary = 'authority-pre-read' | 'authority-post-read' | 'opened' | 'named' | 'current';
type ReadCondition =
    | 'replacement'
    | 'refusal'
    | 'EIO'
    | 'ENOENT'
    | 'invalidated'
    | 'hardlink'
    | 'nonregular'
    | 'absent'
    | 'foreign-device'
    | 'controlled-link';

// Observe the real store's document capability/receipt boundaries, never a POSIX native algorithm.
async function controlledDocumentRead(
    context: TestContext,
    control: Readonly<{ boundary: ReadBoundary; condition: ReadCondition; closeFailure?: boolean }>,
) {
    const own = await fixture();
    const readerContext = new AsyncLocalStorage<boolean>();
    const captured = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const originalOpen = filesystem.open;
    const originalLstat = filesystem.lstat;
    const originalParse = JSON.parse;
    const file = path.join(own.envelope, 'state.json');
    const alias = path.join(own.envelope, 'state-control-link.json');
    const oldText = `${JSON.stringify(own.state)}\n`;
    const injected = Object.assign(new Error(`Controlled document ${control.condition} failure.`), {
        code: control.condition,
    });
    const closeFailure = new Error('Controlled document close failure.');
    let paused = false;
    let observing = false;
    let readCalls = 0;
    let parseCalls = 0;
    let closeCalls = 0;
    let invalidations = 0;
    let pendingCurrent = false;
    let heldReceiptLinks: bigint | undefined;
    const namedSamples: { inode: string; links: string; directory: boolean }[] = [];
    let opened: Awaited<ReturnType<typeof filesystem.open>> | undefined;
    let operation: DeploymentLease | undefined;
    let use: DeploymentLease | undefined;
    let settleRead: Promise<unknown> | undefined;
    async function barrier() {
        paused = true;
        captured.resolve();
        await resume.promise;
        if (control.condition === 'EIO' || control.condition === 'ENOENT') throw injected;
    }
    const opening = mock.method(filesystem, 'open', async (...args: Parameters<typeof filesystem.open>) => {
        const handle = await originalOpen(...args);
        if (!observing || !readerContext.getStore() || args[0] !== file || opened) return handle;
        opened = handle;
        if (control.boundary === 'opened') await barrier();
        return new Proxy(handle, {
            get(target, key) {
                if (key === 'stat')
                    return async () => {
                        if (control.boundary === 'current' && readCalls > 0 && !paused) {
                            await barrier();
                            pendingCurrent = true;
                        }
                        const stats = await target.stat({ bigint: true });
                        if (control.boundary === 'current' && readCalls > 0) heldReceiptLinks = stats.nlink;
                        return stats;
                    };
                if (key === 'read')
                    return (...values: unknown[]) => {
                        readCalls++;
                        return Reflect.apply(target.read, target, values);
                    };
                if (key === 'close')
                    return async () => {
                        closeCalls++;
                        await target.close();
                        if (control.closeFailure && paused) throw closeFailure;
                    };
                const value: unknown = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
    });
    const named = mock.method(filesystem, 'lstat', async (...args: Parameters<typeof filesystem.lstat>) => {
        if (!observing || !readerContext.getStore() || !opened || args[0] !== file) return originalLstat(...args);
        const current = control.boundary === 'current' && pendingCurrent;
        if (paused && !current) return originalLstat(...args);
        const matching = current || (control.boundary === 'named' && readCalls === 0);
        if (!matching) return originalLstat(...args);
        if (current) pendingCurrent = false;
        else await barrier();
        // Every named/current receipt samples this actual pathname after the barrier.
        const entry = await originalLstat(file, { bigint: true });
        namedSamples.push({ inode: String(entry.ino), links: String(entry.nlink), directory: entry.isDirectory() });
        if (control.condition === 'foreign-device' || control.condition === 'controlled-link')
            return new Proxy(entry, {
                get(target, key) {
                    if (key === 'dev' && control.condition === 'foreign-device') return entry.dev + 1n;
                    if (key === 'isSymbolicLink' && control.condition === 'controlled-link') return () => true;
                    const value: unknown = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        return entry;
    });
    const parsing = mock.method(JSON, 'parse', (...args: Parameters<typeof JSON.parse>) => {
        if (observing && readerContext.getStore() && args[0] === oldText) parseCalls++;
        return originalParse(...args);
    });
    own.onDocument(async (name) => {
        if (!observing || !readerContext.getStore() || name !== file || paused) return;
        if (
            (control.boundary === 'authority-pre-read' && readCalls === 0) ||
            (control.boundary === 'authority-post-read' && readCalls > 0)
        )
            await barrier();
    });
    syncBuiltinESMExports();
    try {
        const store = await own.deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: own.tryLock,
            stateIO: {
                // Non-atomic adversarial name invalidation, never the default atomic writer path.
                replace: async (from, to) => {
                    assert.equal(to, file);
                    assert.equal(path.dirname(from), own.envelope);
                    assert.ok(path.basename(from).startsWith('.state-') && from.endsWith('.tmp'));
                    assert.equal(closeCalls, 0, 'The paused reader must retain its actual handle.');
                    const prepared = await originalLstat(from, { bigint: true });
                    assert.ok(prepared.isFile() && !prepared.isSymbolicLink() && prepared.nlink === 1n);
                    await unlink(to);
                    await assert.rejects(originalLstat(to, { bigint: true }), { code: 'ENOENT' });
                    // The isolated test schedule establishes absence; ordinary rename is not no-clobber.
                    await rename(from, to);
                    const published = await originalLstat(to, { bigint: true });
                    assert.equal(published.dev, prepared.dev);
                    assert.equal(published.ino, prepared.ino);
                    assert.equal(closeCalls, 0);
                    invalidations++;
                },
            },
        });
        operation = await store.tryAcquire('operation');
        use = await store.tryAcquire('use');
        assert.ok(operation);
        assert.ok(use);
        const lease = use;
        observing = true;
        const reading = readerContext
            .run(true, () => store.read(lease))
            .then(
                (value) => ({ value }),
                (error: unknown) => ({ error }),
            );
        settleRead = reading;
        const arrival = await Promise.race([captured.promise.then(() => 'reached'), reading.then(() => 'settled')]);
        assert.equal(arrival, 'reached', `Missing controlled store boundary: ${control.boundary}`);
        assert.ok(opened);
        const heldBefore = await opened.stat({ bigint: true });
        assert.equal(heldBefore.nlink, 1n);
        const selected = await store.commit(operation, own.state, next);
        assert.equal(invalidations, 1);
        const heldAfter = await opened.stat({ bigint: true });
        const current = await originalLstat(file, { bigint: true });
        assert.equal(heldAfter.ino, heldBefore.ino);
        assert.equal(heldAfter.nlink, 0n);
        assert.notEqual(current.ino, heldBefore.ino);
        assert.equal(current.nlink, 1n);
        if (control.condition === 'hardlink') await filesystem.link(file, alias);
        if (control.condition === 'absent') await unlink(file);
        if (control.condition === 'nonregular') {
            await unlink(file);
            await mkdir(file);
            assert.equal((await originalLstat(file, { bigint: true })).isDirectory(), true);
        }
        if (control.condition === 'refusal') {
            if (control.boundary === 'current' || control.boundary === 'named')
                own.onReceipt((stats) => {
                    if (stats.ino !== heldBefore.ino) throw injected;
                });
            else own.fail(file, injected);
        }
        resume.resolve();
        const result = await reading;
        observing = false;
        context.diagnostic(
            JSON.stringify({
                ...control,
                readCalls,
                parseCalls,
                closeCalls,
                invalidations,
                heldBefore: { inode: String(heldBefore.ino), links: String(heldBefore.nlink) },
                heldAfter: { inode: String(heldAfter.ino), links: String(heldAfter.nlink) },
                published: { inode: String(current.ino), links: String(current.nlink) },
                namedSamples,
            }),
        );
        assert.ok('error' in result, 'A replaced document must never return the old selection.');
        assert.ok(result.error instanceof Error);
        if (control.closeFailure) assert.equal(result.error, closeFailure);
        else if (control.condition === 'refusal' || control.condition === 'EIO' || control.condition === 'ENOENT')
            assert.equal(result.error, injected);
        else if (
            control.condition === 'hardlink' ||
            control.condition === 'nonregular' ||
            control.condition === 'controlled-link'
        )
            assert.match(result.error.message, /regular file with one link/);
        else if (control.condition === 'foreign-device') assert.match(result.error.message, /owned device/);
        else if (control.condition === 'absent') assert.ok(isRecord(result.error) && result.error.code === 'ENOENT');
        else assert.equal(result.error.message, 'Deployment document identity changed.');
        assert.equal(parseCalls, 0);
        assert.equal(closeCalls, 1);
        if (control.boundary === 'current') assert.equal(heldReceiptLinks, 0n);
        if (control.boundary === 'opened' || control.boundary === 'named' || control.boundary === 'authority-pre-read')
            assert.equal(readCalls, 0);
        else assert.ok(readCalls > 0);
        await assert.rejects(opened.stat(), { code: 'EBADF' });
        own.onDocument();
        own.onReceipt();
        own.fail(file);
        if (control.condition === 'hardlink') await unlink(alias);
        if (control.condition === 'nonregular')
            await filesystem.rmdir(path.join(own.physical, '.deployment', 'state.json'));
        if (control.condition === 'absent' || control.condition === 'nonregular')
            await writeFile(file, `${JSON.stringify(selected)}\n`, { flag: 'wx' });
        assert.deepEqual(await store.read(use), selected);
    } finally {
        observing = false;
        resume.resolve();
        await settleRead?.catch(() => {});
        parsing.mock.restore();
        named.mock.restore();
        opening.mock.restore();
        syncBuiltinESMExports();
        readerContext.disable();
        own.onDocument();
        own.onReceipt();
        own.fail(file);
        await use?.release();
        await operation?.release();
        await own.cleanup();
    }
}

for (const boundary of ['authority-pre-read', 'authority-post-read'] as const) {
    for (const condition of ['replacement', 'refusal', 'EIO', 'ENOENT'] as const)
        test(
            `${boundary} preserves ${condition} refusal without stale bytes and retains retry`,
            { timeout: 20000 },
            (context) => controlledDocumentRead(context, { boundary, condition }),
        );
}
for (const boundary of ['opened', 'named', 'current'] as const)
    test(
        `${boundary} invalidated document receipt closes once before returning or parsing bytes`,
        { timeout: 20000 },
        (context) => controlledDocumentRead(context, { boundary, condition: 'invalidated' }),
    );
for (const boundary of ['named', 'current'] as const) {
    for (const condition of [
        'refusal',
        'hardlink',
        'nonregular',
        'absent',
        'foreign-device',
        'controlled-link',
    ] as const)
        test(
            `${boundary} receipt preserves fatal ${condition} evidence during real replacement`,
            { timeout: 20000 },
            (context) => controlledDocumentRead(context, { boundary, condition }),
        );
}
for (const condition of ['replacement', 'EIO'] as const)
    test(
        `one actual close preserves its original fatal Error after document ${condition}`,
        { timeout: 20000 },
        (context) =>
            controlledDocumentRead(context, { boundary: 'authority-post-read', condition, closeFailure: true }),
    );
