import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMessage } from '../../src/shared/errors.ts';
import { PLUGIN_HOSTS } from '../distribution/host-descriptors.ts';
import { validateTextStyle, validateYamlFilename } from './text-policy.ts';

export async function checkTextStyle(root: string, arguments_: readonly string[]) {
    const paths = arguments_.map((argument) => {
        const absolute = path.resolve(root, argument);
        return { absolute, relative: path.relative(root, absolute).replaceAll('\\', '/') };
    });
    const errors = [];
    for (const { absolute, relative } of paths) {
        if (PLUGIN_HOSTS.some((host) => relative.startsWith(`${host.payloadRoot}/dist/`))) {
            errors.push(`${relative}: retired thin runtime path must not ship.`);
            continue;
        }
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
