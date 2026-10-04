import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
