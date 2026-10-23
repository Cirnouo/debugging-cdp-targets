import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { OFFICIAL_RELEASE } from '../../tooling/official-release.ts';
import type { PnpmExecutor } from '../../tooling/security/dependency-scan.ts';
import { INSTALL_POLICY } from '../../tooling/security/installation-policy.ts';
import { assessAudit } from '../../tooling/security/registry-reports.ts';

export type CommandCall = { args: string[]; cwd: string };
export function required<T>(value: T | undefined): T {
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

export const lock = `---
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
export const inventory = [
    { name: 'helper', version: '1.0.0', integrity: 'sha512-aGVscGVy' },
    { name: 'pnpm', version: '12.4.2', integrity: 'sha512-dG9vbA==' },
    { name: 'ws', version: '8.22.0', integrity: 'sha512-d3M=' },
];
export const upstreamLock = lock
    .replaceAll('ws', 'chrome-devtools-mcp')
    .replaceAll('8.22.0', '1.11.0')
    .replace('devDependencies:', 'dependencies:')
    .replace('sha512-d3M=', OFFICIAL_RELEASE.integrity);
export const upstreamInputs = { release: OFFICIAL_RELEASE, snapshot: upstreamLock };
export const releaseRootLock = lock
    .replace(
        'ws: {specifier: 8.22.0, version: 8.22.0}',
        'ws: {specifier: 8.22.0, version: 8.22.0}\n      chrome-devtools-mcp: {specifier: 1.11.0, version: 1.11.0}',
    )
    .replace(
        'packages:\n  ws@8.22.0:',
        `packages:\n  chrome-devtools-mcp@1.11.0:\n    resolution: {integrity: ${OFFICIAL_RELEASE.integrity}}\n  ws@8.22.0:`,
    )
    .replace('snapshots:\n  ws@8.22.0:', 'snapshots:\n  chrome-devtools-mcp@1.11.0: {}\n  ws@8.22.0:');
export const ghsa = 'GHSA-35jh-r3h4-6jhm';
export const now = new Date('2026-09-30T00:00:00.000Z');
export const fingerprints = { code: 'a'.repeat(64), configuration: 'b'.repeat(64), dependencies: 'c'.repeat(64) };
export function audit(severity = 'high', version = '8.22.0', count = 3): AuditFixture {
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
export function waiver() {
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
export function findings(severity = 'high') {
    return assessAudit({ stdout: JSON.stringify(audit(severity)), exitCode: 1 }, inventory);
}

export async function lockProject() {
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

export function isolatedExecutor(calls: CommandCall[], severity = 'high', failure?: string): PnpmExecutor {
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
        const report = audit(severity, '1.11.0');
        required(report.advisories[1]).module_name = 'chrome-devtools-mcp';
        if (failure === 'coverage') report.metadata.totalDependencies = 0;
        return { exitCode: 1, stdout: JSON.stringify(report) };
    };
}
