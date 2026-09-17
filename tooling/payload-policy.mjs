export const SKILL_NAME = 'debugging-cdp-targets';
export const SKILL_ROOT = `skills/${SKILL_NAME}`;

export const REQUIRED_PAYLOAD_FILES = Object.freeze([
    'LICENSE',
    'README.md',
    'SKILL.md',
    'agents/README.md',
    'agents/openai.yaml',
    'references/README.md',
    'references/obsidian.md',
    'scripts/AGENTS.md',
    'scripts/README.md',
    'scripts/cdp-session.mjs',
    'scripts/hide-mcp-console.cjs',
    'scripts/windows-cdp-helper.ps1',
    'scripts/adapters/AGENTS.md',
    'scripts/adapters/README.md',
    'scripts/application/AGENTS.md',
    'scripts/application/README.md',
    'scripts/domains/AGENTS.md',
    'scripts/domains/README.md',
    'scripts/interface/AGENTS.md',
    'scripts/interface/README.md',
    'scripts/shared/AGENTS.md',
    'scripts/shared/README.md',
]);

const allowedFiles = [
    /^(?:LICENSE|README\.md|SKILL\.md)$/,
    /^agents\/(?:README\.md|openai\.yaml)$/,
    /^references\/(?:README\.md|[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/,
    /^scripts\/(?:AGENTS\.md|README\.md|cdp-session\.mjs|hide-mcp-console\.cjs|windows-cdp-helper\.ps1)$/,
    /^scripts\/(?:adapters|application|interface|shared)\/(?:AGENTS\.md|README\.md|[a-z0-9]+(?:-[a-z0-9]+)*\.mjs)$/,
    /^scripts\/domains\/(?:AGENTS\.md|README\.md)$/,
    /^scripts\/domains\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:AGENTS\.md|README\.md|[a-z0-9]+(?:-[a-z0-9]+)*\.mjs)$/,
];

export function validatePayloadFileInventory(relativeFilePaths) {
    const paths = [...relativeFilePaths].sort();
    const present = new Set(paths);
    const errors = [];

    for (const filePath of paths) {
        if (!allowedFiles.some((pattern) => pattern.test(filePath))) {
            errors.push(`Payload path ${filePath} is not in the explicit production inventory.`);
        }
    }
    for (const required of REQUIRED_PAYLOAD_FILES) {
        if (!present.has(required)) {
            errors.push(`Payload required file ${required} is missing.`);
        }
    }
    return errors;
}
