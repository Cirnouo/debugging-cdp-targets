import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('package, output and repository fixtures work with an aliased system temporary directory', async () => {
    const temporaryBase = await realpath(os.tmpdir());
    const root = await mkdtemp(path.join(temporaryBase, 'dct-aliased-temp-'));
    try {
        const directory = path.join(root, 'real');
        const alias = path.join(root, 'alias');
        await mkdir(directory);
        await symlink(directory, alias, 'junction');
        const environment: NodeJS.ProcessEnv = { ...process.env, TEMP: alias, TMP: alias, TMPDIR: alias };
        delete environment.NODE_TEST_CONTEXT;
        const result = await promisify(execFile)(
            process.execPath,
            [
                '--test',
                '--test-reporter=spec',
                '--test-name-pattern=package verifier|installed pnpm|packaged resolver|build synchronization|assembly copies only approved icons|repository audit accepts the supported Node range and contributor entry point',
                ...[
                    'gateway/official/package-files',
                    'tooling/distribution/thin-plugin-payloads',
                    'icon-packaging',
                    'repository-audit',
                ].map((name) => fileURLToPath(new URL(`../../${name}.test.ts`, import.meta.url))),
            ],
            {
                env: environment,
                timeout: 30_000,
                windowsHide: true,
                shell: false,
            },
        );
        assert.match(result.stdout, /fail 0/);
        for (const title of [
            'package verifier preserves exact nested bytes and rejects changed, missing and extra content',
            'package verifier rejects internal links and a linked package root',
            'installed pnpm bin shims are excluded only by the explicit build-input boundary',
            'packaged resolver verifies every call and rejects missing or changed content before child spawn',
            'build synchronization preserves nested paths and check mode never changes stale, missing or extra outputs',
            'assembly copies only approved icons and rejects missing, unexpected and malformed PNG inputs',
            'repository audit accepts the supported Node range and contributor entry point',
        ])
            assert.equal(
                result.stdout.split('\n').filter((line) => line.startsWith(`✔ ${title} (`)).length,
                1,
                `${title}: ${result.stdout}`,
            );
        assert.ok(
            result.stdout.includes(
                'build synchronization preserves nested paths and check mode never changes stale, missing or extra outputs',
            ),
            result.stdout,
        );
    } finally {
        assert.equal(path.dirname(root), temporaryBase);
        assert.ok(path.basename(root).startsWith('dct-aliased-temp-'));
        await rm(root, { recursive: true, force: true });
    }
});
