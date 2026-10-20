import assert from 'node:assert/strict';
import childProcess, { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { isRecord } from '../src/shared/errors.ts';
import { ownedDeploymentPe } from './fixtures/deployment-support.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
// Start only the reviewed bundler before native process fences; never a deployment executable.
await build({
    stdin: { contents: 'export {};', sourcefile: 'owned-bundler-warm.ts' },
    write: false,
    logLevel: 'silent',
});
const forbidden = () => {
    throw new Error('Native deployment execution forbidden in worker controls.');
};
const nativeSpawn = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn');
assert.ok(nativeSpawn);
Object.defineProperty(ChildProcess.prototype, 'spawn', { ...nativeSpawn, value: forbidden });
mock.method(childProcess, 'spawn', forbidden);
mock.method(childProcess, 'execFile', forbidden);
mock.method(process, 'dlopen', forbidden);
syncBuiltinESMExports();
after(() => {
    Object.defineProperty(ChildProcess.prototype, 'spawn', nativeSpawn);
    mock.restoreAll();
    syncBuiltinESMExports();
});
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const bound = (bytes: Buffer) => ({
    kind: 'bound',
    platform: 'win32',
    architecture: 'x64',
    name: 'windows-deployment-query.exe',
    bytes: bytes.length,
    sha256: hash(bytes),
    machine: 'x64',
    runtime: 'v4.0.30319',
});

async function compiled(binding: unknown, worker = false, enrolled = true, authority = false) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dct-query-worker-controlled-')));
    const app = enrolled ? path.join(directory, 'builds', 'a'.repeat(64), 'resources/app') : directory;
    await fs.mkdir(app, { recursive: true });
    const module = path.join(app, worker ? 'deployment-worker.mjs' : 'app-main.mjs');
    const result = await build({
        absWorkingDir: root,
        entryPoints: [
            authority
                ? 'src/adapters/app-deployment-native.ts'
                : worker
                  ? 'tooling/deployment-worker.ts'
                  : 'src/adapters/windows-deployment-query.ts',
        ],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        write: false,
        define: { __DCT_DEPLOYMENT_QUERY__: JSON.stringify(binding) },
        external: ['fs-native-extensions'],
        logLevel: 'silent',
    });
    const output = result.outputFiles[0];
    assert.ok(output);
    await fs.writeFile(module, output.contents);
    const exports: unknown = await import(pathToFileURL(module).href);
    assert.ok(isRecord(exports));
    return {
        directory,
        app,
        exports,
        async cleanup() {
            assert.equal(path.dirname(directory), await fs.realpath(os.tmpdir()));
            assert.ok(path.basename(directory).startsWith('dct-query-worker-controlled-'));
            await fs.rm(directory, { recursive: true });
        },
    };
}

async function beforeIo(action: () => Promise<unknown>) {
    let calls = 0;
    const guards = (['open', 'lstat', 'realpath', 'readFile'] as const).map((key) =>
        mock.method(fs, key, () => {
            calls++;
            throw new Error('Unexpected I/O before intrinsic refusal.');
        }),
    );
    syncBuiltinESMExports();
    try {
        await assert.rejects(action, /unbound|intrinsic|placement|binding|unsupported|writing remains unavailable/);
        assert.equal(calls, 0);
    } finally {
        for (const guard of guards) guard.mock.restore();
        syncBuiltinESMExports();
    }
}

test('unbound ordinary worker and query refuse before filesystem native or process I/O', async () => {
    await beforeIo(async () => {
        const { verifyFreshDeployment } = await import('../tooling/deployment-worker.ts');
        await verifyFreshDeployment();
    });
    await beforeIo(async () => {
        const { openWindowsDeploymentQuery } = await import('../src/adapters/windows-deployment-query.ts');
        await openWindowsDeploymentQuery();
    });
    await assert.rejects(async () => promisify(childProcess.execFile)(process.execPath, ['--version']), /forbidden/);
});

test('intrinsic query binding refuses malformed closed shapes before any query I/O', async () => {
    const bytes = ownedDeploymentPe();
    for (const value of [
        null,
        {},
        { kind: 'unbound', extra: true },
        { ...bound(bytes), kind: 'unknown' },
        { ...bound(bytes), architecture: 'arm64' },
        { ...bound(bytes), name: '../query.exe' },
        { ...bound(bytes), bytes: 0 },
        { ...bound(bytes), sha256: 'A'.repeat(64) },
        { ...bound(bytes), runtime: 'v2.0.50727' },
        { ...bound(bytes), extra: true },
    ]) {
        const fixture = await compiled(value);
        try {
            const open = fixture.exports.openWindowsDeploymentQuery;
            assert.equal(typeof open, 'function');
            await beforeIo(async () => {
                assert.equal(typeof open, 'function');
                if (typeof open === 'function') await open();
            });
        } finally {
            await fixture.cleanup();
        }
    }
});

test('bound worker refuses flat placement or a foreign ordinary Node before filesystem or native I/O', async () => {
    for (const enrolled of [false, true]) {
        const fixture = await compiled(bound(ownedDeploymentPe()), true, enrolled);
        try {
            const verify = fixture.exports.verifyFreshDeployment;
            assert.equal(typeof verify, 'function');
            await beforeIo(async () => {
                if (typeof verify === 'function') await verify();
            });
        } finally {
            await fixture.cleanup();
        }
    }
});

test('ordinary query refuses wrong PE and same-byte inode replacement without running a helper', {
    skip: process.platform !== 'win32' || process.arch !== 'x64',
}, async () => {
    const pe = ownedDeploymentPe();
    const malformed = Buffer.from(pe);
    malformed.writeUInt16LE(0x14c, 0x84);
    const wrong = await compiled(bound(malformed));
    try {
        await fs.writeFile(path.join(wrong.app, 'windows-deployment-query.exe'), malformed);
        const open = wrong.exports.openWindowsDeploymentQuery;
        assert.equal(typeof open, 'function');
        if (typeof open === 'function') await assert.rejects(open(), /Invalid Windows/);
    } finally {
        await wrong.cleanup();
    }
    const fixture = await compiled(bound(pe));
    try {
        const query = path.join(fixture.app, 'windows-deployment-query.exe');
        await fs.writeFile(query, pe);
        const open = fixture.exports.openWindowsDeploymentQuery;
        assert.equal(typeof open, 'function');
        if (typeof open !== 'function') throw new Error('Missing actual query factory.');
        const reader: unknown = await open();
        assert.ok(isRecord(reader) && typeof reader.query === 'function');
        await fs.rename(query, query + '.retained');
        await fs.writeFile(query, pe);
        await assert.rejects(reader.query([query]), /identity\/bytes changed/);
    } finally {
        await fixture.cleanup();
    }
});

test('bound ordinary Windows authority still refuses writing before query filesystem or native I/O', {
    skip: process.platform !== 'win32',
}, async () => {
    const fixture = await compiled(bound(ownedDeploymentPe()), false, true, true);
    try {
        const open = fixture.exports.openDeploymentNativeAuthority;
        assert.equal(typeof open, 'function');
        await beforeIo(async () => {
            if (typeof open === 'function') await open('C:\\unselected', true);
        });
    } finally {
        await fixture.cleanup();
    }
});
