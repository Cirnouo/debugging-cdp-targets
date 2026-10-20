import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAppOfficialRuntime } from '../src/adapters/app-official-runtime.ts';
import { createOfficialConnection } from '../src/adapters/mcp-bridge.ts';
import { resolveVerifiedOfficialServerBin } from '../src/gateway/official/server-launch.ts';
import { OFFICIAL_RELEASE } from './official-release.ts';
import { isStableVersion } from './version-policy.ts';

type Source = { kind: 'installed' } | { kind: 'stage'; directory: string };
export function parseOfficialSmokeArguments(args: string[]): Source {
    if (args.length === 1 && args[0] === '--installed') return { kind: 'installed' };
    if (args.length === 2 && args[0] === '--stage' && args[1] && path.isAbsolute(args[1]))
        return { kind: 'stage', directory: args[1] };
    throw new Error('Select exactly --installed or --stage <absolute-verified-App-stage>.');
}

async function removeSmokeWorkspace(home: string, temporaryBase: string) {
    if (path.dirname(home) !== temporaryBase || !path.basename(home).startsWith('dct-official-catalog-'))
        throw new Error('Unsafe smoke cleanup path.');
    await rm(home, { recursive: true, force: true });
}

/** Explicit research modes only; catalog initialization never launches a target. */
export async function smokeOfficialCatalog(source: Source) {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (
        process.versions.electron ||
        !isStableVersion(process.versions.node) ||
        major !== 24 ||
        minor === undefined ||
        minor < 21
    )
        throw new Error('A supported stable ordinary Node 24 runtime is required.');
    const resources = source.kind === 'stage' ? path.join(source.directory, 'resources') : '';
    const runtime =
        source.kind === 'stage'
            ? await verifyAppOfficialRuntime({
                  directory: path.join(resources, 'app'),
                  resources,
                  platform: process.platform,
                  architecture: process.arch,
              })
            : {
                  nodeExecutable: process.execPath,
                  bin: await resolveVerifiedOfficialServerBin({
                      directory: await realpath(
                          fileURLToPath(new URL('../node_modules/chrome-devtools-mcp/', import.meta.url)),
                      ),
                      release: OFFICIAL_RELEASE,
                      pnpmInstalled: true,
                  }),
              };
    const temporaryBase = await realpath(os.tmpdir());
    const home = await realpath(await mkdtemp(path.join(temporaryBase, 'dct-official-catalog-')));
    try {
        const connection = await createOfficialConnection('http://127.0.0.1:1', {
            ...runtime,
            cwd: home,
            environment: {
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
            },
        });
        try {
            const names = connection.tools.map((tool) => tool.name);
            assert.ok(names.includes('list_pages') && names.includes('evaluate_script'));
            console.log(
                JSON.stringify({
                    source: source.kind,
                    toolCount: names.length,
                    ordinaryNode: true,
                    originalPublicBin: true,
                }),
            );
        } finally {
            await connection.close();
        }
    } finally {
        await removeSmokeWorkspace(home, temporaryBase);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await smokeOfficialCatalog(parseOfficialSmokeArguments(process.argv.slice(2)));
}
