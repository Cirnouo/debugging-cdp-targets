import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NPM_REGISTRY, PACKAGE_NAME, PACKAGE_SPEC, PACKAGE_VERSION } from '../shared/constants.ts';
import { isRecord } from '../shared/errors.ts';

declare const __DCT_PACKAGED_PRELOAD__: boolean;

function booleanSetting(environment: NodeJS.ProcessEnv, name: string, fallback: boolean) {
    const value = environment[name];
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be a boolean: true or false.`);
}

export function buildServerArguments(browserUrl: string, environment = process.env) {
    const url = new URL(browserUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
        throw new Error('The official Server must connect to a local loopback browser URL.');
    }
    const extensions = booleanSetting(environment, 'DCT_EXTENSIONS', true);
    const statistics = booleanSetting(environment, 'DCT_USAGE_STATISTICS', false);
    const crux = booleanSetting(environment, 'DCT_PERFORMANCE_CRUX', false);
    return [
        `--browserUrl=${browserUrl}`,
        `--categoryExtensions=${extensions}`,
        statistics ? '--usage-statistics' : '--no-usage-statistics',
        crux ? '--performance-crux' : '--no-performance-crux',
    ];
}

function cacheRoot() {
    const home = process.platform === 'win32' ? process.env.LOCALAPPDATA : path.join(os.homedir(), '.cache');
    if (!home || !path.isAbsolute(home)) throw new Error('A user cache directory is required.');
    return path.join(home, 'debugging-cdp-targets', 'cache', 'mcp-server', 'npm-cache');
}

function packageDirectory(cache: string) {
    const hash = createHash('sha512').update(PACKAGE_SPEC).digest('hex').slice(0, 16);
    return path.join(cache, '_npx', hash, 'node_modules', PACKAGE_NAME);
}

function npxLaunch(): [string, string[]] {
    const adjacent = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (existsSync(adjacent)) return [process.execPath, [adjacent]];
    if (process.platform === 'win32') {
        const where = spawnSync('where.exe', ['npx.exe'], { encoding: 'utf8', windowsHide: true, shell: false });
        const executable = where.stdout?.split(/\r?\n/).find((value) => value.endsWith('.exe'));
        if (executable) return [executable, []];
    } else {
        return ['npx', []];
    }
    throw new Error('A shell-free npx launcher is unavailable.');
}

export async function prepareServerBin() {
    const cache = cacheRoot();
    await mkdir(cache, { recursive: true });
    const [command, prefix] = npxLaunch();
    const environment = {
        ...process.env,
        NODE_OPTIONS:
            process.platform === 'win32'
                ? `--import="${new URL(typeof __DCT_PACKAGED_PRELOAD__ !== 'undefined' && __DCT_PACKAGED_PRELOAD__ ? './hide-npm-console.cjs' : './hide-npm-console.ts', import.meta.url).href}"`
                : '',
        NPM_CONFIG_CACHE: cache,
        NPM_CONFIG_REGISTRY: NPM_REGISTRY,
        NPM_CONFIG_IGNORE_SCRIPTS: 'true',
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    };
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(command, [...prefix, '--yes', '--package', PACKAGE_SPEC, PACKAGE_NAME, '--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false,
            env: environment,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
    if (result.code !== 0 || result.stdout.trim() !== PACKAGE_VERSION) {
        throw new Error(`Could not acquire ${PACKAGE_SPEC}: ${result.stderr.trim()}`);
    }
    const root = await realpath(packageDirectory(cache));
    const manifest: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const lock: unknown = JSON.parse(await readFile(path.join(root, '..', '..', 'package-lock.json'), 'utf8'));
    if (!isRecord(manifest) || !isRecord(lock) || !isRecord(lock.packages))
        throw new Error('Invalid cached package metadata.');
    const locked = lock.packages[`node_modules/${PACKAGE_NAME}`];
    if (
        manifest.name !== PACKAGE_NAME ||
        manifest.version !== PACKAGE_VERSION ||
        !isRecord(locked) ||
        locked.version !== PACKAGE_VERSION ||
        locked?.resolved !== `${NPM_REGISTRY}/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz` ||
        typeof locked.integrity !== 'string' ||
        !locked.integrity.startsWith('sha512-')
    ) {
        throw new Error('The cached official MCP package failed provenance verification.');
    }
    const relativeBin = isRecord(manifest.bin) ? manifest.bin[PACKAGE_NAME] : manifest.bin;
    if (typeof relativeBin !== 'string' || !relativeBin || path.isAbsolute(relativeBin))
        throw new Error('The package has no public Server bin.');
    const bin = await realpath(path.resolve(root, relativeBin));
    if (!bin.startsWith(`${root}${path.sep}`)) throw new Error('The Server bin escapes the verified package.');
    return bin;
}

export async function startOfficialServer(browserUrl: string) {
    const arguments_ = buildServerArguments(browserUrl);
    const bin = await prepareServerBin();
    const child = spawn(process.execPath, [bin, ...arguments_], {
        stdio: 'inherit',
        windowsHide: true,
        shell: false,
    });
    await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    return child;
}
