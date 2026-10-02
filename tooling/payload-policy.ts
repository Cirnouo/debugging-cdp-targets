import { readFileSync } from 'node:fs';
import { parseOfficialReleaseEvidence } from '../src/shared/official-package.ts';

export const PLUGIN_NAME = 'debugging-cdp-targets';
export const PLUGIN_ROOT = `plugins/${PLUGIN_NAME}`;
export const OFFICIAL_RELEASE = parseOfficialReleaseEvidence(
    JSON.parse(readFileSync(new URL('./official-server-release.json', import.meta.url), 'utf8')),
);
export const REQUIRED_PAYLOAD_FILES = Object.freeze([
    'LICENSE',
    'README.md',
    '.codex-plugin/README.md',
    '.codex-plugin/plugin.json',
    'mcp.json',
    'hooks/README.md',
    'hooks/hooks.json',
    'dist/README.md',
    'dist/THIRD-PARTY-NOTICES.txt',
    'dist/control.mjs',
    'dist/mcp-bootstrap.mjs',
    'dist/hide-npm-console.cjs',
    'dist/windows-cdp-helper.ps1',
    'skills/README.md',
    'skills/debugging-cdp-targets/README.md',
    'skills/debugging-cdp-targets/SKILL.md',
    ...OFFICIAL_RELEASE.files.map((file) => `dist/official-server/${file.path}`),
]);

export function validatePayloadFileInventory(paths: readonly string[]) {
    const errors = [];
    for (const file of paths)
        if (!REQUIRED_PAYLOAD_FILES.includes(file)) errors.push(`Unexpected Plugin file: ${file}`);
    for (const file of REQUIRED_PAYLOAD_FILES) if (!paths.includes(file)) errors.push(`Missing Plugin file: ${file}`);
    if (new Set(paths).size !== paths.length) errors.push('Duplicate Plugin inventory entries.');
    return errors;
}
