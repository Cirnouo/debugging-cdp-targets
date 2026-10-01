import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = path.join(root, 'tooling/security/dist/check-security.mjs');

test('committed security checker includes its parser and fails closed without node_modules', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-bundle-'));
    try {
        await assert.doesNotReject(readFile(bundle), 'commit a standalone security entry before installation');
        await copyFile(bundle, path.join(directory, 'check-security.mjs'));
        execFileSync('git', ['init', '--quiet', directory], { windowsHide: true });
        await mkdir(path.join(directory, 'docs/policies'), { recursive: true });
        await writeFile(path.join(directory, 'package.json'), '{}');
        await writeFile(path.join(directory, 'pnpm-lock.yaml'), 'invalid: [');
        await writeFile(
            path.join(directory, 'docs/policies/security-exceptions.json'),
            '{"schemaVersion":1,"exceptions":[]}',
        );
        let failure;
        try {
            execFileSync(process.execPath, ['check-security.mjs', '--phase', 'lockfile', '--root', directory], {
                cwd: directory,
                windowsHide: true,
                encoding: 'utf8',
                stdio: 'pipe',
            });
        } catch (error) {
            failure = error;
        }
        assert.equal(failure?.status, 1);
        const result = JSON.parse(failure.stderr);
        assert.equal(result.ok, false);
        assert.match(result.error, /Malformed lockfile YAML/);
        assert.doesNotMatch(result.error, /module|package.*not found/i);
        for (const args of [
            [],
            ['--phase', 'lockfile'],
            ['--phase', 'unknown'],
            ['--phase', 'lockfile', '--phase', 'complete'],
            ['--root'],
            ['--unexpected', 'value'],
        ]) {
            let error;
            try {
                execFileSync(process.execPath, ['check-security.mjs', ...args], {
                    cwd: directory,
                    windowsHide: true,
                    encoding: 'utf8',
                    stdio: 'pipe',
                });
            } catch (failure) {
                error = failure;
            }
            assert.equal(error?.status, 1);
            assert.match(JSON.parse(error.stderr).error, /Unknown security phase|Usage:/);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('security build comparison rejects drift without repairing it', async () => {
    const { generateSecurityFiles, verifySecurityFiles } = await import('../tooling/build-security.mjs');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-security-build-'));
    try {
        const files = await generateSecurityFiles();
        assert.deepEqual([...files.keys()].sort(), ['THIRD-PARTY-NOTICES.txt', 'check-security.mjs']);
        const license = files.get('THIRD-PARTY-NOTICES.txt').toString();
        assert.equal(license, await readFile(path.join(root, 'node_modules/yaml/LICENSE'), 'utf8'));
        for (const [file, contents] of files) await writeFile(path.join(directory, file), contents);
        await verifySecurityFiles(directory, files);
        await writeFile(path.join(directory, 'check-security.mjs'), 'throw new Error("drift");\n');
        await assert.rejects(verifySecurityFiles(directory, files), /Stale security build/);
        assert.equal(await readFile(path.join(directory, 'check-security.mjs'), 'utf8'), 'throw new Error("drift");\n');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
