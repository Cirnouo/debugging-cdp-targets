import assert from 'node:assert/strict';
import childProcess, { ChildProcess, execFile } from 'node:child_process';
import { constants } from 'node:fs';
import fs, { readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { mock, test } from 'node:test';
import { promisify } from 'node:util';
import { isRecord } from '../src/shared/errors.ts';
import { createDeploymentStoreFixture } from './fixtures/deployment-store.ts';

for (const native of [
    { platform: 'linux', architecture: 'x64' },
    { platform: 'darwin', architecture: 'arm64' },
    { platform: 'win32', architecture: 'ia32' },
]) {
    for (const writing of [false, true]) {
        test(`unsupported deployment authority refuses before filesystem or native query on ${native.platform}/${native.architecture} (${writing ? 'writer' : 'reader'})`, async () => {
            const result = await promisify(execFile)(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `
import childProcess,{ChildProcess} from 'node:child_process';
import filesystem from 'node:fs';
import fs from 'node:fs/promises';
import Module,{syncBuiltinESMExports} from 'node:module';
import {openDeploymentNativeAuthority} from ${JSON.stringify(new URL('../src/adapters/app-deployment-native.ts', import.meta.url).href)};
const effects={resolve:0,read:0,lstat:0,open:0,mkdir:0,realpath:0,statfs:0,query:0,dlopen:0};
const blocked=key=>()=>{effects[key]++;throw Error('Blocked unexpected native acquisition: '+key)};
Object.defineProperty(process,'platform',{value:${JSON.stringify(native.platform)}});
Object.defineProperty(process,'arch',{value:${JSON.stringify(native.architecture)}});
Module._resolveFilename=blocked('resolve');
for(const [name,key] of [['readFile','read'],['lstat','lstat'],['open','open'],['mkdir','mkdir'],['realpath','realpath'],['statfs','statfs'],['readdir','read'],['readlink','read']])fs[name]=blocked(key);
for(const [name,key] of [['readFileSync','read'],['lstatSync','lstat'],['openSync','open'],['mkdirSync','mkdir'],['realpathSync','realpath'],['statfsSync','statfs']])filesystem[name]=blocked(key);
for(const name of ['spawn','spawnSync','execFile','execFileSync','execSync'])childProcess[name]=blocked('query');
ChildProcess.prototype.spawn=blocked('query');
process.dlopen=blocked('dlopen');
syncBuiltinESMExports();
let rejected=false,message='';
try{await openDeploymentNativeAuthority(${JSON.stringify(native.platform === 'win32' ? 'C:\\owned\\deployment' : '/owned/deployment')},${writing})}catch(error){rejected=true;message=error instanceof Error?error.message:'Non-Error rejection'}
console.log(JSON.stringify({rejected,message,effects}));
`,
                ],
                {
                    windowsHide: true,
                    timeout: 10_000,
                    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
                },
            );
            assert.equal(result.stderr, '');
            const value: unknown = JSON.parse(result.stdout);
            assert.ok(isRecord(value));
            assert.equal(value.rejected, true);
            assert.deepEqual(value.effects, {
                resolve: 0,
                read: 0,
                lstat: 0,
                open: 0,
                mkdir: 0,
                realpath: 0,
                statfs: 0,
                query: 0,
                dlopen: 0,
            });
            assert.ok(typeof value.message === 'string');
            assert.match(value.message, /unsupported/i);
            assert.match(value.message, /Windows/);
            assert.match(value.message, /x64/);
            assert.match(value.message, /arm64/);
        });
    }
}

// Shared store behavior uses real owned files and explicit controlled Windows authority.
// This replacement provides no ACL, native enrollment or product admission evidence.
test('controlled Windows reader exposes only shared-use admission and cannot request operation, deletion or commit', async () => {
    const own = await createDeploymentStoreFixture();
    const deployment = own.deployment;
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

test('controlled Windows missing, malformed, noncanonical and foreign initial documents remain unusable without adoption', async () => {
    for (const scenario of ['missing-installation', 'missing-state', 'future-state', 'noncanonical', 'foreign-root']) {
        const own = await createDeploymentStoreFixture();
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
            await assert.rejects(own.deployment.openDeploymentInstallation(own.directory, { tryLock: () => true }));
            assert.deepEqual(await fs.readdir(own.envelope), before);
        } finally {
            await own.cleanup();
        }
    }
});

test('custom-promisify bypass is rejected before native process creation while controlled store admission remains usable', async () => {
    const own = await createDeploymentStoreFixture();
    const spawn = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn');
    assert.ok(spawn);
    Object.defineProperty(ChildProcess.prototype, 'spawn', {
        ...spawn,
        value: () => {
            throw new Error('Native process creation is forbidden in controlled authority tests.');
        },
    });
    const helper = mock.method(childProcess, 'execFile', () => {
        throw new Error('Native execution forbidden.');
    });
    const native = mock.method(process, 'dlopen', () => {
        throw new Error('Native loading forbidden.');
    });
    syncBuiltinESMExports();
    try {
        await assert.rejects(
            async () => promisify(childProcess.execFile)(process.execPath, ['--version']),
            /Native process creation is forbidden/,
        );
        const reader = await own.deployment.openDeploymentInstallation(own.directory, { tryLock: () => true });
        assert.equal(reader.installation.root.realPath, own.directory);
    } finally {
        native.mock.restore();
        helper.mock.restore();
        Object.defineProperty(ChildProcess.prototype, 'spawn', spawn);
        syncBuiltinESMExports();
        await own.cleanup();
    }
});

test('controlled Windows writer refuses revoked authority or unsafe evidence before effects and retains retry', async () => {
    const own = await createDeploymentStoreFixture();
    try {
        const writer = await own.deployment.openDeploymentWriterInstallation(own.directory, { tryLock: () => true });
        const lease = await writer.tryAcquire('operation');
        assert.ok(lease);
        const file = path.join(own.envelope, 'state.json');
        const original = await readFile(file);
        const descriptors = own.descriptors.length;
        own.revoke(true);
        await assert.rejects(writer.commit(lease, own.state, { type: 'begin-removal' }), /authority/i);
        assert.equal(own.descriptors.length, descriptors);
        assert.deepEqual(await readFile(file), original);
        own.revoke(false);
        own.unsafe(true);
        await assert.rejects(writer.tryAcquire('operation'), /unsafe|authority/i);
        assert.equal(own.descriptors.length, descriptors);
        own.unsafe(false);
        assert.deepEqual(await writer.read(lease), own.state);
        await lease.release();
    } finally {
        await own.cleanup();
    }
});

test('controlled Windows partial envelope with either missing fixed lease refuses read admission without repair', async () => {
    for (const name of ['operation.lock', 'use.lock']) {
        const own = await createDeploymentStoreFixture();
        try {
            await fs.unlink(path.join(own.envelope, name));
            await assert.rejects(own.deployment.openDeploymentInstallation(own.directory, { tryLock: () => true }));
            await assert.rejects(readFile(path.join(own.envelope, name)), { code: 'ENOENT' });
        } finally {
            await own.cleanup();
        }
    }
});

test('controlled Windows exact shared and writable lease descriptors retain removal fences and report uncertain replacement', async () => {
    const own = await createDeploymentStoreFixture();
    const deployment = own.deployment;
    try {
        const reader = await deployment.openDeploymentInstallation(own.directory, { tryLock: () => true });
        const use = await reader.tryAcquire('use');
        assert.ok(use);
        assert.equal(
            own.descriptors.find((entry) => entry.file.endsWith('use.lock'))?.flags,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const writer = await deployment.openDeploymentWriterInstallation(own.directory, { tryLock: () => true });
        const operation = await writer.tryAcquire('operation');
        assert.ok(operation);
        assert.equal(
            own.descriptors.find((entry) => entry.file.endsWith('operation.lock'))?.flags,
            constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
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

test('controlled Windows reader refuses replacement of its held fixed inode', async () => {
    const own = await createDeploymentStoreFixture();
    try {
        const reader = await own.deployment.openDeploymentInstallation(own.directory, { tryLock: () => true });
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
