import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PathLike } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodeWindowsDeploymentCopyHeader } from '../../src/adapters/windows-deployment-protocol.ts';

// Inert owned PE-shaped bytes, never a compiler/runtime or executable acceptance fixture.
export function ownedDeploymentPe() {
    const bytes = Buffer.alloc(1024);
    bytes.write('MZ');
    bytes.writeUInt32LE(0x80, 0x3c);
    bytes.write('PE\0\0', 0x80);
    bytes.writeUInt16LE(0x8664, 0x84);
    bytes.writeUInt16LE(1, 0x86);
    bytes.writeUInt16LE(240, 0x94);
    bytes.writeUInt16LE(2, 0x96);
    bytes.writeUInt16LE(0x20b, 0x98);
    bytes.writeUInt16LE(3, 0xdc);
    bytes.writeUInt32LE(16, 0x104);
    bytes.writeUInt32LE(0x2000, 0x178);
    bytes.writeUInt32LE(72, 0x17c);
    bytes.writeUInt32LE(512, 0x190);
    bytes.writeUInt32LE(0x2000, 0x194);
    bytes.writeUInt32LE(512, 0x198);
    bytes.writeUInt32LE(512, 0x19c);
    bytes.writeUInt32LE(72, 0x200);
    bytes.writeUInt32LE(0x2080, 0x208);
    bytes.writeUInt32LE(64, 0x20c);
    bytes.writeUInt32LE(1, 0x210);
    bytes.writeUInt32LE(0x06000001, 0x214);
    bytes.writeUInt32LE(0x424a5342, 0x280);
    bytes.writeUInt32LE(12, 0x28c);
    bytes.write('v4.0.30319\0', 0x290);
    return bytes;
}

export async function ownedWindowsDeploymentCompiler(t: TestContext) {
    const temporaryRoot = await fs.realpath(os.tmpdir());
    const root = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, 'dct-owned-compiler-')));
    const helper = fileURLToPath(new URL('../../src/adapters/', import.meta.url));
    const compilerRoot = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319';
    const outputs = path.join(root, 'outputs');
    await fs.mkdir(outputs);
    for (const name of ['csc.exe', 'mscorlib.dll', 'System.dll', 'System.Core.dll'])
        await fs.writeFile(path.join(root, name), `inert owned ${name}`);
    const original = { open: fs.open, lstat: fs.lstat, realpath: fs.realpath, unlink: fs.unlink };
    const map = (file: PathLike) => {
        const name = String(file);
        if (path.dirname(name) === compilerRoot) return path.join(root, path.basename(name));
        if (
            path.dirname(name) === helper.replace(/[\\/]$/, '') &&
            [
                'windows-deployment-query.exe',
                'windows-deployment-create.exe',
                '.windows-deployment-build.lock',
            ].includes(path.basename(name))
        )
            return path.join(outputs, path.basename(name));
        return file;
    };
    fs.open = (...args: Parameters<typeof fs.open>) => original.open(map(args[0]), args[1], args[2]);
    Object.defineProperty(fs, 'lstat', {
        value: (file: PathLike, options?: { bigint?: boolean }) => original.lstat(map(file), options),
    });
    Object.defineProperty(fs, 'realpath', {
        value: async (file: PathLike) => {
            const actual = await original.realpath(map(file));
            return String(map(file)) === String(file) ? actual : String(file);
        },
    });
    fs.unlink = (file: PathLike) => original.unlink(map(file));
    let compiles = 0;
    t.mock.method(
        childProcess,
        'execFile',
        (
            executable: string,
            args: readonly string[],
            _options: unknown,
            callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
            assert.equal(executable, path.join(compilerRoot, 'csc.exe'));
            const output = args.find((value) => value.startsWith('/out:'))?.slice(5);
            assert.ok(output);
            assert.ok(output.startsWith(path.join(temporaryRoot, 'dct-deployment-support-')));
            const sources = args.filter((value) => value.endsWith('.cs'));
            compiles++;
            assert.deepEqual(
                sources.map((file) => path.basename(file)),
                compiles === 1
                    ? ['windows-deployment-authority.cs']
                    : ['windows-deployment-authority.cs', 'windows-deployment-create.cs'],
            );
            void fs.writeFile(output, ownedDeploymentPe()).then(
                () => callback(null, '', ''),
                (error: Error) => callback(error, '', ''),
            );
        },
    );
    syncBuiltinESMExports();
    let closed = false;
    async function cleanup() {
        if (closed) return;
        closed = true;
        t.mock.restoreAll();
        Object.assign(fs, original);
        syncBuiltinESMExports();
        assert.equal(path.dirname(root), temporaryRoot);
        assert.ok(path.basename(root).startsWith('dct-owned-compiler-'));
        await fs.rm(root, { recursive: true });
    }
    t.after(cleanup);
    return { root, outputs, compiles: () => compiles, cleanup };
}

/** Test-only raw wire encoder, never a production source or permission decision. */
export function ownedDeploymentFacts(values: readonly Readonly<Record<string, unknown>>[]) {
    const parts = [Buffer.from('DCTQRS1\n'), Buffer.from([values.length, 0, 0, 0])];
    const text = (value: unknown) => {
        const body = Buffer.from(String(value)),
            size = Buffer.alloc(4);
        size.writeUInt32LE(body.length);
        parts.push(size, body);
    };
    for (const value of values) {
        for (const key of ['account', 'owner', 'path', 'device', 'inode', 'links', 'size']) text(value[key]);
        parts.push(Buffer.from([Number(value.directory), Number(value.protected), Number(value.reparse)]));
        text(value.filesystem);
        for (const number of [value.volumeFlags, value.driveType, 1]) {
            const bytes = Buffer.alloc(4);
            bytes.writeUInt32LE(Number(number));
            parts.push(bytes);
        }
        text(value.sid);
        for (const number of [value.mask, value.flags, 0]) {
            const bytes = Buffer.alloc(4);
            bytes.writeUInt32LE(Number(number));
            parts.push(bytes);
        }
    }
    return Buffer.concat(parts);
}

/** File-only native-process I/O fake. It never evaluates ACLs or executes C# methods. */
export function ownedDeploymentCopyChild(
    root: string,
    hook: (boundary: string, relative: string) => Promise<void> = async () => {},
) {
    const child = Object.assign(new EventEmitter(), {
        pid: 42,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    });
    // A child can close its input after an early rejection; ownership still ends only below.
    child.stdin.on('error', () => {});
    void (async () => {
        const iterator = child.stdin[Symbol.asyncIterator]();
        let pending = Buffer.alloc(0),
            position = 0;
        async function exact(size: number) {
            const bytes = Buffer.alloc(size);
            let used = 0;
            while (used < size) {
                if (position === pending.length) {
                    const next = await iterator.next();
                    if (next.done) throw new Error('Controlled child saw short copy input.');
                    pending = next.value;
                    position = 0;
                }
                const count = Math.min(size - used, pending.length - position);
                pending.copy(bytes, used, position, position + count);
                position += count;
                used += count;
            }
            return bytes;
        }
        const prefix = await exact(12),
            size = prefix.readUInt32LE(8);
        if (size < 12 || size > 8 * 1024 * 1024) throw new Error('Controlled bounded header rejected.');
        const plan = decodeWindowsDeploymentCopyHeader(Buffer.concat([prefix, await exact(size - 12)]));
        assert.equal(plan.root, root);
        const stage = path.join(root, ...plan.stage.split('/'));
        const entries = [
            ...plan.entries,
            {
                type: 'file' as const,
                path: 'payload-manifest.json',
                bytes: plan.manifestLength,
                sha256: plan.manifestSha256,
            },
        ];
        const result: { path: string; type: string; device: string; inode: string; bytes: number }[] = [];
        for (const entry of entries) {
            if (entry.type === 'symlink') throw new Error('Controlled Windows copy has no links.');
            const file = path.join(stage, ...entry.path.split('/'));
            assert.ok(file.startsWith(`${root}${path.sep}`));
            await hook('parent-before', entry.path);
            if (entry.type === 'directory') {
                await fs.mkdir(file);
                await hook('directory-after', entry.path);
            } else {
                const handle = await fs.open(file, 'wx');
                let primary: unknown;
                try {
                    await hook('write-before', entry.path);
                    const hash = createHash('sha256');
                    for (let offset = 0; offset < entry.bytes; ) {
                        const bytes = await exact(Math.min(65536, entry.bytes - offset));
                        hash.update(bytes);
                        let written = 0;
                        while (written < bytes.length) {
                            const outcome = await handle.write(
                                bytes,
                                written,
                                bytes.length - written,
                                offset + written,
                            );
                            if (outcome.bytesWritten === 0) throw new Error('Controlled zero write.');
                            written += outcome.bytesWritten;
                        }
                        offset += bytes.length;
                    }
                    if (hash.digest('hex') !== entry.sha256)
                        throw new Error('Controlled write bytes differ from declared hash.');
                    await handle.sync();
                    await hook('flush-after', entry.path);
                } catch (error) {
                    primary = error;
                }
                try {
                    await handle.close();
                } catch (close) {
                    throw primary ? new AggregateError([primary, close]) : close;
                }
                if (primary) throw primary;
                await hook('write-close-after', entry.path);
                const readback = await fs.open(file, 'r');
                try {
                    await hook('readback-before', entry.path);
                    for (let offset = 0; offset < entry.bytes; ) {
                        const expected = await exact(Math.min(65536, entry.bytes - offset));
                        const actual = Buffer.alloc(expected.length);
                        let used = 0;
                        while (used < actual.length) {
                            const read = await readback.read(actual, used, actual.length - used, offset + used);
                            if (!read.bytesRead) throw new Error('Controlled short readback.');
                            used += read.bytesRead;
                        }
                        assert.ok(actual.equals(expected), 'Controlled readback bytes differ.');
                        offset += expected.length;
                    }
                    assert.equal((await readback.read(Buffer.alloc(1), 0, 1, entry.bytes)).bytesRead, 0);
                    await hook('readback-after', entry.path);
                } catch (error) {
                    primary = error;
                }
                try {
                    await readback.close();
                } catch (close) {
                    throw primary ? new AggregateError([primary, close]) : close;
                }
                if (primary) throw primary;
                await hook('read-close-after', entry.path);
            }
            const stat = await fs.lstat(file, { bigint: true });
            result.push({
                path: entry.path,
                type: entry.type,
                device: String(stat.dev),
                inode: String(stat.ino),
                bytes: stat.isDirectory() ? 0 : Number(stat.size),
            });
        }
        await hook('eof-before', '');
        if (position !== pending.length || !(await iterator.next()).done)
            throw new Error('Controlled trailing copy input.');
        const parts = [Buffer.from('DCTCPR1\n')];
        const uint = (value: number) => {
            const bytes = Buffer.alloc(4);
            bytes.writeUInt32LE(value);
            parts.push(bytes);
        };
        const ulong = (value: string | number) => {
            const bytes = Buffer.alloc(8);
            bytes.writeBigUInt64LE(BigInt(value));
            parts.push(bytes);
        };
        uint(result.length);
        for (const entry of result) {
            const name = Buffer.from(entry.path);
            uint(name.length);
            parts.push(name);
            ulong(entry.device);
            ulong(entry.inode);
            parts.push(Buffer.from([entry.type === 'file' ? 1 : 0]));
            ulong(entry.bytes);
        }
        return Buffer.concat(parts);
    })().then(
        (bytes) => {
            child.stdout.end(bytes);
            child.stderr.end();
            child.emit('exit', 0, null);
            child.emit('close', 0, null);
        },
        (error: unknown) => {
            child.stdin.destroy(new Error('Controlled native input closed.'));
            child.stdout.end();
            child.stderr.end(String(error));
            child.emit('exit', 1, null);
            child.emit('close', 1, null);
        },
    );
    return child;
}

export async function ownedWindowsDeploymentNative(t: TestContext) {
    const fixture = await ownedWindowsDeploymentCompiler(t);
    let queries = 0,
        mutations = 0;
    let copies = 0,
        copyTerminals = 0;
    let copyHook: (boundary: string, relative: string) => Promise<void> = async () => {};
    let suffix: Buffer = Buffer.alloc(0);
    let patch: (name: string, facts: Record<string, unknown>) => Record<string, unknown> = (_name, facts) => facts;
    const facts = async (names: string[]) => {
        const parts = [Buffer.from('DCTQRS1\n'), Buffer.from([names.length, 0, 0, 0])];
        const text = (value: string) => {
            const body = Buffer.from(value),
                size = Buffer.alloc(4);
            size.writeUInt32LE(body.length);
            parts.push(size, body);
        };
        for (const name of names) {
            const stat = await fs.lstat(name, { bigint: true });
            const value = patch(name, {
                account: 'S-1-5-21-101',
                owner: 'S-1-5-21-101',
                inode: String(stat.ino),
                device: String(stat.dev),
                links: String(stat.nlink),
                size: String(stat.isDirectory() ? 0 : stat.size),
                directory: stat.isDirectory(),
                protected: true,
                reparse: false,
                filesystem: 'NTFS',
                volumeFlags: 8,
                driveType: 3,
                sid: 'S-1-5-21-101',
                mask: 2032127,
                flags: stat.isDirectory() ? 3 : 0,
            });
            for (const key of ['account', 'owner']) text(String(value[key]));
            text(name);
            for (const key of ['device', 'inode', 'links', 'size']) text(String(value[key]));
            parts.push(Buffer.from([Number(value.directory), Number(value.protected), Number(value.reparse)]));
            text(String(value.filesystem));
            for (const number of [value.volumeFlags, value.driveType, 1]) {
                const bytes = Buffer.alloc(4);
                bytes.writeUInt32LE(Number(number));
                parts.push(bytes);
            }
            text(String(value.sid));
            for (const number of [value.mask, value.flags, 0]) {
                const bytes = Buffer.alloc(4);
                bytes.writeUInt32LE(Number(number));
                parts.push(bytes);
            }
        }
        return Buffer.concat([...parts, suffix]);
    };
    t.mock.method(childProcess, 'spawn', (executable: string, args: readonly string[]) => {
        if (args[0] === 'copy') {
            assert.ok(executable.endsWith('windows-deployment-create.exe'));
            assert.deepEqual(args, ['copy']);
            copies++;
            const child = ownedDeploymentCopyChild(path.join(fixture.root, 'managed'), copyHook);
            child.once('exit', () => {
                copyTerminals++;
            });
            return child;
        }
        if (executable.endsWith('query.exe')) queries++;
        else mutations++;
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
            void (async () => {
                const bytes = Buffer.concat(input);
                let offset = 12;
                const names: string[] = [];
                for (let index = 0; index < bytes.readUInt32LE(8); index++) {
                    const size = bytes.readUInt32LE(offset);
                    offset += 4;
                    names.push(new TextDecoder('utf8', { fatal: true }).decode(bytes.subarray(offset, offset + size)));
                    offset += size;
                }
                assert.equal(offset, bytes.length);
                if (executable.endsWith('query.exe')) {
                    assert.deepEqual(args, []);
                    assert.equal(bytes.subarray(0, 8).toString(), 'DCTQRY1\n');
                    return facts(names);
                }
                assert.deepEqual(args, ['mutate']);
                assert.equal(bytes.subarray(0, 8).toString(), 'DCTMUT1\n');
                assert.equal(names.length, 8);
                const [operation, root, relative, destination] = names;
                assert.ok(root && relative !== undefined && destination !== undefined);
                const target =
                    operation === 'create-root'
                        ? root
                        : path.join(root, operation === 'publish' ? destination : relative);
                if (operation === 'publish') await fs.rename(path.join(root, relative), target);
                else await fs.mkdir(target);
                return facts([target]);
            })().then(
                (reply) => {
                    child.stdout.end(reply);
                    child.stderr.end();
                    child.emit('exit', 0, null);
                    child.emit('close', 0, null);
                },
                (error: unknown) => {
                    child.stderr.end(String(error));
                    child.stdout.end();
                    child.emit('exit', 1, null);
                    child.emit('close', 1, null);
                },
            );
        });
        return child;
    });
    syncBuiltinESMExports();
    return {
        ...fixture,
        copies: () => copies,
        copyTerminals: () => copyTerminals,
        copyHook: (value: typeof copyHook) => {
            copyHook = value;
        },
        queries: () => queries,
        mutations: () => mutations,
        suffix: (bytes: Buffer) => {
            suffix = bytes;
        },
        patch: (value: typeof patch) => {
            patch = value;
        },
    };
}
