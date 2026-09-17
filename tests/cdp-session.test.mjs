import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectManagedTarget } from '../skills/debugging-cdp-targets/scripts/application/target.mjs';
import { fileURLToPath } from 'node:url';

import { SessionError } from '../skills/debugging-cdp-targets/scripts/shared/errors.mjs';
import { buildCliRuntimePaths, getSkillRoot, getDefaultLockEndpoint, getDefaultStatePath, withSessionLock } from '../skills/debugging-cdp-targets/scripts/adapters/local-data.mjs';
import { buildDaemonArguments, buildScopedCliArguments, buildToolCliArguments, getDaemonSessionId, parseDaemonStatus, parseToolInvocation, resolveExtensionMode, resolveStopDaemonAction, validateDaemonStatus } from '../skills/debugging-cdp-targets/scripts/domains/devtools-bridge/contracts.mjs';
import { buildNpxEnvironment, getNpxPackageRoot, selectNpxLaunch } from '../skills/debugging-cdp-targets/scripts/adapters/official-cli.mjs';
import { buildTargetArguments, findLoopbackPort, isVerifiedPortRace, runPortTransaction, validateCdpContract, validateRootSnapshot } from '../skills/debugging-cdp-targets/scripts/domains/cdp-target/policy.mjs';
import { canDiscardStaleState, classifyInspectedSession, classifySession, resolveStopTargetAction } from '../skills/debugging-cdp-targets/scripts/domains/managed-session/lifecycle.mjs';
import { createSessionRecord } from '../skills/debugging-cdp-targets/scripts/domains/managed-session/record.mjs';
import { invokeGuardedTool, rollbackManagedStart, resumeManagedSession, stopManagedSession } from '../skills/debugging-cdp-targets/scripts/application/session-lifecycle.mjs';
import { parseCli } from '../skills/debugging-cdp-targets/scripts/interface/cli.mjs';
import { probeLoopbackPort } from '../skills/debugging-cdp-targets/scripts/adapters/windows-target.mjs';
import { resolvePackageVersion } from '../skills/debugging-cdp-targets/scripts/application/bridge.mjs';

test('new adapter vocabulary accepts both strategies and rejects legacy input', () => {
    for (const targetAdapter of ['chrome', 'generic-cdp']) {
        assert.equal(parseCli(['start', '--target-adapter', targetAdapter]).targetAdapter, targetAdapter);
    }
    for (const value of ['Chrome', 'ChromiumApp', 'other']) {
        assert.throws(() => parseCli(['start', '--target-adapter', value]), (error) => error.code === 'TARGET_ADAPTER_INVALID');
    }
    assert.throws(() => parseCli(['start', '--target-kind', 'Chrome']), (error) => error.code === 'ARGUMENT_INVALID');
});

test('new records persist targetAdapter without legacy fields', () => {
    const record = createSessionRecord(literalState({ targetAdapter: 'chrome' }));
    assert.equal(record.targetAdapter, 'chrome');
    assert.equal(Object.hasOwn(record, 'targetKind'), false);
});

test('new per-user layout is deterministic with a separate retained cache', () => {
    assert.equal(getDefaultStatePath({ localAppData: 'C:\\Users\\Tester\\AppData\\Local' }), 'C:\\Users\\Tester\\AppData\\Local\\debugging-cdp-targets\\state\\session.json');
    assert.equal(buildCliRuntimePaths({ localAppData: 'C:\\Users\\Tester\\AppData\\Local' }).root, 'C:\\Users\\Tester\\AppData\\Local\\debugging-cdp-targets\\cache\\chrome-devtools-cli');
    for (const localAppData of ['', 'relative', 'C:relative', '\\relative', null]) {
        assert.throws(() => getDefaultStatePath({ localAppData }), (error) => error.code === 'LOCALAPPDATA_INVALID');
    }
});

test('new state removal prunes only the empty state directory and retains cache', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cdp-layout-'));
    const statePath = path.join(root, 'state', 'session.json');
    const cachePath = path.join(root, 'cache', 'chrome-devtools-cli', 'marker');
    await mkdir(path.dirname(statePath), { recursive: true });
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(literalState()));
    await writeFile(cachePath, 'keep');
    await stopManagedSession({ statePath, disposition: 'Close', stopDaemon: async () => {}, closeTarget: async () => true });
    await assert.rejects(access(path.dirname(statePath)), { code: 'ENOENT' });
    assert.equal(await readFile(cachePath, 'utf8'), 'keep');
});

const absentTarget = { status: 'absent', reason: 'root-and-listener-absent' };
const absentDaemon = { running: false, processId: 0, version: '', arguments: [] };

test('new Resume clears a proven absent target without launching a replacement', async () => {
    const statePath = await temporaryStatePath();
    await writeFile(statePath, JSON.stringify(literalState({ status: 'detached', daemonProcessId: 0 })));
    await assert.rejects(resumeManagedSession({
        statePath,
        validateTarget: async () => false,
        inspectTarget: async () => absentTarget,
        getDaemonStatus: async () => absentDaemon,
        startDaemon: async () => assert.fail('must not launch'),
        validateDaemon: async () => false,
    }), (error) => error.code === 'TARGET_EXITED' && error.details.sessionCleared === true);
    await assert.rejects(access(statePath), { code: 'ENOENT' });
});

for (const duringInvoke of [false, true]) {
    test(`new Invoke reconciles ${duringInvoke ? 'post' : 'pre'}-call target disappearance`, async () => {
        const statePath = await temporaryStatePath();
        const state = literalState();
        await writeFile(statePath, JSON.stringify(state));
        let inspections = 0;
        let calls = 0;
        await assert.rejects(invokeGuardedTool({
            state, statePath, toolArguments: ['list_pages'],
            validateTarget: async () => duringInvoke && inspections++ === 0,
            inspectTarget: async () => duringInvoke && inspections++ === 0 ? { status: 'valid' } : absentTarget,
            getDaemonStatus: async () => absentDaemon,
            validateDaemon: async () => true,
            runNpx: async () => { calls += 1; return { exitCode: 0 }; },
        }), (error) => error.code === (duringInvoke ? 'TARGET_EXITED_DURING_INVOKE' : 'TARGET_EXITED')
            && error.details.sessionCleared === true && error.details.toolMayHaveExecuted === duringInvoke);
        assert.equal(calls, duringInvoke ? 1 : 0);
        await assert.rejects(access(statePath), { code: 'ENOENT' });
    });
}

test('new final entry runs from any working directory', () => {
    const entry = path.resolve('skills/debugging-cdp-targets/scripts/cdp-session.mjs');
    const result = spawnSync(process.execPath, [entry], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /"errorCode":"ACTION_REQUIRED"/);
});

test('Invoke rejects options placed before its tool delimiter', () => {
    assert.throws(() => parseCli(['invoke', '--target-kind', 'Chrome', '--', 'list_pages']), { code: 'ARGUMENT_INVALID' });
});

test('lifecycle actions reject options owned by another action', () => {
    assert.throws(
        () => parseCli(['start', '--disposition', 'Close']),
        (error) => error.code === 'ARGUMENT_INVALID',
    );
    for (const arguments_ of [
        ['stop', '--target-adapter', 'chrome', '--disposition', 'Keep'],
        ['stop', '--enable-extensions', '--disposition', 'Keep'],
        ['stop', '--base-port', '9333', '--disposition', 'Keep'],
    ]) {
        assert.throws(() => parseCli(arguments_), (error) => error.code === 'ARGUMENT_INVALID');
    }
});

test('target inspection requires explicit root absence and a complete listener snapshot', async () => {
    for (const snapshot of [null, {}, { root: {}, listeners: [] }, { root: { exists: false } }, { root: { exists: false }, listeners: null }]) {
        const result = await inspectManagedTarget(literalState({ rootProcessId: process.pid }), { getSnapshot: async () => snapshot });
        assert.equal(result.status, 'unverifiable');
    }
    const absent = await inspectManagedTarget(literalState(), { getSnapshot: async () => ({ root: { exists: false }, listeners: [] }) });
    assert.equal(absent.status, 'absent');
    const occupied = await inspectManagedTarget(literalState(), { getSnapshot: async () => ({ root: { exists: false }, listeners: [{ localAddress: '127.0.0.1', owningProcess: 9999 }] }) });
    assert.equal(occupied.status, 'mismatch');
});

test('Resume reconciles an absent active record before requiring detached state', async () => {
    const statePath = await temporaryStatePath();
    await writeFile(statePath, JSON.stringify(literalState()));
    await assert.rejects(resumeManagedSession({
        statePath, inspectTarget: async () => absentTarget, getDaemonStatus: async () => absentDaemon,
        startDaemon: async () => assert.fail('must not launch'),
    }), (error) => error.code === 'TARGET_EXITED' && error.details.sessionCleared);
    await assert.rejects(access(statePath), { code: 'ENOENT' });
});

test('Invoke reconciles an absent detached record before requiring active state', async () => {
    const statePath = await temporaryStatePath();
    const state = literalState({ status: 'detached', daemonProcessId: 0 });
    await writeFile(statePath, JSON.stringify(state));
    await assert.rejects(invokeGuardedTool({
        state, statePath, toolArguments: ['list_pages'], inspectTarget: async () => absentTarget,
        getDaemonStatus: async () => absentDaemon, runNpx: async () => assert.fail('must not invoke'),
    }), (error) => error.code === 'TARGET_EXITED' && error.details.sessionCleared && error.details.toolMayHaveExecuted === false);
    await assert.rejects(access(statePath), { code: 'ENOENT' });
});

for (const scenario of ['matching', 'mismatch', 'unverifiable', 'stop-failed', 'still-running']) {
    test(`new Resume cleanup handles ${scenario} daemon safely`, async () => {
        const statePath = await temporaryStatePath();
        const state = literalState({ status: 'detached', daemonProcessId: 0 });
        await writeFile(statePath, JSON.stringify(state));
        const running = { running: true, processId: 4343, version: '1.9.0', arguments: buildDaemonArguments(state).arguments };
        let stopped = false;
        const operation = resumeManagedSession({
            statePath,
            inspectTarget: async () => absentTarget,
            validateTarget: async () => false,
            getDaemonStatus: async () => {
                if (scenario === 'unverifiable') throw new Error('cannot inspect');
                if (stopped && scenario !== 'still-running') return absentDaemon;
                return scenario === 'mismatch' ? { ...running, version: '8.0.0' } : running;
            },
            stopDaemon: async (candidate) => {
                assert.equal(candidate.daemonProcessId, 4343);
                if (scenario === 'stop-failed') throw new Error('cannot stop');
                stopped = true;
            },
            processExists: true,
            startDaemon: async () => assert.fail('must not launch'),
        });
        if (scenario === 'matching') {
            await assert.rejects(operation, (error) => error.code === 'TARGET_EXITED' && error.details.sessionCleared);
            assert.equal(stopped, true);
            await assert.rejects(access(statePath), { code: 'ENOENT' });
        } else {
            await assert.rejects(operation, (error) => ['DAEMON_IDENTITY_MISMATCH', 'DAEMON_IDENTITY_UNVERIFIABLE', 'DAEMON_STOP_FAILED'].includes(error.code));
            assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), state);
            if (['mismatch', 'unverifiable'].includes(scenario)) assert.equal(stopped, false);
        }
    });
}

for (const inspection of [{ status: 'mismatch', reason: 'root-absent-listener-present' }, { status: 'unverifiable' }, { status: 'absent', reason: 'unknown' }]) {
    test(`new Resume retains state for target ${inspection.status}/${inspection.reason}`, async () => {
        const statePath = await temporaryStatePath();
        const state = literalState({ status: 'detached', daemonProcessId: 0 });
        await writeFile(statePath, JSON.stringify(state));
        await assert.rejects(resumeManagedSession({
            statePath, inspectTarget: async () => inspection, validateTarget: async () => false,
            getDaemonStatus: async () => assert.fail('unproven absence cannot clean up a daemon'),
            startDaemon: async () => assert.fail('must not launch'),
        }), { code: 'TARGET_IDENTITY_MISMATCH' });
        assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), state);
    });
}

const expectedStateKeys = [
    'schemaVersion',
    'status',
    'targetAdapter',
    'executablePath',
    'rootProcessId',
    'port',
    'browserProduct',
    'browserMajorVersion',
    'webSocketDebuggerUrl',
    'requestedPackageSpec',
    'resolvedPackageVersion',
    'extensionsEnabled',
    'workspaces',
    'startedAtUtc',
    'daemonProcessId',
];

function literalState(overrides = {}) {
    return {
        schemaVersion: 1,
        status: 'active',
        targetAdapter: 'chrome',
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        rootProcessId: 4242,
        port: 9223,
        browserProduct: 'Chrome/153.0.8010.48',
        browserMajorVersion: 153,
        webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/test',
        requestedPackageSpec: 'chrome-devtools-mcp@latest',
        resolvedPackageVersion: '1.9.0',
        extensionsEnabled: false,
        workspaces: [getSkillRoot()],
        startedAtUtc: '2026-09-17T00:00:00.000Z',
        daemonProcessId: 4343,
        ...overrides,
    };
}

async function temporaryStatePath() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'debugging-cdp-targets-node-tests-'));
    return path.join(directory, 'session.json');
}

test('IPv4 occupation makes a candidate unavailable even when IPv6 is free', async (t) => {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const { port } = server.address();

    const result = await probeLoopbackPort(port);
    assert.equal(result.available, false);
    assert.equal(result.ipv4.status, 'occupied');
});

test('port scan chooses 9223 after both families reject 9222', async () => {
    const result = await findLoopbackPort({
        basePort: 9222,
        probe: async (port) => ({
            available: port !== 9222,
            ipv4: { status: port === 9222 ? 'occupied' : 'available' },
            ipv6: { status: port === 9222 ? 'occupied' : 'available' },
        }),
    });
    assert.equal(result.port, 9223);
});

test('an unsupported address family is distinct from an occupied port', async () => {
    const result = await findLoopbackPort({
        basePort: 9222,
        probe: async () => ({
            available: true,
            ipv4: { status: 'available' },
            ipv6: { status: 'unsupported' },
        }),
    });
    assert.equal(result.port, 9222);
});

test('only a verified post-probe port race advances to the next candidate', async () => {
    const attempts = [];
    const result = await runPortTransaction({
        basePort: 9222,
        probe: async () => ({ available: true }),
        tryCandidate: async (port) => {
            attempts.push(port);
            return port === 9222 ? { outcome: 'port-race' } : { outcome: 'success', port };
        },
    });
    assert.deepEqual(attempts, [9222, 9223]);
    assert.equal(result.port, 9223);
});

test('ordinary startup failure does not loop across more ports', async () => {
    const attempts = [];
    await assert.rejects(
        runPortTransaction({
            basePort: 9222,
            probe: async () => ({ available: true }),
            tryCandidate: async (port) => {
                attempts.push(port);
                return { outcome: 'fatal', code: 'CDP_TIMEOUT' };
            },
        }),
        (error) => error instanceof SessionError && error.code === 'CDP_TIMEOUT',
    );
    assert.deepEqual(attempts, [9222]);
});

test('a released-probe race requires a foreign IPv4 owner and never hides exposure', () => {
    const snapshot = {
        processIds: [7001, 7002],
        listeners: [{ localAddress: '127.0.0.1', owningProcess: 8001 }],
    };
    assert.equal(isVerifiedPortRace({ snapshot, failureCode: 'TARGET_EXITED' }), true);
    assert.equal(isVerifiedPortRace({ snapshot, failureCode: 'CDP_TIMEOUT' }), true);
    assert.equal(isVerifiedPortRace({ snapshot, failureCode: 'TARGET_START_FAILED' }), false);
    assert.equal(isVerifiedPortRace({
        snapshot: {
            ...snapshot,
            listeners: [...snapshot.listeners, { localAddress: '0.0.0.0', owningProcess: 8001 }],
        },
        failureCode: 'CDP_TIMEOUT',
    }), false);
});

test('Chrome launch arguments include the exact persistent profile and loopback switches', () => {
    const args = buildTargetArguments({
        targetAdapter: 'chrome',
        port: 9223,
        launchArguments: ['--new-window'],
        chromeProfilePath: 'C:\\Users\\tester\\.cache\\chrome-devtools-mcp\\chrome-profile',
    });
    assert.deepEqual(args, [
        '--remote-debugging-port=9223',
        '--remote-debugging-address=127.0.0.1',
        '--user-data-dir=C:\\Users\\tester\\.cache\\chrome-devtools-mcp\\chrome-profile',
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
    ]);
});

test('generic-cdp launch arguments do not gain a user-data-dir', () => {
    const args = buildTargetArguments({
        targetAdapter: 'generic-cdp',
        port: 9224,
        launchArguments: [],
        chromeProfilePath: 'C:\\profile',
    });
    assert.equal(args.some((argument) => argument.startsWith('--user-data-dir=')), false);
});

test('generic-cdp may receive an application-supported user-data-dir without weakening runner-owned CDP switches', () => {
    const args = buildTargetArguments({
        targetAdapter: 'generic-cdp',
        port: 9224,
        launchArguments: ['--user-data-dir=C:\\Obsidian-Test'],
    });
    assert.deepEqual(args, [
        '--remote-debugging-port=9224',
        '--remote-debugging-address=127.0.0.1',
        '--user-data-dir=C:\\Obsidian-Test',
    ]);
});

test('caller-supplied remote debugging switches are rejected', () => {
    for (const launchArguments of [
        ['--remote-debugging-port=9999'],
        ['--remote-debugging-address', '0.0.0.0'],
        ['--user-data-dir=C:\\Users\\tester\\Default'],
        ['--no-first-run'],
        ['--no-default-browser-check'],
    ]) {
        assert.throws(
            () => buildTargetArguments({ targetAdapter: 'chrome', port: 9223, launchArguments, chromeProfilePath: 'C:\\profile' }),
            (error) => error.code === 'RUNNER_ARGUMENT_CONFLICT',
        );
    }
});

test('latest is resolved once and converted to an exact package version', async () => {
    const calls = [];
    const result = await resolvePackageVersion({
        packageSpec: 'chrome-devtools-mcp@latest',
        runNpx: async (arguments_) => {
            calls.push(arguments_);
            return { exitCode: 0, stdout: '1.9.0\n', stderr: '' };
        },
    });
    assert.deepEqual(result, { version: '1.9.0', pinnedPackageSpec: 'chrome-devtools-mcp@1.9.0' });
    assert.deepEqual(calls, [['--yes', '--package', 'chrome-devtools-mcp@latest', 'chrome-devtools', '--version']]);
});

test('npx launch falls back to a PATH executable when the current Node runtime has no bundled npm', () => {
    assert.deepEqual(selectNpxLaunch({
        processExecutable: 'C:\\CodexRuntime\\node.exe',
        adjacentNpxExists: false,
        pathCandidates: ['C:\\NodeShims\\npx.exe'],
    }), {
        executable: 'C:\\NodeShims\\npx.exe',
        prefixArguments: [],
    });
});

test('official package resolution uses a task-independent runtime and deterministic exact cache path', () => {
    const runtime = buildCliRuntimePaths({ baseDirectory: 'C:\\Trusted Agent Runtime' });
    assert.equal(runtime.workingDirectory, 'C:\\Trusted Agent Runtime\\work');
    assert.equal(runtime.cacheRoot, 'C:\\Trusted Agent Runtime\\npm-cache');
    assert.equal(runtime.userConfigPath, 'C:\\Trusted Agent Runtime\\npmrc');
    assert.equal(runtime.globalConfigPath, 'C:\\Trusted Agent Runtime\\global-npmrc');
    assert.equal(
        getNpxPackageRoot({ cacheRoot: runtime.cacheRoot, packageSpec: 'chrome-devtools-mcp@1.9.0' }),
        'C:\\Trusted Agent Runtime\\npm-cache\\_npx\\600081e5c584a85c\\node_modules\\chrome-devtools-mcp',
    );
});

test('package resolution rejects every package except official latest or an exact semver', async () => {
    for (const packageSpec of [
        'other-package@latest',
        'chrome-devtools-mcp@next',
        'chrome-devtools-mcp@https://user:secret@example.test/package.tgz',
        'chrome-devtools-mcp@01.2.3',
        'chrome-devtools-mcp@1.02.3',
        'chrome-devtools-mcp@1.2.03',
        'chrome-devtools-mcp@1.2.3-01',
        'chrome-devtools-mcp@1.2.3-alpha..1',
    ]) {
        let called = false;
        await assert.rejects(
            resolvePackageVersion({
                packageSpec,
                runNpx: async () => { called = true; return { exitCode: 0, stdout: '1.9.0', stderr: '' }; },
            }),
            (error) => error.code === 'PACKAGE_SPEC_INVALID',
        );
        assert.equal(called, false);
    }
});

test('daemon CLI calls use a stable session-specific namespace', () => {
    const state = literalState();
    const sessionId = getDaemonSessionId(state);
    assert.match(sessionId, /^[a-f0-9]{32}$/);
    assert.equal(getDaemonSessionId({ ...state }), sessionId);
    assert.notEqual(getDaemonSessionId({ ...state, rootProcessId: state.rootProcessId + 1 }), sessionId);
    assert.deepEqual(
        buildScopedCliArguments({ resolvedPackageVersion: '1.9.0', state, commandArguments: ['status'] }),
        [`--sessionId=${sessionId}`, 'status'],
    );
});

test('tool CLI calls carry only the scoped session identity, never start-only options', () => {
    const state = literalState();
    const arguments_ = buildToolCliArguments({ state, toolArguments: ['list_pages', '--output-format=json'] });
    assert.deepEqual(arguments_.slice(-2), ['list_pages', '--output-format=json']);
    assert.equal(arguments_.some((argument) => /browserUrl|workspace|usage-statistics|performance-crux|categoryExtensions/i.test(argument)), false);
    assert.equal(arguments_.includes(`--sessionId=${getDaemonSessionId(state)}`), true);
});

test('npx subprocesses preload only the targeted no-console guard and discard inherited Node injection', () => {
    const runtimePaths = buildCliRuntimePaths({ baseDirectory: 'C:\\Trusted Agent Runtime' });
    const environment = buildNpxEnvironment({
        baseEnvironment: {
            PATH: 'C:\\Tools',
            NODE_OPTIONS: '--no-warnings',
            NPM_CONFIG_REGISTRY: 'https://attacker.invalid/',
            npm_config_userconfig: 'C:\\Workspace\\.npmrc',
            INIT_CWD: 'C:\\Workspace',
            NODE_PATH: 'C:\\Workspace\\node_modules',
        },
        preloadPath: 'C:\\Agent Skills\\hide-mcp-console.cjs',
        runtimePaths,
    });
    assert.equal(environment.PATH, 'C:\\Tools');
    assert.equal(environment.NODE_OPTIONS, '--require="C:/Agent Skills/hide-mcp-console.cjs"');
    assert.equal(environment.NPM_CONFIG_REGISTRY, 'https://registry.npmjs.org/');
    assert.equal(environment.NPM_CONFIG_CACHE, runtimePaths.cacheRoot);
    assert.equal(environment.NPM_CONFIG_USERCONFIG, runtimePaths.userConfigPath);
    assert.equal(environment.NPM_CONFIG_GLOBALCONFIG, runtimePaths.globalConfigPath);
    assert.notEqual(environment.NPM_CONFIG_USERCONFIG, environment.NPM_CONFIG_GLOBALCONFIG);
    assert.equal(Object.hasOwn(environment, 'npm_config_userconfig'), false);
    assert.equal(Object.hasOwn(environment, 'INIT_CWD'), false);
    assert.equal(Object.hasOwn(environment, 'NODE_PATH'), false);
});

test('no-console preload removes inherited stderr only from the inner MCP stdio server', () => {
    const preloadPath = path.join(getSkillRoot(), 'scripts', 'hide-mcp-console.cjs');
    const evaluation = [
        `const hook = require(${JSON.stringify(preloadPath)});`,
        `const targeted = hook.normalizeSpawnOptions(process.execPath, ['C:\\\\pkg\\\\chrome-devtools-mcp.js', '--viaCli'], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });`,
        `const ordinary = hook.normalizeSpawnOptions(process.execPath, ['C:\\\\pkg\\\\other.js'], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });`,
        `process.stdout.write(JSON.stringify({ targeted: targeted.stdio, ordinary: ordinary.stdio }));`,
    ].join('');
    const result = spawnSync(process.execPath, ['-e', evaluation], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
        targeted: ['pipe', 'pipe', 'ignore'],
        ordinary: ['pipe', 'pipe', 'inherit'],
    });
});

test('no-console preload hides only the npm command shell that launches chrome-devtools', () => {
    const preloadPath = path.join(getSkillRoot(), 'scripts', 'hide-mcp-console.cjs');
    const evaluation = [
        `const hook = require(${JSON.stringify(preloadPath)});`,
        `const targeted = hook.normalizeSpawnOptions('C:\\\\Windows\\\\System32\\\\cmd.exe', ['/d', '/s', '/c', 'chrome-devtools status'], { stdio: 'inherit' });`,
        `const ordinary = hook.normalizeSpawnOptions('C:\\\\Windows\\\\System32\\\\cmd.exe', ['/d', '/s', '/c', 'echo visible'], { stdio: 'inherit' });`,
        `process.stdout.write(JSON.stringify({ targeted, ordinary }));`,
    ].join('');
    const result = spawnSync(process.execPath, ['-e', evaluation], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).targeted.windowsHide, true);
    assert.equal(Object.hasOwn(JSON.parse(result.stdout).ordinary, 'windowsHide'), false);
});

test('ordinary tasks explicitly disable extension tools', () => {
    assert.deepEqual(
        resolveExtensionMode({ requested: false }),
        { enabled: false, reason: 'not-requested' },
    );
});

test('capable Chrome and MCP allow requested extension tools', () => {
    const mode = resolveExtensionMode({
        requested: true,
        targetAdapter: 'chrome',
        browserProduct: 'Chrome/153.0.8010.48',
        browserMajorVersion: 153,
        resolvedPackageVersion: '1.9.0',
        startHelp: '--categoryExtensions Enable extension tools',
        startHelpExitCode: 0,
        extensionCommandsAvailable: true,
    });
    assert.equal(mode.enabled, true);
});

test('extension mode fails closed when any capability gate is absent', () => {
    const cases = [
        { targetAdapter: 'chrome', browserProduct: 'Chrome/148.0.0.0', browserMajorVersion: 148, resolvedPackageVersion: '1.9.0', startHelp: '--categoryExtensions', startHelpExitCode: 0, extensionCommandsAvailable: true },
        { targetAdapter: 'chrome', browserProduct: 'Chrome/153.0.0.0', browserMajorVersion: 153, resolvedPackageVersion: '0.21.9', startHelp: '--categoryExtensions', startHelpExitCode: 0, extensionCommandsAvailable: true },
        { targetAdapter: 'chrome', browserProduct: 'Chrome/153.0.0.0', browserMajorVersion: 153, resolvedPackageVersion: '0.22.0-beta.1', startHelp: '--categoryExtensions', startHelpExitCode: 0, extensionCommandsAvailable: true },
        { targetAdapter: 'generic-cdp', browserProduct: 'Obsidian/1.13.6 Chrome/153.0.0.0', browserMajorVersion: 153, resolvedPackageVersion: '1.9.0', startHelp: '--categoryExtensions', startHelpExitCode: 0, extensionCommandsAvailable: true },
        { targetAdapter: 'chrome', browserProduct: 'Chromium/153.0.0.0', browserMajorVersion: 153, resolvedPackageVersion: '1.9.0', startHelp: '--categoryExtensions', startHelpExitCode: 0, extensionCommandsAvailable: true },
        { targetAdapter: 'chrome', browserProduct: 'Chrome/153.0.0.0', browserMajorVersion: 153, resolvedPackageVersion: '1.9.0', startHelp: 'other options', startHelpExitCode: 0, extensionCommandsAvailable: true },
        { targetAdapter: 'chrome', browserProduct: 'Chrome/153.0.0.0', browserMajorVersion: 153, resolvedPackageVersion: '1.9.0', startHelp: 'error: --categoryExtensions unsupported', startHelpExitCode: 1, extensionCommandsAvailable: true },
        { targetAdapter: 'chrome', browserProduct: 'Chrome/153.0.0.0', browserMajorVersion: 153, resolvedPackageVersion: '1.9.0', startHelp: '--categoryExtensions', startHelpExitCode: 0, extensionCommandsAvailable: false },
    ];
    for (const capabilities of cases) {
        assert.throws(
            () => resolveExtensionMode({ requested: true, ...capabilities }),
            (error) => error.code === 'EXTENSIONS_UNSUPPORTED',
        );
    }
});

test('daemon arguments pin the package, set explicit extension mode, and never include PWA mode', () => {
    const result = buildDaemonArguments({
        ...literalState(),
        resolvedPackageVersion: '1.9.0',
        port: 9223,
        workspaces: ['C:\\One', 'C:\\Two'],
        extensionsEnabled: false,
    });
    assert.equal(result.packageSpec, 'chrome-devtools-mcp@1.9.0');
    assert.equal(result.arguments.includes(`--sessionId=${getDaemonSessionId(literalState())}`), true);
    assert.equal(result.arguments.includes('--browserUrl=http://127.0.0.1:9223'), true);
    assert.equal(result.arguments.includes('--categoryExtensions=false'), true);
    assert.equal(result.arguments.includes('--workspace=C:\\One'), true);
    assert.equal(result.arguments.includes('--workspace=C:\\Two'), true);
    assert.equal(result.arguments.some((argument) => argument.toLowerCase().includes('categorypwa')), false);
});

test('current official daemon status format and JSON args are parsed', () => {
    const raw = [
        'chrome-devtools-mcp daemon is running.',
        'pid=41980 socket=\\\\.\\pipe\\chrome-devtools-mcp-test\\server.sock start-date=2026-09-17T00:08:07.802Z version=1.9.0',
        'args=["--viaCli","--no-category-extensions","--browser-url=http://127.0.0.1:9223","--no-usage-statistics","--no-performance-crux","--filesystem-root=C:\\\\Workspace"]',
    ].join('\r\n');
    const status = parseDaemonStatus({ exitCode: 0, stdout: raw, stderr: '' });
    assert.equal(status.running, true);
    assert.equal(status.processId, 41980);
    assert.equal(status.version, '1.9.0');
    assert.deepEqual(status.arguments, [
        '--viaCli',
        '--no-category-extensions',
        '--browser-url=http://127.0.0.1:9223',
        '--no-usage-statistics',
        '--no-performance-crux',
        '--filesystem-root=C:\\Workspace',
    ]);
});

test('normalized daemon identity validates PID, version, URL, mode, workspace, and process existence', () => {
    const state = literalState({ daemonProcessId: 41980 });
    const status = {
        running: true,
        processId: 41980,
        version: '1.9.0',
        arguments: [
            '--viaCli',
            '--no-category-extensions',
            '--browser-url=http://127.0.0.1:9223',
            '--no-usage-statistics',
            '--no-performance-crux',
            `--filesystem-root=${state.workspaces[0]}`,
        ],
    };
    assert.deepEqual(validateDaemonStatus({ state, status, processExists: true }), { valid: true, reason: 'valid' });
});

test('daemon identity requires privacy flags and rejects every PWA category spelling', () => {
    const state = literalState({ daemonProcessId: 41980 });
    const baseArguments = [
        '--viaCli',
        '--no-category-extensions',
        '--browser-url=http://127.0.0.1:9223',
        '--no-usage-statistics',
        '--no-performance-crux',
        `--filesystem-root=${state.workspaces[0]}`,
    ];
    for (const arguments_ of [
        baseArguments.filter((argument) => argument !== '--no-usage-statistics'),
        baseArguments.filter((argument) => argument !== '--no-performance-crux'),
        [...baseArguments, '--category-pwa'],
        [...baseArguments, '--categoryPwa=true'],
    ]) {
        const result = validateDaemonStatus({
            state,
            status: { running: true, processId: 41980, version: '1.9.0', arguments: arguments_ },
            processExists: true,
        });
        assert.equal(result.valid, false);
    }
});

test('daemon status does not mistake a workspace containing not running for stopped state', () => {
    const raw = [
        'chrome-devtools-mcp daemon is running.',
        'pid=41980 socket=\\\\.\\pipe\\chrome-devtools-mcp-test\\server.sock start-date=2026-09-17T00:08:07.802Z version=1.9.0',
        'args=["--viaCli","--no-category-extensions","--browser-url=http://127.0.0.1:9223","--filesystem-root=C:\\\\Not Running\\\\Workspace"]',
    ].join('\r\n');
    assert.equal(parseDaemonStatus({ exitCode: 0, stdout: raw, stderr: '' }).running, true);
});

test('daemon status treats command failures and unknown output as unverifiable, never absent', () => {
    for (const result of [
        { exitCode: 1, stdout: '', stderr: 'named pipe access denied' },
        { exitCode: 0, stdout: 'unexpected output', stderr: '' },
    ]) {
        assert.throws(
            () => parseDaemonStatus(result),
            (error) => error.code === 'DAEMON_STATUS_INVALID',
        );
    }
});

test('CDP contract rejects missing websocket, wrong port, foreign owner, and exposed listener', () => {
    const base = {
        port: 9223,
        endpoint: { Browser: 'Chrome/153.0.0.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/x' },
        listeners: [{ localAddress: '127.0.0.1', owningProcess: 5001 }],
        allowedProcessIds: [5001],
        targetAdapter: 'chrome',
    };
    const cases = [
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: '' } }, 'CDP_WEBSOCKET_MISSING'],
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: 'ws://127.0.0.1:9999/devtools/browser/x' } }, 'CDP_WEBSOCKET_PORT_MISMATCH'],
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: 'ws://192.0.2.10:9223/devtools/browser/x' } }, 'CDP_WEBSOCKET_HOST_MISMATCH'],
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: 'wss://127.0.0.1:9223/devtools/browser/x' } }, 'CDP_WEBSOCKET_INVALID'],
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: 'ws://user:secret@127.0.0.1:9223/devtools/browser/x' } }, 'CDP_WEBSOCKET_INVALID'],
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: 'ws://127.0.0.1:9223/unexpected' } }, 'CDP_WEBSOCKET_INVALID'],
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/x/extra' } }, 'CDP_WEBSOCKET_INVALID'],
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/x?token=1' } }, 'CDP_WEBSOCKET_INVALID'],
        [{ ...base, endpoint: { ...base.endpoint, webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/x#fragment' } }, 'CDP_WEBSOCKET_INVALID'],
        [{ ...base, listeners: [{ localAddress: '127.0.0.1', owningProcess: 6000 }] }, 'CDP_OWNER_MISMATCH'],
        [{ ...base, listeners: [...base.listeners, { localAddress: '::1', owningProcess: 6000 }] }, 'CDP_OWNER_MISMATCH'],
        [{ ...base, listeners: [...base.listeners, { localAddress: '0.0.0.0', owningProcess: 5001 }] }, 'CDP_EXPOSED'],
    ];
    for (const [input, code] of cases) {
        assert.throws(() => validateCdpContract(input), (error) => error.code === code);
    }
});

test('root snapshot validation binds path, Windows session, and creation time', () => {
    const expected = {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        startedAtUtc: '2026-09-17T00:00:00.000Z',
    };
    const valid = {
        currentSessionId: 2,
        root: {
            exists: true,
            executablePath: expected.executablePath,
            sessionId: 2,
            startedAtUtc: '2026-09-17T00:00:00.500Z',
            productName: 'Google Chrome',
            companyName: 'Google LLC',
            originalFilename: 'chrome.exe',
        },
    };
    assert.equal(validateRootSnapshot({ snapshot: valid, targetAdapter: 'chrome', ...expected }), true);
    for (const snapshot of [
        { ...valid, root: { ...valid.root, executablePath: 'C:\\Windows\\notepad.exe' } },
        { ...valid, root: { ...valid.root, sessionId: 3 } },
        { ...valid, root: { ...valid.root, startedAtUtc: '2026-09-17T00:00:02.000Z' } },
        { ...valid, root: { ...valid.root, startedAtUtc: '2026-09-16T23:50:00.000Z' } },
        { ...valid, root: { ...valid.root, productName: 'Chromium' } },
        { ...valid, root: { ...valid.root, companyName: 'Example Vendor' } },
        { ...valid, root: { ...valid.root, originalFilename: 'chromium.exe' } },
    ]) {
        assert.throws(
            () => validateRootSnapshot({ snapshot, targetAdapter: 'chrome', ...expected }),
            (error) => error.code === 'TARGET_IDENTITY_MISMATCH',
        );
    }
    assert.equal(validateRootSnapshot({ snapshot: { ...valid, root: { ...valid.root, productName: 'Obsidian', companyName: 'Dynalist Inc.', originalFilename: 'Obsidian.exe' } }, targetAdapter: 'generic-cdp', ...expected }), true);
});

test('session record contains only approved non-sensitive fields', () => {
    const record = createSessionRecord(literalState());
    assert.deepEqual(Object.keys(record), expectedStateKeys);
    assert.doesNotMatch(JSON.stringify(record), /launchArgument|header|cookie|pageContent/i);
});

test('session records reject untrusted package selectors before they can be persisted or executed', () => {
    assert.throws(
        () => createSessionRecord(literalState({ requestedPackageSpec: 'chrome-devtools-mcp@https://user:secret@example.test/x.tgz' })),
        (error) => error.code === 'PACKAGE_SPEC_INVALID',
    );
    assert.throws(
        () => createSessionRecord(literalState({ resolvedPackageVersion: 'latest' })),
        (error) => error.code === 'PACKAGE_VERSION_INVALID',
    );
});

test('session records validate every persisted identity and lifecycle field at the boundary', () => {
    const invalidStates = [
        { executablePath: 'chrome.exe' },
        { rootProcessId: '4242' },
        { port: '9223' },
        { browserProduct: '' },
        { browserMajorVersion: '153' },
        { browserMajorVersion: 152 },
        { webSocketDebuggerUrl: 'not-a-websocket' },
        { webSocketDebuggerUrl: 'ws://127.0.0.1:9224/devtools/browser/test' },
        { extensionsEnabled: 'false' },
        { workspaces: getSkillRoot() },
        { workspaces: [] },
        { workspaces: ['relative'] },
        { startedAtUtc: 'yesterday' },
        { daemonProcessId: 0 },
        { status: 'detached', daemonProcessId: 42 },
        { requestedPackageSpec: 'chrome-devtools-mcp@1.8.0' },
    ];
    for (const overrides of invalidStates) {
        assert.throws(() => createSessionRecord(literalState(overrides)), SessionError);
    }
});

test('persisted workspace paths remain readable after the workspace itself disappears', () => {
    const missingWorkspace = path.join(os.tmpdir(), 'debugging-cdp-targets-missing-workspace');
    const record = createSessionRecord(literalState({ workspaces: [missingWorkspace] }));
    assert.deepEqual(record.workspaces, [missingWorkspace]);
});

test('state classification covers none, active, detached, and stale', async () => {
    assert.equal((await classifySession({ state: null })).status, 'none');
    assert.equal((await classifySession({ state: literalState(), validateTarget: async () => true, validateDaemon: async () => true })).status, 'active');
    assert.equal((await classifySession({ state: literalState({ status: 'detached', daemonProcessId: 0 }), validateTarget: async () => true, validateDaemon: async () => false })).status, 'detached');
    assert.equal((await classifySession({ state: literalState(), validateTarget: async () => false, validateDaemon: async () => false })).status, 'stale');
});

test('inspection classification exposes an unexpected detached daemon and an absent active target as stale', () => {
    const detached = literalState({ status: 'detached', daemonProcessId: 0 });
    assert.equal(classifyInspectedSession({
        state: detached,
        targetInspection: { status: 'valid' },
        daemonInspection: { status: 'absent' },
    }).status, 'detached');
    assert.equal(classifyInspectedSession({
        state: detached,
        targetInspection: { status: 'valid' },
        daemonInspection: { status: 'mismatch', reason: 'pid-mismatch' },
    }).status, 'stale');
    const active = literalState();
    const absentTarget = classifyInspectedSession({
        state: active,
        targetInspection: { status: 'absent' },
        daemonInspection: { status: 'valid' },
    });
    assert.equal(absentTarget.status, 'stale');
    assert.equal(absentTarget.targetValid, false);
    assert.equal(absentTarget.daemonValid, true);
});

test('stale state is discarded only after target and daemon absence are both confirmed', () => {
    assert.equal(canDiscardStaleState({ targetInspection: { status: 'absent' }, daemonInspection: { status: 'absent' } }), true);
    for (const [targetStatus, daemonStatus] of [
        ['unverifiable', 'absent'],
        ['mismatch', 'absent'],
        ['absent', 'unverifiable'],
        ['absent', 'mismatch'],
        ['valid', 'absent'],
        ['absent', 'valid'],
    ]) {
        assert.equal(canDiscardStaleState({
            targetInspection: { status: targetStatus },
            daemonInspection: { status: daemonStatus },
        }), false);
    }
});

test('guarded Invoke refuses to call CLI when daemon identity is absent', async () => {
    let called = false;
    await assert.rejects(
        invokeGuardedTool({
            state: literalState(),
            toolArguments: ['list_pages', '--output-format=json'],
            validateTarget: async () => true,
            validateDaemon: async () => false,
            runNpx: async () => { called = true; return { exitCode: 0, stdout: '[]', stderr: '' }; },
            stopDaemon: async () => {},
        }),
        (error) => error.code === 'DAEMON_IDENTITY_MISMATCH',
    );
    assert.equal(called, false);
});

test('guarded Invoke never stops a daemon whose identity changed during a post-call race', async () => {
    let validations = 0;
    let stopped = false;
    await assert.rejects(
        invokeGuardedTool({
            state: literalState(),
            toolArguments: ['list_pages', '--output-format=json'],
            validateTarget: async () => true,
            validateDaemon: async () => ++validations === 1,
            runNpx: async () => ({ exitCode: 0, stdout: '[]', stderr: '' }),
            stopDaemon: async () => { stopped = true; },
        }),
        (error) => error.code === 'DAEMON_IDENTITY_MISMATCH',
    );
    assert.equal(stopped, false);
});

test('guarded Invoke verifies target identity before and after the tool call', async () => {
    let targetValidations = 0;
    let called = false;
    await assert.rejects(
        invokeGuardedTool({
            state: literalState(),
            toolArguments: ['list_pages', '--output-format=json'],
            validateTarget: async () => ++targetValidations === 1,
            validateDaemon: async () => true,
            runNpx: async () => { called = true; return { exitCode: 0, stdout: '[]', stderr: '' }; },
            stopDaemon: async () => assert.fail('a target mismatch must not stop any daemon'),
        }),
        (error) => error.code === 'TARGET_IDENTITY_MISMATCH',
    );
    assert.equal(called, true);

    called = false;
    await assert.rejects(
        invokeGuardedTool({
            state: literalState(),
            toolArguments: ['list_pages', '--output-format=json'],
            validateTarget: async () => false,
            validateDaemon: async () => true,
            runNpx: async () => { called = true; return { exitCode: 0, stdout: '[]', stderr: '' }; },
            stopDaemon: async () => {},
        }),
        (error) => error.code === 'TARGET_IDENTITY_MISMATCH',
    );
    assert.equal(called, false);
});

test('lifecycle transitions active to detached to active to closed without a force-kill hook', async () => {
    const statePath = await temporaryStatePath();
    await writeFile(statePath, JSON.stringify(literalState()), 'utf8');
    let closeCalls = 0;

    const kept = await stopManagedSession({
        statePath,
        disposition: 'Keep',
        stopDaemon: async () => {},
        closeTarget: async () => { closeCalls += 1; return true; },
    });
    assert.equal(kept.status, 'detached');
    assert.equal(closeCalls, 0);
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).status, 'detached');

    await resumeManagedSession({
        statePath,
        validateTarget: async () => true,
        startDaemon: async () => 9876,
        validateDaemon: async () => true,
    });
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).status, 'active');

    const closed = await stopManagedSession({
        statePath,
        disposition: 'Close',
        stopDaemon: async () => {},
        closeTarget: async () => { closeCalls += 1; return true; },
    });
    assert.equal(closed.status, 'closed');
    assert.equal(closeCalls, 1);
    await assert.rejects(readFile(statePath, 'utf8'), { code: 'ENOENT' });
});

test('failed graceful close retains detached state and never exposes a force-kill dependency', async () => {
    const statePath = await temporaryStatePath();
    await writeFile(statePath, JSON.stringify(literalState()), 'utf8');
    const result = await stopManagedSession({
        statePath,
        disposition: 'Close',
        stopDaemon: async () => {},
        closeTarget: async () => false,
    });
    assert.equal(result.status, 'close-pending');
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).status, 'detached');
});

test('resume compensates a final state-write failure by stopping the newly started daemon', async () => {
    const statePath = await temporaryStatePath();
    await writeFile(statePath, JSON.stringify(literalState({ status: 'detached', daemonProcessId: 0 })), 'utf8');
    let daemonRunning = false;
    await assert.rejects(
        resumeManagedSession({
            statePath,
            validateTarget: async () => true,
            startDaemon: async () => { daemonRunning = true; return 9876; },
            validateDaemon: async () => daemonRunning,
            stopDaemon: async () => { daemonRunning = false; },
            writeState: async () => { throw new Error('disk full'); },
        }),
        (error) => error.code === 'STATE_WRITE_FAILED_RECOVERED',
    );
    assert.equal(daemonRunning, false);
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).status, 'detached');
});

test('resume preserves the active daemon identity when validation and safe stop both fail', async () => {
    const statePath = await temporaryStatePath();
    await writeFile(statePath, JSON.stringify(literalState({ status: 'detached', daemonProcessId: 0 })), 'utf8');
    await assert.rejects(
        resumeManagedSession({
            statePath,
            validateTarget: async () => true,
            startDaemon: async () => 8765,
            validateDaemon: async () => false,
            stopDaemon: async () => { throw new Error('identity mismatch'); },
        }),
        (error) => error.code === 'DAEMON_IDENTITY_MISMATCH',
    );
    const recovery = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(recovery.status, 'active');
    assert.equal(recovery.daemonProcessId, 8765);
});

test('Keep state-write failure leaves an externally recoverable active record after daemon stop', async () => {
    const statePath = await temporaryStatePath();
    await writeFile(statePath, JSON.stringify(literalState()), 'utf8');
    let stopCalls = 0;
    await assert.rejects(
        stopManagedSession({
            statePath,
            disposition: 'Keep',
            stopDaemon: async () => { stopCalls += 1; },
            closeTarget: async () => true,
            writeState: async () => { throw new Error('disk full'); },
        }),
        (error) => error.code === 'STATE_WRITE_FAILED_RECOVERABLE',
    );
    assert.equal(stopCalls, 1);
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).status, 'active');
});

test('Stop recovery safely handles a daemon missing from active state or matching a detached session', () => {
    const active = literalState();
    assert.deepEqual(
        resolveStopDaemonAction({ state: active, status: { running: false }, processExists: true }),
        { action: 'none', reason: 'not-running' },
    );

    const detached = literalState({ status: 'detached', daemonProcessId: 0 });
    const matchingStatus = {
        running: true,
        processId: 9876,
        version: detached.resolvedPackageVersion,
        arguments: buildDaemonArguments(detached).arguments,
    };
    const recovery = resolveStopDaemonAction({ state: detached, status: matchingStatus, processExists: true });
    assert.equal(recovery.action, 'stop');
    assert.equal(recovery.recoveredFromDetached, true);
    assert.equal(recovery.state.status, 'active');
    assert.equal(recovery.state.daemonProcessId, 9876);

    const mismatch = resolveStopDaemonAction({
        state: detached,
        status: { ...matchingStatus, arguments: matchingStatus.arguments.map((value) => value.startsWith('--browserUrl=') ? '--browserUrl=http://127.0.0.1:65534' : value) },
        processExists: true,
    });
    assert.deepEqual(mismatch, { action: 'reject', reason: 'browser-url-mismatch' });
});

test('Stop recovery can stop a matching daemon after the target vanished without closing a reused process', () => {
    assert.deepEqual(resolveStopTargetAction({ status: 'absent', reason: 'root-and-listener-absent' }), {
        action: 'remove-state',
        requireOwnedListener: false,
    });
    assert.deepEqual(resolveStopTargetAction({ status: 'valid', processIdentityValid: true }), {
        action: 'manage-target',
        requireOwnedListener: true,
    });
    assert.deepEqual(resolveStopTargetAction({ status: 'unverifiable', processIdentityValid: true }), {
        action: 'manage-target',
        requireOwnedListener: false,
    });
    assert.deepEqual(resolveStopTargetAction({ status: 'mismatch', processIdentityValid: false, reason: 'root-validation-failed' }), {
        action: 'reject',
        requireOwnedListener: false,
    });
});

test('Start rollback preserves recovery state and leaves the target open when daemon stop is unconfirmed', async () => {
    const statePath = await temporaryStatePath();
    const detached = createSessionRecord(literalState({ status: 'detached', daemonProcessId: 0 }));
    await writeFile(statePath, JSON.stringify(detached), 'utf8');
    let closeCalls = 0;
    let removeCalls = 0;
    const writes = [];
    const result = await rollbackManagedStart({
        statePath,
        detached,
        getDaemonStatus: async () => ({
            running: true,
            processId: 7654,
            version: detached.resolvedPackageVersion,
            arguments: buildDaemonArguments(detached).arguments,
        }),
        stopDaemon: async () => { throw new Error('named pipe unavailable'); },
        closeTarget: async () => { closeCalls += 1; return true; },
        writeState: async (_path, value) => { writes.push(value); },
        removeState: async () => { removeCalls += 1; },
        processExists: true,
    });
    assert.equal(result.daemonCleanupConfirmed, false);
    assert.equal(result.targetClosed, false);
    assert.equal(result.recoveryState.status, 'active');
    assert.equal(result.recoveryState.daemonProcessId, 7654);
    assert.equal(closeCalls, 0);
    assert.equal(removeCalls, 0);
    assert.equal(writes.at(-1).status, 'active');
});

test('Start rollback retains a discovered daemon PID when its identity is mismatched', async () => {
    const statePath = await temporaryStatePath();
    const detached = createSessionRecord(literalState({ status: 'detached', daemonProcessId: 0 }));
    const mismatchedArguments = buildDaemonArguments(detached).arguments.map((value) => (
        value.startsWith('--browserUrl=') ? '--browserUrl=http://127.0.0.1:65534' : value
    ));
    let stopCalls = 0;
    const writes = [];
    const result = await rollbackManagedStart({
        statePath,
        detached,
        getDaemonStatus: async () => ({
            running: true,
            processId: 7654,
            version: detached.resolvedPackageVersion,
            arguments: mismatchedArguments,
        }),
        stopDaemon: async () => { stopCalls += 1; },
        closeTarget: async () => assert.fail('an unverified daemon must keep the target open'),
        writeState: async (_path, value) => { writes.push(value); },
        processExists: true,
    });
    assert.equal(stopCalls, 0);
    assert.equal(result.daemonCleanupConfirmed, false);
    assert.equal(result.recoveryState.status, 'active');
    assert.equal(result.recoveryState.daemonProcessId, 7654);
    assert.equal(writes.at(-1).status, 'active');
    assert.equal(writes.at(-1).daemonProcessId, 7654);
});

test('Start rollback closes the target and removes state only after daemon absence is confirmed', async () => {
    const statePath = await temporaryStatePath();
    const detached = createSessionRecord(literalState({ status: 'detached', daemonProcessId: 0 }));
    let closeCalls = 0;
    let removeCalls = 0;
    const result = await rollbackManagedStart({
        statePath,
        detached,
        getDaemonStatus: async () => ({ running: false, processId: 0, version: '', arguments: [] }),
        stopDaemon: async () => assert.fail('an absent daemon must not be stopped'),
        closeTarget: async () => { closeCalls += 1; return true; },
        removeState: async () => { removeCalls += 1; },
    });
    assert.equal(result.daemonCleanupConfirmed, true);
    assert.equal(result.targetClosed, true);
    assert.equal(closeCalls, 1);
    assert.equal(removeCalls, 1);
});

test('Start rollback reports close and state persistence failures without losing the root recovery identity', async () => {
    const statePath = await temporaryStatePath();
    const detached = createSessionRecord(literalState({ status: 'detached', daemonProcessId: 0 }));
    const result = await rollbackManagedStart({
        statePath,
        detached,
        getDaemonStatus: async () => ({ running: false, processId: 0, version: '', arguments: [] }),
        stopDaemon: async () => assert.fail('an absent daemon must not be stopped'),
        closeTarget: async () => { throw new Error('window refused close'); },
        writeState: async () => { throw new Error('disk full'); },
    });
    assert.equal(result.daemonCleanupConfirmed, true);
    assert.equal(result.targetClosed, false);
    assert.equal(result.recoveryState.rootProcessId, detached.rootProcessId);
    assert.equal(result.closeError.message, 'window refused close');
    assert.equal(result.stateWriteError.message, 'disk full');
});

test('Windows helper snapshots include executable product identity metadata', { skip: process.platform !== 'win32' }, () => {
    const helper = path.join(getSkillRoot(), 'scripts', 'windows-cdp-helper.ps1');
    const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
        '-Action', 'Snapshot',
        '-RootProcessId', String(process.pid),
        '-Port', '65534',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.root.exists, true);
    assert.equal(typeof output.root.productName, 'string');
    assert.equal(typeof output.root.companyName, 'string');
    assert.equal(typeof output.root.originalFilename, 'string');
    assert.notEqual(output.root.originalFilename.length, 0);
});

for (const commandName of ['Get-Process', 'Get-NetTCPConnection']) {
    test(`Windows helper retains uncertainty when ${commandName} fails`, { skip: process.platform !== 'win32' }, () => {
        const helper = path.join(getSkillRoot(), 'scripts', 'windows-cdp-helper.ps1').replaceAll("'", "''");
        const command = `function ${commandName} { [CmdletBinding()] param([int] $Id, [string] $State, [int] $LocalPort); Write-Error 'forced-inspection-failure' }; & '${helper}' -Action Snapshot -RootProcessId 2147483000 -Port 65534`;
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.equal(JSON.parse(result.stdout.trim()).errorCode, 'WINDOWS_HELPER_FAILED');
    });
}

test('Windows helper does not report closed when the root vanished but the CDP port still listens', { skip: process.platform !== 'win32' }, async (t) => {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const { port } = server.address();
    const helper = path.join(getSkillRoot(), 'scripts', 'windows-cdp-helper.ps1');
    const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
        '-Action', 'Close',
        '-RootProcessId', '2147483000',
        '-Port', String(port),
        '-ExecutablePath', 'C:\\missing.exe',
        '-StartedAtUtc', new Date().toISOString(),
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.closed, false);
    assert.equal(output.reason, 'listener-present');

    const relaxed = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
        '-Action', 'Close',
        '-RootProcessId', '2147483000',
        '-Port', String(port),
        '-ExecutablePath', 'C:\\missing.exe',
        '-StartedAtUtc', new Date().toISOString(),
        '-ListenerPolicy', 'ProcessIdentityOnly',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(relaxed.status, 0, relaxed.stderr);
    const relaxedOutput = JSON.parse(relaxed.stdout.trim());
    assert.equal(relaxedOutput.closed, true);
    assert.equal(relaxedOutput.reason, 'root-absent');
});

test('CLI parser preserves raw official tool arguments after -- and rejects PWA category', () => {
    assert.deepEqual(
        parseCli(['invoke', '--', 'list_pages', '--output-format=json']),
        { action: 'invoke', toolArguments: ['list_pages', '--output-format=json'] },
    );
    assert.throws(
        () => parseCli(['start', '--categoryPwa=true']),
        (error) => error.code === 'PWA_CATEGORY_UNSUPPORTED',
    );
    assert.throws(
        () => parseCli(['start', '--category-pwa=true']),
        (error) => error.code === 'PWA_CATEGORY_UNSUPPORTED',
    );
    for (const lifecycle of ['start', 'stop', 'status']) {
        assert.throws(
            () => parseCli(['invoke', '--', lifecycle]),
            (error) => error.code === 'TOOL_COMMAND_INVALID',
        );
    }
    for (const runnerOwned of [
        '--sessionId=foreign',
        '--browserUrl=http://127.0.0.1:9999',
        '--workspace=C:\\Other',
        '--categoryExtensions=true',
        '--usageStatistics=true',
    ]) {
        assert.throws(
            () => parseCli(['invoke', '--', 'list_pages', runnerOwned]),
            (error) => error.code === 'RUNNER_ARGUMENT_CONFLICT',
        );
    }
    assert.throws(
        () => parseCli(['invoke', '--', '--browserUrl=http://127.0.0.1:9999']),
        (error) => error.code === 'TOOL_COMMAND_INVALID',
    );
    assert.throws(
        () => parseCli(['invoke', '--', '--categoryPwa=true']),
        (error) => error.code === 'PWA_CATEGORY_UNSUPPORTED',
    );
    assert.deepEqual(
        parseCli(['invoke', '--', 'evaluate_script', '() => "categoryPwa"']),
        { action: 'invoke', toolArguments: ['evaluate_script', '() => "categoryPwa"'] },
    );
});

test('tool invocation parsing uses the pinned package command schema without a CLI auto-start path', () => {
    const commands = {
        evaluate_script: {
            args: {
                function: { type: 'string', required: true },
                pageId: { type: 'number', required: false },
                waitForStableDom: { type: 'boolean', required: false, default: true },
            },
        },
    };
    assert.deepEqual(parseToolInvocation({
        commands,
        toolArguments: ['evaluate_script', '() => document.title', '--pageId=7', '--waitForStableDom=false', '--output-format=json'],
    }), {
        tool: 'evaluate_script',
        args: { function: '() => document.title', pageId: 7, waitForStableDom: false },
        outputFormat: 'json',
    });
    assert.throws(
        () => parseToolInvocation({ commands, toolArguments: ['missing_tool'] }),
        (error) => error.code === 'TOOL_COMMAND_INVALID',
    );
});

test('skill root is derived from the module URL, not cwd or a Codex path', () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    assert.equal(getSkillRoot(), path.join(path.dirname(testDirectory), 'skills', 'debugging-cdp-targets'));
    assert.equal(getSkillRoot().includes(`${path.sep}.codex${path.sep}`), false);
});

test('per-user named-pipe lock serializes mutations and is released by the operating system', async () => {
    const lockEndpoint = `\\\\.\\pipe\\debugging-cdp-targets-test-${process.pid}-${Date.now()}`;
    let releaseFirst;
    let enteredFirst;
    const entered = new Promise((resolve) => { enteredFirst = resolve; });
    const hold = new Promise((resolve) => { releaseFirst = resolve; });
    const first = withSessionLock({
        lockEndpoint,
    }, async () => {
        enteredFirst();
        await hold;
        return 'first';
    });
    await entered;
    await assert.rejects(
        withSessionLock({ lockEndpoint }, async () => 'second'),
        (error) => error.code === 'SESSION_BUSY',
    );
    releaseFirst();
    assert.equal(await first, 'first');
    assert.equal(await withSessionLock({ lockEndpoint }, async () => 'reacquired'), 'reacquired');
});

test('default lock endpoint uses the new per-user namespace and stable identity inputs', () => {
    const first = getDefaultLockEndpoint({ username: 'Alice', localDataRoot: 'C:\\Users\\Alice\\AppData\\Local\\debugging-cdp-targets' });
    const same = getDefaultLockEndpoint({ username: 'Alice', localDataRoot: 'C:\\Users\\Alice\\AppData\\Local\\debugging-cdp-targets' });
    const otherUser = getDefaultLockEndpoint({ username: 'Bob', localDataRoot: 'C:\\Users\\Bob\\AppData\\Local\\debugging-cdp-targets' });
    assert.match(first, /^\\\\\.\\pipe\\debugging-cdp-targets-[0-9a-f]{24}$/);
    assert.equal(first, same);
    assert.notEqual(first, otherUser);
});
