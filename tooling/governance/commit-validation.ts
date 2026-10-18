import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const loadedCli: unknown = require('@commitlint/cli');
if (typeof loadedCli !== 'string') throw new Error('Invalid commitlint CLI entry.');
const commitlintCli = loadedCli;
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const commitlintConfig = fileURLToPath(new URL('../../commitlint.config.ts', import.meta.url));

export function validateCommitMessage(message: string, options: { isMerge?: boolean } = {}) {
    if (options.isMerge === true) {
        return [];
    }

    const result = spawnSync(
        process.execPath,
        [commitlintCli, '--config', commitlintConfig, '--cwd', repositoryRoot, '--color=false'],
        {
            encoding: 'utf8',
            input: message,
            windowsHide: true,
        },
    );
    if (result.error) {
        throw result.error;
    }
    if (result.status === 0) {
        return [];
    }

    const output = [result.stdout, result.stderr]
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .trim();
    if (result.status !== 1) {
        throw new Error(output || `commitlint exited with status ${result.status}.`);
    }

    return [output || 'Commit message violates the repository commitlint configuration.'];
}
