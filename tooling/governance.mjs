import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const COMMIT_TYPES = Object.freeze([
    'build',
    'chore',
    'ci',
    'docs',
    'feat',
    'fix',
    'perf',
    'refactor',
    'revert',
    'style',
    'test',
]);

export const COMMIT_SCOPES = Object.freeze([
    'skill',
    'session',
    'target',
    'devtools',
    'windows',
    'obsidian',
    'distribution',
    'testing',
    'tooling',
    'governance',
    'dependencies',
    'release',
]);

export const BRANCH_PREFIXES = Object.freeze([
    'feat',
    'fix',
    'hotfix',
    'chore',
    'docs',
    'refactor',
    'test',
    'ci',
    'codex',
]);

const kebabPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const require = createRequire(import.meta.url);
const commitlintCli = require('@commitlint/cli');
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const commitlintConfig = fileURLToPath(new URL('../commitlint.config.mjs', import.meta.url));

export function validateCommitMessage(message, options = {}) {
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

export function validateBranchName(branchName) {
    if (branchName === 'main') {
        return [];
    }

    if (branchName.startsWith('release/')) {
        return semverPattern.test(branchName.slice('release/'.length))
            ? []
            : ['Release branches must use release/<semver> with SemVer punctuation.'];
    }

    const separator = branchName.indexOf('/');
    const prefix = branchName.slice(0, separator);
    const topic = branchName.slice(separator + 1);
    if (separator < 1 || !BRANCH_PREFIXES.includes(prefix) || !kebabPattern.test(topic)) {
        return [
            `Branch must be main or <approved-prefix>/<lowercase-kebab-topic>; approved prefixes: ${BRANCH_PREFIXES.join(', ')}.`,
        ];
    }

    return [];
}
