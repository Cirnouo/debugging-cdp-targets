import { parseMcpArgs } from '../official/options.ts';

export function describeWorkspacePolicy(mcpArgs: string[], supportsRoots: boolean, temporaryDirectory: string) {
    const args = parseMcpArgs(mcpArgs);
    return {
        officialDirectories: args.get('filesystemRoot')?.values ?? [temporaryDirectory],
        officialSource: args.has('filesystemRoot') ? 'explicit-workspace' : 'system-temporary-directory',
        clientRoots: supportsRoots ? 'immutable-start-snapshot' : 'not-negotiated',
        unrestrictedPaths: args.get('allowUnrestrictedPaths')?.values[0] === true,
        cwdGrantsAccess: false,
    };
}
