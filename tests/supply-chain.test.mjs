import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { checkSecurity } from '../tooling/check-security.mjs';
import {
    assessAudit,
    evaluateFindings,
    readLockInventory,
    validateExceptions,
    validateSignatures,
} from '../tooling/security/audit-policy.mjs';
import {
    fingerprintInputs,
    validateInstallPolicy,
    verifyInstalledTree,
} from '../tooling/security/security-evidence.mjs';
import { scanUpstream } from '../tooling/security/security-runner.mjs';

const lock = `---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm: {specifier: 12.4.2, version: 12.4.2}
packages:
  pnpm@12.4.2:
    resolution: {integrity: sha512-dG9vbA==}
snapshots:
  pnpm@12.4.2: {}
---
lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      ws: {specifier: 8.22.0, version: 8.22.0}
packages:
  ws@8.22.0:
    resolution: {integrity: sha512-d3M=}
  helper@1.0.0:
    resolution: {integrity: sha512-aGVscGVy}
snapshots:
  ws@8.22.0:
    optionalDependencies: {helper: 1.0.0}
  helper@1.0.0: {optional: true}
`;
const inventory = [
    { name: 'helper', version: '1.0.0', integrity: 'sha512-aGVscGVy' },
    { name: 'pnpm', version: '12.4.2', integrity: 'sha512-dG9vbA==' },
    { name: 'ws', version: '8.22.0', integrity: 'sha512-d3M=' },
];
const upstreamLock = lock
    .replaceAll('ws', 'chrome-devtools-mcp')
    .replaceAll('8.22.0', '1.9.0')
    .replace('devDependencies:', 'dependencies:');
const ghsa = 'GHSA-35jh-r3h4-6jhm';
const now = new Date('2026-09-30T00:00:00.000Z');
const fingerprints = { code: 'a'.repeat(64), configuration: 'b'.repeat(64), dependencies: 'c'.repeat(64) };
function audit(severity = 'high', version = '8.22.0') {
    return {
        advisories: {
            1: {
                findings: [{ version, paths: ['.>ws'], dev: true, optional: false, bundled: false }],
                id: 1,
                title: 'Controlled vulnerability',
                module_name: 'ws',
                vulnerable_versions: '<9',
                patched_versions: null,
                severity,
                github_advisory_id: ghsa,
                url: `https://github.com/advisories/${ghsa}`,
            },
        },
        metadata: {
            vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, [severity]: 1 },
            dependencies: 1,
            devDependencies: 1,
            optionalDependencies: 1,
            totalDependencies: 3,
        },
    };
}
function waiver() {
    return {
        ghsa,
        package: 'ws',
        version: '8.22.0',
        scope: 'repository',
        reason: 'The affected API is not used in the reviewed application.',
        triggerConditions: 'Untrusted data passed to the affected API.',
        evidence: ['src/adapters/cdp-router.mjs'],
        reviewedBy: 'Security reviewer',
        reviewedAt: '2026-09-29T00:00:00.000Z',
        expiresAt: '2026-10-10T00:00:00.000Z',
        fingerprints,
    };
}
function findings(severity = 'high') {
    return assessAudit({ stdout: JSON.stringify(audit(severity)), exitCode: 1 }, inventory);
}

test('lock inventory reads every YAML document including package-manager and optional dependencies', () => {
    assert.deepEqual(readLockInventory(lock).packages, inventory);
    for (const source of [
        '',
        '---\nimporters: {}\n',
        `${lock}\npackages: [`,
        lock.replace('ws@8.22.0:', 'ws@latest:'),
    ]) {
        assert.throws(() => readLockInventory(source));
    }
});

test('scoped and nested peer annotations do not corrupt the dependency identity', () => {
    const source = lock.replace(
        '  ws@8.22.0:\n    optionalDependencies:',
        '  ws@8.22.0(@types/node@24.13.0)(nested@1.0.0(other@2.0.0)):\n    optionalDependencies:',
    );
    assert.deepEqual(readLockInventory(source).packages, inventory);
});

test('audit blocks high and critical dependencies but retains lower-severity reports', () => {
    for (const severity of ['high', 'critical', 'moderate', 'low', 'info']) {
        const result = evaluateFindings(findings(severity), [], { repository: fingerprints });
        assert.equal(result.blocked.length, ['high', 'critical'].includes(severity) ? 1 : 0);
        assert.equal(result.reported.length, 1);
        assert.equal(result.reported[0].scope, 'repository');
    }
});

test('an audit with no advisories still must cover the entire lock inventory', () => {
    const report = audit();
    report.advisories = {};
    report.metadata.vulnerabilities.high = 0;
    assert.deepEqual(assessAudit({ stdout: JSON.stringify(report), exitCode: 0 }, inventory), []);
    report.metadata.totalDependencies = 0;
    assert.throws(() => assessAudit({ stdout: JSON.stringify(report), exitCode: 0 }, inventory), /inventory|coverage/i);
});

test('audit failures, unknown identities, severity mismatches and filtered reports fail closed', () => {
    for (const result of [
        { stdout: '{', exitCode: 1 },
        { stdout: JSON.stringify({ error: { code: 'ENETUNREACH' } }), exitCode: 1 },
        { stdout: JSON.stringify(audit()), exitCode: 2 },
        { stdout: JSON.stringify(audit('high', '8.21.0')), exitCode: 1 },
        { stdout: JSON.stringify({ ...audit(), advisories: {} }), exitCode: 1 },
        { stdout: JSON.stringify({ ...audit(), ignored: ['hidden'] }), exitCode: 1 },
    ])
        assert.throws(() => assessAudit(result, inventory));
    const report = audit();
    report.advisories[1].severity = 'unknown';
    assert.throws(() => assessAudit({ stdout: JSON.stringify(report), exitCode: 1 }, inventory));
});

test('signature checks reject zero coverage, missing or invalid signatures and command failures', () => {
    assert.doesNotThrow(() =>
        validateSignatures({ stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}', exitCode: 0 }, 3),
    );
    for (const report of [
        { audited: 0, verified: 0, invalid: [], missing: [] },
        { audited: 3, verified: 2, invalid: [], missing: ['ws'] },
        { audited: 3, verified: 2, invalid: ['ws'], missing: [] },
        { audited: 3, verified: 3 },
    ])
        assert.throws(() => validateSignatures({ stdout: JSON.stringify(report), exitCode: 0 }, 3));
    assert.throws(() => validateSignatures({ stdout: '{}', exitCode: 1 }, 3));
});

test('an exact reviewed waiver releases only its matching advisory, scope, version and evidence', () => {
    const exceptions = validateExceptions({ schemaVersion: 1, exceptions: [waiver()] }, now);
    const result = evaluateFindings(findings(), exceptions, { repository: fingerprints });
    assert.equal(result.blocked.length, 0);
    assert.equal(result.waived.length, 1);
    const other = [{ ...findings()[0], version: '8.21.0' }];
    assert.equal(evaluateFindings(other, exceptions, { repository: fingerprints }).blocked.length, 1);
    assert.equal(evaluateFindings(findings(), exceptions, { upstream: fingerprints }).blocked.length, 1);
    assert.throws(
        () => evaluateFindings(findings(), exceptions, { repository: { ...fingerprints, code: 'd'.repeat(64) } }),
        /fingerprint/i,
    );
});

test('waivers reject expired, future, wildcard, duplicated, incomplete or more-than-30-day reviews', () => {
    for (const replacement of [
        { expiresAt: '2026-09-30T00:00:00.000Z' },
        { reviewedAt: '2026-10-01T00:00:00.000Z' },
        { expiresAt: '2026-11-01T00:00:00.000Z' },
        { reviewedAt: '2026-02-30T00:00:00.000Z' },
        { version: '*' },
        { version: '^8.22.0' },
        { package: null },
        { evidence: [] },
        { reviewedBy: '' },
        { scope: 'all' },
        { fingerprints: { ...fingerprints, code: 'unknown' } },
    ])
        assert.throws(() =>
            validateExceptions({ schemaVersion: 1, exceptions: [{ ...waiver(), ...replacement }] }, now),
        );
    assert.throws(() => validateExceptions({ schemaVersion: 1, exceptions: [waiver(), waiver()] }, now));
});

test('upstream scanning is isolated, script-free, uses the shared exact version and never runs its bin', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dct-security-test-'));
    const calls = [];
    try {
        const result = await scanUpstream({
            temporaryRoot,
            async execute(args, options) {
                calls.push({ args, cwd: options.cwd });
                if (args[0] === 'install') {
                    const manifest = JSON.parse(await readFile(path.join(options.cwd, 'package.json'), 'utf8'));
                    assert.deepEqual(manifest.dependencies, { 'chrome-devtools-mcp': '1.9.0' });
                    const settings = parse(await readFile(path.join(options.cwd, 'pnpm-workspace.yaml'), 'utf8'));
                    assert.equal(settings.ignoreScripts, true);
                    assert.equal(args.includes('--ignore-scripts'), true);
                    assert.ok(args.some((arg) => arg.startsWith(`--store-dir=${options.cwd}`)));
                    assert.ok(options.env.NPM_CONFIG_USERCONFIG.startsWith(options.cwd));
                    assert.ok(options.env.XDG_CONFIG_HOME.startsWith(options.cwd));
                    await writeFile(path.join(options.cwd, 'pnpm-lock.yaml'), upstreamLock);
                    await mkdir(path.join(options.cwd, 'node_modules/.pnpm'), { recursive: true });
                    await writeFile(
                        path.join(options.cwd, 'node_modules/.pnpm/lock.yaml'),
                        upstreamLock.split('---')[2],
                    );
                    await writeFile(
                        path.join(options.cwd, 'node_modules/.modules.yaml'),
                        JSON.stringify({
                            included: { dependencies: true, devDependencies: true, optionalDependencies: true },
                        }),
                    );
                    return { stdout: '', exitCode: 0 };
                }
                if (args[0] === 'config')
                    return {
                        stdout: JSON.stringify(
                            parse(await readFile(path.join(options.cwd, 'pnpm-workspace.yaml'), 'utf8')),
                        ),
                        exitCode: 0,
                    };
                const report = audit('moderate', '1.9.0');
                report.advisories[1].module_name = 'chrome-devtools-mcp';
                return args.includes('signatures')
                    ? { stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}', exitCode: 0 }
                    : { stdout: JSON.stringify(report), exitCode: 1 };
            },
        });
        assert.equal(result.findings[0].severity, 'moderate');
        assert.equal(calls.length, 4);
        assert.equal(
            calls.every(({ args }) => !args.includes('--version') && !args.includes('exec')),
            true,
        );
        assert.equal(
            calls.every(({ cwd }) => cwd.startsWith(`${temporaryRoot}${path.sep}`)),
            true,
        );
        await assert.rejects(readFile(path.join(calls[0].cwd, 'package.json')), /ENOENT/);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test('installation policy has no cooldown exemptions, ignored advisories or trust bypass', () => {
    const safe = {
        minimumReleaseAge: 1440,
        minimumReleaseAgeStrict: true,
        minimumReleaseAgeIgnoreMissingTime: false,
        trustLockfile: false,
        trustPolicy: 'no-downgrade',
        blockExoticSubdeps: true,
        strictDepBuilds: true,
        allowBuilds: { 'esbuild@0.28.2': true },
    };
    assert.doesNotThrow(() => validateInstallPolicy(safe));
    for (const changed of [
        { minimumReleaseAge: 0 },
        { trustLockfile: true },
        { trustPolicy: 'off' },
        { minimumReleaseAgeExclude: ['skills@1.6.0'] },
        { auditConfig: { ignoreGhsas: [ghsa] } },
        { audit: { ignore: [ghsa] } },
        { audit: { level: 'high' } },
        { ignoreUnfixable: true },
        { optional: false },
        { ignoredOptionalDependencies: ['helper'] },
        { allowBuilds: { '*': true } },
        { onlyBuiltDependencies: ['anything'] },
    ]) {
        assert.throws(() => validateInstallPolicy({ ...safe, ...changed }));
    }
});

test('installed tree evidence includes development and optional dependencies, not just roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-inventory-'));
    try {
        await mkdir(path.join(root, 'node_modules/.pnpm'), { recursive: true });
        await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { ws: '8.22.0' } }));
        const modules = { included: { dependencies: true, devDependencies: true, optionalDependencies: true } };
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await writeFile(path.join(root, 'node_modules/.pnpm/lock.yaml'), lock.split('---')[2]);
        await verifyInstalledTree(root, readLockInventory(lock));
        modules.included.devDependencies = false;
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await assert.rejects(verifyInstalledTree(root, readLockInventory(lock)), /installed|included/i);
        modules.included.devDependencies = true;
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await writeFile(
            path.join(root, 'node_modules/.pnpm/lock.yaml'),
            lock.split('---')[2].replaceAll('8.22.0', '8.21.0'),
        );
        await assert.rejects(verifyInstalledTree(root, readLockInventory(lock)), /installed|graph/i);
        const before = await fingerprintInputs(
            root,
            ['package.json'],
            ['node_modules/.modules.yaml'],
            readLockInventory(lock),
        );
        await writeFile(path.join(root, 'package.json'), '{}');
        const after = await fingerprintInputs(
            root,
            ['package.json'],
            ['node_modules/.modules.yaml'],
            readLockInventory(lock),
        );
        assert.notEqual(before.code, after.code);
        assert.equal(before.dependencies, after.dependencies);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('failed isolated installs never proceed to audit and clean only their created workspace', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dct-security-test-'));
    await writeFile(path.join(temporaryRoot, 'sentinel'), 'keep');
    let calls = 0;
    try {
        await assert.rejects(
            scanUpstream({
                temporaryRoot,
                execute: async () => {
                    calls++;
                    return { stdout: '', exitCode: 1 };
                },
            }),
            /install/i,
        );
        assert.equal(calls, 1);
        assert.equal(await readFile(path.join(temporaryRoot, 'sentinel'), 'utf8'), 'keep');
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test('public gate reports both full trees and rejects evidence changing during a scan', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-gate-'));
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dct-upstream-'));
    let omitOptional = false;
    async function tree(directory, source) {
        await writeFile(path.join(directory, 'pnpm-lock.yaml'), source);
        await mkdir(path.join(directory, 'node_modules/.pnpm'), { recursive: true });
        await writeFile(path.join(directory, 'node_modules/.pnpm/lock.yaml'), source.split('---')[2]);
        await writeFile(
            path.join(directory, 'node_modules/.modules.yaml'),
            JSON.stringify({
                included: { dependencies: true, devDependencies: true, optionalDependencies: !omitOptional },
            }),
        );
    }
    try {
        execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
        await mkdir(path.join(root, 'docs/policies'), { recursive: true });
        await mkdir(path.join(root, 'src'), { recursive: true });
        await mkdir(path.join(root, 'plugins/fixture'), { recursive: true });
        await writeFile(path.join(root, 'plugins/fixture/mcp.json'), '{"env":{}}');
        await writeFile(path.join(root, 'src/evidence.mjs'), 'export const safe = true;\n');
        await writeFile(
            path.join(root, 'docs/policies/security-exceptions.json'),
            '{"schemaVersion":1,"exceptions":[]}',
        );
        await writeFile(path.join(root, 'package.json'), '{"devDependencies":{"ws":"8.22.0"}}');
        const { INSTALL_POLICY } = await import('../tooling/security/security-evidence.mjs');
        await writeFile(
            path.join(root, 'pnpm-workspace.yaml'),
            stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
        );
        await tree(root, lock);
        let mutate = false;
        async function execute(args, { cwd }) {
            if (args[0] === 'install') {
                await tree(cwd, upstreamLock);
                return { exitCode: 0, stdout: '' };
            }
            if (args[0] === 'config')
                return {
                    exitCode: 0,
                    stdout: JSON.stringify(parse(await readFile(path.join(cwd, 'pnpm-workspace.yaml'), 'utf8'))),
                };
            if (args.includes('signatures')) {
                if (mutate && cwd === root)
                    await writeFile(path.join(root, 'src/evidence.mjs'), 'export const safe = false;\n');
                return { exitCode: 0, stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}' };
            }
            const report = audit(cwd === root ? 'high' : 'moderate', cwd === root ? '8.22.0' : '1.9.0');
            if (cwd !== root) report.advisories[1].module_name = 'chrome-devtools-mcp';
            return { exitCode: 1, stdout: JSON.stringify(report) };
        }
        const result = await checkSecurity(root, { temporaryRoot, execute, now });
        assert.equal(result.ok, false);
        assert.equal(result.scopes.repository.blocked.length, 1);
        assert.equal(result.scopes.upstream.reported[0].severity, 'moderate');
        omitOptional = true;
        await assert.rejects(checkSecurity(root, { temporaryRoot, execute, now }), /excluded/i);
        omitOptional = false;
        const exceptionPath = path.join(root, 'docs/policies/security-exceptions.json');
        await writeFile(
            exceptionPath,
            JSON.stringify({
                schemaVersion: 1,
                exceptions: [
                    {
                        ...waiver(),
                        evidence: ['src/evidence.mjs'],
                        fingerprints: result.scopes.repository.fingerprints,
                    },
                ],
            }),
        );
        await writeFile(path.join(root, 'README.md'), 'Unhashed prose is not implementation evidence.\n');
        const approvedReview = JSON.parse(await readFile(exceptionPath, 'utf8'));
        approvedReview.exceptions[0].evidence = ['README.md'];
        await writeFile(exceptionPath, JSON.stringify(approvedReview));
        await assert.rejects(checkSecurity(root, { temporaryRoot, execute, now }), /fingerprinted evidence/i);
        approvedReview.exceptions[0].evidence = ['src/evidence.mjs'];
        await writeFile(exceptionPath, JSON.stringify(approvedReview));
        assert.equal((await checkSecurity(root, { temporaryRoot, execute, now })).ok, true);
        const beforeConfig = result.scopes.repository.fingerprints.configuration;
        await writeFile(path.join(root, 'plugins/fixture/mcp.json'), '{"env":{"changed":true}}');
        await assert.rejects(checkSecurity(root, { temporaryRoot, execute, now }), /fingerprint/i);
        await writeFile(exceptionPath, '{"schemaVersion":1,"exceptions":[]}');
        const afterConfig = await checkSecurity(root, { temporaryRoot, execute, now });
        assert.notEqual(beforeConfig, afterConfig.scopes.repository.fingerprints.configuration);
        mutate = true;
        await assert.rejects(checkSecurity(root, { temporaryRoot, execute, now }), /changed during/i);
    } finally {
        await rm(root, { recursive: true, force: true });
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});
