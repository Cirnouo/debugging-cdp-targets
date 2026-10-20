import path from 'node:path';
import { buildOfficialServerArguments } from '../gateway/official/options.ts';
import { verifyOfficialPackageFiles } from '../gateway/official/package-files.ts';
import { type OfficialReleaseEvidence, parseOfficialReleaseEvidence } from '../gateway/official/release-evidence.ts';
import { errorMessage } from '../shared/errors.ts';

export function snapshotOfficialEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return { ...environment, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1', CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1' };
}

export function buildServerArguments(
    browserUrl: string,
    environment = process.env,
    mcpArgs: string[] = [],
    windowsEnvironment = process.platform === 'win32',
) {
    return buildOfficialServerArguments(browserUrl, environment, mcpArgs, windowsEnvironment);
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
        await verifyOfficialPackageFiles(options.directory, evidence, {
            pnpmInstalled: options.pnpmInstalled === true,
        });
        return path.join(options.directory, evidence.bin);
    } catch (error) {
        throw new Error(
            `Official MCP package verification failed; rebuild the verified App or prepare its reviewed development dependency. ${errorMessage(error)}`,
        );
    }
}
