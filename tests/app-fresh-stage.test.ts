import assert from 'node:assert/strict';
import childProcess, { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { mock, type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { isRecord } from '../src/shared/errors.ts';
import * as app from '../tooling/build-app.ts';
import { stageFixture } from './fixtures/app-stage.ts';
import {
    ownedDeploymentCopyChild,
    ownedDeploymentFacts,
    ownedWindowsDeploymentCompiler,
} from './fixtures/deployment-support.ts';

let lockEffect: (exclusive: boolean) => void = () => {
    throw new Error('No controlled native lock owner.');
};

test('fresh production entry exists without a caller-supplied payload or authority backend', async () => {
    const spawn = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn');
    assert.ok(spawn);
    Object.defineProperty(ChildProcess.prototype, 'spawn', {
        ...spawn,
        value: () => {
            throw new Error('Native execution blocked before spawn.');
        },
    });
    const native = mock.method(process, 'dlopen', () => {
        throw new Error('Native loading blocked before dlopen.');
    });
    try {
        assert.equal(typeof Reflect.get(app, 'stageFreshDesktopInstallation'), 'function');
        await assert.rejects(
            async () => promisify(childProcess.execFile)(process.execPath, ['--version']),
            /blocked before spawn/,
        );
        assert.throws(() => process.dlopen({}, 'not-allowed.node'), /blocked before dlopen/);
    } finally {
        Object.defineProperty(ChildProcess.prototype, 'spawn', spawn);
        native.mock.restore();
    }
});

async function controlled(context: TestContext) {
    const pristine = {
        open: fs.open,
        lstat: fs.lstat,
        readFile: fs.readFile,
        mkdtemp: fs.mkdtemp,
        execFile: childProcess.execFile,
        dlopen: process.dlopen,
    };
    const own = await stageFixture();
    const originalExec = childProcess.execFile;
    let compiler: Awaited<ReturnType<typeof ownedWindowsDeploymentCompiler>>;
    try {
        compiler = await ownedWindowsDeploymentCompiler(context);
    } catch (setupError) {
        try {
            await own.cleanup();
        } catch (cleanupError) {
            throw new AggregateError([setupError, cleanupError], 'Controlled fixture setup and cleanup failed.');
        }
        throw setupError;
    }
    const compilerExec = childProcess.execFile;
    const originalSpawn = childProcess.spawn;
    const originalOpen = fs.open;
    const originalStat = fs.lstat;
    const originalDlopen = process.dlopen;
    const events: string[] = [];
    const executionCounts = { archive: 0, inspect: 0, createRoot: 0, createDirectory: 0, publish: 0, copy: 0 };
    let fault = '';
    let sourceManifest: Buffer | undefined;
    let published = false,
        contentSeen = false,
        payloadChunks = 0;
    lockEffect = (exclusive) => {
        events.push(exclusive ? 'lock:operation' : 'lock:use');
        if (fault === 'lock') throw new Error('controlled lock');
        if (fault === 'use-lock' && !exclusive) throw new Error('controlled shared use failure');
    };
    const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
    const writeFunctions: object[] = [];
    const helper = (...args: unknown[]) => {
        const argv = args[1];
        assert.ok(Array.isArray(argv));
        if (argv.includes(path.join(own.options.root, 'tooling/extract-app-zip.ps1'))) {
            executionCounts.archive++;
            return Reflect.apply(originalExec, childProcess, args);
        }
        if (args[0] === 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe')
            return Reflect.apply(compilerExec, childProcess, args);
        throw new Error('External executor forbidden before native spawn.');
    };
    Object.defineProperty(childProcess, 'spawn', {
        value: (executable: string, argv: readonly string[]) => {
            assert.ok(
                executable.endsWith('windows-deployment-query.exe') ||
                    executable.endsWith('windows-deployment-create.exe'),
            );
            if (argv[0] === 'copy') {
                assert.deepEqual(argv, ['copy']);
                executionCounts.copy++;
                return ownedDeploymentCopyChild(own.options.output, async (boundary, relative) => {
                    if (fault === 'require-copy') throw new Error('controlled stop after single copy request');
                    if (
                        fault === 'manifest-write' &&
                        boundary === 'write-before' &&
                        relative === 'payload-manifest.json'
                    )
                        throw new Error('controlled write');
                });
            }
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
                const bytes = Buffer.concat(chunks);
                chunks.length = 0;
                let offset = 12;
                const fields: string[] = [];
                for (let index = 0; index < bytes.readUInt32LE(8); index++) {
                    const length = bytes.readUInt32LE(offset);
                    offset += 4;
                    fields.push(
                        new TextDecoder('utf8', { fatal: true }).decode(bytes.subarray(offset, offset + length)),
                    );
                    offset += length;
                }
                assert.equal(offset, bytes.length);
                const mutating = argv[0] === 'mutate';
                assert.deepEqual(argv, mutating ? ['mutate'] : []);
                assert.equal(bytes.subarray(0, 8).toString(), mutating ? 'DCTMUT1\n' : 'DCTQRY1\n');
                if (
                    !mutating &&
                    fields.length === 128 &&
                    fields.some((name) => name.includes(`${path.sep}payload${path.sep}`))
                )
                    payloadChunks++;
                const operation = mutating ? fields[0] : '';
                const root = mutating ? fields[1] : '';
                const relative = mutating ? fields[2] : '';
                const destination = mutating ? fields[3] : '';
                assert.ok(root !== undefined && relative !== undefined && destination !== undefined);
                if (!mutating) {
                    executionCounts.inspect++;
                } else if (operation === 'create-root') executionCounts.createRoot++;
                else if (operation === 'create-directory') executionCounts.createDirectory++;
                else if (operation === 'publish') executionCounts.publish++;
                let name = mutating ? path.join(root, relative) : '';
                void (async () => {
                    if (fault === 'source-manifest-replaced' && executionCounts.inspect > 500)
                        throw new Error('controlled legacy process budget exceeded');
                    if (mutating) {
                        events.push(`${operation}:${relative || '.'}`);
                        if (fault === operation) throw new Error(`controlled ${fault}`);
                        if (operation === 'create-root') {
                            const scratchParent = path.dirname(own.options.output);
                            const source = (await fs.readdir(scratchParent)).find((entry) =>
                                entry.startsWith('dct-app-enrollment-'),
                            );
                            assert.ok(source);
                            const manifestName = path.join(scratchParent, source, 'source/payload-manifest.json');
                            sourceManifest = await fs.readFile(manifestName);
                            await fs.mkdir(root);
                            if (fault === 'source-manifest-replaced') await fs.writeFile(manifestName, '{}\n');
                        } else if (operation === 'create-directory') {
                            await fs.mkdir(name);
                            if (relative === '.deployment' && fault.startsWith('lease-'))
                                await fs.writeFile(
                                    path.join(name, `${fault.slice('lease-'.length)}.lock`),
                                    'competitor',
                                );
                        } else if (operation === 'publish') {
                            const target = path.join(root, destination);
                            if (fault === 'build-collision' && destination.startsWith(`builds${path.sep}`)) {
                                await fs.mkdir(target);
                                await fs.writeFile(path.join(target, 'competitor'), 'keep');
                            }
                            await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
                            await fs.rename(name, target);
                            name = target;
                            if (destination === path.join('.deployment', 'state.json')) published = true;
                            if (fault === 'final-drift' && destination.startsWith(`builds${path.sep}`))
                                await fs.writeFile(path.join(target, 'research-extra'), 'foreign');
                            if (fault === 'reopen' && destination === path.join('.deployment', 'state.json'))
                                await fs.writeFile(path.join(root, '.deployment/installation.json'), '{}\n');
                            if (
                                fault === 'publish-after-state' &&
                                destination === path.join('.deployment', 'state.json')
                            )
                                throw new Error('controlled response lost after state effect');
                        } else throw new Error('Unexpected helper operation.');
                    }
                    const results = [];
                    for (const entryName of mutating ? [name] : fields) {
                        const stats = await fs.lstat(entryName, { bigint: true });
                        const result = {
                            platform: 'win32',
                            account: 'S-1-5-21-1-2-3-1000',
                            owner: 'S-1-5-21-1-2-3-1000',
                            path: entryName,
                            device: String(stats.dev),
                            inode: String(stats.ino),
                            links: String(stats.nlink),
                            size: String(stats.isDirectory() ? 0 : stats.size),
                            directory: stats.isDirectory(),
                            protected: fault !== 'unprotected' || !entryName.startsWith(own.options.output),
                            reparse: false,
                            filesystem: 'NTFS',
                            driveType: 3,
                            volumeFlags: 8,
                            sid:
                                fault === 'unsafe-parent' ||
                                (fault === 'unsafe-second-chunk' &&
                                    payloadChunks === 2 &&
                                    entryName === fields.at(-1)) ||
                                (fault === 'post-content-unsafe' &&
                                    contentSeen &&
                                    entryName.endsWith(`${path.sep}payload${path.sep}electron.exe`))
                                    ? 'S-1-1-0'
                                    : 'S-1-5-21-1-2-3-1000',
                            mask: 2032127,
                            flags: stats.isDirectory() ? 3 : 0,
                        };
                        results.push(result);
                    }
                    return ownedDeploymentFacts(results);
                })().then(
                    (reply) => {
                        child.stdout.end(reply);
                        child.stderr.end();
                        child.emit('exit', 0, null);
                        child.emit('close', 0, null);
                    },
                    (error: unknown) => {
                        child.stdout.end();
                        child.stderr.end(String(error));
                        child.emit('exit', 1, null);
                        child.emit('close', 1, null);
                    },
                );
            });
            return child;
        },
    });
    Object.defineProperty(childProcess, 'execFile', { value: helper });
    Object.defineProperty(fs, 'lstat', {
        value: (...args: Parameters<typeof fs.lstat>) => {
            if (fault === 'cleanup' && published && path.basename(String(args[0])).startsWith('dct-app-enrollment-'))
                throw new Error('controlled source scratch identity failure after publication');
            return Reflect.apply(originalStat, fs, args);
        },
    });
    fs.open = async (...args: Parameters<typeof fs.open>) => {
        if (
            fault === 'require-copy' &&
            String(args[0]).startsWith(own.options.output) &&
            String(args[0]).endsWith('electron.exe') &&
            args[1] === 'wx+'
        )
            throw new Error('old per-file payload path observed');
        if (
            String(args[0]).startsWith(own.options.output) &&
            String(args[0]).endsWith('payload-manifest.json') &&
            typeof args[1] === 'number'
        )
            contentSeen = true;
        const handle = await originalOpen(...args);
        handles.push(handle);
        const name = String(args[0]);
        if (name.startsWith(own.options.output) && String(args[1]).includes('x')) {
            events.push(`write:${path.relative(own.options.output, name)}`);
            const sync = handle.sync.bind(handle);
            const write = handle.writeFile.bind(handle);
            const close = handle.close.bind(handle);
            handle.sync = async () => {
                if (fault === 'manifest-sync' && name.endsWith('payload-manifest.json'))
                    throw new Error('controlled sync');
                await sync();
            };
            handle.writeFile = async (...writeArgs: Parameters<typeof handle.writeFile>) => {
                if (fault === 'lease-write-and-close' && name.endsWith('operation.lock'))
                    throw new Error('primary write failure');
                if (fault === 'manifest-write' && name.endsWith('payload-manifest.json'))
                    throw new Error('controlled write');
                return write(...writeArgs);
            };
            writeFunctions.push(handle.writeFile);
            handle.close = async () => {
                await close();
                if (fault === 'lease-write-and-close' && name.endsWith('operation.lock'))
                    throw new Error('secondary close failure');
                if (name.endsWith('payload-manifest.json')) {
                    if (fault === 'manifest-missing') await fs.unlink(name);
                    if (fault === 'manifest-drift') await fs.appendFile(name, ' ');
                    if (fault === 'manifest-identity') {
                        const bytes = await fs.readFile(name);
                        await fs.rename(name, `${name}.retained`);
                        await fs.writeFile(name, bytes);
                    }
                    if (fault === 'manifest-close') throw new Error('controlled close');
                }
            };
        }
        if (name.endsWith('operation.lock') && args[1] === 'r+') {
            const close = handle.close.bind(handle);
            handle.close = async () => {
                await close();
                if (published && fault === 'operation-close') throw new Error('controlled operation release failure');
            };
        }
        return handle;
    };
    // Native module code is never entered. Only the already verified original loader
    // receives a controlled binding at the actual dlopen boundary.
    process.dlopen = (module: unknown, filename: string) => {
        if (!isRecord(module) || !filename.endsWith(`${path.sep}win32-x64${path.sep}fs-native-extensions.node`))
            throw new Error('Native loading blocked before dlopen.');
        module.exports = {
            tryLock: (_fd: number, _offset: number, _length: number, exclusive: boolean) => {
                lockEffect(exclusive);
            },
        };
    };
    syncBuiltinESMExports();
    return {
        own,
        events,
        executionCounts: () => ({ ...executionCounts }),
        sourceManifest: () => {
            assert.ok(sourceManifest);
            return sourceManifest;
        },
        historyCounts() {
            let bytes = 0,
                writes = 0;
            for (const fn of writeFunctions) {
                const tracked: unknown = Reflect.get(fn, 'mock');
                if (!isRecord(tracked) || !Array.isArray(tracked.calls)) continue;
                for (const call of tracked.calls)
                    if (isRecord(call) && Array.isArray(call.arguments)) {
                        writes++;
                        const data: unknown = call.arguments[0];
                        if (Buffer.isBuffer(data)) bytes += data.length;
                    }
            }
            const context: unknown = Reflect.get(helper, 'mock');
            return {
                retainedWriteCalls: writes,
                retainedWriteBytes: bytes,
                retainedExecutorCalls: isRecord(context) && Array.isArray(context.calls) ? context.calls.length : 0,
            };
        },
        fault: (value: string) => {
            fault = value;
        },
        async cleanup() {
            for (const handle of handles) await handle.close().catch(() => {});
            fs.open = originalOpen;
            fs.lstat = originalStat;
            childProcess.execFile = originalExec;
            childProcess.spawn = originalSpawn;
            process.dlopen = originalDlopen;
            syncBuiltinESMExports();
            lockEffect = () => {
                throw new Error('Controlled lock owner has closed.');
            };
            await compiler.cleanup();
            await own.cleanup();
            assert.equal(fs.open, pristine.open);
            assert.equal(fs.lstat, pristine.lstat);
            assert.equal(fs.readFile, pristine.readFile);
            assert.equal(fs.mkdtemp, pristine.mkdtemp);
            assert.equal(childProcess.execFile, pristine.execFile);
            assert.equal(process.dlopen, pristine.dlopen);
            handles.length = 0;
            writeFunctions.length = 0;
        },
    };
}

test('stage fixture admits exact captured temporary owners across controlled raw and canonical spelling', async (context) => {
    const original = { mkdtemp: fs.mkdtemp, realpath: fs.realpath, rm: fs.rm };
    const canonical = await original.realpath(os.tmpdir());
    const raw = path.join(canonical, 'dct-controlled-raw-temp');
    const allocations: { prefix: string; directory: string }[] = [];
    let own: Awaited<ReturnType<typeof stageFixture>> | undefined;
    let compiler: Awaited<ReturnType<typeof ownedWindowsDeploymentCompiler>> | undefined;
    const temporary = mock.method(os, 'tmpdir', () => raw);
    const canonicalize = mock.method(fs, 'realpath', async (file: Parameters<typeof fs.realpath>[0]) =>
        String(file) === raw ? canonical : original.realpath(file),
    );
    const allocate = mock.method(fs, 'mkdtemp', async (prefix: string) => {
        let physical: string;
        if (prefix === path.join(raw, 'dct-payload-stage-')) physical = path.join(canonical, 'dct-payload-stage-');
        else if (prefix === path.join(raw, 'dct-deployment-support-'))
            physical = path.join(canonical, 'dct-deployment-support-');
        else if (
            prefix === path.join(canonical, 'dct-owned-compiler-') ||
            (own && prefix === path.join(path.dirname(own.options.output), 'dct-app-enrollment-'))
        )
            physical = prefix;
        else throw new Error('Unexpected controlled allocator request.');
        const directory = await original.mkdtemp(physical);
        allocations.push({ prefix, directory });
        return directory;
    });
    syncBuiltinESMExports();
    try {
        own = await stageFixture();
        compiler = await ownedWindowsDeploymentCompiler(context);
        assert.deepEqual(
            allocations.map((value) => value.prefix),
            [path.join(raw, 'dct-payload-stage-'), path.join(canonical, 'dct-owned-compiler-')],
        );
        assert.equal(compiler.root, allocations[1]?.directory);
        const enrollment = await fs.mkdtemp(path.join(raw, 'dct-app-enrollment-'));
        assert.equal(path.dirname(enrollment), path.dirname(own.options.output));
        const support = await fs.mkdtemp(path.join(raw, 'dct-deployment-support-'));
        assert.equal(path.dirname(support), canonical);
        const scratch = await fs.mkdtemp(path.join(raw, 'dct-app-stage-'));
        assert.equal(scratch, path.join(path.dirname(own.options.output), 'dct-app-stage-controlled'));
        const before = allocations.length;
        for (const prefix of [
            path.join(raw, 'dct-owned-compiler-'),
            path.join(canonical, 'dct-app-enrollment-'),
            path.join(canonical, 'unrelated-owner-'),
            path.join(canonical, 'outside', 'dct-owned-compiler-'),
            path.join(canonical, 'dct-owned-compiler-extra-'),
            path.join(raw, 'dct-payload-stage-'),
        ])
            await assert.rejects(fs.mkdtemp(prefix), /Unexpected temporary owner/);
        assert.equal(allocations.length, before);
    } finally {
        await compiler?.cleanup();
        await own?.cleanup();
        allocate.mock.restore();
        canonicalize.mock.restore();
        temporary.mock.restore();
        syncBuiltinESMExports();
        for (const allocation of allocations) await original.rm(allocation.directory, { recursive: true, force: true });
    }
});

async function compilerSetupFailure(cleanupError?: Error) {
    const original = { open: fs.open, lstat: fs.lstat, readFile: fs.readFile, mkdtemp: fs.mkdtemp, rm: fs.rm };
    const descriptor = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn');
    assert.ok(descriptor);
    const canonical = await fs.realpath(os.tmpdir());
    const setupError = new Error('controlled compiler setup failure');
    const directories: string[] = [];
    let compilerRequests = 0;
    let cleanupCalls = 0;
    const temporary = mock.method(os, 'tmpdir', () => canonical);
    const allocate = mock.method(fs, 'mkdtemp', async (prefix: string) => {
        if (prefix === path.join(canonical, 'dct-owned-compiler-')) {
            compilerRequests++;
            throw setupError;
        }
        assert.equal(prefix, path.join(canonical, 'dct-payload-stage-'));
        const directory = await original.mkdtemp(prefix);
        directories.push(directory);
        return directory;
    });
    const remove = cleanupError
        ? mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
              assert.ok(directories.includes(String(args[0])));
              cleanupCalls++;
              await original.rm(...args);
              throw cleanupError;
          })
        : undefined;
    syncBuiltinESMExports();
    const expected = { open: fs.open, lstat: fs.lstat, readFile: fs.readFile, mkdtemp: fs.mkdtemp };
    return {
        setupError,
        directories,
        compilerRequests: () => compilerRequests,
        cleanupCalls: () => cleanupCalls,
        assertRestored() {
            assert.equal(fs.open, expected.open);
            assert.equal(fs.lstat, expected.lstat);
            assert.equal(fs.readFile, expected.readFile);
            assert.equal(fs.mkdtemp, expected.mkdtemp);
            assert.deepEqual(Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn'), descriptor);
        },
        async assertRemoved() {
            assert.equal(directories.length, 1);
            await assert.rejects(original.lstat(String(directories[0])), { code: 'ENOENT' });
        },
        async restore() {
            // Restore only this test's captured I/O after assertions, including an expected RED.
            Object.assign(fs, original);
            Object.defineProperty(ChildProcess.prototype, 'spawn', descriptor);
            remove?.mock.restore();
            allocate.mock.restore();
            temporary.mock.restore();
            syncBuiltinESMExports();
            for (const directory of directories) await original.rm(directory, { recursive: true, force: true });
        },
    };
}

test('fresh fixture construction restores guards and owned stage after compiler setup failure', async (context) => {
    const fault = await compilerSetupFailure();
    try {
        await assert.rejects(controlled(context), (error: unknown) => error === fault.setupError);
        assert.equal(fault.compilerRequests(), 1);
        fault.assertRestored();
        await fault.assertRemoved();
        const subsequent = await stageFixture();
        try {
            assert.ok((await fs.lstat(subsequent.options.electronArchive)).isFile());
        } finally {
            await subsequent.cleanup();
        }
        fault.assertRestored();
    } finally {
        await fault.restore();
    }
});

test('fresh fixture construction preserves original setup and cleanup errors in order', async (context) => {
    const cleanupError = new Error('controlled owned stage cleanup failure');
    const fault = await compilerSetupFailure(cleanupError);
    try {
        await assert.rejects(controlled(context), (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors.length, 2);
            assert.equal(error.errors[0], fault.setupError);
            assert.equal(error.errors[1], cleanupError);
            return true;
        });
        assert.equal(fault.compilerRequests(), 1);
        assert.equal(fault.cleanupCalls(), 1);
        fault.assertRestored();
        await fault.assertRemoved();
    } finally {
        await fault.restore();
    }
});

test('fresh transaction uses actual source producer, protected manifest and state-last publication then read admission', {
    skip: process.platform !== 'win32',
}, async (context) => {
    const fixture = await controlled(context);
    fixture.fault('source-manifest-replaced');
    Reflect.set(fixture.own.options, 'manifest', { entries: [] });
    Reflect.set(fixture.own.options, 'verified', true);
    Reflect.set(fixture.own.options, 'onInputs', async () => {
        Reflect.set(fixture.own.options, 'kind', 'installed');
        Reflect.set(fixture.own.options, 'architecture', 'arm64');
    });
    try {
        const result = await app.stageFreshDesktopInstallation(fixture.own.options);
        const installation: unknown = JSON.parse(
            await fs.readFile(path.join(result.installationRoot, '.deployment/installation.json'), 'utf8'),
        );
        const state: unknown = JSON.parse(
            await fs.readFile(path.join(result.installationRoot, '.deployment/state.json'), 'utf8'),
        );
        const manifest = await fs.readFile(path.join(result.buildRoot, 'payload-manifest.json'));
        assert.ok(isRecord(installation) && isRecord(installation.root) && isRecord(state));
        assert.deepEqual(manifest, fixture.sourceManifest());
        assert.equal(state.selectedBuildId, createHash('sha256').update(manifest).digest('hex'));
        assert.equal(result.selectedBuildId, state.selectedBuildId);
        assert.equal(installation.root.realPath, fixture.own.options.output);
        assert.equal(installation.kind, 'portable');
        assert.equal(installation.architecture, 'x64');
        assert.equal(result.executablePath, path.join(result.buildRoot, 'electron.exe'));
        assert.equal(fixture.executionCounts().copy, 1);
        const sourceValue: unknown = JSON.parse(fixture.sourceManifest().toString());
        assert.ok(isRecord(sourceValue) && Array.isArray(sourceValue.entries));
        let ancestors = 0;
        for (let current = path.dirname(result.installationRoot); ; current = path.dirname(current)) {
            ancestors++;
            if (current === path.dirname(current)) break;
        }
        const count = sourceValue.entries.length;
        const expectedHelpers =
            122 + 2 * (Math.ceil((count + 5 + ancestors) / 128) + 4 * Math.ceil((count + 4 + ancestors) / 128));
        const actual = fixture.executionCounts();
        context.diagnostic(JSON.stringify({ entries: count, ancestors, expectedHelpers, actual }));
        assert.equal(
            actual.inspect + actual.createRoot + actual.createDirectory + actual.publish + actual.copy,
            expectedHelpers,
        );
        assert.equal(actual.createRoot + actual.createDirectory + actual.publish + actual.copy, 10);
        const pubs = fixture.events.filter((value) => value.startsWith('publish:'));
        assert.equal(pubs.length, 3);
        assert.ok(pubs[0]?.includes('/payload') || pubs[0]?.includes('\\payload'));
        assert.ok(pubs[1]?.includes('installation'));
        assert.ok(pubs[2]?.includes('state'));
        assert.ok(fixture.events.includes('lock:operation') && fixture.events.includes('lock:use'));
        for (const name of ['operation.lock', 'use.lock'])
            assert.equal((await fs.stat(path.join(result.installationRoot, '.deployment', name))).size, 0);
        await assert.rejects(app.stageFreshDesktopInstallation(fixture.own.options));
        assert.equal(
            await fs.readFile(path.join(result.buildRoot, 'payload-manifest.json'), 'utf8'),
            manifest.toString(),
        );
    } finally {
        await fixture.cleanup();
    }
});

test('controlled fresh I/O does not retain raw payload bytes or executor callback histories', {
    skip: process.platform !== 'win32',
}, async (context) => {
    const fixture = await controlled(context);
    fixture.fault('manifest-write');
    try {
        await assert.rejects(app.stageFreshDesktopInstallation(fixture.own.options));
        const counts = fixture.historyCounts();
        context.diagnostic(JSON.stringify({ ...counts, executions: fixture.executionCounts() }));
        assert.deepEqual(counts, { retainedWriteCalls: 0, retainedWriteBytes: 0, retainedExecutorCalls: 0 });
    } finally {
        await fixture.cleanup();
    }
});

test('post-publication source cleanup failure remains an indeterminate transaction result', {
    skip: process.platform !== 'win32',
}, async (context) => {
    const fixture = await controlled(context);
    fixture.fault('cleanup');
    try {
        await assert.rejects(
            app.stageFreshDesktopInstallation(fixture.own.options),
            (error: unknown) => error instanceof app.FreshDeploymentError && error.outcome === 'indeterminate',
        );
        assert.ok((await fs.lstat(path.join(fixture.own.options.output, '.deployment/state.json'))).isFile());
    } finally {
        await fixture.cleanup();
    }
});

test('fresh write and close failures preserve both original errors and publish no state', {
    skip: process.platform !== 'win32',
}, async (context) => {
    const fixture = await controlled(context);
    fixture.fault('lease-write-and-close');
    try {
        await assert.rejects(app.stageFreshDesktopInstallation(fixture.own.options), (error: unknown) => {
            assert.ok(error instanceof app.FreshDeploymentError && error.outcome === 'not-published');
            assert.ok(error.cause instanceof AggregateError);
            assert.deepEqual(
                error.cause.errors.map((value: unknown) => (value instanceof Error ? value.message : '')),
                ['primary write failure', 'secondary close failure'],
            );
            return true;
        });
        await assert.rejects(fs.lstat(path.join(fixture.own.options.output, '.deployment/state.json')), {
            code: 'ENOENT',
        });
    } finally {
        await fixture.cleanup();
    }
});

test('existing roots and fixed-file collisions are refused without adoption or repair', {
    skip: process.platform !== 'win32',
}, async (context) => {
    for (const scenario of [
        'empty',
        'flat',
        'partial',
        'active',
        'removing',
        'removed',
        'lease-operation',
        'lease-use',
    ]) {
        const fixture = await controlled(context);
        const output = fixture.own.options.output;
        try {
            if (scenario.startsWith('lease-')) fixture.fault(scenario);
            else {
                await fs.mkdir(output);
                if (scenario !== 'empty') await fs.writeFile(path.join(output, 'marker'), scenario);
                if (scenario === 'flat')
                    await fs.writeFile(path.join(output, 'electron.exe'), 'existing inert flat payload');
                if (['partial', 'active', 'removing', 'removed'].includes(scenario)) {
                    await fs.mkdir(path.join(output, '.deployment'));
                    await fs.writeFile(path.join(output, '.deployment/operation.lock'), '');
                    if (scenario !== 'partial') {
                        const stats = await fs.lstat(output, { bigint: true });
                        const installation = {
                            schemaVersion: 1,
                            installationId: '0dd7224c-51a2-41b3-914d-01171c139ac2',
                            kind: 'portable',
                            platform: 'win32',
                            architecture: 'x64',
                            root: { realPath: output, device: String(stats.dev), inode: String(stats.ino) },
                        };
                        const identity = createHash('sha256').update(JSON.stringify(installation)).digest('hex');
                        await fs.writeFile(path.join(output, '.deployment/use.lock'), '');
                        await fs.writeFile(
                            path.join(output, '.deployment/installation.json'),
                            `${JSON.stringify(installation)}\n`,
                        );
                        await fs.writeFile(
                            path.join(output, '.deployment/state.json'),
                            `${JSON.stringify({ schemaVersion: 1, installationIdentity: identity, phase: scenario, selectedBuildId: 'a'.repeat(64), selectedManifestSha256: 'b'.repeat(64) })}\n`,
                        );
                    }
                }
            }
            await assert.rejects(app.stageFreshDesktopInstallation(fixture.own.options));
            if (scenario.startsWith('lease-'))
                assert.equal(
                    await fs.readFile(path.join(output, '.deployment', `${scenario.slice(6)}.lock`), 'utf8'),
                    'competitor',
                );
            else if (scenario !== 'empty')
                assert.equal(await fs.readFile(path.join(output, 'marker'), 'utf8'), scenario);
            assert.equal(
                fixture.events.some((event) => event.startsWith('publish:')),
                false,
            );
        } finally {
            await fixture.cleanup();
        }
    }
});

test('no-replace collision and final tree drift cannot publish a state', {
    skip: process.platform !== 'win32',
}, async (context) => {
    for (const fault of ['build-collision', 'final-drift'])
        await context.test(fault, async () => {
            const fixture = await controlled(context);
            fixture.fault(fault);
            try {
                await assert.rejects(
                    app.stageFreshDesktopInstallation(fixture.own.options),
                    (error: unknown) => error instanceof app.FreshDeploymentError && error.outcome === 'not-published',
                );
                await assert.rejects(fs.lstat(path.join(fixture.own.options.output, '.deployment/state.json')), {
                    code: 'ENOENT',
                });
                if (fault === 'build-collision') {
                    const names = await fs.readdir(path.join(fixture.own.options.output, 'builds'));
                    assert.equal(names.length, 1);
                    assert.equal(
                        await fs.readFile(
                            path.join(fixture.own.options.output, 'builds', String(names[0]), 'competitor'),
                            'utf8',
                        ),
                        'keep',
                    );
                }
            } finally {
                await fixture.cleanup();
            }
        });
});

test('unsupported fresh selections fail before filesystem, subprocess or native loading', async () => {
    const native = mock.method(process, 'dlopen', () => {
        throw new Error('unexpected dlopen');
    });
    const exec = mock.method(childProcess, 'execFile', () => {
        throw new Error('unexpected executor');
    });
    syncBuiltinESMExports();
    try {
        for (const platform of ['darwin', 'linux'] as const)
            await assert.rejects(
                app.stageFreshDesktopInstallation({
                    root: 'unused',
                    kind: 'portable',
                    platform,
                    architecture: 'x64',
                    electronArchive: 'unused',
                    nodeArchive: 'unused',
                    output: 'unused',
                }),
                /other native cells remain pending/,
            );
        assert.equal(exec.mock.callCount(), 0);
        assert.equal(native.mock.callCount(), 0);
    } finally {
        native.mock.restore();
        exec.mock.restore();
        syncBuiltinESMExports();
    }
});

test('protected manifest failures never publish state or remove fixed lease inodes', {
    skip: process.platform !== 'win32',
}, async (context) => {
    for (const fault of [
        'manifest-write',
        'manifest-sync',
        'manifest-close',
        'manifest-missing',
        'manifest-drift',
        'manifest-identity',
    ]) {
        await context.test(fault, async () => {
            const fixture = await controlled(context);
            fixture.fault(fault);
            try {
                await assert.rejects(
                    app.stageFreshDesktopInstallation(fixture.own.options),
                    (error: unknown) => error instanceof app.FreshDeploymentError && error.outcome === 'not-published',
                );
                await assert.rejects(fs.lstat(path.join(fixture.own.options.output, '.deployment/state.json')), {
                    code: 'ENOENT',
                });
                assert.equal(
                    fixture.events.some((value) => value.startsWith('publish:')),
                    false,
                );
                for (const name of ['operation.lock', 'use.lock'])
                    assert.equal((await fs.lstat(path.join(fixture.own.options.output, '.deployment', name))).size, 0);
            } finally {
                await fixture.cleanup();
            }
        });
    }
});

test('unsafe native parents and false successful creation replies refuse admission before payload or state publication', {
    skip: process.platform !== 'win32',
}, async (context) => {
    for (const fault of ['unsafe-parent', 'unprotected', 'create-directory']) {
        const fixture = await controlled(context);
        fixture.fault(fault);
        try {
            await assert.rejects(app.stageFreshDesktopInstallation(fixture.own.options));
            assert.equal(
                fixture.events.some((value) => value.startsWith('publish:')),
                false,
            );
            await assert.rejects(fs.lstat(path.join(fixture.own.options.output, '.deployment/state.json')), {
                code: 'ENOENT',
            });
        } finally {
            await fixture.cleanup();
        }
    }
});

test('state publication response loss is indeterminate and preserves the committed closure without replay', {
    skip: process.platform !== 'win32',
}, async (context) => {
    const fixture = await controlled(context);
    fixture.fault('publish-after-state');
    try {
        await assert.rejects(
            app.stageFreshDesktopInstallation(fixture.own.options),
            (error: unknown) => error instanceof app.FreshDeploymentError && error.outcome === 'indeterminate',
        );
        const state: unknown = JSON.parse(
            await fs.readFile(path.join(fixture.own.options.output, '.deployment/state.json'), 'utf8'),
        );
        assert.ok(isRecord(state) && typeof state.selectedBuildId === 'string');
        assert.ok(
            (await fs.lstat(path.join(fixture.own.options.output, 'builds', state.selectedBuildId))).isDirectory(),
        );
        assert.equal(
            fixture.events.filter((value) => value.includes('.state-') && value.startsWith('publish:')).length,
            1,
        );
    } finally {
        await fixture.cleanup();
    }
});

test('post-publication read admission and operation release failures remain indeterminate', {
    skip: process.platform !== 'win32',
}, async (context) => {
    for (const fault of ['reopen', 'use-lock', 'operation-close'])
        await context.test(fault, async () => {
            const fixture = await controlled(context);
            fixture.fault(fault);
            try {
                await assert.rejects(
                    app.stageFreshDesktopInstallation(fixture.own.options),
                    (error: unknown) => error instanceof app.FreshDeploymentError && error.outcome === 'indeterminate',
                );
                assert.ok((await fs.lstat(path.join(fixture.own.options.output, '.deployment/state.json'))).isFile());
                for (const name of ['operation.lock', 'use.lock'])
                    assert.equal((await fs.lstat(path.join(fixture.own.options.output, '.deployment', name))).size, 0);
            } finally {
                await fixture.cleanup();
            }
        });
});

test('fresh payload consumer issues exactly one fixed copy command before any payload publication', {
    skip: process.platform !== 'win32',
}, async (context) => {
    const fixture = await controlled(context);
    fixture.fault('require-copy');
    try {
        await assert.rejects(app.stageFreshDesktopInstallation(fixture.own.options));
        assert.equal(fixture.executionCounts().copy, 1);
        assert.equal(
            fixture.events.some((event) => event.startsWith('publish:')),
            false,
        );
    } finally {
        await fixture.cleanup();
    }
});

test('complete permission sweeps reject unsafe non-target second chunks and changes after content reads before publication', {
    skip: process.platform !== 'win32',
}, async (context) => {
    for (const fault of ['unsafe-second-chunk', 'post-content-unsafe'])
        await context.test(fault, async () => {
            const fixture = await controlled(context);
            fixture.fault(fault);
            try {
                await assert.rejects(
                    app.stageFreshDesktopInstallation(fixture.own.options),
                    (error: unknown) => error instanceof app.FreshDeploymentError && error.outcome === 'not-published',
                );
                assert.equal(fixture.executionCounts().copy, 1);
                assert.equal(fixture.executionCounts().publish, 0);
                for (const name of ['operation.lock', 'use.lock'])
                    assert.equal((await fs.lstat(path.join(fixture.own.options.output, '.deployment', name))).size, 0);
                await assert.rejects(fs.lstat(path.join(fixture.own.options.output, '.deployment/state.json')), {
                    code: 'ENOENT',
                });
            } finally {
                await fixture.cleanup();
            }
        });
});
