import { isSemVer } from '../../src/domains/software-version.ts';

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
    'app',
    'distribution',
    'testing',
    'tooling',
    'governance',
    'dependencies',
    'release',
]);

export const BRANCH_PREFIXES = Object.freeze(['feat', 'fix', 'hotfix', 'chore']);

const kebabPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateBranchName(branchName: string) {
    if (branchName === 'main') {
        return [];
    }

    if (branchName.startsWith('release/')) {
        return isSemVer(branchName.slice('release/'.length))
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
