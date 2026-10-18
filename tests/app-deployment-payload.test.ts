import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import {
    link,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readdir,
    readFile,
    realpath,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as delivery from '../src/adapters/app-delivery.ts';
import * as deployment from '../src/domains/app-deployment.ts';

const emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const golden =
    '{"schemaVersion":1,"platform":"win32","architecture":"x64","entries":[{"type":"file","path":"app.js","bytes":0,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","executableBits":null}]}\n';
const goldenDigest = 'e6edd72613f28e9c95d007e21b8e5d69803220b39325d52161a9902fe0d6bcd5';

function file(name: string, executableBits: number | null = null) {
    return { type: 'file', path: name, bytes: 0, sha256: emptyDigest, executableBits };
}

function directory(name: string, executableBits: number | null = null) {
    return { type: 'directory', path: name, executableBits };
}

function manifest(entries: unknown[] = [file('app.js')], platform = 'win32', architecture = 'x64') {
    return { schemaVersion: 1, platform, architecture, entries };
}

test('payload identity binds literal canonical bytes to the independently fixed v1 digest', () => {
    assert.equal(typeof delivery.identifyDeploymentPayload, 'function', 'complete payload identity API is required');
    assert.equal(deployment.encodeDeploymentPayloadManifest(JSON.parse(golden)), golden);
    const identified = delivery.identifyDeploymentPayload(JSON.parse(golden));
    assert.equal(identified.canonicalManifest, golden);
    assert.equal(identified.selectedBuildId, goldenDigest);
    assert.equal(identified.selectedManifestSha256, goldenDigest);
    assert.deepEqual(delivery.identifyDeploymentPayload(JSON.parse(golden)), identified);
    assert.ok(Object.isFrozen(identified));
    assert.ok(Object.isFrozen(identified.manifest));
    assert.ok(Object.isFrozen(identified.manifest.entries));
    assert.ok(Object.isFrozen(identified.manifest.entries[0]));
});

test('owned payload snapshots do not retain mutable caller objects', () => {
    const input = manifest();
    const snapshot = deployment.parseDeploymentPayloadManifest(input);
    input.entries.length = 0;
    input.platform = 'linux';
    assert.equal(snapshot.entries.length, 1);
    assert.equal(snapshot.platform, 'win32');
});

test('payload parser freezes the same file length it validated from an accessor', () => {
    let reads = 0;
    const input = manifest([
        {
            ...file('app.js'),
            get bytes() {
                reads++;
                return reads <= 3 ? 0 : -1;
            },
        },
    ]);
    const snapshot = deployment.parseDeploymentPayloadManifest(input);
    const entry = snapshot.entries[0];
    assert.ok(entry?.type === 'file');
    assert.equal(entry.bytes, 0);
    assert.equal(reads, 1);
});

test('payload parser validates single captured values across every supplied field', () => {
    const cases: { input: ReturnType<typeof manifest>; owner: 'manifest' | number; key: string; later: unknown }[] = [
        ...['schemaVersion', 'platform', 'architecture', 'entries'].map((key) => ({
            input: manifest(),
            owner: 'manifest' as const,
            key,
            later: null,
        })),
        ...['type', 'path', 'bytes', 'sha256', 'executableBits'].map((key) => ({
            input: manifest(),
            owner: 0,
            key,
            later: 'unsupported',
        })),
        { input: manifest([directory('empty')]), owner: 0, key: 'executableBits', later: 1 },
        { input: framework(), owner: 7, key: 'target', later: '/outside' },
    ];
    for (const { input, owner, key, later } of cases) {
        const expected = structuredClone(input);
        const record = owner === 'manifest' ? input : input.entries[owner];
        assert.ok(typeof record === 'object' && record !== null);
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        assert.ok(descriptor && Object.hasOwn(descriptor, 'value'));
        const first: unknown = descriptor.value;
        let reads = 0;
        Object.defineProperty(record, key, {
            enumerable: true,
            get() {
                return ++reads === 1 ? first : later;
            },
        });
        assert.deepEqual(deployment.parseDeploymentPayloadManifest(input), expected, `${owner}:${key}`);
        assert.equal(reads, 1, `${owner}:${key}`);
    }
});

test('every content coordinate changes v1 identity without a version field', () => {
    const variants = [
        manifest([file('other.js')]),
        manifest([directory('app.js')]),
        manifest([{ ...file('app.js'), bytes: 1 }]),
        manifest([{ ...file('app.js'), sha256: '1'.repeat(64) }]),
        manifest([file('app.js', 0)], 'linux'),
        manifest([file('app.js', 0o100)], 'linux'),
        manifest([file('app.js', 0)], 'darwin'),
        manifest([file('app.js')], 'win32', 'arm64'),
    ];
    const identities = variants.map((value) => delivery.identifyDeploymentPayload(value).selectedBuildId);
    assert.equal(new Set([goldenDigest, ...identities]).size, variants.length + 1);
});

test('all six OS and architecture schemas preserve exact executable-bit policy', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
        for (const architecture of ['x64', 'arm64']) {
            const value = manifest([file('app', platform === 'win32' ? null : 0o111)], platform, architecture);
            assert.equal(deployment.parseDeploymentPayloadManifest(value).architecture, architecture);
        }
    }
});

test('strict manifest syntax refuses unsupported fields, paths, order, aliases and modes', () => {
    const invalid: unknown[] = [
        null,
        { ...manifest(), extra: true },
        { ...manifest(), schemaVersion: 2 },
        { ...manifest(), platform: 'unknown' },
        { ...manifest(), architecture: 'ia32' },
        { ...manifest(), entries: {} },
        manifest([{ ...file('app.js'), extra: true }]),
        manifest([{ ...file('app.js'), bytes: -1 }]),
        manifest([{ ...file('app.js'), bytes: Number.MAX_SAFE_INTEGER + 1 }]),
        manifest([{ ...file('app.js'), sha256: 'A'.repeat(64) }]),
        manifest([file('app.js', 0)]),
        manifest([file('app.js', null)], 'linux'),
        manifest([file('app.js', 0o200)], 'linux'),
        manifest([file('app.js', 0.5)], 'linux'),
        manifest([{ type: 'socket', path: 'app.js' }]),
        manifest([file('b'), file('a')]),
        manifest([file('a'), file('a')]),
        manifest([directory('Foo'), directory('foo'), file('foo/a')]),
        manifest([directory('Foo'), file('Foo/a'), file('foo/b')]),
        manifest([file('missing/app.js')]),
        manifest([file('a'), file('a/b')]),
        manifest([file('payload-manifest.json')]),
        manifest([directory('payload-manifest.json'), file('payload-manifest.json/a')]),
        ...['../a', '/a', 'a\\b', 'C:a', 'nul.txt', 'a.', 'a ', 'a\u0000', 'e\u0301', '\ud800'].map((name) =>
            manifest([file(name)]),
        ),
    ];
    for (const value of invalid) assert.throws(() => deployment.parseDeploymentPayloadManifest(value));
});

test('manifest entry and canonical byte bounds refuse instead of truncating', () => {
    const entries = Array.from({ length: 100000 }, (_, index) =>
        directory(`entry-${index.toString().padStart(6, '0')}`),
    );
    assert.equal(deployment.parseDeploymentPayloadManifest(manifest(entries)).entries.length, 100000);
    assert.throws(() => deployment.parseDeploymentPayloadManifest(manifest([...entries, directory('entry-100000')])));
    assert.throws(() => deployment.encodeDeploymentPayloadManifest(manifest([file('a'.repeat(16 * 1024 * 1024))])));
});

function framework(target = 'Versions/Current/value') {
    return manifest(
        [
            directory('App.app', 0o111),
            directory('App.app/Frameworks', 0o111),
            directory('App.app/Frameworks/Kit.framework', 0o111),
            directory('App.app/Frameworks/Kit.framework/Versions', 0o111),
            directory('App.app/Frameworks/Kit.framework/Versions/A', 0o111),
            file('App.app/Frameworks/Kit.framework/Versions/A/value', 0),
            { type: 'symlink', path: 'App.app/Frameworks/Kit.framework/Versions/Current', target: 'A' },
            { type: 'symlink', path: 'App.app/Frameworks/Kit.framework/value', target },
        ],
        'darwin',
    );
}

test('Darwin framework links resolve declared intermediate links and bind exact target text', () => {
    const a = delivery.identifyDeploymentPayload(framework());
    const b = delivery.identifyDeploymentPayload(framework('./Versions/A/value'));
    assert.notEqual(a.selectedBuildId, b.selectedBuildId);
    assert.equal(deployment.parseDeploymentPayloadManifest(framework('Versions/A/../A/value')).entries.length, 8);
});

test('link graph refuses wrong platforms, dangling targets, cycles, escape and link parents', () => {
    for (const target of ['missing', '/absolute', 'C:drive', 'Versions\\A', '../..\u0000', '../../../outside', 'value'])
        assert.throws(() => deployment.parseDeploymentPayloadManifest(framework(target)));
    for (const platform of ['win32', 'linux'])
        assert.throws(() => deployment.parseDeploymentPayloadManifest({ ...framework(), platform }));
    assert.throws(() =>
        deployment.parseDeploymentPayloadManifest(manifest([{ type: 'symlink', path: 'link', target: 'a' }], 'darwin')),
    );
    const cycle = framework();
    cycle.entries[6] = {
        type: 'symlink',
        path: 'App.app/Frameworks/Kit.framework/Versions/Current',
        target: '../value',
    };
    assert.throws(() => deployment.parseDeploymentPayloadManifest(cycle));
    const child = framework();
    child.entries.splice(7, 0, file('App.app/Frameworks/Kit.framework/Versions/Current/child', 0));
    assert.throws(() => deployment.parseDeploymentPayloadManifest(child));
});

test('framework directory links cannot create ancestor or cross-directory traversal cycles', () => {
    assert.throws(() => deployment.parseDeploymentPayloadManifest(framework('.')));
    const cyclic = framework();
    cyclic.entries.splice(5, 0, {
        type: 'symlink',
        path: 'App.app/Frameworks/Kit.framework/Versions/A/back',
        target: '../B',
    });
    cyclic.entries.splice(7, 0, directory('App.app/Frameworks/Kit.framework/Versions/B', 0o111), {
        type: 'symlink',
        path: 'App.app/Frameworks/Kit.framework/Versions/B/back',
        target: '../A',
    });
    assert.throws(() => deployment.parseDeploymentPayloadManifest(cyclic));
});

async function fixture() {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-payload-')));
    const files = [
        ['.hidden', 'hidden'],
        ['App/evidence.json', '{}'],
        ['App/main.js', 'generated'],
        ['Electron/locales/en.pak', 'lazy'],
        ['Electron/resources.pak', 'runtime'],
        ['native/LICENSE', 'notice'],
        ['native/prebuild/addon.node', 'inert'],
        ['node/LICENSE', 'license'],
        ['node/node', 'ordinary'],
        ['official/LICENSE', 'notice'],
        ['official/build/bin.js', 'official'],
        ['official/skills/tool/SKILL.md', 'skill'],
    ];
    try {
        for (const [name, text] of files) {
            assert.ok(name !== undefined && text !== undefined);
            await mkdir(path.dirname(path.join(root, name)), { recursive: true });
            await writeFile(path.join(root, name), text);
        }
        await mkdir(path.join(root, 'empty'));
        const entries: unknown[] = [];
        async function inventory(current: string, prefix = ''): Promise<void> {
            for (const name of await readdir(current)) {
                const relative = `${prefix}${name}`;
                const full = path.join(current, name);
                const metadata = await lstat(full);
                if (metadata.isDirectory()) {
                    entries.push(directory(relative));
                    await inventory(full, `${relative}/`);
                } else {
                    const bytes = await readFile(full);
                    entries.push({
                        ...file(relative),
                        bytes: bytes.length,
                        sha256: createHash('sha256').update(bytes).digest('hex'),
                    });
                }
            }
        }
        await inventory(root);
        const sorted = entries
            .map((entry) => {
                assert.ok(
                    typeof entry === 'object' && entry !== null && 'path' in entry && typeof entry.path === 'string',
                );
                return { path: entry.path, value: entry };
            })
            .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
            .map((entry) => entry.value);
        const identity = delivery.identifyDeploymentPayload(manifest(sorted));
        await writeFile(path.join(root, 'payload-manifest.json'), identity.canonicalManifest);
        const expected = {
            selectedBuildId: identity.selectedBuildId,
            selectedManifestSha256: identity.selectedManifestSha256,
            platform: 'win32' as const,
            architecture: 'x64' as const,
        };
        return { root, expected, identity };
    } catch (error) {
        await cleanup(root);
        throw error;
    }
}

async function cleanup(root: string) {
    assert.equal(path.dirname(root), await realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('dct-payload-'));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test('read-only verification covers nested runtime representatives, hidden files and empty directories', async () => {
    const { root, expected, identity } = await fixture();
    try {
        const result = await delivery.verifyDeploymentPayload(root, expected);
        assert.equal(result.directory, root);
        assert.deepEqual(result.manifest, identity.manifest);
        assert.equal(result.selectedBuildId, expected.selectedBuildId);
        assert.equal(result.selectedManifestSha256, expected.selectedManifestSha256);
        assert.ok(Object.isFrozen(result));
        assert.equal(await readFile(path.join(root, 'payload-manifest.json'), 'utf8'), identity.canonicalManifest);
        await assert.rejects(delivery.verifyDeploymentPayload(path.relative(process.cwd(), root), expected));
        await assert.rejects(delivery.verifyDeploymentPayload(`${root}${path.sep}.`, expected));
    } finally {
        await cleanup(root);
    }
});

test('independent expected identities and platform are mandatory and snapshotted before first await', async () => {
    const { root, expected } = await fixture();
    try {
        for (const invalid of [
            { ...expected, selectedBuildId: '0'.repeat(64) },
            { ...expected, selectedManifestSha256: '0'.repeat(64) },
            { ...expected, platform: 'linux' as const },
            { ...expected, architecture: 'arm64' as const },
        ])
            await assert.rejects(delivery.verifyDeploymentPayload(root, invalid));
        const promise = delivery.verifyDeploymentPayload(root, expected);
        expected.selectedBuildId = '0'.repeat(64);
        expected.selectedManifestSha256 = '0'.repeat(64);
        await promise;
        const missing = { platform: 'win32', architecture: 'x64' };
        await assert.rejects(Reflect.apply(delivery.verifyDeploymentPayload, undefined, [root, missing]));
    } finally {
        await cleanup(root);
    }
});

test('complete payload verification rejects changed, missing, extra, aliased and wrong-type entries', async () => {
    for (const change of ['changed', 'missing', 'extra', 'hidden-directory', 'missing-empty', 'wrong-type', 'alias']) {
        const { root, expected } = await fixture();
        try {
            const full = path.join(root, 'App/main.js');
            if (change === 'changed') await writeFile(full, 'tampered');
            if (change === 'missing' || change === 'wrong-type') await rm(full);
            if (change === 'extra') await writeFile(path.join(root, 'extra'), 'extra');
            if (change === 'hidden-directory') await mkdir(path.join(root, '.cache'));
            if (change === 'missing-empty') await rm(path.join(root, 'empty'), { recursive: true });
            if (change === 'wrong-type') await mkdir(full);
            if (change === 'alias') await rename(full, path.join(root, 'App/MAIN.js'));
            await assert.rejects(delivery.verifyDeploymentPayload(root, expected), { name: 'Error' }, change);
        } finally {
            await cleanup(root);
        }
    }
});

test('on-disk manifest requires exact canonical bounded UTF-8 without duplicate keys or alternate encoding', async () => {
    const { root, expected, identity } = await fixture();
    try {
        const name = path.join(root, 'payload-manifest.json');
        const invalid = [
            identity.canonicalManifest.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
            identity.canonicalManifest.replace('\n', '\r\n'),
            identity.canonicalManifest.trimEnd(),
            `\ufeff${identity.canonicalManifest}`,
            JSON.stringify(identity.manifest, null, 4),
            identity.canonicalManifest.replace('"platform"', '"platfor\\u006d"'),
            Buffer.from([0xff]),
            Buffer.alloc(16 * 1024 * 1024 + 1, 32),
        ];
        for (const bytes of invalid) {
            await writeFile(name, bytes);
            await assert.rejects(delivery.verifyDeploymentPayload(root, expected));
        }
    } finally {
        await cleanup(root);
    }
});

test('hardlinks inside or outside a build, including the manifest, refuse', async () => {
    for (const target of ['App/main.js', 'payload-manifest.json']) {
        const { root, expected } = await fixture();
        const alias = `${root}-hardlink`;
        try {
            await link(path.join(root, target), alias);
            await assert.rejects(delivery.verifyDeploymentPayload(root, expected));
        } finally {
            assert.equal(path.dirname(alias), await realpath(os.tmpdir()));
            await rm(alias, { force: true });
            await cleanup(root);
        }
    }
});

function metadata(stats: BigIntStats, patch: Partial<BigIntStats>): BigIntStats {
    return new Proxy(stats, {
        get(target, key) {
            return Object.hasOwn(patch, key) ? Reflect.get(patch, key) : Reflect.get(target, key);
        },
    });
}

test('observed root, directory, file, device, link-count and metadata drift rejects', async () => {
    for (const scenario of ['root', 'directory', 'file', 'device', 'link-count', 'mode', 'query', 'enumeration']) {
        const { root, expected } = await fixture();
        try {
            const counts = new Map<string, number>();
            const io = {
                lstat: async (name: string) => {
                    const stats = await lstat(name, { bigint: true });
                    const count = (counts.get(name) ?? 0) + 1;
                    counts.set(name, count);
                    if (scenario === 'query' && name.endsWith(`${path.sep}main.js`))
                        throw new Error('controlled query failure');
                    const selected =
                        scenario === 'root'
                            ? name === root
                            : scenario === 'directory'
                              ? name === path.join(root, 'App')
                              : name === path.join(root, 'App/main.js');
                    if (!selected) return stats;
                    if (scenario === 'device') return metadata(stats, { dev: stats.dev + 1n });
                    if (count < 2) return stats;
                    if (scenario === 'link-count') return metadata(stats, { nlink: 2n });
                    return metadata(
                        stats,
                        scenario === 'mode' ? { mode: stats.mode ^ 0o100n } : { ino: stats.ino + 1n },
                    );
                },
                readdir: async (name: string) => {
                    const names = await readdir(name);
                    if (scenario === 'enumeration' && name === root) return [...names, 'unknown'];
                    return names;
                },
            };
            await assert.rejects(delivery.verifyDeploymentPayload(root, expected, io), { name: 'Error' }, scenario);
        } finally {
            await cleanup(root);
        }
    }
});

test('payload read and close failures reject after closing every acquired descriptor', async () => {
    for (const failure of ['read', 'close']) {
        const { root, expected } = await fixture();
        let opens = 0;
        let closes = 0;
        try {
            await assert.rejects(
                delivery.verifyDeploymentPayload(root, expected, {
                    open: async (name, flags) => {
                        const handle = await open(name, flags);
                        opens++;
                        return {
                            stat: () => handle.stat({ bigint: true }),
                            readFile: async () => {
                                if (failure === 'read') throw new Error('controlled read failure');
                                return handle.readFile();
                            },
                            close: async () => {
                                await handle.close();
                                closes++;
                                if (failure === 'close') throw new Error('controlled close failure');
                            },
                        };
                    },
                }),
                new RegExp(`controlled ${failure} failure`),
            );
            assert.equal(closes, opens);
        } finally {
            await cleanup(root);
        }
    }
});

test('manifest replacement above the bound rejects before the helper reads any bytes', async () => {
    const { root, expected } = await fixture();
    const name = path.join(root, 'payload-manifest.json');
    const replacement = metadata(await lstat(name, { bigint: true }), { size: 16n * 1024n * 1024n + 1n });
    let replaced = false;
    let reads = 0;
    let closes = 0;
    try {
        await assert.rejects(
            delivery.verifyDeploymentPayload(root, expected, {
                lstat: async (fileName) =>
                    replaced && fileName === name ? replacement : lstat(fileName, { bigint: true }),
                open: async (fileName, flags) => {
                    assert.equal(fileName, name);
                    const handle = await open(fileName, flags);
                    replaced = true;
                    return {
                        stat: async () => replacement,
                        readFile: async () => {
                            reads++;
                            throw new Error('oversized read sentinel');
                        },
                        close: async () => {
                            await handle.close();
                            closes++;
                        },
                    };
                },
            }),
        );
        assert.equal(reads, 0, 'an oversized stable replacement must never reach readFile');
        assert.equal(closes, 1);
    } finally {
        await cleanup(root);
    }
});

test('controlled Darwin framework filesystem verifies contained links without opening or enumerating them', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-payload-')));
    const identified = delivery.identifyDeploymentPayload(framework());
    const expected = {
        selectedBuildId: identified.selectedBuildId,
        selectedManifestSha256: identified.selectedManifestSha256,
        platform: 'darwin' as const,
        architecture: 'x64' as const,
    };
    const entries = new Map(identified.manifest.entries.map((entry) => [path.join(root, entry.path), entry]));
    let drift = '';
    let reads = 0;
    try {
        for (const [full, entry] of entries) {
            if (entry.type === 'directory') await mkdir(full);
            else await writeFile(full, '');
        }
        await writeFile(path.join(root, 'payload-manifest.json'), identified.canonicalManifest);
        const io = {
            lstat: async (name: string) => {
                const stats = await lstat(name, { bigint: true });
                const entry = entries.get(name);
                if (entry?.type === 'symlink')
                    return metadata(stats, { mode: 0o120777n, isSymbolicLink: () => true, isFile: () => false });
                if (entry) return metadata(stats, { mode: (stats.mode & ~0o111n) | BigInt(entry.executableBits ?? 0) });
                return stats;
            },
            readlink: async (name: string) => {
                const entry = entries.get(name);
                assert.equal(entry?.type, 'symlink');
                if (entry?.type !== 'symlink') throw new Error('unexpected link read');
                reads++;
                return drift === 'target' && reads > 2 ? 'Versions/A/value' : entry.target;
            },
            readdir: async (name: string) => {
                assert.notEqual(entries.get(name)?.type, 'symlink');
                return readdir(name);
            },
            open: async (name: string, flags: number) => {
                assert.notEqual(entries.get(name)?.type, 'symlink');
                const handle = await open(name, flags);
                return {
                    stat: () => handle.stat({ bigint: true }),
                    readFile: () => handle.readFile(),
                    close: () => handle.close(),
                };
            },
        };
        assert.equal(
            (await delivery.verifyDeploymentPayload(root, expected, io)).selectedBuildId,
            expected.selectedBuildId,
        );
        reads = 0;
        drift = 'target';
        await assert.rejects(delivery.verifyDeploymentPayload(root, expected, io), /target changed/);
        drift = '';
        await assert.rejects(
            delivery.verifyDeploymentPayload(root, expected, {
                ...io,
                lstat: async (name) => {
                    const stats = await io.lstat(name);
                    return entries.get(name)?.type === 'file' ? metadata(stats, { mode: stats.mode | 0o100n }) : stats;
                },
            }),
            /executable bits/,
        );
    } finally {
        await cleanup(root);
    }
});

test('manifest replacement and canonical readback drift during traversal reject without repair', async () => {
    for (const scenario of ['manifest', 'readback', 'special', 'directory-list']) {
        const { root, expected } = await fixture();
        let changed = false;
        try {
            await assert.rejects(
                delivery.verifyDeploymentPayload(root, expected, {
                    lstat: async (name) => {
                        const stats = await lstat(name, { bigint: true });
                        if (scenario === 'special' && name === path.join(root, 'App/main.js'))
                            return metadata(stats, { isFile: () => false });
                        return stats;
                    },
                    realpath: async (name) =>
                        scenario === 'readback' && name === path.join(root, 'App/main.js')
                            ? path.join(root, 'App/MAIN.js')
                            : realpath(name),
                    readdir: async (name) => {
                        const names = await readdir(name);
                        if (name === root && !changed) {
                            changed = true;
                            if (scenario === 'manifest')
                                await writeFile(path.join(root, 'payload-manifest.json'), '{}\n');
                        } else if (scenario === 'directory-list' && name === root)
                            return names.filter((part) => part !== 'empty');
                        return names;
                    },
                }),
                { name: 'Error' },
                scenario,
            );
        } finally {
            await cleanup(root);
        }
    }
});

test('expected selection snapshots valid accessor fields exactly once', async (t) => {
    const { root, expected } = await fixture();
    const fields = ['selectedBuildId', 'selectedManifestSha256', 'platform', 'architecture'] as const;
    const later = {
        selectedBuildId: '0'.repeat(64),
        selectedManifestSha256: '0'.repeat(64),
        platform: 'linux',
        architecture: 'arm64',
    };
    try {
        for (const changed of fields) {
            await t.test(changed, async () => {
                const input = { ...expected };
                const reads = { selectedBuildId: 0, selectedManifestSha256: 0, platform: 0, architecture: 0 };
                for (const field of fields) {
                    Object.defineProperty(input, field, {
                        enumerable: true,
                        get() {
                            return ++reads[field] === 1 || field !== changed ? expected[field] : later[field];
                        },
                    });
                }
                const result = await delivery.verifyDeploymentPayload(root, input);
                assert.equal(result.selectedBuildId, expected.selectedBuildId);
                assert.equal(result.selectedManifestSha256, expected.selectedManifestSha256);
                assert.equal(result.manifest.platform, expected.platform);
                assert.equal(result.manifest.architecture, expected.architecture);
                assert.deepEqual(reads, {
                    selectedBuildId: 1,
                    selectedManifestSha256: 1,
                    platform: 1,
                    architecture: 1,
                });
            });
        }
    } finally {
        await cleanup(root);
    }
});

test('expected selection rejects invalid accessor fields before payload I/O', async (t) => {
    const { root, expected } = await fixture();
    const fields = ['selectedBuildId', 'selectedManifestSha256', 'platform', 'architecture'] as const;
    const invalid: Readonly<Record<(typeof fields)[number], unknown>> = {
        selectedBuildId: null,
        selectedManifestSha256: 'invalid',
        platform: 'unsupported',
        architecture: 'unsupported',
    };
    try {
        for (const changed of fields) {
            await t.test(changed, async () => {
                const input = { ...expected };
                const reads = { selectedBuildId: 0, selectedManifestSha256: 0, platform: 0, architecture: 0 };
                let ioCalls = 0;
                for (const field of fields) {
                    Object.defineProperty(input, field, {
                        enumerable: true,
                        get() {
                            return ++reads[field] === 1 && field === changed ? invalid[field] : expected[field];
                        },
                    });
                }
                await assert.rejects(
                    delivery.verifyDeploymentPayload(root, input, {
                        lstat: async () => {
                            ioCalls++;
                            throw new Error('unexpected payload I/O');
                        },
                    }),
                    { message: 'Invalid independently expected payload selection.' },
                );
                assert.equal(ioCalls, 0);
                assert.deepEqual(reads, {
                    selectedBuildId: 1,
                    selectedManifestSha256: 1,
                    platform: 1,
                    architecture: 1,
                });
            });
        }
    } finally {
        await cleanup(root);
    }
});
