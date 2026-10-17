import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { launchSealedStudy, type SealedStudyIo, verifySealedStudy } from './smoke/sealed-study.ts';

function fixture() {
    const stage = path.resolve('synthetic-sealed-study');
    const appPaths = [
        'electron.exe',
        'resources/app/app-bootstrap.mjs',
        'resources/app/app-main.mjs',
        'resources/app/app-preload.cjs',
        'resources/app/app-renderer.js',
        'resources/app/package.json',
        'resources/app/delivery/app-release-inputs.json',
        'resources/app/delivery/app-native-release.json',
        'resources/app/delivery/official-server-release.json',
        'resources/node/node.exe',
        'resources/node/LICENSE',
        'resources/official-server/package.json',
        'resources/official-server/build/src/bin/chrome-devtools-mcp.js',
        'resources/app/node_modules/fs-native-extensions/prebuilds/win32-x64/fs-native-extensions.node',
    ];
    const nativePaths = [
        'windows-cdp-helper.ps1',
        'windows-native-helper.ps1',
        'windows-native-process.cs',
        'src/adapters/windows-native-process.cs',
        'tests/smoke/windows-window-evidence.ps1',
        'tests/smoke/windows-selected-tab-evidence.ps1',
        'tests/smoke/windows-png-evidence.ps1',
        'tests/fixtures/compile-native-window.ps1',
        'tests/fixtures/native-window.cs',
    ];
    const fixturePaths = [
        'http-fixture-NOTICES.txt',
        'http-fixture.mjs',
        'screenshot-layers-study.mjs',
        'screenshot-timeout-study.mjs',
        ...nativePaths,
    ];
    const contents = new Map(
        [...appPaths, ...fixturePaths].map((file) => [file, Buffer.from(`sealed fixture bytes: ${file}`)]),
    );
    const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
    const entries = (names: string[]) =>
        names
            .map((name) => {
                const bytes = contents.get(name);
                assert.ok(bytes);
                return { path: name, bytes: bytes.length, sha256: hash(bytes) };
            })
            .sort((left, right) => left.path.localeCompare(right.path, 'en'));
    const inputs = [{ path: 'tests/smoke/screenshot-layers.ts', bytes: 1, sha256: hash('x') }];
    const app = entries(appPaths);
    const files = entries([...appPaths, ...fixturePaths]);
    const receipt = {
        schemaVersion: 1,
        platform: 'win32',
        architecture: 'x64',
        createdAtUtc: '2026-10-17T00:00:00Z',
        source: { revision: '1'.repeat(40), dirty: false, inputs, digest: hash(JSON.stringify(inputs)) },
        app: { files: app, digest: hash(JSON.stringify(app)) },
        fixture: { files: entries(fixturePaths) },
        files,
        inventoryDigest: hash(JSON.stringify(files)),
    };
    const effects = { reads: 0, launches: [] as { executable: string; args: string[]; env: NodeJS.ProcessEnv }[] };
    const environment = {
        PATH: 'synthetic native path',
        NODE_OPTIONS: '--import=mutable-code',
        nOdE_pAtH: 'mutable-modules',
        DCT_SYNTHETIC: 'preserved',
    };
    const io: SealedStudyIo = {
        environment,
        async listFiles(root) {
            assert.equal(root, stage);
            return [...contents.keys()];
        },
        async readFile(file) {
            effects.reads++;
            if (file === `${stage}.receipt.json`) return Buffer.from(JSON.stringify(receipt));
            const bytes = contents.get(path.relative(stage, file).replaceAll('\\', '/'));
            if (!bytes) throw new Error('Synthetic sealed file is missing.');
            return bytes;
        },
        async run(executable, args, env) {
            effects.launches.push({ executable, args: [...args], env });
            return { code: 0, signal: null };
        },
    };
    const args = [
        '--allow-gui',
        path.resolve('synthetic-fixture.json'),
        path.resolve('synthetic-evidence'),
        '--stage',
        stage,
    ];
    return { stage, receipt, contents, nativePaths, environment, effects, io, args };
}

test('study launcher denies GUI acquisition before seal reads when the exact authorization flag is absent', async () => {
    const f = fixture();
    assert.deepEqual(
        await launchSealedStudy(
            'layers',
            f.args.filter((arg) => arg !== '--allow-gui'),
            f.io,
        ),
        {
            skipped: true,
        },
    );
    assert.equal(f.effects.reads, 0);
    assert.deepEqual(f.effects.launches, []);
});

test('both study launchers require one explicit absolute stage and two original positional paths before I/O', async () => {
    for (const args of [
        ['--allow-gui'],
        ['--allow-gui', '--stage', 'relative'],
        ['--allow-gui', '--stage'],
        ['--allow-gui', '--stage', path.resolve('one'), '--stage', path.resolve('two')],
    ]) {
        const f = fixture();
        await assert.rejects(launchSealedStudy('timeout', args, f.io));
        assert.equal(f.effects.reads, 0);
        assert.deepEqual(f.effects.launches, []);
    }
});

for (const kind of ['layers', 'timeout'] as const) {
    test(`${kind} launches only its verified sealed study on the same verified ordinary Node`, async () => {
        const f = fixture();
        await launchSealedStudy(kind, f.args, f.io);
        assert.equal(f.effects.launches.length, 1);
        assert.deepEqual(f.effects.launches[0], {
            executable: path.join(f.stage, 'resources/node/node.exe'),
            args: [
                path.join(f.stage, kind === 'layers' ? 'screenshot-layers-study.mjs' : 'screenshot-timeout-study.mjs'),
                ...f.args,
            ],
            env: { PATH: 'synthetic native path', DCT_SYNTHETIC: 'preserved' },
        });
        assert.equal(f.environment.NODE_OPTIONS, '--import=mutable-code');
        assert.equal(f.environment.nOdE_pAtH, 'mutable-modules');
    });
}

test('missing receipt, dirty source and mismatched App or study bytes reject before any measured child launch', async () => {
    for (const variant of ['missing-receipt', 'dirty', 'app', 'study'] as const) {
        const f = fixture();
        if (variant === 'missing-receipt')
            f.io.readFile = async () => {
                throw new Error('No receipt.');
            };
        if (variant === 'dirty') f.receipt.source.dirty = true;
        if (variant === 'app') f.contents.set('resources/node/node.exe', Buffer.from('changed Node'));
        if (variant === 'study') f.contents.set('screenshot-timeout-study.mjs', Buffer.from('changed study'));
        await assert.rejects(launchSealedStudy('timeout', f.args, f.io));
        assert.deepEqual(f.effects.launches, []);
    }
});

test('every required native asset is checked for missing or changed bytes before study/native acquisition', async () => {
    for (const asset of fixture().nativePaths) {
        for (const changed of [false, true]) {
            const f = fixture();
            if (changed) f.contents.set(asset, Buffer.from('tampered native asset'));
            else f.contents.delete(asset);
            await assert.rejects(launchSealedStudy('layers', f.args, f.io));
            assert.deepEqual(f.effects.launches, [], asset);
        }
    }
});

test('sealed child refuses another stage entry or Node even when the receipt itself validates', async () => {
    const f = fixture();
    const verified = await verifySealedStudy('layers', f.args, f.io, {
        entry: path.join(f.stage, 'screenshot-layers-study.mjs'),
        nodeExecutable: path.join(f.stage, 'resources/node/node.exe'),
    });
    assert.deepEqual(verified.args, [path.resolve('synthetic-fixture.json'), path.resolve('synthetic-evidence')]);
    assert.deepEqual(verified.source, {
        revision: '1'.repeat(40),
        digest: f.receipt.source.digest,
        inventoryDigest: f.receipt.inventoryDigest,
    });
    for (const identity of [
        {
            entry: path.join(f.stage, 'screenshot-timeout-study.mjs'),
            nodeExecutable: path.join(f.stage, 'resources/node/node.exe'),
        },
        { entry: path.join(f.stage, 'screenshot-layers-study.mjs'), nodeExecutable: process.execPath },
    ]) {
        await assert.rejects(verifySealedStudy('layers', f.args, f.io, identity));
        assert.deepEqual(f.effects.launches, []);
    }
});

test('launcher awaits actual study close and cannot accept a failed or signalled child as normal cleanup', async () => {
    const f = fixture();
    let release = () => {};
    f.io.run = async () =>
        new Promise((resolve) => {
            release = () => resolve({ code: 0, signal: null });
        });
    let completed = false;
    const pending = launchSealedStudy('timeout', f.args, f.io).then((result) => {
        completed = true;
        return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(completed, false);
    release();
    assert.equal((await pending).skipped, false);
    for (const result of [
        { code: 1, signal: null },
        { code: 0, signal: 'SIGTERM' as const },
    ]) {
        f.io.run = async () => result;
        await assert.rejects(launchSealedStudy('layers', f.args, f.io), /did not exit normally/);
    }
});

test('actual study CLIs skip without GUI permission and reject absent, dirty or incomplete seals before evidence acquisition', async () => {
    const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-sealed-study-')));
    try {
        const stage = path.join(base, 'stage');
        const output = path.join(base, 'unacquired-evidence');
        const config = path.join(base, 'unread-fixture.json');
        const f = fixture();
        for (const [name, bytes] of f.contents) {
            const destination = path.join(stage, name);
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, bytes);
        }
        const receiptPath = `${stage}.receipt.json`;
        const environment = Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !['node_options', 'node_path'].includes(key.toLowerCase())),
        );
        for (const entry of ['screenshot-layers.ts', 'screenshot-timeout-probe.ts']) {
            const script = fileURLToPath(new URL(`./smoke/${entry}`, import.meta.url));
            const args = [config, output, '--stage', stage];
            const skipped = await promisify(execFile)(process.execPath, [script, ...args], {
                env: environment,
                windowsHide: true,
                shell: false,
                timeout: 10_000,
            });
            assert.match(skipped.stdout, /SKIP: GUI execution requires explicit --allow-gui/);
            for (const variant of ['missing', 'dirty', 'tampered', 'native-missing'] as const) {
                await rm(receiptPath, { force: true });
                if (variant !== 'missing') {
                    await writeFile(
                        receiptPath,
                        JSON.stringify({
                            ...f.receipt,
                            source: { ...f.receipt.source, dirty: variant === 'dirty' },
                        }),
                    );
                }
                const node = path.join(stage, 'resources/node/node.exe');
                await writeFile(
                    node,
                    variant === 'tampered' ? 'tampered' : (f.contents.get('resources/node/node.exe') ?? ''),
                );
                const native = path.join(stage, 'windows-native-helper.ps1');
                if (variant === 'native-missing') await rm(native);
                else await writeFile(native, f.contents.get('windows-native-helper.ps1') ?? '');
                await assert.rejects(
                    promisify(execFile)(process.execPath, [script, '--allow-gui', ...args], {
                        env: environment,
                        windowsHide: true,
                        shell: false,
                        timeout: 10_000,
                    }),
                    (error: unknown) => {
                        assert.ok(error instanceof Error);
                        assert.match(
                            error.message,
                            variant === 'missing' ? /stage\.receipt\.json/ : /Native fixture seal/,
                        );
                        assert.doesNotMatch(error.message, /unread-fixture\.json.*ENOENT/);
                        return true;
                    },
                );
                await assert.rejects(access(output));
            }
        }
    } finally {
        assert.equal(path.dirname(base), await realpath(os.tmpdir()));
        assert.ok(path.basename(base).startsWith('dct-sealed-study-'));
        await rm(base, { recursive: true, force: true });
    }
});
