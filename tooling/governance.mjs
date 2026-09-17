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

const commitHeaderPattern = /^(?<type>[a-z]+)\((?<scope>[^)]+)\)(?<breaking>!)?: (?<subject>.+)$/;
const kebabPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export function validateCommitMessage(message, options = {}) {
    if (options.isMerge === true) {
        return [];
    }

    const normalized = message.replace(/\r\n?/g, '\n').trimEnd();
    const [header = '', ...rest] = normalized.split('\n');
    const errors = [];
    const match = commitHeaderPattern.exec(header);

    if (header.length > 100) {
        errors.push('Commit header must not exceed 100 characters.');
    }

    if (!match) {
        errors.push('Commit header must use type(lowercase-kebab-scope): nonempty subject.');
    } else {
        const { type, scope, subject } = match.groups;
        if (!COMMIT_TYPES.includes(type)) {
            errors.push(`Commit type must be one of: ${COMMIT_TYPES.join(', ')}.`);
        }
        if (!kebabPattern.test(scope) || !COMMIT_SCOPES.includes(scope)) {
            errors.push(`Commit scope must be one lowercase kebab scope from: ${COMMIT_SCOPES.join(', ')}.`);
        }
        if (subject.trim().length === 0) {
            errors.push('Commit subject must not be empty.');
        }
        if (subject.endsWith('.')) {
            errors.push('Commit subject must not end with a period.');
        }
        if (/^[^A-Za-z]*[A-Z]/.test(subject)) {
            errors.push('Commit subject must use lower-case sentence style.');
        }
    }

    if (rest.length > 0 && rest[0] !== '') {
        errors.push('Commit body or footer must be preceded by a blank line.');
    }

    for (const line of rest.slice(1)) {
        if (line.length > 100) {
            errors.push('Commit body and footer lines must not exceed 100 characters.');
            break;
        }
    }

    const footerIndex = rest.findIndex((line) => /^BREAKING CHANGE:\s*\S/.test(line));
    if (footerIndex > 0 && rest[footerIndex - 1] !== '') {
        errors.push('Commit footer must be preceded by a blank line.');
    }

    return errors;
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
