import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { OFFICIAL_RELEASE } from '../../../tooling/official-release.ts';
import { checkSecurity } from '../../../tooling/security/check-security.ts';
import type { PnpmExecutor } from '../../../tooling/security/dependency-scan.ts';
import { INSTALL_POLICY } from '../../../tooling/security/installation-policy.ts';
import { audit, lockProject, now, upstreamLock } from '../../fixtures/security-audit.ts';

test('security fingerprints bind all official resource bytes, release evidence and the frozen snapshot', async () => {
    const root = await lockProject();
    try {
        const resources = [
            'plugins/codex/debugging-cdp-targets/dist/official-server/build/src/resource.txt',
            'plugins/claude-code/debugging-cdp-targets/dist/official-server/build/src/resource.txt',
        ];
        const marketplaces = ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json'];
        for (const [file, bytes] of [
            ...resources.map((file) => [file, 'resource']),
            ...marketplaces.map((file) => [file, '{}']),
            ['tooling/official-server-release.json', JSON.stringify(OFFICIAL_RELEASE)],
            ['tooling/security/upstream-pnpm-lock.yaml', upstreamLock],
        ]) {
            assert.ok(file && bytes);
            await mkdir(path.dirname(path.join(root, file)), { recursive: true });
            await writeFile(path.join(root, file), bytes);
        }
        const execute: PnpmExecutor = async (args) =>
            args[0] === 'config'
                ? {
                      exitCode: 0,
                      stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
                  }
                : args[0] === 'install'
                  ? { exitCode: 0, stdout: '' }
                  : args.includes('signatures')
                    ? { exitCode: 0, stdout: '{"audited":3,"verified":3,"missing":[],"invalid":[]}' }
                    : { exitCode: 1, stdout: JSON.stringify(audit('moderate')) };
        let changed = await checkSecurity(root, { phase: 'lockfile', execute, now });
        for (const resource of resources) {
            const before = changed;
            await writeFile(path.join(root, resource), 'changed resource');
            changed = await checkSecurity(root, { phase: 'lockfile', execute, now });
            assert.notEqual(
                before.scopes.repository.fingerprints.code,
                changed.scopes.repository.fingerprints.code,
                resource,
            );
        }
        for (const marketplace of marketplaces) {
            const before = changed;
            await writeFile(path.join(root, marketplace), '{"changed":true}');
            changed = await checkSecurity(root, { phase: 'lockfile', execute, now });
            assert.notEqual(
                before.scopes.repository.fingerprints.configuration,
                changed.scopes.repository.fingerprints.configuration,
                marketplace,
            );
        }
        await writeFile(
            path.join(root, 'tooling/official-server-release.json'),
            `${JSON.stringify(OFFICIAL_RELEASE)}\n`,
        );
        const evidence = await checkSecurity(root, { phase: 'lockfile', execute, now });
        assert.notEqual(
            changed.scopes.repository.fingerprints.configuration,
            evidence.scopes.repository.fingerprints.configuration,
        );
        await writeFile(path.join(root, 'tooling/security/upstream-pnpm-lock.yaml'), `${upstreamLock}\n`);
        const snapshot = await checkSecurity(root, { phase: 'lockfile', execute, now });
        assert.notEqual(
            evidence.scopes.repository.fingerprints.configuration,
            snapshot.scopes.repository.fingerprints.configuration,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('security code inventory fingerprints native JXA and C# names, lengths and contents without changing review exceptions', async () => {
    const root = await lockProject();
    const helpers = [
        'src/adapters/macos-deployment-authority.jxa',
        'src/adapters/macos-parent-identity.jxa',
        'src/adapters/windows-deployment-authority.cs',
        'src/adapters/windows-deployment-create.cs',
        'src/adapters/windows-native-process.cs',
    ];
    const execute: PnpmExecutor = async (args) =>
        args[0] === 'config'
            ? { exitCode: 0, stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }) }
            : args[0] === 'install'
              ? { exitCode: 0, stdout: '' }
              : args.includes('signatures')
                ? { exitCode: 0, stdout: '{"audited":3,"verified":3,"missing":[],"invalid":[]}' }
                : { exitCode: 1, stdout: JSON.stringify(audit('moderate')) };
    try {
        await mkdir(path.join(root, 'src/adapters'));
        for (const file of helpers) await writeFile(path.join(root, file), 'readonly helper A\n');
        const exceptionFile = path.join(root, 'docs/policies/security-exceptions.json');
        const exceptions = await readFile(exceptionFile);
        const fingerprint = async () =>
            (await checkSecurity(root, { phase: 'lockfile', execute, now })).scopes.repository.fingerprints;
        const before = await fingerprint();
        // Literal fixture inventory and byte counts independently bind the documented hash framing.
        const expected = createHash('sha256');
        for (const file of helpers) expected.update(`${file}\0${18}\0readonly helper A\n`);
        expected.update('src/evidence.ts\0' + '26\0export const safe = true;\n');
        assert.equal(before.code, expected.digest('hex'));
        for (const file of helpers) {
            const absolute = path.join(root, file);
            await writeFile(absolute, 'readonly helper B\n');
            const changed = await fingerprint();
            assert.notEqual(changed.code, before.code, `same-length content: ${file}`);
            assert.equal(changed.configuration, before.configuration);
            assert.equal(changed.dependencies, before.dependencies);
            await writeFile(absolute, 'readonly helper A\n\n');
            assert.notEqual((await fingerprint()).code, before.code, `byte length: ${file}`);
            await writeFile(absolute, 'readonly helper A\n');
            const renamed = path.join(path.dirname(absolute), `renamed-${path.basename(absolute)}`);
            await rename(absolute, renamed);
            assert.notEqual((await fingerprint()).code, before.code, `relative name: ${file}`);
            await rename(renamed, absolute);
            assert.equal((await fingerprint()).code, before.code);
        }
        assert.deepEqual(await readFile(exceptionFile), exceptions);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
