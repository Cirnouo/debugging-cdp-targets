import path from 'node:path';
import { findEnvironmentKey } from '../domains/launch-command.ts';
import { parseMcpArgs } from '../domains/official-options.ts';
import { errorMessage } from '../shared/errors.ts';
import { type OfficialReleaseEvidence, parseOfficialReleaseEvidence } from '../shared/official-package.ts';
import { verifyOfficialPackage } from './official-package.ts';

export function snapshotOfficialEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return { ...environment, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1', CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1' };
}

function booleanSetting(environment: NodeJS.ProcessEnv, name: string, fallback: boolean, windows: boolean) {
    const key = findEnvironmentKey(environment, name, windows);
    const value = key === undefined ? undefined : environment[key];
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be a boolean: true or false.`);
}

export function buildServerArguments(
    browserUrl: string,
    environment = process.env,
    mcpArgs: string[] = [],
    windowsEnvironment = process.platform === 'win32',
) {
    const url = new URL(browserUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
        throw new Error('The official Server must connect to a local loopback browser URL.');
    }
    const extensions = booleanSetting(environment, 'DCT_EXTENSIONS', true, windowsEnvironment);
    const statistics = booleanSetting(environment, 'DCT_USAGE_STATISTICS', false, windowsEnvironment);
    const crux = booleanSetting(environment, 'DCT_PERFORMANCE_CRUX', false, windowsEnvironment);
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

/** Trusted explicit input only. Missing App/runtime location never discovers another installation. */
export async function resolveServerBin(options?: {
    directory: string;
    release: OfficialReleaseEvidence;
    pnpmInstalled?: boolean;
}): Promise<string> {
    try {
        if (!options || !path.isAbsolute(options.directory))
            throw new Error('Explicit verified runtime location is required.');
        const evidence = parseOfficialReleaseEvidence(options.release);
        await verifyOfficialPackage(options.directory, evidence, { pnpmInstalled: options.pnpmInstalled === true });
        return path.join(options.directory, evidence.bin);
    } catch (error) {
        throw new Error(
            `Official MCP package verification failed; rebuild the verified App or prepare its reviewed development dependency. ${errorMessage(error)}`,
        );
    }
}
