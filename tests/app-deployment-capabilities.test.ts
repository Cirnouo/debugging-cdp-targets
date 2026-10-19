import assert from 'node:assert/strict';
import childProcess, { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import fs, { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { promisify } from 'node:util';
import * as deployment from '../src/adapters/app-deployment.ts';
import { openDeploymentNativeAuthority } from '../src/adapters/app-deployment-native.ts';
import { isRecord } from '../src/shared/errors.ts';

// These fixtures replace permission/account/volume evidence. No native helper,
// lock addon, ACL query, chmod, installer or actual platform admission runs.
function metadata(stats: BigIntStats, patch: Partial<BigIntStats>): BigIntStats {
    return new Proxy(stats, {
        get: (target, key) => (Object.hasOwn(patch, key) ? Reflect.get(patch, key) : Reflect.get(target, key)),
    });
}
async function fixture() {
    const directory = await fs.realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-authority-controlled-')));
    const envelope = path.join(directory, '.deployment');
    await mkdir(envelope);
    const stats = await lstat(directory, { bigint: true });
    const installation = {
        schemaVersion: 1,
        installationId: '0dd7224c-51a2-41b3-914d-01171c139ac2',
        kind: 'portable',
        platform: 'win32',
        architecture: process.arch,
        root: { realPath: directory, device: String(stats.dev), inode: String(stats.ino) },
    };
    const identity = createHash('sha256').update(JSON.stringify(installation)).digest('hex');
    const state = {
        schemaVersion: 1,
        installationIdentity: identity,
        phase: 'active',
        selectedBuildId: 'a'.repeat(64),
        selectedManifestSha256: 'b'.repeat(64),
    };
    for (const [name, content] of [
        ['installation.json', `${JSON.stringify(installation)}\n`],
        ['state.json', `${JSON.stringify(state)}\n`],
        ['operation.lock', ''],
        ['use.lock', ''],
    ]) {
        assert.ok(name !== undefined && content !== undefined);
        await writeFile(path.join(envelope, name), content);
    }
    let account = 'S-1-5-21-1-2-3-1000';
    let unsafe = '';
    let reply: (name: string, value: Record<string, unknown>) => unknown = (_name, value) => value;
    const descriptors: { file: string; flags: string | number }[] = [];
    const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
    const originalStat = fs.lstat;
    const originalOpen = fs.open;
    const stat = (name: string, value: BigIntStats) => {
        const managed = name === directory || name.startsWith(`${directory}${path.sep}`);
        return metadata(value, {
            uid: managed ? 1000n : 0n,
            gid: managed ? 1000n : 0n,
            mode: value.isDirectory() ? (name === unsafe ? 0o40777n : managed ? 0o40700n : 0o40755n) : 0o100600n,
        });
    };
    const named = mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) =>
        stat(String(args[0]), await originalStat(args[0], { bigint: true })),
    );
    const opened = mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        descriptors.push({ file: String(args[0]), flags: args[1] ?? 'r' });
        const handle = await originalOpen(...args);
        handles.push(handle);
        const original = handle.stat.bind(handle);
        mock.method(handle, 'stat', async () => stat(String(args[0]), await original({ bigint: true })));
        return handle;
    });
    const volume = mock.method(fs, 'statfs', async () => ({ type: 0xef53n }));
    // execFile's custom promisify can retain its original executor across a mock.
    // Block the actual native spawn method before any fixture/helper can run.
    const originalSpawn = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn');
    assert.ok(originalSpawn);
    Object.defineProperty(ChildProcess.prototype, 'spawn', {
        ...originalSpawn,
        value: () => {
            throw new Error('Native process creation is forbidden in controlled authority tests.');
        },
    });
    const helper = mock.method(childProcess, 'execFile', (...args: unknown[]) => {
        const argv = args[1];
        assert.ok(Array.isArray(argv));
        const name = argv[argv.length - 1];
        assert.equal(typeof name, 'string');
        const callback = args.at(-1);
        assert.equal(typeof callback, 'function');
        if (typeof callback !== 'function' || typeof name !== 'string') throw new Error('Malformed helper call.');
        assert.ok(argv.includes('-NoProfile') && argv.includes('-NonInteractive'));
        const options = args[2];
        assert.ok(
            typeof options === 'object' &&
                options !== null &&
                'shell' in options &&
                'windowsHide' in options &&
                'env' in options,
        );
        assert.equal(options.shell, false);
        assert.equal(options.windowsHide, true);
        void originalStat(name, { bigint: true }).then(
            (value) => {
                const result = {
                    platform: 'win32',
                    account,
                    owner: 'S-1-5-21-1-2-3-1000',
                    path: name,
                    device: String(value.dev),
                    inode: String(value.ino),
                    links: String(value.nlink),
                    size: String(value.isDirectory() ? 0 : value.size),
                    directory: value.isDirectory(),
                    protected: true,
                    reparse: false,
                    filesystem: 'NTFS',
                    driveType: 3,
                    volumeFlags: 8,
                    dacl: [
                        {
                            sid: name === unsafe ? 'S-1-1-0' : 'S-1-5-21-1-2-3-1000',
                            mask: '2032127',
                            flags: value.isDirectory() ? 3 : 0,
                            type: 0,
                        },
                    ],
                };
                callback(null, `${JSON.stringify(reply(name, result))}\n`, '');
            },
            (error: unknown) => callback(error, '', ''),
        );
        return new ChildProcess();
    });
    syncBuiltinESMExports();
    return {
        directory,
        envelope,
        state,
        descriptors,
        reply: (value: typeof reply) => {
            reply = value;
        },
        setUid: (value: number) => {
            account = `S-1-5-21-1-2-3-${value}`;
        },
        unsafe: (name: string) => {
            unsafe = name;
        },
        async cleanup() {
            for (const handle of handles) await handle.close();
            named.mock.restore();
            opened.mock.restore();
            volume.mock.restore();
            helper.mock.restore();
            Object.defineProperty(ChildProcess.prototype, 'spawn', originalSpawn);
            syncBuiltinESMExports();
            assert.equal(path.dirname(directory), await fs.realpath(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-authority-controlled-'));
            await rm(directory, { recursive: true });
        },
    };
}

test('reader exposes only shared-use admission and cannot request operation, deletion or commit', {
    skip: process.platform !== 'win32',
}, async () => {
    const own = await fixture();
    try {
        const reader = await deployment.openDeploymentInstallation(own.directory, { tryLock: () => true });
        assert.equal('commit' in reader, false);
        await assert.rejects(Reflect.apply(reader.tryAcquire, reader, ['operation']), /writer|read/i);
        await assert.rejects(Reflect.apply(reader.tryAcquire, reader, ['deletion']), /writer|read/i);
        const lease = await reader.tryAcquire('use');
        assert.ok(lease);
        assert.deepEqual(await reader.read(lease), own.state);
        await lease.release();
    } finally {
        await own.cleanup();
    }
});

test('missing, malformed, noncanonical and foreign initial documents remain unusable without adoption', {
    skip: process.platform !== 'win32',
}, async () => {
    for (const scenario of ['missing-installation', 'missing-state', 'future-state', 'noncanonical', 'foreign-root']) {
        const own = await fixture();
        try {
            const installationFile = path.join(own.envelope, 'installation.json');
            const stateFile = path.join(own.envelope, 'state.json');
            if (scenario === 'missing-installation') await fs.unlink(installationFile);
            if (scenario === 'missing-state') await fs.unlink(stateFile);
            if (scenario === 'future-state')
                await writeFile(stateFile, `${JSON.stringify({ ...own.state, schemaVersion: 2 })}\n`);
            if (scenario === 'noncanonical') await writeFile(stateFile, JSON.stringify(own.state, null, 4));
            if (scenario === 'foreign-root') {
                const value: unknown = JSON.parse(await readFile(installationFile, 'utf8'));
                assert.ok(isRecord(value) && isRecord(value.root));
                value.root.inode = '18446744073709551615';
                await writeFile(installationFile, `${JSON.stringify(value)}\n`);
            }
            const before = await fs.readdir(own.envelope);
            await assert.rejects(deployment.openDeploymentInstallation(own.directory, { tryLock: () => true }));
            assert.deepEqual(await fs.readdir(own.envelope), before);
        } finally {
            await own.cleanup();
        }
    }
});

test('custom-promisify bypass is rejected before native process creation even when helper source exists', {
    skip: process.platform !== 'win32',
}, async () => {
    const own = await fixture();
    try {
        await assert.rejects(
            async () => promisify(childProcess.execFile)(process.execPath, ['--version']),
            /Native process creation is forbidden/,
        );
        // The real production factory must still work through the controlled callback executor.
        const reader = await deployment.openDeploymentInstallation(own.directory, { tryLock: () => true });
        assert.equal(reader.installation.root.realPath, own.directory);
    } finally {
        await own.cleanup();
    }
});

test('trusted writer derives actual account authority and refuses changed account or unsafe ancestors before effects', {
    skip: process.platform !== 'win32',
}, async () => {
    const own = await fixture();
    try {
        assert.ok('openDeploymentWriterInstallation' in deployment);
        const openWriter = deployment.openDeploymentWriterInstallation;
        assert.equal(typeof openWriter, 'function');
        if (typeof openWriter !== 'function') throw new Error('Missing writer entry.');
        const writer = await openWriter(own.directory, { tryLock: () => true });
        const lease = await writer.tryAcquire('operation');
        assert.ok(lease);
        own.setUid(1001);
        await assert.rejects(writer.commit(lease, own.state, { type: 'begin-removal' }));
        assert.equal(JSON.parse(await readFile(path.join(own.envelope, 'state.json'), 'utf8')).phase, 'active');
        own.setUid(1000);
        own.unsafe(path.dirname(own.directory));
        await assert.rejects(writer.tryAcquire('operation'), /permission|unsafe|authority/i);
        await lease.release();
    } finally {
        await own.cleanup();
    }
});

test('partial envelope with either missing fixed lease refuses read admission without repair', {
    skip: process.platform !== 'win32',
}, async () => {
    for (const name of ['operation.lock', 'use.lock']) {
        const own = await fixture();
        try {
            await fs.unlink(path.join(own.envelope, name));
            await assert.rejects(deployment.openDeploymentInstallation(own.directory, { tryLock: () => true }));
            await assert.rejects(readFile(path.join(own.envelope, name)), { code: 'ENOENT' });
        } finally {
            await own.cleanup();
        }
    }
});

test('exact shared and writable lease descriptors retain removal fences and report uncertain replacement', {
    skip: process.platform !== 'win32',
}, async () => {
    const own = await fixture();
    try {
        const reader = await deployment.openDeploymentInstallation(own.directory, { tryLock: () => true });
        const use = await reader.tryAcquire('use');
        assert.ok(use);
        assert.equal(own.descriptors.find((entry) => entry.file.endsWith('use.lock'))?.flags, 0);
        const writer = await deployment.openDeploymentWriterInstallation(own.directory, { tryLock: () => true });
        const operation = await writer.tryAcquire('operation');
        assert.ok(operation);
        assert.equal(own.descriptors.find((entry) => entry.file.endsWith('operation.lock'))?.flags, 2);
        const removing = await writer.commit(operation, own.state, { type: 'begin-removal' });
        assert.equal(removing.phase, 'removing');
        await assert.rejects(reader.tryAcquire('use'), /fenced/);
        const deletion = await writer.tryAcquire('deletion', operation);
        assert.ok(deletion);
        await assert.rejects(
            writer.commit(operation, removing, { type: 'cancel-removal' }),
            (error: unknown) => error instanceof deployment.DeploymentCommitError && error.outcome === 'not-committed',
        );
        await assert.rejects(operation.release(), /Deletion/);
        await deletion.release();
        await use.release();
        await operation.release();
        const failed = await deployment.openDeploymentWriterInstallation(own.directory, {
            tryLock: () => true,
            stateIO: {
                replace: async (from, to) => {
                    await fs.rename(from, to);
                    throw new Error('controlled replacement uncertainty');
                },
            },
        });
        const lease = await failed.tryAcquire('operation');
        assert.ok(lease);
        await assert.rejects(
            failed.commit(lease, removing, { type: 'cancel-removal' }),
            (error: unknown) => error instanceof deployment.DeploymentCommitError && error.outcome === 'indeterminate',
        );
        assert.equal((await failed.read(lease)).phase, 'active');
        await lease.release();
    } finally {
        await own.cleanup();
    }
});

test('native result success cannot hide changed object identity, granting ACL or unknown fields', {
    skip: process.platform !== 'win32',
}, async () => {
    const own = await fixture();
    try {
        for (const patch of [
            { inode: '18446744073709551615' },
            { reparse: true },
            { filesystem: 'SMB' },
            { trusted: true },
            { owner: 'S-1-5-21-1-2-3-1001' },
            { dacl: null },
        ]) {
            own.reply((_name, value) => ({ ...value, ...patch }));
            await assert.rejects(deployment.openDeploymentInstallation(own.directory, { tryLock: () => true }));
        }
        own.reply((_name, value) => value);
        const reader = await deployment.openDeploymentInstallation(own.directory, { tryLock: () => true });
        const lease = await reader.tryAcquire('use');
        assert.ok(lease);
        const name = path.join(own.envelope, 'use.lock');
        await fs.rename(name, `${name}-old`);
        await writeFile(name, '');
        await assert.rejects(reader.read(lease), /identity/);
        await lease.release();
    } finally {
        await own.cleanup();
    }
});

test('Linux system-DEB readers and writers derive their roles from controlled real/effective UID and root-owned fixed paths', async () => {
    const template = await lstat(process.cwd(), { bigint: true });
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const getuid = Object.getOwnPropertyDescriptor(process, 'getuid');
    const geteuid = Object.getOwnPropertyDescriptor(process, 'geteuid');
    let foreign = false;
    let childrenChanged = false;
    let uid = 1000,
        effective = 1000,
        filesystem = 0xef53n,
        unsafe = false;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'getuid', { value: () => uid, configurable: true });
    Object.defineProperty(process, 'geteuid', { value: () => effective, configurable: true });
    const entry = (name: string) =>
        metadata(template, {
            uid: 0n,
            gid: 0n,
            dev: foreign && name.endsWith('/builds') ? 2n : 1n,
            ino: BigInt(name.length + 1),
            mode: unsafe ? 0o40777n : 0o40755n,
            size: childrenChanged ? 128n : 0n,
            nlink: childrenChanged ? 3n : 2n,
            ctimeNs: template.ctimeNs + (childrenChanged ? 1n : 0n),
            mtimeNs: template.mtimeNs + (childrenChanged ? 1n : 0n),
        });
    const named = mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => entry(String(args[0])));
    const canonical = mock.method(fs, 'realpath', async (name: Parameters<typeof fs.realpath>[0]) => String(name));
    const volume = mock.method(fs, 'statfs', async () => ({ type: filesystem }));
    syncBuiltinESMExports();
    try {
        const reader = await openDeploymentNativeAuthority('/opt/debugging-cdp-targets', false);
        assert.equal(reader.role, 'system');
        assert.throws(() => reader.writer(), /reader/);
        await assert.rejects(openDeploymentNativeAuthority('/opt/debugging-cdp-targets', true));
        uid = effective = 0;
        const writer = await openDeploymentNativeAuthority('/opt/debugging-cdp-targets', true);
        assert.doesNotThrow(() => writer.writer());
        const beforeChildren = entry('/opt/debugging-cdp-targets');
        childrenChanged = true;
        await assert.doesNotReject(writer.entry('/opt/debugging-cdp-targets', beforeChildren, 'directory'));
        childrenChanged = false;
        effective = 1000;
        assert.throws(() => writer.writer());
        effective = 0;
        foreign = true;
        await assert.rejects(
            writer.entry('/opt/debugging-cdp-targets/builds', entry('/opt/debugging-cdp-targets/builds'), 'directory'),
        );
        foreign = false;
        filesystem = 0x6969n;
        await assert.rejects(
            writer.entry('/opt/debugging-cdp-targets', entry('/opt/debugging-cdp-targets'), 'directory'),
            /filesystem/,
        );
        filesystem = 0xef53n;
        unsafe = true;
        await assert.rejects(writer.ancestors(), /permission/);
    } finally {
        named.mock.restore();
        canonical.mock.restore();
        volume.mock.restore();
        if (platform) Object.defineProperty(process, 'platform', platform);
        if (getuid) Object.defineProperty(process, 'getuid', getuid);
        else delete process.getuid;
        if (geteuid) Object.defineProperty(process, 'geteuid', geteuid);
        else delete process.geteuid;
        syncBuiltinESMExports();
    }
});

test('macOS trusted sealed-System ancestry admits writable Data controls and refuses unsafe ancestors or read-only managed entries', async () => {
    const template = await lstat(process.cwd(), { bigint: true });
    const directory = '/Users/alice/Applications/Debugging';
    const control = `${directory}/.deployment/use.lock`;
    const entries = new Map([
        ['/', { owner: '0', device: '1', mode: 0o755, directory: true, mountFlags: 0x1001 }],
        ['/Users', { owner: '0', device: '2', mode: 0o755, directory: true, mountFlags: 0x1000 }],
        ['/Users/alice', { owner: '501', device: '2', mode: 0o700, directory: true, mountFlags: 0x1000 }],
        ['/Users/alice/Applications', { owner: '501', device: '2', mode: 0o700, directory: true, mountFlags: 0x1000 }],
        [directory, { owner: '501', device: '2', mode: 0o700, directory: true, mountFlags: 0x1000 }],
        [`${directory}/.deployment`, { owner: '501', device: '2', mode: 0o700, directory: true, mountFlags: 0x1000 }],
        [control, { owner: '501', device: '2', mode: 0o600, directory: false, mountFlags: 0x1000 }],
    ]);
    const native = (name: string) => {
        const value = entries.get(name);
        assert.ok(value, `Unexpected controlled path: ${name}`);
        return {
            platform: 'darwin',
            account: '501',
            path: name,
            inode: String([...entries.keys()].indexOf(name) + 1),
            links: value.directory ? '2' : '1',
            size: '0',
            acl: 'absent',
            filesystem: 'apfs',
            lockCapabilities: true,
            ...value,
        };
    };
    const stats = (name: string) => {
        const value = native(name);
        return metadata(template, {
            uid: BigInt(value.owner),
            gid: 20n,
            dev: BigInt(value.device),
            ino: BigInt(value.inode),
            mode: BigInt((value.directory ? 0o40000 : 0o100000) | value.mode),
            size: 0n,
            nlink: BigInt(value.links),
        });
    };
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const getuid = Object.getOwnPropertyDescriptor(process, 'getuid');
    const geteuid = Object.getOwnPropertyDescriptor(process, 'geteuid');
    const originalSpawn = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn');
    assert.ok(originalSpawn);
    Object.defineProperty(ChildProcess.prototype, 'spawn', {
        ...originalSpawn,
        value: () => {
            throw new Error('Native process creation is forbidden in controlled macOS authority tests.');
        },
    });
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'getuid', { value: () => 501, configurable: true });
    Object.defineProperty(process, 'geteuid', { value: () => 501, configurable: true });
    let mutation: { name: string; fields: Record<string, unknown> } | undefined;
    const named = mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => stats(String(args[0])));
    const canonical = mock.method(fs, 'realpath', async (name: Parameters<typeof fs.realpath>[0]) => String(name));
    const helper = mock.method(childProcess, 'execFile', (...args: unknown[]) => {
        assert.equal(args[0], '/usr/bin/osascript');
        assert.ok(Array.isArray(args[1]));
        const name: unknown = args[1].at(-1);
        const callback = args.at(-1);
        assert.equal(typeof name, 'string');
        assert.equal(typeof callback, 'function');
        if (typeof name !== 'string' || typeof callback !== 'function')
            throw new Error('Invalid controlled native query.');
        callback(null, JSON.stringify({ ...native(name), ...(mutation?.name === name ? mutation.fields : {}) }), '');
        return new ChildProcess();
    });
    syncBuiltinESMExports();
    try {
        const authority = await openDeploymentNativeAuthority(directory, true);
        await authority.entry(`${directory}/.deployment`, stats(`${directory}/.deployment`), 'directory');
        await authority.entry(control, stats(control), 'use');
        mutation = { name: '/', fields: { acl: 'deny-only' } };
        await assert.doesNotReject(openDeploymentNativeAuthority(directory, true));
        for (const fields of [
            { owner: '502' },
            { mode: 0o777 },
            { acl: 'present' },
            { acl: 'error' },
            { filesystem: 'nfs' },
            { mountFlags: 1 },
            { mountFlags: 0x201001 },
            { directory: false },
        ]) {
            mutation = { name: '/', fields };
            await assert.rejects(openDeploymentNativeAuthority(directory, true));
        }
        mutation = { name: directory, fields: { mountFlags: 0x1001 } };
        await assert.rejects(openDeploymentNativeAuthority(directory, true));
        mutation = { name: control, fields: { mountFlags: 0x1001 } };
        await assert.rejects(authority.entry(control, stats(control), 'use'));
        mutation = { name: `${directory}/.deployment`, fields: { mountFlags: 0x1001 } };
        await assert.rejects(
            authority.entry(`${directory}/.deployment`, stats(`${directory}/.deployment`), 'directory'),
        );
    } finally {
        named.mock.restore();
        canonical.mock.restore();
        helper.mock.restore();
        Object.defineProperty(ChildProcess.prototype, 'spawn', originalSpawn);
        if (platform) Object.defineProperty(process, 'platform', platform);
        if (getuid) Object.defineProperty(process, 'getuid', getuid);
        else delete process.getuid;
        if (geteuid) Object.defineProperty(process, 'geteuid', geteuid);
        else delete process.geteuid;
        syncBuiltinESMExports();
    }
});
