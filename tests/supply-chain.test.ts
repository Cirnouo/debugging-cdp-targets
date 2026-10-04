import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';
import { checkSecurity } from '../tooling/check-security.ts';
import { OFFICIAL_RELEASE } from '../tooling/payload-policy.ts';
import {
    assessAudit,
    evaluateFindings,
    readLockInventory,
    validateExceptions,
    validateSignatures,
} from '../tooling/security/audit-policy.ts';
import {
    fingerprintInputs,
    INSTALL_POLICY,
    validateInstallPolicy,
    verifyInstalledTree,
} from '../tooling/security/security-evidence.ts';
import type { PnpmExecutor } from '../tooling/security/security-runner.ts';
import { scanUpstream } from '../tooling/security/security-runner.ts';

type CommandCall = { args: string[]; cwd: string };
function required<T>(value: T | undefined): T {
    assert.notEqual(value, undefined);
    assert.ok(value !== undefined);
    return value;
}
type AuditFixture = {
    advisories: Record<
        number,
        {
            findings: { version: string; paths: string[]; dev: boolean; optional: boolean; bundled: boolean }[];
            id: number;
            title: string;
            module_name: string;
            vulnerable_versions: string;
            patched_versions: null;
            severity: string;
            github_advisory_id: string;
            url: string;
        }
    >;
    metadata: {
        vulnerabilities: Record<string, number>;
        dependencies: number;
        devDependencies: number;
        optionalDependencies: number;
        totalDependencies: number;
    };
};

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
    .replaceAll('8.22.0', '1.10.1')
    .replace('devDependencies:', 'dependencies:')
    .replace('sha512-d3M=', OFFICIAL_RELEASE.integrity);
const upstreamInputs = { release: OFFICIAL_RELEASE, snapshot: upstreamLock };
const releaseRootLock = lock
    .replace(
        'ws: {specifier: 8.22.0, version: 8.22.0}',
        'ws: {specifier: 8.22.0, version: 8.22.0}\n      chrome-devtools-mcp: {specifier: 1.10.1, version: 1.10.1}',
    )
    .replace(
        'packages:\n  ws@8.22.0:',
        `packages:\n  chrome-devtools-mcp@1.10.1:\n    resolution: {integrity: ${OFFICIAL_RELEASE.integrity}}\n  ws@8.22.0:`,
    )
    .replace('snapshots:\n  ws@8.22.0:', 'snapshots:\n  chrome-devtools-mcp@1.10.1: {}\n  ws@8.22.0:');
const ghsa = 'GHSA-35jh-r3h4-6jhm';
const now = new Date('2026-09-30T00:00:00.000Z');
const fingerprints = { code: 'a'.repeat(64), configuration: 'b'.repeat(64), dependencies: 'c'.repeat(64) };
function audit(severity = 'high', version = '8.22.0', count = 3): AuditFixture {
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
            devDependencies: count - 2,
            optionalDependencies: 1,
            totalDependencies: count,
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
        evidence: ['src/adapters/cdp-router.ts'],
        reviewedBy: 'Security reviewer',
        reviewedAt: '2026-09-29T00:00:00.000Z',
        expiresAt: '2026-10-10T00:00:00.000Z',
        fingerprints,
    };
}
function findings(severity = 'high') {
    return assessAudit({ stdout: JSON.stringify(audit(severity)), exitCode: 1 }, inventory);
}

async function lockProject() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-preflight-'));
    execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
    await mkdir(path.join(root, 'docs/policies'), { recursive: true });
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src/evidence.ts'), 'export const safe = true;\n');
    await writeFile(path.join(root, 'docs/policies/security-exceptions.json'), '{"schemaVersion":1,"exceptions":[]}');
    await writeFile(path.join(root, 'package.json'), '{"devDependencies":{"ws":"8.22.0"}}');
    await writeFile(path.join(root, 'pnpm-lock.yaml'), lock);
    await writeFile(
        path.join(root, 'pnpm-workspace.yaml'),
        stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
    );
    return root;
}

function isolatedExecutor(calls: CommandCall[], severity = 'high', failure?: string): PnpmExecutor {
    return async (args, { cwd }) => {
        calls.push({ args, cwd });
        if (args[0] === 'config')
            return { exitCode: 0, stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: {} }) };
        if (args[0] === 'install') {
            assert.equal(args.includes('--lockfile-only'), true, 'a blocked upstream tree must never be installed');
            await writeFile(path.join(cwd, 'pnpm-lock.yaml'), upstreamLock);
            return { exitCode: 0, stdout: '' };
        }
        if (failure === 'network') throw new Error('registry unreachable');
        if (failure === 'malformed') return { exitCode: 0, stdout: '{' };
        if (args.includes('signatures'))
            return {
                exitCode: failure === 'signature' ? 1 : 0,
                stdout: JSON.stringify({
                    audited: 3,
                    verified: failure === 'signature' ? 2 : 3,
                    missing: [],
                    invalid: [],
                }),
            };
        const report = audit(severity, '1.10.1');
        required(report.advisories[1]).module_name = 'chrome-devtools-mcp';
        if (failure === 'coverage') report.metadata.totalDependencies = 0;
        return { exitCode: 1, stdout: JSON.stringify(report) };
    };
}

test('lockfile preflight audits all dependencies without an installed tree or upstream resolution', async () => {
    const root = await lockProject();
    const calls: string[][] = [];
    try {
        const before = await readFile(path.join(root, 'pnpm-lock.yaml'));
        const result = await checkSecurity(root, {
            phase: 'lockfile',
            now,
            async execute(args, { cwd }) {
                assert.equal(cwd, root);
                assert.equal(args.includes('--ignore-pnpmfile'), true);
                assert.equal(args.includes('--config.configDependencies={}'), true);
                calls.push(args);
                if (args[0] === 'config')
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
                    };
                if (args[0] === 'install') {
                    assert.equal(args.includes('--lockfile-only'), true);
                    assert.equal(args.includes('--frozen-lockfile'), true);
                    assert.equal(args.includes('--ignore-scripts'), true);
                    return { exitCode: 0, stdout: '' };
                }
                if (args.includes('signatures'))
                    return { exitCode: 0, stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}' };
                return { exitCode: 1, stdout: JSON.stringify(audit('moderate')) };
            },
        });
        assert.equal(result.ok, true);
        assert.deepEqual(Object.keys(result.scopes), ['repository']);
        assert.deepEqual(
            calls.map((args) => args[0]),
            ['config', 'install', 'audit', 'audit'],
        );
        assert.equal(result.scopes.repository.reported[0]?.severity, 'moderate');
        assert.deepEqual(before, await readFile(path.join(root, 'pnpm-lock.yaml')));
        await assert.rejects(access(path.join(root, 'node_modules')), /ENOENT/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('preflight rejects manifest mismatches before executing pnpm', async () => {
    const root = await lockProject();
    let calls = 0;
    try {
        await writeFile(path.join(root, 'package.json'), '{"devDependencies":{"ws":"8.21.0"}}');
        await assert.rejects(
            checkSecurity(root, {
                phase: 'lockfile',
                execute: async () => {
                    calls++;
                    throw new Error('must not execute');
                },
            }),
            /importer|declaration|manifest/i,
        );
        assert.equal(calls, 0);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('preflight rejects executable configuration dependencies before any pnpm command', async () => {
    for (const location of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
        const root = await lockProject();
        let calls = 0;
        try {
            if (location === 'pnpm-lock.yaml') {
                await writeFile(
                    path.join(root, location),
                    lock.replace(
                        'packageManagerDependencies:',
                        'configDependencies: {plugin: 1.0.0}\n    packageManagerDependencies:',
                    ),
                );
            } else {
                await writeFile(
                    path.join(root, location),
                    stringify({ ...INSTALL_POLICY, configDependencies: { plugin: '1.0.0' } }),
                );
            }
            await assert.rejects(
                checkSecurity(root, {
                    phase: 'lockfile',
                    execute: async () => {
                        calls++;
                        throw new Error('must not execute');
                    },
                }),
                /configuration dependencies/i,
            );
            assert.equal(calls, 0);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
});

test('lock-only validation cannot create an installation tree or mutate locked inputs', async () => {
    for (const change of ['node_modules', 'pnpm-lock.yaml', 'package.json']) {
        const root = await lockProject();
        try {
            await assert.rejects(
                checkSecurity(root, {
                    phase: 'lockfile',
                    async execute(args) {
                        if (args[0] === 'config')
                            return {
                                exitCode: 0,
                                stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
                            };
                        assert.equal(args[0], 'install');
                        if (change === 'node_modules') await mkdir(path.join(root, change));
                        else await writeFile(path.join(root, change), '{}');
                        return { exitCode: 0, stdout: '' };
                    },
                }),
                /changed|created|installation/i,
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
});

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

test('upstream high findings are blocked before installation, including without a review callback', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dct-blocked-upstream-'));
    const calls: CommandCall[] = [];
    try {
        const result = await scanUpstream({ temporaryRoot, inputs: upstreamInputs, execute: isolatedExecutor(calls) });
        assert.equal(result.findings[0]?.severity, 'high');
        assert.equal(result.installed, false);
        assert.equal(calls.filter(({ args }) => args[0] === 'install').length, 1);
        await assert.rejects(access(required(calls[0]).cwd), /ENOENT/);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test('upstream signature, network, malformed and incomplete audits never proceed to installation', async () => {
    for (const failure of ['signature', 'network', 'malformed', 'coverage']) {
        const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dct-failed-upstream-'));
        const calls: CommandCall[] = [];
        try {
            await assert.rejects(
                scanUpstream({
                    temporaryRoot,
                    inputs: upstreamInputs,
                    execute: isolatedExecutor(calls, 'moderate', failure),
                }),
            );
            assert.equal(calls.filter(({ args }) => args[0] === 'install').length, 1);
            assert.equal(
                calls.some(({ args }) => args[0] === 'audit'),
                true,
            );
            await assert.rejects(access(required(calls[0]).cwd), /ENOENT/);
        } finally {
            await rm(temporaryRoot, { recursive: true, force: true });
        }
    }
});

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
        assert.equal(result.reported[0]?.scope, 'repository');
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
    required(report.advisories[1]).severity = 'unknown';
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
    const first = findings()[0];
    assert.ok(first);
    const other = [{ ...first, version: '8.21.0' }];
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

test('upstream reviews the isolated lock before installation and never runs its bin', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dct-security-test-'));
    const calls: CommandCall[] = [];
    let reviewed = false;
    try {
        const result = await scanUpstream({
            temporaryRoot,
            inputs: upstreamInputs,
            async review(result) {
                await assert.rejects(access(path.join(required(calls[0]).cwd, 'node_modules')), /ENOENT/);
                assert.equal(result.findings[0]?.severity, 'moderate');
                reviewed = true;
                return { blocked: [] };
            },
            async execute(args, options) {
                assert.equal(args.includes('--ignore-pnpmfile'), true);
                assert.equal(args.includes('--config.configDependencies={}'), true);
                calls.push({ args, cwd: options.cwd });
                if (args[0] === 'install') {
                    const manifest: unknown = JSON.parse(
                        await readFile(path.join(options.cwd, 'package.json'), 'utf8'),
                    );
                    assert.ok(isRecord(manifest));
                    assert.deepEqual(manifest.dependencies, { 'chrome-devtools-mcp': '1.10.1' });
                    const settings: unknown = parse(
                        await readFile(path.join(options.cwd, 'pnpm-workspace.yaml'), 'utf8'),
                    );
                    assert.ok(isRecord(settings));
                    assert.equal(settings.ignoreScripts, true);
                    assert.equal(args.includes('--ignore-scripts'), true);
                    assert.ok(args.some((arg) => arg.startsWith(`--store-dir=${options.cwd}`)));
                    assert.ok(options.env.NPM_CONFIG_USERCONFIG?.startsWith(options.cwd));
                    assert.ok(options.env.XDG_CONFIG_HOME?.startsWith(options.cwd));
                    if (args.includes('--lockfile-only')) {
                        assert.equal(await readFile(path.join(options.cwd, 'pnpm-lock.yaml'), 'utf8'), upstreamLock);
                        assert.equal(args.includes('--frozen-lockfile'), true);
                        return { stdout: '', exitCode: 0 };
                    }
                    assert.equal(reviewed, true, 'upstream approval must precede installation');
                    assert.equal(args.includes('--frozen-lockfile'), true);
                    await mkdir(path.join(options.cwd, 'node_modules/.pnpm'), { recursive: true });
                    await writeFile(
                        path.join(options.cwd, 'node_modules/.pnpm/lock.yaml'),
                        required(upstreamLock.split('---')[2]),
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
                const report = audit('moderate', '1.10.1');
                required(report.advisories[1]).module_name = 'chrome-devtools-mcp';
                return args.includes('signatures')
                    ? { stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}', exitCode: 0 }
                    : { stdout: JSON.stringify(report), exitCode: 1 };
            },
        });
        assert.equal(result.findings[0]?.severity, 'moderate');
        assert.deepEqual(
            calls.map(({ args }) => args[0]),
            ['config', 'install', 'audit', 'audit', 'install'],
        );
        assert.equal(
            calls.every(({ args }) => !args.includes('--version') && !args.includes('exec')),
            true,
        );
        assert.equal(
            calls.every(({ cwd }) => cwd.startsWith(`${temporaryRoot}${path.sep}`)),
            true,
        );
        await assert.rejects(readFile(path.join(required(calls[0]).cwd, 'package.json')), /ENOENT/);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test('frozen upstream validation rejects identity drift and lock mutation before any audit', async () => {
    let audits = 0;
    const execute: PnpmExecutor = async (args, { cwd }) => {
        if (args[0] === 'config')
            return { exitCode: 0, stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: {} }) };
        if (args[0] === 'audit') audits++;
        if (args[0] === 'install') {
            assert.equal(args.includes('--frozen-lockfile'), true);
            await writeFile(path.join(cwd, 'pnpm-lock.yaml'), `${upstreamLock}\n`);
        }
        return { exitCode: 0, stdout: '' };
    };
    await assert.rejects(
        scanUpstream({ inputs: { ...upstreamInputs, snapshot: upstreamLock.replaceAll('1.10.1', '1.10.0') }, execute }),
        /identity|version/i,
    );
    await assert.rejects(scanUpstream({ inputs: upstreamInputs, execute }), /changed/i);
    assert.equal(audits, 0);
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
        { configDependencies: { plugin: '1.0.0' } },
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
        await writeFile(path.join(root, 'node_modules/.pnpm/lock.yaml'), required(lock.split('---')[2]));
        await verifyInstalledTree(root, readLockInventory(lock));
        modules.included.devDependencies = false;
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await assert.rejects(verifyInstalledTree(root, readLockInventory(lock)), /installed|included/i);
        modules.included.devDependencies = true;
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await writeFile(
            path.join(root, 'node_modules/.pnpm/lock.yaml'),
            required(lock.split('---')[2]).replaceAll('8.22.0', '8.21.0'),
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

test('failed isolated lock resolution never proceeds to audit and cleans only its created workspace', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dct-security-test-'));
    await writeFile(path.join(temporaryRoot, 'sentinel'), 'keep');
    let calls = 0;
    try {
        await assert.rejects(
            scanUpstream({
                temporaryRoot,
                inputs: upstreamInputs,
                execute: async () => {
                    calls++;
                    return { stdout: '', exitCode: 1 };
                },
            }),
            /configuration|resolution/i,
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
    let upstreamSeverity = 'moderate';
    let upstreamInstalls = 0;
    async function tree(directory: string, source: string) {
        await writeFile(path.join(directory, 'pnpm-lock.yaml'), source);
        await mkdir(path.join(directory, 'node_modules/.pnpm'), { recursive: true });
        await writeFile(path.join(directory, 'node_modules/.pnpm/lock.yaml'), required(source.split('---')[2]));
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
        await mkdir(path.join(root, 'tooling'), { recursive: true });
        const vendorEvidence = path.join(root, 'tooling/vendored-licenses.json');
        await mkdir(path.join(root, 'tooling/security'), { recursive: true });
        await writeFile(path.join(root, 'tooling/official-server-release.json'), JSON.stringify(OFFICIAL_RELEASE));
        await writeFile(path.join(root, 'tooling/security/upstream-pnpm-lock.yaml'), upstreamLock);
        await writeFile(vendorEvidence, '{"schemaVersion":1,"packages":[]}');
        await writeFile(path.join(root, 'plugins/fixture/mcp.json'), '{"env":{}}');
        await writeFile(path.join(root, 'src/evidence.ts'), 'export const safe = true;\n');
        await writeFile(
            path.join(root, 'docs/policies/security-exceptions.json'),
            '{"schemaVersion":1,"exceptions":[]}',
        );
        await writeFile(
            path.join(root, 'package.json'),
            '{"devDependencies":{"ws":"8.22.0","chrome-devtools-mcp":"1.10.1"}}',
        );
        const { INSTALL_POLICY } = await import('../tooling/security/security-evidence.ts');
        await writeFile(
            path.join(root, 'pnpm-workspace.yaml'),
            stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
        );
        await tree(root, releaseRootLock);
        let mutate = false;
        const execute: PnpmExecutor = async (args, { cwd }) => {
            if (args[0] === 'install') {
                if (args.includes('--lockfile-only'))
                    assert.equal(await readFile(path.join(cwd, 'pnpm-lock.yaml'), 'utf8'), upstreamLock);
                else {
                    upstreamInstalls++;
                    await tree(cwd, upstreamLock);
                }
                return { exitCode: 0, stdout: '' };
            }
            if (args[0] === 'config')
                return {
                    exitCode: 0,
                    stdout: JSON.stringify(parse(await readFile(path.join(cwd, 'pnpm-workspace.yaml'), 'utf8'))),
                };
            if (args.includes('signatures')) {
                if (mutate && cwd === root)
                    await writeFile(path.join(root, 'src/evidence.ts'), 'export const safe = false;\n');
                const count = cwd === root ? 4 : 3;
                return {
                    exitCode: 0,
                    stdout: JSON.stringify({ audited: count, verified: count, invalid: [], missing: [] }),
                };
            }
            const report = audit(
                cwd === root ? 'high' : upstreamSeverity,
                cwd === root ? '8.22.0' : '1.10.1',
                cwd === root ? 4 : 3,
            );
            if (cwd !== root) required(report.advisories[1]).module_name = 'chrome-devtools-mcp';
            return { exitCode: 1, stdout: JSON.stringify(report) };
        };
        const result = await checkSecurity(root, { temporaryRoot, execute, now });
        assert.equal(result.ok, false);
        assert.equal(result.scopes.repository.blocked.length, 1);
        assert.equal(result.scopes.upstream?.reported[0]?.severity, 'moderate');
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
                        evidence: ['src/evidence.ts'],
                        fingerprints: result.scopes.repository.fingerprints,
                    },
                ],
            }),
        );
        await writeFile(path.join(root, 'README.md'), 'Unhashed prose is not implementation evidence.\n');
        const reviewInput: unknown = JSON.parse(await readFile(exceptionPath, 'utf8'));
        const approvedReview = { schemaVersion: 1, exceptions: validateExceptions(reviewInput, now) };
        const firstReview = approvedReview.exceptions[0];
        assert.ok(firstReview);
        firstReview.evidence = ['README.md'];
        await writeFile(exceptionPath, JSON.stringify(approvedReview));
        await assert.rejects(checkSecurity(root, { temporaryRoot, execute, now }), /fingerprinted evidence/i);
        firstReview.evidence = ['src/evidence.ts'];
        await writeFile(exceptionPath, JSON.stringify(approvedReview));
        assert.equal((await checkSecurity(root, { temporaryRoot, execute, now })).ok, true);
        upstreamSeverity = 'high';
        const installedCount = upstreamInstalls;
        const blockedUpstream = await checkSecurity(root, { temporaryRoot, execute, now });
        assert.equal(blockedUpstream.scopes.upstream?.blocked.length, 1);
        assert.equal(upstreamInstalls, installedCount, 'high finding must block before upstream installation');
        assert.ok(blockedUpstream.scopes.upstream);
        approvedReview.exceptions.push({
            ...waiver(),
            package: 'chrome-devtools-mcp',
            version: '1.10.1',
            scope: 'upstream',
            evidence: ['src/evidence.ts'],
            fingerprints: blockedUpstream.scopes.upstream.fingerprints,
        });
        await writeFile(exceptionPath, JSON.stringify(approvedReview));
        const releasedUpstream = await checkSecurity(root, { temporaryRoot, execute, now });
        assert.equal(releasedUpstream.ok, true);
        assert.equal(releasedUpstream.scopes.upstream?.waived.length, 1);
        assert.equal(upstreamInstalls, installedCount + 1);
        upstreamSeverity = 'moderate';
        const beforeConfig = result.scopes.repository.fingerprints.configuration;
        await writeFile(path.join(root, 'plugins/fixture/mcp.json'), '{"env":{"changed":true}}');
        await assert.rejects(checkSecurity(root, { temporaryRoot, execute, now }), /fingerprint/i);
        await writeFile(exceptionPath, '{"schemaVersion":1,"exceptions":[]}');
        const afterConfig = await checkSecurity(root, { temporaryRoot, execute, now });
        assert.notEqual(beforeConfig, afterConfig.scopes.repository.fingerprints.configuration);
        await writeFile(vendorEvidence, '{"schemaVersion":1,"packages":["changed"]}');
        const afterVendorConfig = await checkSecurity(root, { temporaryRoot, execute, now });
        assert.notEqual(
            afterConfig.scopes.repository.fingerprints.configuration,
            afterVendorConfig.scopes.repository.fingerprints.configuration,
        );
        mutate = true;
        await assert.rejects(checkSecurity(root, { temporaryRoot, execute, now }), /changed during/i);
    } finally {
        await rm(root, { recursive: true, force: true });
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});
