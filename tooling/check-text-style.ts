import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOfficialPackageFiles } from '../src/gateway/official/package-files.ts';
import { parseOfficialReleaseEvidence } from '../src/gateway/official/release-evidence.ts';
import { errorMessage } from '../src/shared/errors.ts';
import { PLUGIN_HOSTS } from './distribution/host-descriptors.ts';
import { validateTextStyle, validateYamlFilename } from './quality/text-policy.ts';

export async function checkTextStyle(root: string, arguments_: readonly string[]) {
    const paths = arguments_.map((argument) => {
        const absolute = path.resolve(root, argument);
        return { absolute, relative: path.relative(root, absolute).replaceAll('\\', '/') };
    });
    const verified = new Set<string>();
    for (const host of PLUGIN_HOSTS) {
        const officialPrefix = `${host.payloadRoot}/dist/official-server/`;
        if (!paths.some(({ relative }) => relative.startsWith(officialPrefix))) continue;
        const release = parseOfficialReleaseEvidence(
            JSON.parse(await readFile(path.join(root, 'tooling/official-server-release.json'), 'utf8')),
        );
        const files = await verifyOfficialPackageFiles(path.join(root, officialPrefix), release);
        for (const file of files.keys()) verified.add(officialPrefix + file);
    }
    const errors = [];
    for (const { absolute, relative } of paths) {
        if (verified.has(relative)) continue;
        errors.push(...validateYamlFilename(relative));
        errors.push(...validateTextStyle(relative, await readFile(absolute, 'utf8')));
    }
    return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const errors = await checkTextStyle(process.cwd(), process.argv.slice(2));
        if (errors.length > 0) throw new Error(errors.map((error) => `- ${error}`).join('\n'));
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
    }
}
