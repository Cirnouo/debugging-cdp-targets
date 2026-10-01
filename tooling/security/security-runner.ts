import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';
import { NPM_REGISTRY, PACKAGE_NAME, PACKAGE_VERSION } from '../../src/shared/constants.ts';
import { errorCode, errorMessage, isRecord } from '../../src/shared/errors.ts';
import type { AuditCommandResult, Finding, LockInventory } from './audit-policy.ts';

export type SecurityPhase = 'complete' | 'lockfile';
export type PnpmExecutor = (
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<AuditCommandResult>;
export interface ScanResult {
    inventory: LockInventory;
    findings: Finding[];
    signatures: { audited: number; verified: number };
    installed?: boolean;
}
export type SecurityRunnerOptions = { root: string; phase?: SecurityPhase; execute?: PnpmExecutor };
export type UpstreamOptions = {
    temporaryRoot?: string;
    execute?: PnpmExecutor;
    review?: (result: ScanResult) => Promise<{ blocked: readonly Finding[] }>;
};

import {
    assessAudit,
    readLockInventory,
    validateConfigurationDependencies,
    validateSignatures,
} from './audit-policy.ts';
import { INSTALL_POLICY, validateInstallPolicy, verifyInstalledTree, verifyLockManifest } from './security-evidence.ts';

const exec = promisify(execFile);
const AUDIT_OPTIONS = ['--ignore-pnpmfile', '--config.configDependencies={}', `--registry=${NPM_REGISTRY}`];
const PROCESS_OPTIONS = {
    windowsHide: true,
    shell: false,
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8' as const,
};

export async function executePnpm(
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<AuditCommandResult> {
    let executable = process.platform === 'win32' ? 'pnpm.exe' : 'pnpm';
    let commandArgs = args;
    // npm-distributed pnpm can expose its JS entry point; never launch a .cmd through a shell.
    if (process.env.npm_execpath && /\.(?:c?js|mjs)$/.test(process.env.npm_execpath)) {
        executable = process.execPath;
        commandArgs = [process.env.npm_execpath, ...args];
    }
    try {
        const result = await exec(executable, commandArgs, { ...PROCESS_OPTIONS, ...options });
        return { ...result, exitCode: 0 };
    } catch (error) {
        if (
            !isRecord(error) ||
            typeof error.code !== 'number' ||
            error.killed ||
            error.signal ||
            typeof error.stdout !== 'string' ||
            typeof error.stderr !== 'string'
        )
            throw new Error(`pnpm command could not complete: ${errorMessage(error)}`);
        return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
    }
}

async function verifyConfiguration(root: string, execute: PnpmExecutor, env: NodeJS.ProcessEnv, isolated = false) {
    const workspace: unknown = parse(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8'));
    if (!isRecord(workspace)) throw new Error('Invalid workspace configuration.');
    validateConfigurationDependencies(workspace.configDependencies);
    const effective = await execute(['config', 'list', '--json', ...AUDIT_OPTIONS], { cwd: root, env });
    if (effective.exitCode !== 0) throw new Error('Cannot verify effective pnpm audit configuration.');
    const configuration: unknown = JSON.parse(effective.stdout);
    validateInstallPolicy(configuration, isolated);
}

async function auditTree(
    root: string,
    inventory: LockInventory,
    execute: PnpmExecutor,
    env: NodeJS.ProcessEnv,
): Promise<ScanResult> {
    const options = { cwd: root, env };
    const vulnerabilities = await execute(['audit', '--json', '--audit-level=info', ...AUDIT_OPTIONS], options);
    const findings = assessAudit(vulnerabilities, inventory.packages);
    const signatures = await execute(['audit', 'signatures', '--json', ...AUDIT_OPTIONS], options);
    validateSignatures(signatures, inventory.packages.length);
    return {
        inventory,
        findings,
        signatures: { audited: inventory.packages.length, verified: inventory.packages.length },
    };
}

async function hasInstallation(root: string) {
    try {
        await lstat(path.join(root, 'node_modules'));
        return true;
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        return false;
    }
}

async function lockedInputs(root: string) {
    return Promise.all(
        ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].map((file) => readFile(path.join(root, file))),
    );
}

async function assertUnchangedInputs(root: string, before: Buffer[]) {
    const after = await lockedInputs(root);
    if (before.some((bytes, index) => !after[index] || !bytes.equals(after[index])))
        throw new Error('Locked inputs changed during validation or installation.');
}

export async function scanRepository({ root, phase = 'complete', execute = executePnpm }: SecurityRunnerOptions) {
    const inventory = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    await verifyLockManifest(root, inventory);
    await verifyConfiguration(root, execute, process.env);
    if (phase === 'lockfile') {
        const before = await lockedInputs(root);
        const installedBefore = await hasInstallation(root);
        const validation = await execute(
            [
                'install',
                '--lockfile-only',
                '--frozen-lockfile',
                '--ignore-scripts',
                '--config.managePackageManagerVersions=false',
                ...AUDIT_OPTIONS,
            ],
            { cwd: root, env: process.env },
        );
        if (validation.exitCode !== 0)
            throw new Error(`Frozen lockfile validation failed: ${validation.stderr ?? validation.stdout}`);
        await assertUnchangedInputs(root, before);
        if (!installedBefore && (await hasInstallation(root)))
            throw new Error('Lock-only validation created an installation tree.');
    } else {
        await verifyInstalledTree(root, inventory);
    }
    return auditTree(root, inventory, execute, process.env);
}

export async function scanUpstream({
    temporaryRoot = os.tmpdir(),
    execute = executePnpm,
    review,
}: UpstreamOptions = {}) {
    const root = await mkdtemp(path.join(temporaryRoot, 'debugging-cdp-targets-security-'));
    try {
        const manifest = {
            name: 'isolated-security-audit',
            version: '0.0.0',
            private: true,
            packageManager: 'pnpm@12.4.2',
            dependencies: { [PACKAGE_NAME]: PACKAGE_VERSION },
        };
        await writeFile(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 4)}\n`);
        await writeFile(
            path.join(root, 'pnpm-workspace.yaml'),
            stringify(
                { ...INSTALL_POLICY, allowBuilds: {}, ignoreScripts: true, registry: NPM_REGISTRY },
                { indent: 4 },
            ),
        );
        await writeFile(path.join(root, 'npmrc'), `registry=${NPM_REGISTRY}\nignore-scripts=true\n`);
        await writeFile(path.join(root, 'global-npmrc'), '');
        const env = Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !/^(?:npm_config_|pnpm_config_|node_options$)/i.test(key)),
        );
        Object.assign(env, {
            NPM_CONFIG_USERCONFIG: path.join(root, 'npmrc'),
            NPM_CONFIG_GLOBALCONFIG: path.join(root, 'global-npmrc'),
            XDG_CONFIG_HOME: path.join(root, 'configuration'),
        });
        await verifyConfiguration(root, execute, env, true);
        const installArguments = [
            'install',
            '--ignore-scripts',
            '--ignore-workspace',
            '--config.managePackageManagerVersions=false',
            `--store-dir=${path.join(root, 'store')}`,
            ...AUDIT_OPTIONS,
        ];
        const resolution = await execute([...installArguments, '--lockfile-only'], { cwd: root, env });
        if (resolution.exitCode !== 0)
            throw new Error(`Isolated upstream lock resolution failed: ${resolution.stderr ?? resolution.stdout}`);
        if (await hasInstallation(root)) throw new Error('Upstream lock resolution created an installation tree.');
        const inventory = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
        await verifyLockManifest(root, inventory);
        const runtime = inventory.documents.find((doc) => doc.importers['.']?.dependencies?.[PACKAGE_NAME]);
        if (
            runtime?.importers['.']?.dependencies?.[PACKAGE_NAME]?.specifier !== PACKAGE_VERSION ||
            !inventory.packages.some((pkg) => pkg.name === PACKAGE_NAME && pkg.version === PACKAGE_VERSION)
        )
            throw new Error('Isolated upstream version differs from shared configuration.');
        const before = await lockedInputs(root);
        const result = await auditTree(root, inventory, execute, env);
        const decision = review
            ? await review(result)
            : { blocked: result.findings.filter((finding) => ['high', 'critical'].includes(finding.severity)) };
        if (!decision || !Array.isArray(decision.blocked)) throw new Error('Invalid upstream review decision.');
        await assertUnchangedInputs(root, before);
        if (decision.blocked.length) return { ...result, installed: false };
        const installation = await execute([...installArguments, '--frozen-lockfile'], { cwd: root, env });
        if (installation.exitCode !== 0)
            throw new Error(`Isolated upstream install failed: ${installation.stderr ?? installation.stdout}`);
        await assertUnchangedInputs(root, before);
        await verifyInstalledTree(root, inventory);
        return { ...result, installed: true };
    } finally {
        // Only this invocation's mkdtemp directory, never a user cache or a caller-owned root.
        await rm(root, { recursive: true, force: true });
    }
}
