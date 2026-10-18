import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
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
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    DeploymentCommitError,
    type DeploymentLease,
    openDeploymentInstallation,
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
    const directory = await mkdtemp(path.join(tmpdir(), 'dct-deployment-store-'));
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

test('unsupported native permission/filesystem roles refuse before creating or adopting deployment metadata', {
    skip: supported,
}, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dct-deployment-unsupported-'));
    try {
        await assert.rejects(openDeploymentInstallation(directory, { tryLock: () => true }), /unsupported/i);
        assert.deepEqual(await readdir(directory), []);
    } finally {
        await rm(directory, { recursive: true });
    }
});

test('enrolled store binds physical root, exact metadata and independently owned leases', {
    skip: !supported,
}, async () => {
    const own = await fixture();
    try {
        const store = await openDeploymentInstallation(own.directory, { tryLock: await native() });
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
        const foreign = await openDeploymentInstallation(own.directory, { tryLock: await native() });
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
        const store = await openDeploymentInstallation(own.directory, { tryLock: await native() });
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
        const store = await openDeploymentInstallation(own.directory, {
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
        const store = await openDeploymentInstallation(own.directory, {
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
        const before = await openDeploymentInstallation(own.directory, {
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
        const after = await openDeploymentInstallation(own.directory, {
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
        const store = await openDeploymentInstallation(own.directory, {
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
        const store = await openDeploymentInstallation(own.directory, {
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
        const store = await openDeploymentInstallation(own.directory, { tryLock: await native() });
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
        const store = await openDeploymentInstallation(own.directory, { tryLock: await native() });
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
        const store = await openDeploymentInstallation(own.directory, { tryLock: await native() });
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
        await assert.rejects(openDeploymentInstallation(own.directory, { tryLock: await native() }), /bound/i);
        await writeFile(
            path.join(own.envelope, 'state.json'),
            `${JSON.stringify(own.state).slice(0, -1)},"phase":"active"}\n`,
        );
        await assert.rejects(openDeploymentInstallation(own.directory, { tryLock: await native() }), /canonical/i);
        await unlink(path.join(own.envelope, 'state.json'));
        await symlink(path.join(own.envelope, 'installation.json'), path.join(own.envelope, 'state.json'));
        await assert.rejects(openDeploymentInstallation(own.directory, { tryLock: await native() }));
    } finally {
        await own.cleanup();
        await rm(moved, { recursive: true, force: true });
    }
});
