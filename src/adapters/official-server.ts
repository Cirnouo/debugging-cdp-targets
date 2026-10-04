import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMcpArgs } from '../domains/official-options.ts';
import { errorMessage } from '../shared/errors.ts';
import { parseOfficialReleaseEvidence } from '../shared/official-package.ts';
import { verifyOfficialPackage } from './official-package.ts';

declare const __DCT_OFFICIAL_RELEASE__: unknown;

function booleanSetting(environment: NodeJS.ProcessEnv, name: string, fallback: boolean) {
    const value = environment[name];
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be a boolean: true or false.`);
}

export function buildServerArguments(browserUrl: string, environment = process.env, mcpArgs: string[] = []) {
    const url = new URL(browserUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
        throw new Error('The official Server must connect to a local loopback browser URL.');
    }
    const extensions = booleanSetting(environment, 'DCT_EXTENSIONS', true);
    const statistics = booleanSetting(environment, 'DCT_USAGE_STATISTICS', false);
    const crux = booleanSetting(environment, 'DCT_PERFORMANCE_CRUX', false);
    const provided = parseMcpArgs(mcpArgs);
    if (provided.get('categoryPwa')?.values[0] === true)
        throw new Error(
            'Official PWA tools require a pipe-launched browser and cannot use a gateway-managed CDP endpoint.',
        );
    return [
        `--browserUrl=${browserUrl}`,
        ...(provided.has('categoryExtensions') ? [] : [`--categoryExtensions=${extensions}`]),
        ...(provided.has('usageStatistics') ? [] : [statistics ? '--usage-statistics' : '--no-usage-statistics']),
        ...(provided.has('performanceCrux') ? [] : [crux ? '--performance-crux' : '--no-performance-crux']),
        ...mcpArgs,
    ];
}

/** Read-only, module-relative resolution; every launch verifies the whole release again. */
export async function resolveServerBin(): Promise<string> {
    try {
        const packaged = typeof __DCT_OFFICIAL_RELEASE__ !== 'undefined';
        const evidence = parseOfficialReleaseEvidence(
            packaged
                ? __DCT_OFFICIAL_RELEASE__
                : JSON.parse(
                      await readFile(new URL('../../tooling/official-server-release.json', import.meta.url), 'utf8'),
                  ),
        );
        const directory = fileURLToPath(
            new URL(
                packaged ? './official-server/' : '../../plugins/debugging-cdp-targets/dist/official-server/',
                import.meta.url,
            ),
        );
        await verifyOfficialPackage(directory, evidence);
        return path.join(directory, evidence.bin);
    } catch (error) {
        throw new Error(
            `Bundled official MCP package verification failed; reinstall the Plugin or run pnpm build:plugin. ${errorMessage(error)}`,
        );
    }
}
