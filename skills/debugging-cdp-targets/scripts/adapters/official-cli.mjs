import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fail } from '../shared/errors.mjs';
import { parseSemver, validatePackageSpec } from '../shared/semver.mjs';
import { getDaemonSessionId, parseToolInvocation } from '../domains/devtools-bridge/contracts.mjs';
import { getSkillRoot, buildCliRuntimePaths, assertFile } from './local-data.mjs';
import { OFFICIAL_NPM_REGISTRY } from '../shared/constants.mjs';

export function getNpxPackageRoot({ cacheRoot, packageSpec }) {
    validatePackageSpec(packageSpec);
    if (!path.isAbsolute(cacheRoot)) fail('CLI_RUNTIME_INVALID', 'The npm cache root must be absolute.');
    if (packageSpec.endsWith('@latest')) fail('PACKAGE_VERSION_INVALID', 'An exact package version is required to locate the pinned CLI.');
    const installHash = createHash('sha512').update(packageSpec).digest('hex').slice(0, 16);
    return path.join(cacheRoot, '_npx', installHash, 'node_modules', 'chrome-devtools-mcp');
}

export function selectNpxLaunch({ processExecutable, adjacentNpxExists, pathCandidates = [] }) {
    const adjacent = path.join(path.dirname(processExecutable), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (adjacentNpxExists) return { executable: processExecutable, prefixArguments: [adjacent] };
    const executable = pathCandidates.find((candidate) => path.extname(candidate).toLocaleLowerCase('en-US') === '.exe');
    if (executable) return { executable, prefixArguments: [] };
    fail('NPX_NOT_FOUND', 'No shell-free npx executable is available from the current Node runtime or PATH.');
}

export async function getNpxLaunch() {
    const adjacent = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    let adjacentNpxExists = false;
    try {
        adjacentNpxExists = (await stat(adjacent)).isFile();
    } catch { /* Fall back to a shell-free npx.exe on PATH. */ }
    const where = spawnSync('where.exe', ['npx.exe'], { encoding: 'utf8', windowsHide: true, shell: false });
    const pathCandidates = where.status === 0
        ? where.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
        : [];
    return selectNpxLaunch({ processExecutable: process.execPath, adjacentNpxExists, pathCandidates });
}

export function consolePreloadPath() {
    return path.join(getSkillRoot(), 'scripts', 'hide-mcp-console.cjs');
}

export function buildNpxEnvironment({
    baseEnvironment = process.env,
    preloadPath = consolePreloadPath(),
    runtimePaths = buildCliRuntimePaths(),
} = {}) {
    if (typeof preloadPath !== 'string' || !path.isAbsolute(preloadPath) || preloadPath.includes('"')) {
        fail('CONSOLE_PRELOAD_INVALID', 'The hidden-console preload must use a quote-free absolute path.');
    }
    const sanitized = {};
    for (const [name, value] of Object.entries(baseEnvironment)) {
        const normalized = name.toLowerCase();
        if (normalized.startsWith('npm_config_') || normalized === 'node_path' || normalized === 'node_options' || normalized === 'init_cwd') continue;
        sanitized[name] = value;
    }
    const nodeOptionPath = preloadPath.replaceAll('\\', '/');
    const requireOption = `--require="${nodeOptionPath}"`;
    return {
        ...sanitized,
        NODE_OPTIONS: requireOption,
        NPM_CONFIG_CACHE: runtimePaths.cacheRoot,
        NPM_CONFIG_USERCONFIG: runtimePaths.userConfigPath,
        NPM_CONFIG_GLOBALCONFIG: runtimePaths.globalConfigPath,
        NPM_CONFIG_REGISTRY: OFFICIAL_NPM_REGISTRY,
        NPM_CONFIG_IGNORE_SCRIPTS: 'true',
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    };
}

export async function ensureCliRuntime(runtimePaths = buildCliRuntimePaths()) {
    await mkdir(runtimePaths.workingDirectory, { recursive: true });
    await mkdir(runtimePaths.cacheRoot, { recursive: true });
    await writeFile(runtimePaths.userConfigPath, [
        `registry=${OFFICIAL_NPM_REGISTRY}`,
        'ignore-scripts=true',
        'audit=false',
        'fund=false',
        'update-notifier=false',
        '',
    ].join('\n'), { encoding: 'utf8' });
    await writeFile(runtimePaths.globalConfigPath, '', { encoding: 'utf8' });
    return runtimePaths;
}

export async function runNpx(arguments_) {
    const launch = await getNpxLaunch();
    const preload = consolePreloadPath();
    const runtimePaths = await ensureCliRuntime();
    await assertFile(preload, 'CONSOLE_PRELOAD_MISSING', `The hidden-console preload is missing at ${preload}.`);
    const result = spawnSync(launch.executable, [...launch.prefixArguments, ...arguments_], {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
        cwd: runtimePaths.workingDirectory,
        env: buildNpxEnvironment({ preloadPath: preload, runtimePaths }),
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) fail('NPX_EXECUTION_FAILED', result.error.message);
    return { exitCode: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export async function resolveInsidePackage(packageRoot, relativePath, code) {
    if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
        fail(code, 'The pinned package declared an invalid internal path.');
    }
    const root = await realpath(packageRoot);
    const candidate = await realpath(path.resolve(root, relativePath));
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail(code, 'The pinned package path escapes its package root.');
    await assertFile(candidate, code, `The pinned package file is missing: ${candidate}`);
    return candidate;
}

export async function verifyOfficialCliRuntime(version) {
    parseSemver(version);
    const runtimePaths = await ensureCliRuntime();
    const packageSpec = `chrome-devtools-mcp@${version}`;
    const packageRoot = getNpxPackageRoot({ cacheRoot: runtimePaths.cacheRoot, packageSpec });
    let manifest;
    let lock;
    try {
        manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
        lock = JSON.parse(await readFile(path.join(path.dirname(path.dirname(packageRoot)), 'package-lock.json'), 'utf8'));
    } catch (error) {
        fail('CLI_PROVENANCE_INVALID', 'The pinned chrome-devtools-mcp installation metadata is missing or invalid.', { cause: error.message });
    }
    const lockEntry = lock.packages?.['node_modules/chrome-devtools-mcp'];
    const officialTarballUrl = `https://registry.npmjs.org/chrome-devtools-mcp/-/chrome-devtools-mcp-${version}.tgz`;
    if (
        manifest.name !== 'chrome-devtools-mcp'
        || manifest.version !== version
        || lockEntry?.version !== version
        || typeof lockEntry.resolved !== 'string'
        || lockEntry.resolved !== officialTarballUrl
        || typeof lockEntry.integrity !== 'string'
        || !lockEntry.integrity.startsWith('sha512-')
    ) {
        fail('CLI_PROVENANCE_INVALID', 'The pinned CLI does not match the official registry package metadata.');
    }
    const binPath = typeof manifest.bin === 'object' ? manifest.bin['chrome-devtools'] : undefined;
    const entryPoint = await resolveInsidePackage(packageRoot, binPath, 'CLI_ENTRYPOINT_INVALID');
    const clientModule = await resolveInsidePackage(packageRoot, 'build/src/daemon/client.js', 'CLI_CLIENT_INVALID');
    const daemonUtilsModule = await resolveInsidePackage(packageRoot, 'build/src/daemon/utils.js', 'CLI_CLIENT_INVALID');
    const commandSchemaModule = await resolveInsidePackage(packageRoot, 'build/src/config/cli-options.js', 'CLI_SCHEMA_INVALID');
    return { runtimePaths, packageRoot, entryPoint, clientModule, daemonUtilsModule, commandSchemaModule };
}

export async function preparePinnedCli(version) {
    const packageSpec = `chrome-devtools-mcp@${version}`;
    const result = await runNpx(['--yes', '--package', packageSpec, 'chrome-devtools', '--version']);
    if (result.exitCode !== 0 || String(result.stdout).trim() !== version) {
        fail('CLI_PIN_FAILED', `The exact ${packageSpec} CLI could not be prepared.`, { stderr: result.stderr.trim() });
    }
    return verifyOfficialCliRuntime(version);
}

export async function runOfficialCli(version, arguments_) {
    const runtime = await verifyOfficialCliRuntime(version);
    const preload = consolePreloadPath();
    const result = spawnSync(process.execPath, [runtime.entryPoint, ...arguments_], {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
        cwd: runtime.runtimePaths.workingDirectory,
        env: buildNpxEnvironment({ preloadPath: preload, runtimePaths: runtime.runtimePaths }),
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) fail('CLI_EXECUTION_FAILED', result.error.message);
    return { exitCode: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export async function spawnOfficialCliDetached(version, arguments_) {
    const runtime = await verifyOfficialCliRuntime(version);
    const preload = consolePreloadPath();
    const child = spawn(process.execPath, [runtime.entryPoint, ...arguments_], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
        cwd: runtime.runtimePaths.workingDirectory,
        env: buildNpxEnvironment({ preloadPath: preload, runtimePaths: runtime.runtimePaths }),
    });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    child.unref();
    return child.pid;
}

export async function loadOfficialCliRuntime(version) {
    const runtime = await verifyOfficialCliRuntime(version);
    const [client, daemonUtils, schema] = await Promise.all([
        import(pathToFileURL(runtime.clientModule).href),
        import(pathToFileURL(runtime.daemonUtilsModule).href),
        import(pathToFileURL(runtime.commandSchemaModule).href),
    ]);
    if (
        typeof client.sendCommand !== 'function'
        || typeof client.handleResponse !== 'function'
        || typeof daemonUtils.isDaemonRunning !== 'function'
        || !schema.commands
    ) {
        fail('CLI_CLIENT_INVALID', 'The pinned CLI client modules do not expose the required official interfaces.');
    }
    return { ...runtime, sendCommand: client.sendCommand, handleResponse: client.handleResponse, isDaemonRunning: daemonUtils.isDaemonRunning, commands: schema.commands };
}

export async function getOfficialDaemonStatus(state) {
    const runtime = await loadOfficialCliRuntime(state.resolvedPackageVersion);
    const sessionId = getDaemonSessionId(state);
    if (!runtime.isDaemonRunning(sessionId)) {
        return { running: false, processId: 0, version: '', arguments: [] };
    }
    let response;
    try {
        response = await runtime.sendCommand({ method: 'status' }, sessionId);
    } catch (error) {
        fail('DAEMON_STATUS_INVALID', 'The pinned official client could not verify the daemon status.', { cause: error.message });
    }
    if (!response?.success) fail('DAEMON_STATUS_INVALID', 'The daemon rejected its status request.', { error: response?.error });
    let data;
    try { data = JSON.parse(response.result); } catch (error) {
        fail('DAEMON_STATUS_INVALID', 'The daemon returned invalid status JSON.', { cause: error.message });
    }
    if (!Number.isInteger(data.pid) || typeof data.version !== 'string' || !Array.isArray(data.args)) {
        fail('DAEMON_STATUS_INVALID', 'The daemon returned an invalid status payload.');
    }
    return { running: true, processId: data.pid, version: data.version, arguments: data.args };
}

export async function invokeOfficialTool(state, toolArguments) {
    const runtime = await loadOfficialCliRuntime(state.resolvedPackageVersion);
    const invocation = parseToolInvocation({ commands: runtime.commands, toolArguments });
    let response;
    try {
        response = await runtime.sendCommand({
            method: 'invoke_tool',
            tool: invocation.tool,
            args: invocation.args,
        }, getDaemonSessionId(state));
    } catch (error) {
        fail('DAEMON_COMMAND_FAILED', 'The existing managed daemon became unavailable; no replacement daemon or browser was started.', { cause: error.message });
    }
    if (!response?.success) {
        return { exitCode: 1, stdout: '', stderr: `Error: ${response?.error || 'The daemon rejected the tool request.'}\n` };
    }
    let callToolResult;
    try { callToolResult = JSON.parse(response.result); } catch (error) {
        fail('DAEMON_COMMAND_FAILED', 'The daemon returned invalid tool result JSON.', { cause: error.message });
    }
    const output = await runtime.handleResponse(callToolResult, invocation.outputFormat);
    return { exitCode: 0, stdout: `${output}\n`, stderr: '' };
}
