import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { BigIntStats } from 'node:fs';
import filesystem, {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rename,
    rm,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock, type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    DeploymentCommitError,
    type DeploymentLease,
    openDeploymentWriterInstallation,
} from '../src/adapters/app-deployment.ts';
import { loadAppAdvisoryLock } from '../src/adapters/app-native.ts';
import { parseAppNativeEvidence } from '../src/domains/app-release.ts';
import { isRecord } from '../src/shared/errors.ts';

const native = () =>
    readFile(new URL('../tooling/app-native-release.json', import.meta.url), 'utf8').then((text) =>
        loadAppAdvisoryLock(parseAppNativeEvidence(JSON.parse(text))),
    );
const selection = { selectedBuildId: 'a'.repeat(64), selectedManifestSha256: 'b'.repeat(64) };
const next = { type: 'select', selectedBuildId: 'c'.repeat(64), selectedManifestSha256: 'd'.repeat(64) };
const supported = process.platform === 'linux';

function rejectionReason(error: unknown, expression: RegExp) {
    const reason = error instanceof DeploymentCommitError ? error.cause : error;
    return reason instanceof Error && expression.test(reason.message);
}

async function fixture() {
    const directory = await mkdtemp(path.join(process.cwd(), '.deployment-test-'));
    await chmod(directory, 0o700);
    const envelope = path.join(directory, '.deployment');
    await mkdir(envelope, { mode: 0o700 });
    const root = await lstat(directory, { bigint: true });
    const installation = {
        schemaVersion: 1,
        installationId: '0dd7224c-51a2-41b3-914d-01171c139ac2',
        kind: 'portable',
        platform: process.platform,
        architecture: process.arch,
        root: { realPath: directory, device: String(root.dev), inode: String(root.ino) },
    };
    const identity = createHash('sha256').update(JSON.stringify(installation)).digest('hex');
    const state = { schemaVersion: 1, installationIdentity: identity, phase: 'active', ...selection };
    await writeFile(path.join(envelope, 'installation.json'), `${JSON.stringify(installation)}\n`, {
        flag: 'wx',
        mode: 0o600,
    });
    await writeFile(path.join(envelope, 'state.json'), `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 });
    for (const file of ['operation.lock', 'use.lock'])
        await writeFile(path.join(envelope, file), '', { flag: 'wx', mode: 0o600 });
    return { directory, envelope, installation, state, identity, cleanup: () => rm(directory, { recursive: true }) };
}

test('unsupported native permission/filesystem roles refuse before creating or adopting deployment metadata', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dct-deployment-unsupported-'));
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'aix', configurable: true });
    try {
        await assert.rejects(openDeploymentWriterInstallation(directory, { tryLock: () => true }), /unsupported/i);
        assert.deepEqual(await readdir(directory), []);
    } finally {
        if (platform) Object.defineProperty(process, 'platform', platform);
        await rm(directory, { recursive: true });
    }
});

test('enrolled store binds physical root, exact metadata and independently owned leases', {
    skip: !supported,
}, async () => {
    const own = await fixture();
    try {
        const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
        assert.equal(store.identity, own.identity);
        const operation = await store.tryAcquire('operation');
        assert.ok(operation);
        const reader = await store.tryAcquire('use');
        assert.ok(reader);
        assert.deepEqual(await store.read(reader), own.state);
        assert.equal(await store.tryAcquire('operation'), undefined);
        await assert.rejects(store.commit(reader, own.state, next), (error: unknown) =>
            rejectionReason(error, /operation/i),
        );
        await assert.rejects(store.tryAcquire('deletion'), /operation/i);
        const foreign = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
        await assert.rejects(foreign.read(operation), /lease/i);
        const committed = await store.commit(operation, own.state, next);
        assert.equal(committed.selectedBuildId, next.selectedBuildId);
        await assert.rejects(store.commit(operation, own.state, next), (error: unknown) =>
            rejectionReason(error, /stale/i),
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

test('removing fences new readers and deletion waits for every actual open shared descriptor', {
    skip: !supported,
}, async () => {
    const own = await fixture();
    try {
        const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
        const operation = await store.tryAcquire('operation');
        const reader = await store.tryAcquire('use');
        assert.ok(operation);
        assert.ok(reader);
        const removing = await store.commit(operation, own.state, { type: 'begin-removal' });
        await assert.rejects(store.tryAcquire('use'), /fenced/i);
        assert.equal(await store.tryAcquire('deletion', operation), undefined);
        await assert.rejects(store.commit(operation, removing, { type: 'finish-removal' }), (error: unknown) =>
            rejectionReason(error, /deletion/i),
        );
        await reader.release();
        const deletion = await store.tryAcquire('deletion', operation);
        assert.ok(deletion);
        await assert.rejects(store.commit(operation, removing, { type: 'cancel-removal' }), (error: unknown) =>
            rejectionReason(error, /deletion/i),
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
    skip: !supported,
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
        const store = await openDeploymentWriterInstallation(own.directory, {
            tryLock: await native(),
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
    skip: !supported,
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
        const store = await openDeploymentWriterInstallation(own.directory, {
            tryLock: await native(),
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

test('pre-replacement flush failure retains old state while uncertain replacement never claims rollback', {
    skip: !supported,
}, async () => {
    const own = await fixture();
    try {
        const before = await openDeploymentWriterInstallation(own.directory, {
            tryLock: await native(),
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
            (error: unknown) => error instanceof DeploymentCommitError && error.outcome === 'not-committed',
        );
        assert.deepEqual(await before.read(lease), own.state);
        await lease.release();
        const after = await openDeploymentWriterInstallation(own.directory, {
            tryLock: await native(),
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
            (error: unknown) => error instanceof DeploymentCommitError && error.outcome === 'indeterminate',
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

test('a replaced temporary inode cannot become selection or authorize deletion of a foreign name', {
    skip: !supported,
}, async () => {
    const own = await fixture();
    let replacement: string | undefined;
    try {
        const store = await openDeploymentWriterInstallation(own.directory, {
            tryLock: await native(),
            stateIO: {
                flush: async (handle) => {
                    await handle.sync();
                    const name = (await readdir(own.envelope)).find((item) => item.startsWith('.state-'));
                    assert.ok(name);
                    replacement = path.join(own.envelope, name);
                    await rename(replacement, `${replacement}.original`);
                    await symlink(path.join(own.envelope, 'installation.json'), replacement);
                },
            },
        });
        const operation = await store.tryAcquire('operation');
        assert.ok(operation);
        await assert.rejects(
            store.commit(operation, own.state, next),
            (error: unknown) => error instanceof DeploymentCommitError && error.outcome === 'not-committed',
        );
        assert.deepEqual(await store.read(operation), own.state);
        assert.ok(replacement);
        assert.equal((await lstat(replacement)).isSymbolicLink(), true);
        await operation.release();
    } finally {
        await own.cleanup();
    }
});

test('readback failure retains the committed removal fence and reports indeterminate outcome', {
    skip: !supported,
}, async () => {
    const own = await fixture();
    try {
        const store = await openDeploymentWriterInstallation(own.directory, {
            tryLock: await native(),
            stateIO: {
                replace: async (from, to) => {
                    await rename(from, to);
                    await chmod(to, 0o620);
                },
            },
        });
        const operation = await store.tryAcquire('operation');
        assert.ok(operation);
        await assert.rejects(
            store.commit(operation, own.state, { type: 'begin-removal' }),
            (error: unknown) => error instanceof DeploymentCommitError && error.outcome === 'indeterminate',
        );
        const bytes = await readFile(path.join(own.envelope, 'state.json'), 'utf8');
        assert.equal(JSON.parse(bytes).phase, 'removing');
        await chmod(path.join(own.envelope, 'state.json'), 0o600);
        assert.equal((await store.read(operation)).phase, 'removing');
        await operation.release();
    } finally {
        await own.cleanup();
    }
});

// R1 keeps real filesystem identity and commit/replacement; only the reader's
// native resample is paused. No classification correction is present yet.
for (const phase of ['pre-read', 'post-read'] as const) {
    for (const condition of ['replacement', 'unsafe-replacement', 'unknown-replacement'] as const) {
        test(`native ${phase} document resample preserves ${condition} classification`, {
            skip: !supported,
            timeout: 20000,
        }, async (context) => {
            const own = await fixture();
            const readerContext = new AsyncLocalStorage<boolean>();
            const captured = Promise.withResolvers<void>();
            const resume = Promise.withResolvers<void>();
            const originalOpen = filesystem.open;
            const originalLstat = filesystem.lstat;
            const originalStatfs = filesystem.statfs;
            const originalParse = JSON.parse;
            const stateFile = path.join(own.envelope, 'state.json');
            const oldText = `${JSON.stringify(own.state)}\n`;
            const unknownFailure = Object.assign(new Error('Controlled unknown native resample failure.'), {
                code: 'EIO',
            });
            let pendingNativeResample = false;
            let paused = false;
            let countParse = false;
            let readCalls = 0;
            let parseCalls = 0;
            let closeCalls = 0;
            let observedPhase: typeof phase | undefined;
            let opened: Awaited<ReturnType<typeof filesystem.open>> | undefined;
            let openedBefore: BigIntStats | undefined;
            let heldAfterReplacement: BigIntStats | undefined;
            let namedAfterReplacement: BigIntStats | undefined;
            let operation: DeploymentLease | undefined;
            let use: DeploymentLease | undefined;
            let settleRead: Promise<unknown> | undefined;
            const openBoundary = mock.method(
                filesystem,
                'open',
                async (...args: Parameters<typeof filesystem.open>) => {
                    const handle = await originalOpen(...args);
                    if (!readerContext.getStore() || args[0] !== stateFile || opened) return handle;
                    opened = handle;
                    return new Proxy(handle, {
                        get(target, key) {
                            if (key === 'stat')
                                return async () => {
                                    const entry = await target.stat({ bigint: true });
                                    openedBefore ??= entry;
                                    return entry;
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
                                };
                            const value: unknown = Reflect.get(target, key, target);
                            return typeof value === 'function' ? value.bind(target) : value;
                        },
                    });
                },
            );
            const volumeBoundary = mock.method(
                filesystem,
                'statfs',
                async (...args: Parameters<typeof filesystem.statfs>) => {
                    const volume = await originalStatfs(...args);
                    if (readerContext.getStore() && args[0] === stateFile) pendingNativeResample = true;
                    return volume;
                },
            );
            const namedBoundary = mock.method(
                filesystem,
                'lstat',
                async (...args: Parameters<typeof filesystem.lstat>) => {
                    if (!readerContext.getStore() || args[0] !== stateFile || !pendingNativeResample)
                        return originalLstat(...args);
                    pendingNativeResample = false;
                    const currentPhase = readCalls === 0 ? 'pre-read' : 'post-read';
                    if (paused || currentPhase !== phase) return originalLstat(...args);
                    paused = true;
                    observedPhase = currentPhase;
                    captured.resolve();
                    await resume.promise;
                    const entry = await originalLstat(stateFile, { bigint: true });
                    namedAfterReplacement = entry;
                    if (condition === 'unknown-replacement') throw unknownFailure;
                    return entry;
                },
            );
            const parseBoundary = mock.method(JSON, 'parse', (...args: Parameters<typeof JSON.parse>) => {
                if (countParse && args[0] === oldText) parseCalls++;
                return originalParse(...args);
            });
            syncBuiltinESMExports();
            try {
                const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
                operation = await store.tryAcquire('operation');
                use = await store.tryAcquire('use');
                assert.ok(operation);
                assert.ok(use);
                const readerLease = use;
                countParse = true;
                const reading = readerContext
                    .run(true, () => store.read(readerLease))
                    .then(
                        (value) => ({ value }),
                        (error: unknown) => ({ error }),
                    );
                settleRead = reading;
                await Promise.race([
                    captured.promise,
                    reading.then(() => {
                        throw new Error('Reader bypassed the controlled native resample.');
                    }),
                ]);
                assert.equal(observedPhase, phase);
                assert.ok(opened);
                assert.ok(openedBefore);
                assert.equal(openedBefore.nlink, 1n);
                // The writer is outside readerContext and cannot enter the barrier.
                countParse = false;
                const selected = await store.commit(operation, own.state, next);
                if (condition === 'unsafe-replacement') await chmod(stateFile, 0o644);
                heldAfterReplacement = await opened.stat({ bigint: true });
                const replacement = await originalLstat(stateFile, { bigint: true });
                assert.equal(heldAfterReplacement.isFile(), true);
                assert.equal(heldAfterReplacement.nlink, 0n);
                assert.equal(heldAfterReplacement.ino, openedBefore.ino);
                assert.equal(replacement.nlink, 1n);
                assert.notEqual(replacement.ino, heldAfterReplacement.ino);
                if (condition === 'unsafe-replacement') assert.notEqual(replacement.mode & 0o077n, 0n);
                else assert.equal(replacement.mode & 0o077n, 0n);
                countParse = true;
                resume.resolve();
                const result = await reading;
                countParse = false;
                assert.equal(parseCalls, 0);
                assert.equal(closeCalls, 1);
                await assert.rejects(opened.stat(), { code: 'EBADF' });
                assert.ok(namedAfterReplacement);
                assert.equal(namedAfterReplacement.ino, replacement.ino);
                if (phase === 'pre-read') assert.equal(readCalls, 0);
                else assert.ok(readCalls > 0);
                context.diagnostic(
                    JSON.stringify({
                        phase,
                        condition,
                        nativeResampleReached: paused,
                        actualHeldLinks: String(heldAfterReplacement.nlink),
                        actualHeldInode: String(heldAfterReplacement.ino),
                        actualNamedInode: String(namedAfterReplacement.ino),
                        actualNamedMode: String(namedAfterReplacement.mode & 0o777n),
                        readCalls,
                        parseCalls,
                        closeCalls,
                    }),
                );
                if (condition !== 'unsafe-replacement') assert.deepEqual(await store.read(use), selected);
                assert.ok('error' in result);
                assert.ok(result.error instanceof Error);
                if (condition === 'replacement')
                    assert.equal(result.error.message, 'Deployment document identity changed.');
                else {
                    assert.doesNotMatch(result.error.message, /document identity.*changed/);
                    if (condition === 'unsafe-replacement')
                        assert.equal(result.error.message, 'Deployment native authority is unavailable or unsafe.');
                    else assert.equal(result.error, unknownFailure);
                }
            } finally {
                countParse = false;
                resume.resolve();
                await settleRead?.catch(() => {});
                parseBoundary.mock.restore();
                namedBoundary.mock.restore();
                volumeBoundary.mock.restore();
                openBoundary.mock.restore();
                syncBuiltinESMExports();
                readerContext.disable();
                await use?.release();
                await operation?.release();
                await own.cleanup();
            }
        });
    }
}

test('an opened state document unlinked before its first stat rejects as changed identity', {
    skip: !supported,
    timeout: 20000,
}, async () => {
    const own = await fixture();
    const captured = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const originalOpen = filesystem.open;
    const stateFile = path.join(own.envelope, 'state.json');
    let armed = false;
    let opened: Awaited<ReturnType<typeof filesystem.open>> | undefined;
    let operation: DeploymentLease | undefined;
    let use: DeploymentLease | undefined;
    let settleRead: Promise<unknown> | undefined;
    const boundary = mock.method(filesystem, 'open', async (...args: Parameters<typeof filesystem.open>) => {
        const handle = await originalOpen(...args);
        if (armed && args[0] === stateFile) {
            armed = false;
            opened = handle;
            captured.resolve();
            await resume.promise;
        }
        return handle;
    });
    syncBuiltinESMExports();
    try {
        const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
        operation = await store.tryAcquire('operation');
        use = await store.tryAcquire('use');
        assert.ok(operation);
        assert.ok(use);
        armed = true;
        const reading = store.read(use).then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
        );
        settleRead = reading;
        await Promise.race([
            captured.promise,
            reading.then(() => {
                throw new Error('Reader bypassed its controlled open return.');
            }),
        ]);
        const selected = await store.commit(operation, own.state, next);
        assert.ok(opened);
        const oldInode = await opened.stat({ bigint: true });
        assert.equal(oldInode.isFile(), true);
        assert.equal(oldInode.nlink, 0n);
        resume.resolve();
        const result = await reading;
        assert.ok('error' in result);
        assert.ok(result.error instanceof Error);
        assert.match(result.error.message, /document identity.*changed/);
        await assert.rejects(opened.stat(), { code: 'EBADF' });
        assert.deepEqual(await store.read(use), selected);

        const secondName = path.join(own.envelope, 'state-second-link.json');
        await filesystem.link(stateFile, secondName);
        try {
            await assert.rejects(
                store.read(use),
                (error: unknown) => error instanceof Error && /regular file with one link/.test(error.message),
            );
        } finally {
            await filesystem.unlink(secondName);
        }
    } finally {
        resume.resolve();
        await settleRead?.catch(() => {});
        boundary.mock.restore();
        syncBuiltinESMExports();
        await use?.release();
        await operation?.release();
        await own.cleanup();
    }
});

for (const receipt of ['named', 'current'] as const) {
    test(`an invalidated ${receipt} document receipt rejects without returning or parsing its bytes`, {
        skip: !supported,
        timeout: 20000,
    }, async (context) => {
        const own = await fixture();
        const captured = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const originalOpen = filesystem.open;
        const originalLstat = filesystem.lstat;
        const originalParse = JSON.parse;
        const stateFile = path.join(own.envelope, 'state.json');
        const originalStateText = `${JSON.stringify(own.state)}\n`;
        let armed = false;
        let observing = false;
        let countParse = false;
        let namedCalls = 0;
        let readCalls = 0;
        let parseCalls = 0;
        let closeCalls = 0;
        let opened: Awaited<ReturnType<typeof filesystem.open>> | undefined;
        let before: BigIntStats | undefined;
        let operation: DeploymentLease | undefined;
        let use: DeploymentLease | undefined;
        let settleRead: Promise<unknown> | undefined;
        const openBoundary = mock.method(filesystem, 'open', async (...args: Parameters<typeof filesystem.open>) => {
            const handle = await originalOpen(...args);
            if (!armed || args[0] !== stateFile) return handle;
            armed = false;
            observing = true;
            opened = handle;
            return new Proxy(handle, {
                get(target, key) {
                    if (key === 'stat')
                        return async () => {
                            const entry = await target.stat({ bigint: true });
                            before ??= entry;
                            return entry;
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
                        };
                    const value: unknown = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        });
        const lstatBoundary = mock.method(filesystem, 'lstat', async (...args: Parameters<typeof filesystem.lstat>) => {
            const entry = await originalLstat(...args);
            if (!observing || args[0] !== stateFile) return entry;
            if (receipt === 'named' ? ++namedCalls !== 1 : readCalls === 0) return entry;
            observing = false;
            captured.resolve();
            await resume.promise;
            assert.ok(opened);
            assert.ok(before);
            const invalidated = await opened.stat({ bigint: true });
            const replacement = await originalLstat(stateFile, { bigint: true });
            assert.equal(invalidated.isFile(), true);
            assert.equal(invalidated.isSymbolicLink(), false);
            assert.equal(invalidated.nlink, 0n);
            assert.equal(invalidated.ino, before.ino);
            assert.equal(replacement.nlink, 1n);
            assert.notEqual(replacement.ino, invalidated.ino);
            if (receipt === 'named') return invalidated;
            const expected = before;
            context.diagnostic(
                JSON.stringify({
                    receipt,
                    modeledFields: ['mtimeNs', 'ctimeNs'],
                    actual: { mtimeNs: String(invalidated.mtimeNs), ctimeNs: String(invalidated.ctimeNs) },
                    modeled: { mtimeNs: String(expected.mtimeNs), ctimeNs: String(expected.ctimeNs) },
                    actualNlink: String(invalidated.nlink),
                }),
            );
            // Model only timestamp equality to reach the current-receipt classifier.
            // Inode, link count, type and private-role metadata remain actual.
            return new Proxy(invalidated, {
                get(target, key) {
                    if (key === 'mtimeNs') return expected.mtimeNs;
                    if (key === 'ctimeNs') return expected.ctimeNs;
                    const value: unknown = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        });
        const parseBoundary = mock.method(JSON, 'parse', (...args: Parameters<typeof JSON.parse>) => {
            if (countParse && args[0] === originalStateText) parseCalls++;
            return originalParse(...args);
        });
        syncBuiltinESMExports();
        try {
            const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
            operation = await store.tryAcquire('operation');
            use = await store.tryAcquire('use');
            assert.ok(operation);
            assert.ok(use);
            armed = true;
            countParse = true;
            const reading = store.read(use).then(
                (value) => ({ value }),
                (error: unknown) => ({ error }),
            );
            settleRead = reading;
            await Promise.race([
                captured.promise,
                reading.then(() => {
                    throw new Error('Reader bypassed its controlled receipt return.');
                }),
            ]);
            countParse = false;
            const selected = await store.commit(operation, own.state, next);
            countParse = true;
            resume.resolve();
            const result = await reading;
            countParse = false;
            assert.ok('error' in result);
            assert.ok(result.error instanceof Error);
            assert.match(result.error.message, /document identity.*changed/);
            assert.equal(parseCalls, 0);
            if (receipt === 'named') assert.equal(readCalls, 0);
            else assert.ok(readCalls > 0, 'current receipt follows bounded reads');
            assert.equal(closeCalls, 1);
            assert.ok(opened);
            await assert.rejects(opened.stat(), { code: 'EBADF' });
            assert.deepEqual(await store.read(use), selected);
        } finally {
            countParse = false;
            resume.resolve();
            await settleRead?.catch(() => {});
            parseBoundary.mock.restore();
            lstatBoundary.mock.restore();
            openBoundary.mock.restore();
            syncBuiltinESMExports();
            await use?.release();
            await operation?.release();
            await own.cleanup();
        }
    });
}

test('named document hardlinks, nonregular entries, private-mode failures and absence remain fatal', {
    skip: !supported,
}, async (context) => {
    for (const kind of ['hardlink', 'nonregular', 'permissions', 'absent'] as const) {
        const own = await fixture();
        const originalLstat = filesystem.lstat;
        const stateFile = path.join(own.envelope, 'state.json');
        const secondName = path.join(own.envelope, 'state-second-link.json');
        let armed = false;
        let operation: DeploymentLease | undefined;
        let use: DeploymentLease | undefined;
        const boundary = mock.method(filesystem, 'lstat', async (...args: Parameters<typeof filesystem.lstat>) => {
            if (!armed || args[0] !== stateFile) return originalLstat(...args);
            armed = false;
            if (kind === 'hardlink') await filesystem.link(stateFile, secondName);
            if (kind === 'permissions') await chmod(stateFile, 0o644);
            if (kind === 'absent') await unlink(stateFile);
            // The nonregular control supplies actual owned-directory metadata only here.
            const entry = await originalLstat(kind === 'nonregular' ? own.envelope : stateFile, { bigint: true });
            if (kind === 'hardlink') assert.equal(entry.nlink, 2n);
            if (kind === 'nonregular') assert.equal(entry.isDirectory(), true);
            if (kind === 'permissions') assert.notEqual(entry.mode & 0o077n, 0n);
            return entry;
        });
        syncBuiltinESMExports();
        try {
            const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
            operation = await store.tryAcquire('operation');
            use = await store.tryAcquire('use');
            assert.ok(operation);
            assert.ok(use);
            armed = true;
            await assert.rejects(store.read(use), (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.doesNotMatch(error.message, /document identity.*changed/);
                if (kind === 'absent') return isRecord(error) && error.code === 'ENOENT';
                return kind === 'permissions'
                    ? error.message === 'Deployment native authority is unavailable or unsafe.'
                    : /regular file with one link/.test(error.message);
            });
            context.diagnostic(JSON.stringify({ fatalControl: kind, result: 'passed' }));
        } finally {
            boundary.mock.restore();
            syncBuiltinESMExports();
            if (kind === 'hardlink') await unlink(secondName).catch(() => {});
            if (kind === 'permissions') await chmod(stateFile, 0o600);
            await use?.release();
            await operation?.release();
            await own.cleanup();
        }
    }
});

test('a separate leased reader returns complete selections during atomic writer replacements', {
    skip: !supported,
    timeout: 20000,
}, async () => {
    const own = await fixture();
    const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./fixtures/deployment-state-reader.ts', import.meta.url)), own.directory],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true },
    );
    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
    });
    const exited = once(child, 'exit');
    const earlyExit = exited.then(() => {
        throw new Error(`Reader fixture exited: ${stderr}`);
    });
    let operation: DeploymentLease | undefined;
    try {
        const ready = await Promise.race([once(child, 'message'), earlyExit]);
        assert.equal(ready[0], 'ready');
        const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
        operation = await store.tryAcquire('operation');
        assert.ok(operation);
        let current = await store.read(operation);
        for (let index = 0; index < 11; index++)
            current = await store.commit(operation, current, index % 2 === 0 ? next : { type: 'select', ...selection });
        const result = once(child, 'message');
        child.send('stop');
        const [message] = await Promise.race([result, earlyExit]);
        assert.ok(isRecord(message));
        assert.ok(Array.isArray(message.samples));
        assert.deepEqual(
            new Set(message.samples),
            new Set([
                `${selection.selectedBuildId}:${selection.selectedManifestSha256}`,
                `${next.selectedBuildId}:${next.selectedManifestSha256}`,
            ]),
        );
        const [code, signal] = await exited;
        assert.equal(code, 0, stderr);
        assert.equal(signal, null);
    } finally {
        if (child.connected) {
            child.send('stop');
            await exited;
        }
        await operation?.release();
        await own.cleanup();
    }
});

test('stale root or lock identity and malformed bounded metadata fail without replacing state', {
    skip: !supported,
}, async () => {
    const own = await fixture();
    const moved = `${own.directory}-moved`;
    try {
        const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
        const operation = await store.tryAcquire('operation');
        assert.ok(operation);
        await rename(own.directory, moved);
        await mkdir(own.directory, { mode: 0o700 });
        await assert.rejects(store.commit(operation, own.state, next), (error: unknown) =>
            rejectionReason(error, /identity/i),
        );
        await rm(own.directory, { recursive: true });
        await rename(moved, own.directory);
        await rename(path.join(own.envelope, 'operation.lock'), path.join(own.envelope, 'held.lock'));
        await writeFile(path.join(own.envelope, 'operation.lock'), '', { flag: 'wx', mode: 0o600 });
        await assert.rejects(store.commit(operation, own.state, next), (error: unknown) =>
            rejectionReason(error, /identity/i),
        );
        await operation.release();
        assert.equal(
            JSON.parse(await readFile(path.join(own.envelope, 'state.json'), 'utf8')).selectedBuildId,
            selection.selectedBuildId,
        );
        await writeFile(path.join(own.envelope, 'state.json'), ' '.repeat(65536));
        await assert.rejects(openDeploymentWriterInstallation(own.directory, { tryLock: await native() }), /bound/i);
        await writeFile(
            path.join(own.envelope, 'state.json'),
            `${JSON.stringify(own.state).slice(0, -1)},"phase":"active"}\n`,
        );
        await assert.rejects(
            openDeploymentWriterInstallation(own.directory, { tryLock: await native() }),
            /canonical/i,
        );
        await unlink(path.join(own.envelope, 'state.json'));
        await symlink(path.join(own.envelope, 'installation.json'), path.join(own.envelope, 'state.json'));
        await assert.rejects(openDeploymentWriterInstallation(own.directory, { tryLock: await native() }));
    } finally {
        await own.cleanup();
        await rm(moved, { recursive: true, force: true });
    }
});

type DocumentReadPhase = 'pre-read' | 'post-read';
type DocumentReadInterval = 'canonical' | 'final' | 'named' | 'current';
type DocumentReadCondition =
    | 'replacement'
    | 'unsafe-replacement'
    | 'unknown-replacement'
    | 'enoent-replacement'
    | 'permissions'
    | 'hardlink'
    | 'nonregular'
    | 'foreign-device';

async function controlledDocumentRead(
    context: TestContext,
    control: Readonly<{
        phase: DocumentReadPhase;
        interval: DocumentReadInterval;
        condition: DocumentReadCondition;
        closeFailure?: boolean;
    }>,
) {
    const own = await fixture();
    const readerContext = new AsyncLocalStorage<boolean>();
    const captured = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const originalOpen = filesystem.open;
    const originalLstat = filesystem.lstat;
    const originalStatfs = filesystem.statfs;
    const originalRealpath = filesystem.realpath;
    const originalParse = JSON.parse;
    const stateFile = path.join(own.envelope, 'state.json');
    const secondName = path.join(own.envelope, 'state-control-link.json');
    const oldText = `${JSON.stringify(own.state)}\n`;
    const root = await originalLstat(own.directory, { bigint: true });
    const unknownFailure = Object.assign(new Error('Controlled document interval failure.'), {
        code: control.condition === 'enoent-replacement' ? 'ENOENT' : 'EIO',
    });
    const closeFailure = new Error('Controlled document close failure.');
    const events: string[] = [];
    const nativeSequence: { stage: 'idle' | 'volume' | 'sampled' | 'canonical'; phase: DocumentReadPhase | undefined } =
        {
            stage: 'idle',
            phase: undefined,
        };
    let paused = false;
    let observing = true;
    let pendingCurrent = false;
    let readCalls = 0;
    let parseCalls = 0;
    let closeCalls = 0;
    let failureInjected = false;
    let opened: Awaited<ReturnType<typeof filesystem.open>> | undefined;
    let before: BigIntStats | undefined;
    let held: BigIntStats | undefined;
    let suppliedCurrent: BigIntStats | undefined;
    let operation: DeploymentLease | undefined;
    let use: DeploymentLease | undefined;
    let settleRead: Promise<unknown> | undefined;
    const phase = (): DocumentReadPhase => (readCalls === 0 ? 'pre-read' : 'post-read');
    function invalidateNativeSequence(event: string) {
        events.push(`${phase()}:${event}:${nativeSequence.stage}`);
        nativeSequence.stage = 'idle';
        nativeSequence.phase = undefined;
    }
    async function pauseAt(interval: DocumentReadInterval) {
        if (paused || control.interval !== interval || control.phase !== phase()) return false;
        paused = true;
        events.push(`${phase()}:barrier:${interval}`);
        captured.resolve();
        await resume.promise;
        return true;
    }
    function failUnknown() {
        if (control.condition === 'unknown-replacement' || control.condition === 'enoent-replacement') {
            failureInjected = true;
            throw unknownFailure;
        }
    }
    const openBoundary = mock.method(filesystem, 'open', async (...args: Parameters<typeof filesystem.open>) => {
        const handle = await originalOpen(...args);
        if (!observing || !readerContext.getStore() || args[0] !== stateFile || opened) return handle;
        opened = handle;
        return new Proxy(handle, {
            get(target, key) {
                if (key === 'stat')
                    return async () => {
                        // A handle receipt ends the native sequence. In particular, the old
                        // reader's current lstat cannot be mistaken for a native final lstat.
                        invalidateNativeSequence('handle-stat');
                        if (readCalls > 0 && control.interval === 'current' && (await pauseAt('current')))
                            pendingCurrent = true;
                        const entry = await target.stat({ bigint: true });
                        before ??= entry;
                        if (readCalls > 0) held = entry;
                        return entry;
                    };
                if (key === 'read')
                    return (...values: unknown[]) => {
                        readCalls++;
                        invalidateNativeSequence('handle-read');
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
    const volumeBoundary = mock.method(filesystem, 'statfs', async (...args: Parameters<typeof filesystem.statfs>) => {
        const volume = await originalStatfs(...args);
        if (observing && readerContext.getStore() && opened && args[0] === stateFile) {
            nativeSequence.stage = 'volume';
            nativeSequence.phase = phase();
            events.push(`${phase()}:native-volume`);
        }
        return volume;
    });
    const namedBoundary = mock.method(filesystem, 'lstat', async (...args: Parameters<typeof filesystem.lstat>) => {
        if (!observing || !readerContext.getStore() || !opened || args[0] !== stateFile) return originalLstat(...args);
        assert.ok(isRecord(args[1]) && args[1].bigint === true, 'Document metadata must use bigint receipts.');
        if (nativeSequence.stage === 'volume') {
            const entry = await originalLstat(stateFile, { bigint: true });
            nativeSequence.stage = 'sampled';
            events.push(`${phase()}:native-first-sample`);
            return entry;
        }
        if (nativeSequence.stage === 'canonical' && nativeSequence.phase === phase()) {
            events.push(`${phase()}:native-final-sample`);
            const reached = await pauseAt('final');
            const entry = await originalLstat(stateFile, { bigint: true });
            nativeSequence.stage = 'idle';
            if (reached) failUnknown();
            return entry;
        }
        if (control.interval === 'named' && readCalls === 0) await pauseAt('named');
        const entry = await originalLstat(stateFile, { bigint: true });
        if (!pendingCurrent) return entry;
        pendingCurrent = false;
        if (control.condition === 'nonregular') {
            // Actual owned-directory metadata is controlled type evidence, not
            // a claim of an atomic file-to-directory replacement.
            suppliedCurrent = await originalLstat(own.envelope, { bigint: true });
            return suppliedCurrent;
        }
        if (control.condition === 'foreign-device') {
            // Only this adversarial negative field is modeled. This is not
            // evidence of a cross-filesystem rename or a mount experiment.
            suppliedCurrent = new Proxy(entry, {
                get(target, key) {
                    if (key === 'dev') return root.dev + 1n;
                    const value: unknown = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
            return suppliedCurrent;
        }
        suppliedCurrent = entry;
        return entry;
    });
    const canonicalBoundary = mock.method(
        filesystem,
        'realpath',
        async (...args: Parameters<typeof filesystem.realpath>) => {
            const nativeCanonical =
                observing &&
                readerContext.getStore() &&
                opened &&
                args[0] === stateFile &&
                nativeSequence.stage === 'sampled' &&
                nativeSequence.phase === phase();
            const reached = nativeCanonical && (await pauseAt('canonical'));
            const resolved = await originalRealpath(...args);
            if (nativeCanonical) {
                nativeSequence.stage = 'canonical';
                events.push(`${phase()}:native-canonical`);
            }
            if (reached) failUnknown();
            return resolved;
        },
    );
    const parseBoundary = mock.method(JSON, 'parse', (...args: Parameters<typeof JSON.parse>) => {
        if (observing && readerContext.getStore() && args[0] === oldText) parseCalls++;
        return originalParse(...args);
    });
    syncBuiltinESMExports();
    try {
        const store = await openDeploymentWriterInstallation(own.directory, { tryLock: await native() });
        operation = await store.tryAcquire('operation');
        use = await store.tryAcquire('use');
        assert.ok(operation);
        assert.ok(use);
        const readerLease = use;
        const reading = readerContext
            .run(true, () => store.read(readerLease))
            .then(
                (value) => ({ value }),
                (error: unknown) => ({ error }),
            );
        settleRead = reading;
        const arrival = await Promise.race([
            captured.promise.then(() => 'reached' as const),
            reading.then(() => 'settled' as const),
        ]);
        context.diagnostic(
            JSON.stringify({ ...control, arrival, events: [...events], readCalls, parseCalls, closeCalls }),
        );
        // Old code has no native final lstat. Intervening handle I/O resets the
        // provenance above; a later reader receipt cannot satisfy this assertion.
        assert.equal(
            arrival,
            'reached',
            `Missing controlled native/receipt interval: ${control.phase}/${control.interval}; reader settled first.`,
        );
        assert.equal(phase(), control.phase);
        assert.ok(opened);
        assert.ok(before);
        assert.equal(before.nlink, 1n);
        let selected = own.state;
        if (control.condition === 'permissions') {
            await chmod(stateFile, 0o644);
            const changed = await originalLstat(stateFile, { bigint: true });
            assert.equal(changed.ino, before.ino);
            assert.equal(changed.mode & 0o777n, 0o644n);
            assert.notEqual(changed.ctimeNs, before.ctimeNs);
        } else {
            // Writer execution is outside readerContext and cannot enter the barrier.
            selected = await store.commit(operation, own.state, next);
            if (control.condition === 'unsafe-replacement') await chmod(stateFile, 0o644);
            if (control.condition === 'hardlink') await filesystem.link(stateFile, secondName);
            held = await opened.stat({ bigint: true });
            const named = await originalLstat(stateFile, { bigint: true });
            assert.equal(held.isFile(), true);
            assert.equal(held.ino, before.ino);
            assert.equal(held.nlink, 0n);
            assert.notEqual(named.ino, held.ino);
            assert.equal(named.dev, root.dev);
            assert.equal(named.nlink, control.condition === 'hardlink' ? 2n : 1n);
            assert.equal(named.mode & 0o777n, control.condition === 'unsafe-replacement' ? 0o644n : 0o600n);
        }
        resume.resolve();
        const result = await reading;
        observing = false;
        context.diagnostic(
            JSON.stringify({
                ...control,
                events,
                readCalls,
                parseCalls,
                closeCalls,
                heldLinks: held && String(held.nlink),
                suppliedCurrentDevice: suppliedCurrent && String(suppliedCurrent.dev),
                rootDevice: String(root.dev),
                rejected: 'error' in result,
                failureInjected,
                message: 'error' in result && result.error instanceof Error ? result.error.message : undefined,
            }),
        );
        assert.equal(closeCalls, 1);
        await assert.rejects(opened.stat(), { code: 'EBADF' });
        assert.ok('error' in result, 'Concurrent document change must refuse before returning the old selection.');
        assert.ok(result.error instanceof Error);
        if (control.closeFailure) assert.equal(result.error, closeFailure);
        else if (control.condition === 'replacement')
            assert.equal(result.error.message, 'Deployment document identity changed.');
        else if (control.condition === 'unknown-replacement' || control.condition === 'enoent-replacement')
            assert.equal(result.error, unknownFailure);
        else if (control.condition === 'hardlink' || control.condition === 'nonregular')
            assert.equal(result.error.message, 'Deployment metadata/lease must be a regular file with one link.');
        else assert.equal(result.error.message, 'Deployment native authority is unavailable or unsafe.');
        if (control.condition !== 'replacement')
            assert.doesNotMatch(result.error.message, /document identity.*changed/);
        assert.equal(parseCalls, 0);
        if (control.condition === 'unknown-replacement' || control.condition === 'enoent-replacement')
            assert.equal(failureInjected, true);
        if (control.condition === 'foreign-device') {
            assert.ok(held);
            assert.equal(held.nlink, 0n);
            assert.ok(suppliedCurrent);
            assert.equal(suppliedCurrent.dev, root.dev + 1n);
            assert.equal(suppliedCurrent.nlink, 1n);
            assert.equal(suppliedCurrent.mode & 0o777n, 0o600n);
        }
        if (
            !control.closeFailure &&
            ['replacement', 'unknown-replacement', 'enoent-replacement'].includes(control.condition)
        )
            assert.deepEqual(await store.read(use), selected);
    } finally {
        observing = false;
        resume.resolve();
        await settleRead?.catch(() => {});
        parseBoundary.mock.restore();
        canonicalBoundary.mock.restore();
        namedBoundary.mock.restore();
        volumeBoundary.mock.restore();
        openBoundary.mock.restore();
        syncBuiltinESMExports();
        readerContext.disable();
        if (control.condition === 'permissions' || control.condition === 'unsafe-replacement')
            await chmod(stateFile, 0o600);
        if (control.condition === 'hardlink')
            await unlink(secondName).catch((error: unknown) => {
                if (!isRecord(error) || error.code !== 'ENOENT') throw error;
            });
        await use?.release();
        await operation?.release();
        await own.cleanup();
    }
}

for (const phase of ['pre-read', 'post-read'] as const) {
    for (const interval of ['canonical', 'final'] as const) {
        for (const condition of ['replacement', 'unsafe-replacement', 'unknown-replacement'] as const) {
            test(
                `${phase} ${interval} native interval refuses ${condition} before old document parsing`,
                {
                    skip: !supported,
                    timeout: 20000,
                },
                (context) => controlledDocumentRead(context, { phase, interval, condition }),
            );
        }
    }
}

for (const [phase, interval] of [
    ['pre-read', 'named'],
    ['post-read', 'current'],
] as const) {
    test(
        `${phase} observed private permissions take precedence over chmod ctime drift`,
        {
            skip: !supported,
            timeout: 20000,
        },
        (context) => controlledDocumentRead(context, { phase, interval, condition: 'permissions' }),
    );
}

for (const condition of ['unsafe-replacement', 'hardlink', 'nonregular', 'foreign-device'] as const) {
    test(
        `post-read held zero-link receipt cannot hide observed current ${condition}`,
        {
            skip: !supported,
            timeout: 20000,
        },
        (context) => controlledDocumentRead(context, { phase: 'post-read', interval: 'current', condition }),
    );
}

test(
    'final native lstat preserves the original ENOENT Error after an actual replacement',
    {
        skip: !supported,
        timeout: 20000,
    },
    (context) =>
        controlledDocumentRead(context, { phase: 'post-read', interval: 'final', condition: 'enoent-replacement' }),
);

for (const condition of ['replacement', 'unknown-replacement'] as const) {
    test(
        `a real single close preserves its own fatal Error after final-native ${condition}`,
        {
            skip: !supported,
            timeout: 20000,
        },
        (context) =>
            controlledDocumentRead(context, {
                phase: 'post-read',
                interval: 'final',
                condition,
                closeFailure: true,
            }),
    );
}
