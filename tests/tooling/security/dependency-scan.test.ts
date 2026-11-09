import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { isRecord } from '../../../src/shared/errors.ts';
import { OFFICIAL_RELEASE } from '../../../tooling/official-release.ts';
import { checkSecurity } from '../../../tooling/security/check-security.ts';
import { type PnpmExecutor, scanUpstream } from '../../../tooling/security/dependency-scan.ts';
import { INSTALL_POLICY } from '../../../tooling/security/installation-policy.ts';
import { validateExceptions } from '../../../tooling/security/vulnerability-reviews.ts';
import {
    audit,
    type CommandCall,
    isolatedExecutor,
    lock,
    lockProject,
    now,
    releaseRootLock,
    required,
    upstreamInputs,
    upstreamLock,
    waiver,
} from '../../fixtures/security-audit.ts';

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
                    assert.deepEqual(manifest.dependencies, { 'chrome-devtools-mcp': '1.11.0' });
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
                const report = audit('moderate', '1.11.0');
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
        scanUpstream({ inputs: { ...upstreamInputs, snapshot: upstreamLock.replaceAll('1.11.0', '1.10.0') }, execute }),
        /identity|version/i,
    );
    await assert.rejects(scanUpstream({ inputs: upstreamInputs, execute }), /changed/i);
    assert.equal(audits, 0);
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
        await mkdir(path.join(root, 'tooling/licenses'), { recursive: true });
        const vendorEvidence = path.join(root, 'tooling/licenses/reviewed-vendors.json');
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
            '{"devDependencies":{"ws":"8.22.0","chrome-devtools-mcp":"1.11.0"}}',
        );
        const { INSTALL_POLICY } = await import('../../../tooling/security/installation-policy.ts');
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
                cwd === root ? '8.22.0' : '1.11.0',
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
            version: '1.11.0',
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

test('gate samples fallback time only after settled and parsed exception evidence', () => {
    const gate = new URL('../../../tooling/security/check-security.ts', import.meta.url).href;
    const fixture = new URL('../../fixtures/security-audit.ts', import.meta.url).href;
    const policy = new URL('../../../tooling/security/installation-policy.ts', import.meta.url).href;
    const script = `
        import assert from 'node:assert/strict';
        import { registerHooks } from 'node:module';
        import { rm } from 'node:fs/promises';
        import path from 'node:path';
                                        const { lockProject, audit, now } = await import(${JSON.stringify(fixture)});
        const { INSTALL_POLICY } = await import(${JSON.stringify(policy)});
        const root = await lockProject();
        const target = path.join(root, 'docs/policies/security-exceptions.json');
        const events = [];
        let resolveRead, rejectRead;
        globalThis.__exceptionRead = () => {
            events.push('read');
            return new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
        };
        const wrapper = 'data:text/javascript,' + encodeURIComponent(
            "import { lstat, readFile as original } from 'node:fs/promises'; export { lstat }; export function readFile(file, ...args) { if (file === " + JSON.stringify(target) + ") return globalThis.__exceptionRead(); return original(file, ...args); }"
        );
        const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
            if (specifier === 'node:fs/promises' && context.parentURL === ${JSON.stringify(gate)}) return { url: wrapper, shortCircuit: true };
            return nextResolve(specifier, context);
        } });
        const OriginalDate = Date;
        try {
            const { checkSecurity } = await import(${JSON.stringify(gate)});
            globalThis.Date = class extends OriginalDate {
                constructor(...args) {
                    if (!args.length) { events.push('clock'); super('2026-09-30T00:00:00.000Z'); }
                    else super(...args);
                }
                static now() { assert.fail('unexpected Date.now'); }
            };
            for (const mode of ['valid', 'rejected', 'malformed', 'supplied']) {
                events.length = 0;
                const execute = async (args) => {
                    events.push('pnpm');
                    if (args[0] === 'config') return { exitCode: 0, stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }) };
                    if (args[0] === 'install') return { exitCode: 0, stdout: '' };
                    if (args.includes('signatures')) return { exitCode: 0, stdout: JSON.stringify({ audited: 3, verified: 3, missing: [], invalid: [] }) };
                    return { exitCode: 1, stdout: JSON.stringify(audit('moderate')) };
                };
                const operation = checkSecurity(root, { phase: 'lockfile', execute, ...(mode === 'supplied' ? { now } : {}) });
                await new Promise(setImmediate);
                assert.deepEqual(events, ['read'], mode + ': Git inventory precedes waiting read, no clock or pnpm');
                events.push('settled');
                if (mode === 'rejected') rejectRead(new Error('controlled read rejection'));
                else resolveRead(mode === 'malformed' ? '{' : '{"schemaVersion":1,"exceptions":[]}');
                if (mode === 'rejected') await assert.rejects(operation, /controlled read rejection/);
                else if (mode === 'malformed') await assert.rejects(operation, SyntaxError);
                else assert.equal((await operation).ok, true);
                assert.equal(events.filter((event) => event === 'clock').length, mode === 'valid' ? 1 : 0, mode);
                if (mode === 'valid') assert.deepEqual(events.slice(0, 4), ['read', 'settled', 'clock', 'pnpm']);
                if (mode === 'rejected' || mode === 'malformed') assert.deepEqual(events, ['read', 'settled']);
                console.log(mode + ': PASS ' + JSON.stringify(events));
            }
        } finally {
            globalThis.Date = OriginalDate;
            hooks.deregister();
            delete globalThis.__exceptionRead;
            await rm(root, { recursive: true, force: true });
        }
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
    for (const mode of ['valid', 'rejected', 'malformed', 'supplied'])
        assert.match(output, new RegExp(`${mode}: PASS`));
});
