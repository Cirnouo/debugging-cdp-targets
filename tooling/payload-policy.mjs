export const PLUGIN_NAME = 'debugging-cdp-targets';
export const PLUGIN_ROOT = `plugins/${PLUGIN_NAME}`;
export const REQUIRED_PAYLOAD_FILES = Object.freeze([
    'LICENSE',
    'README.md',
    'plugin.json',
    'mcp.json',
    'dist/README.md',
    'dist/THIRD-PARTY-NOTICES.txt',
    'dist/control.mjs',
    'dist/mcp-bootstrap.mjs',
    'dist/hide-npm-console.cjs',
    'dist/windows-cdp-helper.ps1',
    'skills/README.md',
    'skills/debugging-cdp-targets/README.md',
    'skills/debugging-cdp-targets/SKILL.md',
]);

export function validatePayloadFileInventory(paths) {
    const errors = [];
    for (const file of paths)
        if (!REQUIRED_PAYLOAD_FILES.includes(file)) errors.push(`Unexpected Plugin file: ${file}`);
    for (const file of REQUIRED_PAYLOAD_FILES) if (!paths.includes(file)) errors.push(`Missing Plugin file: ${file}`);
    if (new Set(paths).size !== paths.length) errors.push('Duplicate Plugin inventory entries.');
    return errors;
}
