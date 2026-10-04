import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import { errorMessage } from '../src/shared/errors.ts';
import { parseOfficialReleaseEvidence } from '../src/shared/official-package.ts';
import { PLUGIN_ROOT } from './host-policy.ts';
import { validateTextStyle } from './repository-audit.ts';

export async function checkTextStyle(root: string, arguments_: readonly string[]) {
    const paths = arguments_.map((argument) => {
        const absolute = path.resolve(root, argument);
        return { absolute, relative: path.relative(root, absolute).replaceAll('\\', '/') };
    });
    const officialPrefix = `${PLUGIN_ROOT}/dist/official-server/`;
    const verified = new Set<string>();
    if (paths.some(({ relative }) => relative.startsWith(officialPrefix))) {
        const release = parseOfficialReleaseEvidence(
            JSON.parse(await readFile(path.join(root, 'tooling/official-server-release.json'), 'utf8')),
        );
        const files = await verifyOfficialPackage(path.join(root, officialPrefix), release);
        for (const file of files.keys()) verified.add(officialPrefix + file);
    }
    const errors = [];
    for (const { absolute, relative } of paths) {
        if (verified.has(relative)) continue;
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
