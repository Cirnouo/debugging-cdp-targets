import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { after, mock, type TestContext, test } from 'node:test';
import { ownedWindowsDeploymentNative } from './fixtures/deployment-support.ts';

const fixedWindows = process.platform === 'win32' && process.arch === 'x64';
const forbidden = () => {
    throw new Error('Real native/process execution forbidden in owned copy I/O tests.');
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
const { createFreshDeploymentRoot } = await import('../src/adapters/app-deployment-native.ts');

const relativeStage = '.staging/0dd7224c-51a2-41b3-914d-01171c139ac2/payload';
async function sourceFixture(t: TestContext) {
    const fixture = await ownedWindowsDeploymentNative(t);
    const sourceRoot = path.join(fixture.root, 'source');
    await fs.mkdir(sourceRoot);
    const content = Buffer.alloc(131089, 0x61);
    await fs.writeFile(path.join(sourceRoot, 'a.bin'), content);
    await fs.mkdir(path.join(sourceRoot, 'nested'));
    await fs.writeFile(path.join(sourceRoot, 'nested/zero'), '');
    const entries = [
        {
            type: 'file' as const,
            path: 'a.bin',
            bytes: content.length,
            sha256: createHash('sha256').update(content).digest('hex'),
            executableBits: null,
        },
        { type: 'directory' as const, path: 'nested', executableBits: null },
        {
            type: 'file' as const,
            path: 'nested/zero',
            bytes: 0,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            executableBits: null,
        },
    ];
    const manifest = Buffer.from(
        `${JSON.stringify({ schemaVersion: 1, platform: 'win32', architecture: 'x64', entries })}\n`,
    );
    await fs.writeFile(path.join(sourceRoot, 'payload-manifest.json'), 'untrusted later scratch manifest\n');
    const sourceIdentity = await fs.lstat(sourceRoot, { bigint: true });
    const native = await createFreshDeploymentRoot(path.join(fixture.root, 'managed'));
    try {
        for (const name of ['.staging', relativeStage.slice(0, -8), relativeStage])
            await native.createDirectory(path.join(...name.split('/')));
    } catch (error) {
        await native.close();
        throw error;
    }
    return {
        ...fixture,
        native,
        sourceRoot,
        sourceIdentity,
        entries,
        manifest,
        content,
        stage: path.join(fixture.root, 'managed', ...relativeStage.split('/')),
    };
}

test('actual copyPayload streams one opened source twice and uses the same captured manifest bytes', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await sourceFixture(t);
    const acquire = fs.open;
    let opens = 0,
        closes = 0;
    const positions: number[] = [];
    fs.open = async (...args: Parameters<typeof fs.open>) => {
        const handle = await acquire(...args);
        if (String(args[0]) === path.join(fixture.sourceRoot, 'a.bin')) {
            opens++;
            const read = handle.read.bind(handle),
                close = handle.close.bind(handle);
            Object.defineProperty(handle, 'read', {
                value: async (...values: unknown[]) => {
                    assert.equal(typeof values[3], 'number');
                    if (typeof values[3] === 'number') positions.push(values[3]);
                    return Reflect.apply(read, handle, values);
                },
            });
            handle.close = async () => {
                closes++;
                await close();
            };
        }
        return handle;
    };
    syncBuiltinESMExports();
    try {
        const actual = await fixture.native.copyPayload(
            fixture.sourceRoot,
            fixture.sourceIdentity,
            path.join(...relativeStage.split('/')),
            fixture.entries,
            fixture.manifest,
        );
        assert.equal(fixture.copies(), 1);
        assert.equal(fixture.copyTerminals(), 1);
        assert.equal(opens, 1);
        assert.equal(closes, 1);
        assert.deepEqual(positions, [0, 65536, 131072, 131089, 0, 65536, 131072, 131089]);
        assert.deepEqual(await fs.readFile(path.join(fixture.stage, 'a.bin')), fixture.content);
        assert.deepEqual(await fs.readFile(path.join(fixture.stage, 'payload-manifest.json')), fixture.manifest);
        assert.deepEqual(
            actual.map((entry) => entry.path),
            ['a.bin', 'nested', 'nested/zero', 'payload-manifest.json'],
        );
    } finally {
        await fixture.native.close();
        await fixture.cleanup();
    }
});

function errorText(error: unknown): string {
    if (error instanceof AggregateError) return error.errors.map(errorText).join(' | ');
    return error instanceof Error ? `${error.message} ${error.cause ? errorText(error.cause) : ''}` : String(error);
}

test('owned source root replacement is refused before the copy child starts', { skip: !fixedWindows }, async (t) => {
    const fixture = await sourceFixture(t);
    try {
        await fs.rename(fixture.sourceRoot, `${fixture.sourceRoot}-retained`);
        await fs.mkdir(fixture.sourceRoot);
        await assert.rejects(
            fixture.native.copyPayload(
                fixture.sourceRoot,
                fixture.sourceIdentity,
                path.join(...relativeStage.split('/')),
                fixture.entries,
                fixture.manifest,
            ),
            /root comparison baseline changed/,
        );
        assert.equal(fixture.copies(), 0);
    } finally {
        await fixture.native.close();
        await fixture.cleanup();
    }
});

test('actual opened source rejects hash, short, excess, same-bytes inode replacement and preserves read plus close failures', {
    skip: !fixedWindows,
}, async (t) => {
    for (const scenario of ['hash', 'short', 'excess', 'replacement', 'read-close'])
        await t.test(scenario, async (context) => {
            const fixture = await sourceFixture(context),
                acquire = fs.open;
            let opens = 0,
                closes = 0,
                reads = 0;
            fs.open = async (...args: Parameters<typeof fs.open>) => {
                const handle = await acquire(...args);
                if (String(args[0]) !== path.join(fixture.sourceRoot, 'a.bin')) return handle;
                opens++;
                const read = handle.read.bind(handle),
                    close = handle.close.bind(handle);
                Object.defineProperty(handle, 'read', {
                    value: async (...values: unknown[]) => {
                        reads++;
                        const position = values[3];
                        assert.equal(typeof position, 'number');
                        if (scenario === 'read-close' && Number(position) >= 65536)
                            throw new Error('owned source primary read failure');
                        if (scenario === 'short' && Number(position) >= 65536)
                            return { bytesRead: 0, buffer: values[0] };
                        const actual = await Reflect.apply(read, handle, values);
                        if (scenario === 'hash' && reads === 1 && Buffer.isBuffer(values[0])) values[0][0] = 0x62;
                        if (scenario === 'excess' && Number(position) === fixture.content.length)
                            return { bytesRead: 1, buffer: values[0] };
                        if (scenario === 'replacement' && reads === 1) {
                            const file = path.join(fixture.sourceRoot, 'a.bin');
                            await fs.rename(file, `${file}.retained`);
                            await fs.writeFile(file, fixture.content);
                        }
                        return actual;
                    },
                });
                handle.close = async () => {
                    closes++;
                    await close();
                    if (scenario === 'read-close') throw new Error('owned source secondary close failure');
                };
                return handle;
            };
            syncBuiltinESMExports();
            try {
                await assert.rejects(
                    fixture.native.copyPayload(
                        fixture.sourceRoot,
                        fixture.sourceIdentity,
                        path.join(...relativeStage.split('/')),
                        fixture.entries,
                        fixture.manifest,
                    ),
                    (error: unknown) => {
                        const message = errorText(error);
                        if (scenario === 'read-close') {
                            assert.match(message, /primary read failure/);
                            assert.match(message, /secondary close failure/);
                        } else
                            assert.match(
                                message,
                                /hash|length|trailing|identity|metadata|Native deployment helper|Deployment helper/,
                            );
                        return true;
                    },
                );
                assert.equal(opens, 1);
                assert.equal(closes, 1);
                assert.equal(fixture.copyTerminals(), 1);
                await assert.rejects(fs.lstat(path.join(fixture.stage, 'payload-manifest.json')), { code: 'ENOENT' });
            } finally {
                await fixture.native.close();
                await fixture.cleanup();
            }
        });
});

test('actual source closes after early parser rejection and retains the child until its real controlled terminal', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await sourceFixture(t),
        acquire = fs.open,
        spawn = childProcess.spawn;
    const sourceStarted = Promise.withResolvers<void>(),
        nativeStarted = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>();
    let copyChild: ReturnType<typeof spawn> | undefined,
        closes = 0,
        settled = false;
    fixture.copyHook(async (boundary, relative) => {
        if (boundary === 'write-before' && relative === 'a.bin') {
            nativeStarted.resolve();
            await release.promise;
        }
    });
    Object.defineProperty(childProcess, 'spawn', {
        value: (...args: Parameters<typeof spawn>) => {
            const child = Reflect.apply(spawn, childProcess, args);
            if (args[1]?.[0] === 'copy') copyChild = child;
            return child;
        },
    });
    fs.open = async (...args: Parameters<typeof fs.open>) => {
        const handle = await acquire(...args);
        if (String(args[0]) === path.join(fixture.sourceRoot, 'a.bin')) {
            const read = handle.read.bind(handle),
                close = handle.close.bind(handle);
            Object.defineProperty(handle, 'read', {
                value: async (...values: unknown[]) => {
                    const result = await Reflect.apply(read, handle, values);
                    sourceStarted.resolve();
                    return result;
                },
            });
            handle.close = async () => {
                closes++;
                await close();
            };
        }
        return handle;
    };
    syncBuiltinESMExports();
    const pending = fixture.native.copyPayload(
        fixture.sourceRoot,
        fixture.sourceIdentity,
        path.join(...relativeStage.split('/')),
        fixture.entries,
        fixture.manifest,
    );
    const observed = pending.then(
        () => {
            settled = true;
        },
        (error: unknown) => {
            settled = true;
            return error;
        },
    );
    try {
        await Promise.all([sourceStarted.promise, nativeStarted.promise]);
        assert.ok(copyChild?.stdout);
        copyChild.stdout.push(Buffer.from('malformed early output'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(settled, false);
        assert.equal(fixture.copyTerminals(), 0);
        release.resolve();
        const error = await observed;
        assert.match(errorText(error), /before complete input/);
        assert.equal(closes, 1);
        assert.equal(fixture.copyTerminals(), 1);
    } finally {
        release.resolve();
        await observed;
        await fixture.native.close();
        await fixture.cleanup();
    }
});

test('owned output readback drift fails the single copy child without requesting the next source file', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await sourceFixture(t);
    const events: string[] = [];
    const spawn = childProcess.spawn;
    Object.defineProperty(childProcess, 'spawn', {
        value: (...args: Parameters<typeof spawn>) => {
            const child = Reflect.apply(spawn, childProcess, args);
            if (args[1]?.[0] === 'copy') {
                child.on('exit', () => events.push('exit'));
                child.on('close', () => events.push('close'));
                for (const [name, stream] of [
                    ['input', child.stdin],
                    ['output', child.stdout],
                    ['error', child.stderr],
                ] as const) {
                    stream?.on('close', () => events.push(`${name}:close`));
                    stream?.on('end', () => events.push(`${name}:end`));
                    stream?.on('error', () => events.push(`${name}:error`));
                }
            }
            return child;
        },
    });
    syncBuiltinESMExports();
    fixture.copyHook(async (boundary, relative) => {
        events.push(`${boundary}:${relative}`);
        if (boundary === 'readback-before' && relative === 'a.bin')
            await fs.writeFile(path.join(fixture.stage, relative), Buffer.alloc(fixture.content.length, 0x62));
    });
    try {
        await assert.rejects(
            fixture.native.copyPayload(
                fixture.sourceRoot,
                fixture.sourceIdentity,
                path.join(...relativeStage.split('/')),
                fixture.entries,
                fixture.manifest,
            ),
        );
        assert.equal(fixture.copyTerminals(), 1);
        await assert.rejects(fs.lstat(path.join(fixture.stage, 'nested')), { code: 'ENOENT' });
    } finally {
        assert.ok(events.includes('exit') && events.includes('close') && events.includes('input:close'));
        await fixture.native.close();
        await fixture.cleanup();
    }
});

test('fresh same-boundary sweep deduplicates deep parents, revalidates every raw record and never reuses prior permission facts', {
    skip: !fixedWindows,
}, async (t) => {
    const fixture = await sourceFixture(t);
    try {
        const entries = [];
        let nested = '';
        for (let depth = 0; depth < 10; depth++) {
            nested = nested ? `${nested}/d` : 'd';
            await fs.mkdir(path.join(fixture.sourceRoot, ...nested.split('/')));
            entries.push({ type: 'directory' as const, path: nested, executableBits: null });
        }
        await fs.writeFile(path.join(fixture.sourceRoot, ...nested.split('/'), 'leaf'), '');
        entries.push({
            type: 'file' as const,
            path: `${nested}/leaf`,
            bytes: 0,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            executableBits: null,
        });
        for (let index = 0; index < 260; index++) {
            const name = `z${String(index).padStart(3, '0')}`;
            await fs.writeFile(path.join(fixture.sourceRoot, name), '');
            entries.push({
                type: 'file' as const,
                path: name,
                bytes: 0,
                sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                executableBits: null,
            });
        }
        const manifest = Buffer.from(
            `${JSON.stringify({ schemaVersion: 1, platform: 'win32', architecture: 'x64', entries })}\n`,
        );
        const copied = await fixture.native.copyPayload(
            fixture.sourceRoot,
            fixture.sourceIdentity,
            path.join(...relativeStage.split('/')),
            entries,
            manifest,
        );
        const checks = [];
        for (const entry of copied) {
            const file = path.join(fixture.stage, entry.path);
            checks.push({ file, stats: await fs.lstat(file, { bigint: true }) });
        }
        let before = fixture.queries();
        await fixture.native.entries(checks);
        assert.equal(fixture.queries() - before, 3);
        const unsafe = checks[130];
        assert.ok(unsafe);
        fixture.patch((name, facts) => (name === unsafe.file ? { ...facts, sid: 'S-1-1-0' } : facts));
        before = fixture.queries();
        await assert.rejects(fixture.native.entries(checks));
        assert.equal(fixture.queries() - before, 3);
        fixture.patch((_name, facts) => facts);
        await fixture.native.entries(checks);
        fixture.patch((name, facts) =>
            name === path.dirname(fixture.stage)
                ? { ...facts, inode: String(BigInt(String(facts.inode)) + 1n) }
                : facts,
        );
        await assert.rejects(fixture.native.entries(checks));
    } finally {
        await fixture.native.close();
        await fixture.cleanup();
    }
});
