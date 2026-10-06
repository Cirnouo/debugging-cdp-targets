import { readFileSync } from 'node:fs';
import { parseOfficialReleaseEvidence } from '../src/shared/official-package.ts';
import type { HostDescriptor } from './host-policy.ts';
import { CODEX_HOST } from './host-policy.ts';

export { PLUGIN_NAME, PLUGIN_ROOT } from './host-policy.ts';
export const OFFICIAL_RELEASE = parseOfficialReleaseEvidence(
    JSON.parse(readFileSync(new URL('./official-server-release.json', import.meta.url), 'utf8')),
);
export function requiredPayloadFiles(host: HostDescriptor = CODEX_HOST) {
    return Object.freeze([
        'LICENSE',
        'README.md',
        ...host.assets.map((file) => `assets/${file}`),
        ...Object.values(host.files).filter((file) => file !== 'README.md'),
        'dist/README.md',
        'dist/THIRD-PARTY-NOTICES.txt',
        'dist/mcp-bootstrap.mjs',
        'dist/windows-cdp-helper.ps1',
        'dist/windows-native-helper.ps1',
        'dist/windows-native-process.cs',
        'skills/README.md',
        'skills/debugging-cdp-targets/README.md',
        'skills/debugging-cdp-targets/SKILL.md',
        ...OFFICIAL_RELEASE.files.map((file) => `dist/official-server/${file.path}`),
    ]);
}
export const REQUIRED_PAYLOAD_FILES = requiredPayloadFiles();

export function validatePayloadFileInventory(paths: readonly string[], host: HostDescriptor = CODEX_HOST) {
    const required = requiredPayloadFiles(host);
    const errors = [];
    for (const file of paths) if (!required.includes(file)) errors.push(`Unexpected Plugin file: ${file}`);
    for (const file of required) if (!paths.includes(file)) errors.push(`Missing Plugin file: ${file}`);
    if (new Set(paths).size !== paths.length) errors.push('Duplicate Plugin inventory entries.');
    return errors;
}
