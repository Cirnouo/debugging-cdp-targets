import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createOfficialConnection } from '../src/adapters/mcp-bridge.ts';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import { readDistributionTree } from './distribution-audit.ts';
import { PLUGIN_HOSTS } from './host-policy.ts';
import { OFFICIAL_RELEASE, validatePayloadFileInventory } from './payload-policy.ts';

async function catalog(plugin: string) {
    const directory = path.join(plugin, 'dist/official-server');
    await verifyOfficialPackage(directory, OFFICIAL_RELEASE);
    const connection = await createOfficialConnection('http://127.0.0.1:1', {
        bin: path.join(directory, OFFICIAL_RELEASE.bin),
    });
    try {
        const names = connection.tools.map((tool) => tool.name);
        assert.ok(names.includes('list_pages') && names.includes('evaluate_script'));
        console.log(
            JSON.stringify({
                version: OFFICIAL_RELEASE.version,
                tools: names.length,
                packageFiles: OFFICIAL_RELEASE.files.length,
            }),
        );
    } finally {
        // The bridge closes stdin and waits for exit; no browser/tool invocation or signals.
        await connection.close();
    }
}

async function removeSmokeWorkspace(temporary: string, temporaryBase: string) {
    if (path.dirname(temporary) !== temporaryBase || !path.basename(temporary).startsWith('dct-official-catalog-'))
        throw new Error('Unsafe smoke cleanup path.');
    await rm(temporary, { recursive: true, force: true });
}

async function smoke() {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const temporaryBase = await realpath(os.tmpdir());
    const temporary = await realpath(await mkdtemp(path.join(temporaryBase, 'dct-official-catalog-')));
    try {
        for (const host of PLUGIN_HOSTS) {
            const source = await readDistributionTree(path.join(root, host.payloadRoot));
            assert.deepEqual(validatePayloadFileInventory([...source.keys()], host), []);
            const plugin = path.join(temporary, host.id);
            for (const [name, bytes] of source) {
                await mkdir(path.dirname(path.join(plugin, name)), { recursive: true });
                await writeFile(path.join(plugin, name), bytes);
            }
            const home = path.join(temporary, `${host.id}-home`);
            await mkdir(home);
            const environment: NodeJS.ProcessEnv = {
                ...process.env,
                PATH: '',
                NODE_PATH: '',
                NODE_OPTIONS: '',
                HOME: home,
                USERPROFILE: home,
                LOCALAPPDATA: home,
                APPDATA: home,
                XDG_CACHE_HOME: home,
                XDG_CONFIG_HOME: home,
                TEMP: home,
                TMP: home,
                DCT_EXTENSIONS: 'true',
                DCT_USAGE_STATISTICS: 'false',
                DCT_PERFORMANCE_CRUX: 'false',
            };
            delete environment.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS;
            const result = await promisify(execFile)(
                process.execPath,
                [fileURLToPath(import.meta.url), '--child', plugin],
                {
                    cwd: temporary,
                    env: environment,
                    windowsHide: true,
                    shell: false,
                    timeout: 30_000,
                },
            );
            console.log(`${host.id} copied-Plugin official catalog smoke passed: ${result.stdout.trim()}`);
        }
    } finally {
        await removeSmokeWorkspace(temporary, temporaryBase);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv[2] === '--child' && process.argv[3]) await catalog(path.resolve(process.argv[3]));
    else if (process.argv.length === 2) await smoke();
    else throw new Error('Usage: node tooling/smoke-official-catalog.ts');
}
