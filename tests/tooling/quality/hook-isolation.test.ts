import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../../src/shared/errors.ts';

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
        const result = spawnSync(shell, ['-e', fileURLToPath(new URL('../../../.husky/pre-push', import.meta.url))], {
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
    const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-hook-batching-')));
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
        const cli = fileURLToPath(new URL('../../../node_modules/lint-staged/bin/lint-staged.js', import.meta.url));
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
        const result = spawnSync(shell, ['-e', fileURLToPath(new URL('../../../.husky/pre-commit', import.meta.url))], {
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

test('lint-staged routes YAML filename variants through the actual text checker', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-hook-yaml-')));
    const cleanEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
    );
    const git = (arguments_: string[]) =>
        execFileSync('git', arguments_, { cwd: root, env: cleanEnvironment, encoding: 'utf8', windowsHide: true });
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
        const packageData: unknown = JSON.parse(
            await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
        );
        assert.ok(isRecord(packageData) && isRecord(packageData['lint-staged']));
        await writeFile(
            path.join(root, 'package.json'),
            JSON.stringify({ type: 'module', 'lint-staged': packageData['lint-staged'] }),
        );
        await mkdir(path.join(root, 'tooling/quality'), { recursive: true });
        const checker = new URL('../../../tooling/quality/check-staged-text.ts', import.meta.url).href;
        await writeFile(
            path.join(root, 'tooling/quality/check-staged-text.ts'),
            `import { checkTextStyle } from ${JSON.stringify(checker)};\nconst errors = await checkTextStyle(process.cwd(), process.argv.slice(2));\nif (errors.length) { console.error(errors.join('\\n')); process.exitCode = 1; }\n`,
        );
        const files = ['valid.yaml', 'legacy.yml', 'upper.YAML', 'mixed.YaMl', 'short.YML'];
        for (const file of files) await writeFile(path.join(root, file), 'enabled: true\n');
        git(['add', '--', ...files]);
        const result = spawnSync(
            process.execPath,
            [fileURLToPath(new URL('../../../node_modules/lint-staged/bin/lint-staged.js', import.meta.url))],
            { cwd: root, env: cleanEnvironment, encoding: 'utf8', windowsHide: true, timeout: 60_000 },
        );
        const output = result.stdout + result.stderr;
        assert.equal(result.status, 1, output);
        for (const file of files.slice(1)) assert.ok(output.includes(`${file}:`), output);
        assert.ok(!output.includes('valid.yaml:'), output);
    } finally {
        assert.equal(path.dirname(root), await realpath(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('dct-hook-yaml-'));
        await rm(root, { recursive: true, force: true });
    }
});

async function retiredThinRuntimeFixture(host = 'codex') {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-hook-text-')));
    const release: unknown = JSON.parse(
        await readFile(new URL('../../../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release));
    const prefix = `plugins/${host}/debugging-cdp-targets/dist/official-server`;
    const contents = new Map([
        [
            'package.json',
            JSON.stringify({
                name: 'chrome-devtools-mcp',
                version: '1.11.0',
                type: 'module',
                bin: { 'chrome-devtools-mcp': './build/src/bin/chrome-devtools-mcp.js' },
            }),
        ],
        ['LICENSE', 'Original upstream license\n'],
        ['build/src/bin/chrome-devtools-mcp.js', 'export {};\n'],
        ['build/src/third_party/THIRD_PARTY_NOTICES', 'Original vendor notices\n'],
        ['build/src/third_party/bundled-packages.json', '{}\n'],
        ['skills/example/SKILL.md', '# Upstream skill\r\n\tOriginal upstream format\r\n'],
        ['skills/example/upstream.yml', '# Original upstream\r\n\tUnchanged upstream bytes\r\n'],
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
            [fileURLToPath(new URL('../../../tooling/quality/check-staged-text.ts', import.meta.url)), ...files],
            { cwd: root, encoding: 'utf8', windowsHide: true },
        );
    return { root, prefix, run };
}

test('retired thin runtime paths reject even matching upstream YAML bytes for both hosts', async () => {
    for (const host of ['codex', 'claude-code']) {
        const fixture = await retiredThinRuntimeFixture(host);
        try {
            const selected = `${fixture.prefix}/skills/example/upstream.yml`;
            const original = fixture.run([selected]);
            assert.equal(original.status, 1, original.stdout + original.stderr);
            assert.ok(original.stderr.includes(`${selected}: retired thin runtime path`), original.stderr);
            const license = path.join(fixture.root, fixture.prefix, 'LICENSE');
            await writeFile(license, 'Changed upstream license\n');
            const changed = fixture.run([selected]);
            assert.equal(changed.status, 1, changed.stdout + changed.stderr);
            assert.ok(changed.stderr.includes(`${selected}: retired thin runtime path`), changed.stderr);
            await writeFile(license, 'Original upstream license\n');
            const bin = path.join(fixture.root, fixture.prefix, 'build/src/bin/chrome-devtools-mcp.js');
            await rm(bin);
            const missing = fixture.run([selected]);
            assert.equal(missing.status, 1, missing.stdout + missing.stderr);
            assert.ok(missing.stderr.includes(`${selected}: retired thin runtime path`), missing.stderr);
            await writeFile(bin, 'export {};\n');
            await writeFile(path.join(fixture.root, fixture.prefix, 'extra.yml'), 'enabled: true\n');
            const extra = fixture.run([selected]);
            assert.equal(extra.status, 1, extra.stdout + extra.stderr);
            assert.ok(extra.stderr.includes(`${selected}: retired thin runtime path`), extra.stderr);
        } finally {
            assert.equal(path.dirname(fixture.root), await realpath(os.tmpdir()));
            assert.ok(path.basename(fixture.root).startsWith('dct-hook-text-'));
            await rm(fixture.root, { recursive: true, force: true });
        }
    }
});

test('text hook refuses retired upstream Skill formatting and still checks maintained text', async () => {
    const fixture = await retiredThinRuntimeFixture();
    try {
        const result = fixture.run([`${fixture.prefix}/skills/example/SKILL.md`]);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(
            result.stderr.includes(`${fixture.prefix}/skills/example/SKILL.md: retired thin runtime path`),
            result.stderr,
        );
        const own = 'plugins/codex/debugging-cdp-targets/README.md';
        await writeFile(path.join(fixture.root, own), '# Maintained\n\tInvalid indentation\n');
        const rejected = fixture.run([own]);
        assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
        assert.match(rejected.stderr, /tabs are prohibited/);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('Codex retired runtime refusal precedes changed missing or absent release evidence', async () => {
    const fixture = await retiredThinRuntimeFixture();
    try {
        const license = path.join(fixture.root, fixture.prefix, 'LICENSE');
        await writeFile(license, 'Changed upstream license\n');
        const changed = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(changed.status, 1, changed.stdout + changed.stderr);
        assert.ok(changed.stderr.includes(`${fixture.prefix}/LICENSE: retired thin runtime path`), changed.stderr);
        await writeFile(license, 'Original upstream license\n');
        await rm(path.join(fixture.root, fixture.prefix, 'build/src/bin/chrome-devtools-mcp.js'));
        const missing = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(missing.status, 1, missing.stdout + missing.stderr);
        assert.ok(missing.stderr.includes(`${fixture.prefix}/LICENSE: retired thin runtime path`), missing.stderr);
        const evidence = path.join(fixture.root, 'tooling/official-server-release.json');
        await rm(evidence);
        const absent = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(absent.status, 1, absent.stdout + absent.stderr);
        assert.ok(absent.stderr.includes(`${fixture.prefix}/LICENSE: retired thin runtime path`), absent.stderr);
        await writeFile(evidence, '{malformed');
        const malformed = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(malformed.status, 1, malformed.stdout + malformed.stderr);
        assert.ok(malformed.stderr.includes(`${fixture.prefix}/LICENSE: retired thin runtime path`), malformed.stderr);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test('Claude retired runtime refusal precedes changed missing or malformed release evidence', async () => {
    const fixture = await retiredThinRuntimeFixture('claude-code');
    try {
        const original = fixture.run([`${fixture.prefix}/skills/example/SKILL.md`]);
        assert.equal(original.status, 1, original.stdout + original.stderr);
        assert.ok(
            original.stderr.includes(`${fixture.prefix}/skills/example/SKILL.md: retired thin runtime path`),
            original.stderr,
        );
        const license = path.join(fixture.root, fixture.prefix, 'LICENSE');
        await writeFile(license, 'Changed upstream license\n');
        const changed = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(changed.status, 1, changed.stdout + changed.stderr);
        assert.ok(changed.stderr.includes(`${fixture.prefix}/LICENSE: retired thin runtime path`), changed.stderr);
        await writeFile(license, 'Original upstream license\n');
        await rm(path.join(fixture.root, fixture.prefix, 'build/src/bin/chrome-devtools-mcp.js'));
        const missing = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(missing.status, 1, missing.stdout + missing.stderr);
        assert.ok(missing.stderr.includes(`${fixture.prefix}/LICENSE: retired thin runtime path`), missing.stderr);
        const evidence = path.join(fixture.root, 'tooling/official-server-release.json');
        await rm(evidence);
        const absent = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(absent.status, 1, absent.stdout + absent.stderr);
        assert.ok(absent.stderr.includes(`${fixture.prefix}/LICENSE: retired thin runtime path`), absent.stderr);
        await writeFile(evidence, '{malformed');
        const malformed = fixture.run([`${fixture.prefix}/LICENSE`]);
        assert.equal(malformed.status, 1, malformed.stdout + malformed.stderr);
        assert.ok(malformed.stderr.includes(`${fixture.prefix}/LICENSE: retired thin runtime path`), malformed.stderr);
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});
