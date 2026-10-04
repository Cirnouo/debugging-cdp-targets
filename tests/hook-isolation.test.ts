import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../src/shared/errors.ts';

test('pre-push verification clears repository routing before creating independent Git fixtures', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-hook-isolation-'));
    const cleanEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
    );
    const git = (args: string[], cwd = folder) =>
        execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: cleanEnvironment }).trim();
    try {
        const sentinel = path.join(folder, 'sentinel');
        git(['init', '--quiet', sentinel]);
        const sentinelGit = path.join(sentinel, '.git');
        const before = await readFile(path.join(sentinelGit, 'config'), 'utf8');
        const bin = path.join(folder, 'bin');
        await mkdir(bin);
        const pnpm = path.join(bin, 'pnpm');
        await writeFile(pnpm, '#!/bin/sh\nnode "$DCT_TEST_HOOK_PROBE" "$@"\n', 'utf8');
        await chmod(pnpm, 0o755);
        const probe = path.join(folder, 'probe.ts');
        await writeFile(
            probe,
            `
            import assert from 'node:assert/strict';
            import { execFileSync } from 'node:child_process';
            assert.deepEqual(process.argv.slice(2), ['verify:push']);
            const local = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split(/\\s+/);
            for (const name of local) assert.equal(process.env[name], undefined, name + ' must not route nested fixtures');
            execFileSync('git', ['init', '--quiet', '--bare', process.env.DCT_TEST_BARE_FIXTURE], { windowsHide: true });
            console.log('independent verification fixture passed');
        `,
            'utf8',
        );
        const execPath = git(['--exec-path']);
        const shell = process.platform === 'win32' ? path.resolve(execPath, '../../..', 'usr/bin/sh.exe') : 'sh';
        const result = spawnSync(shell, ['-e', fileURLToPath(new URL('../.husky/pre-push', import.meta.url))], {
            cwd: folder,
            encoding: 'utf8',
            windowsHide: true,
            env: {
                ...cleanEnvironment,
                PATH: bin + path.delimiter + (cleanEnvironment.PATH ?? cleanEnvironment.Path ?? ''),
                GIT_DIR: sentinelGit,
                GIT_WORK_TREE: sentinel,
                GIT_INDEX_FILE: path.join(sentinelGit, 'index'),
                GIT_COMMON_DIR: sentinelGit,
                DCT_TEST_HOOK_PROBE: probe,
                DCT_TEST_BARE_FIXTURE: path.join(folder, 'bare-fixture'),
            },
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /independent verification fixture passed/);
        assert.equal(await readFile(path.join(sentinelGit, 'config'), 'utf8'), before);
        assert.equal(git(['--git-dir', path.join(folder, 'bare-fixture'), 'config', 'core.bare']), 'true');
    } finally {
        assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(folder).startsWith('dct-hook-isolation-'));
        await rm(folder, { recursive: true, force: true });
    }
});

test('pre-commit batches every staged file below the launcher capacity while preserving default protection', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-hook-batching-'));
    const cleanEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
    );
    const git = (args: string[]) =>
        execFileSync('git', args, {
            cwd: folder,
            encoding: 'utf8',
            windowsHide: true,
            env: cleanEnvironment,
        });
    try {
        git(['init', '--quiet']);
        git(['config', 'core.autocrlf', 'false']);
        git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            'fixture',
        ]);
        const bin = path.join(folder, 'bin');
        await mkdir(bin);
        const cli = fileURLToPath(new URL('../node_modules/lint-staged/bin/lint-staged.js', import.meta.url));
        const pnpm = path.join(bin, 'pnpm');
        await writeFile(pnpm, '#!/bin/sh\nshift\nshift\nnode "$DCT_TEST_LINT_STAGED" "$@"\n');
        await chmod(pnpm, 0o755);
        const probe = path.join(folder, 'probe.ts');
        await writeFile(
            probe,
            `
            import { appendFileSync } from 'node:fs';
            const files = process.argv.slice(2);
            if (files.map(file => JSON.stringify(file)).join(' ').length > 6000) {
                throw new Error('launcher command capacity exceeded');
            }
            appendFileSync(process.env.DCT_TEST_BATCH_LOG, JSON.stringify(files) + '\\n');
        `,
        );
        await writeFile(
            path.join(folder, 'package.json'),
            JSON.stringify({
                type: 'module',
                'lint-staged': { '*.ts': 'node probe.ts' },
            }),
        );
        const files: string[] = [];
        for (let index = 0; index < 45; index++) {
            const file = `staged-${String(index).padStart(3, '0')}-${'x'.repeat(95)}.ts`;
            files.push(path.join(folder, file));
            await writeFile(path.join(folder, file), 'export {};\n');
        }
        git(['add', '--', ...files]);
        const partiallyStaged = files[0];
        assert.ok(partiallyStaged);
        await writeFile(partiallyStaged, 'export {};\n// preserve unstaged work\n');
        const shell =
            process.platform === 'win32'
                ? path.resolve(git(['--exec-path']).trim(), '../../..', 'usr/bin/sh.exe')
                : 'sh';
        const log = path.join(folder, 'batches.jsonl');
        const result = spawnSync(shell, ['-e', fileURLToPath(new URL('../.husky/pre-commit', import.meta.url))], {
            cwd: folder,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 60_000,
            env: {
                ...cleanEnvironment,
                PATH: bin + path.delimiter + (cleanEnvironment.PATH ?? cleanEnvironment.Path ?? ''),
                DCT_TEST_LINT_STAGED: cli,
                DCT_TEST_BATCH_LOG: log,
            },
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const batches: unknown[] = (await readFile(log, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        const checked: string[] = [];
        for (const batch of batches) {
            assert.ok(Array.isArray(batch) && batch.every((file) => typeof file === 'string'));
            checked.push(...batch.map((file) => path.resolve(file)));
        }
        assert.deepEqual(checked.sort(), files.sort());
        assert.equal(await readFile(partiallyStaged, 'utf8'), 'export {};\n// preserve unstaged work\n');
        assert.equal(git(['show', `:${path.basename(partiallyStaged)}`]), 'export {};\n');
        assert.equal(git(['diff', '--cached', '--name-only']).trim().split('\n').length, files.length);
    } finally {
        assert.ok(path.basename(folder).startsWith('dct-hook-batching-'));
        await rm(folder, { recursive: true, force: true });
    }
});

async function textHookFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-hook-text-'));
    const release: unknown = JSON.parse(
        await readFile(new URL('../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release));
    const prefix = 'plugins/codex/debugging-cdp-targets/dist/official-server';
    const contents = new Map([
        [
            'package.json',
            JSON.stringify({
                name: 'chrome-devtools-mcp',
                version: '1.10.1',
                type: 'module',
                bin: { 'chrome-devtools-mcp': './build/src/bin/chrome-devtools-mcp.js' },
            }),
        ],
        ['LICENSE', 'Original upstream license\n'],
        ['build/src/bin/chrome-devtools-mcp.js', 'export {};\n'],
        ['build/src/third_party/THIRD_PARTY_NOTICES', 'Original vendor notices\n'],
        ['build/src/third_party/bundled-packages.json', '{}\n'],
        ['skills/example/SKILL.md', '# Upstream skill\r\n\tOriginal upstream format\r\n'],
    ]);
    for (const [file, bytes] of contents) {
        await mkdir(path.dirname(path.join(root, prefix, file)), { recursive: true });
        await writeFile(path.join(root, prefix, file), bytes);
    }
    await mkdir(path.join(root, 'tooling'));
    await writeFile(
        path.join(root, 'tooling/official-server-release.json'),
        JSON.stringify({
            ...release,
            files: [...contents]
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([file, bytes]) => ({
                    path: file,
                    bytes: Buffer.byteLength(bytes),
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                })),
        }),
    );
    const run = (files: string[]) =>
        spawnSync(
            process.execPath,
            [fileURLToPath(new URL('../tooling/check-text-style.ts', import.meta.url)), ...files],
            { cwd: root, encoding: 'utf8', windowsHide: true },
        );
    return { root, prefix, run };
}

test('text hook preserves formatting only after verifying the complete original official release', async () => {
    const fixture = await textHookFixture();
    try {
        const result = fixture.run([`${fixture.prefix}/skills/example/SKILL.md`]);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const own = 'plugins/codex/debugging-cdp-targets/README.md';
        await writeFile(path.join(fixture.root, own), '# Maintained\n\tInvalid indentation\n');
        const rejected = fixture.run([own]);
        assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
        assert.match(rejected.stderr, /tabs are prohibited/);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('text hook rejects altered or incomplete official releases even when the selected file follows repository style', async () => {
    const fixture = await textHookFixture();
    try {
        const license = path.join(fixture.root, fixture.prefix, 'LICENSE');
        await writeFile(license, 'Changed upstream license\n');
        const changed = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(changed.status, 1, changed.stdout + changed.stderr);
        assert.match(changed.stderr, /official|digest|fingerprint|integrity/i);
        await writeFile(license, 'Original upstream license\n');
        await rm(path.join(fixture.root, fixture.prefix, 'build/src/bin/chrome-devtools-mcp.js'));
        const missing = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(missing.status, 1, missing.stdout + missing.stderr);
        assert.match(missing.stderr, /official|missing|inventory/i);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});
