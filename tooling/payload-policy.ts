import type { HostDescriptor } from './host-policy.ts';
import { CODEX_HOST } from './host-policy.ts';

export { PLUGIN_NAME, PLUGIN_ROOT } from './host-policy.ts';
export function requiredPayloadFiles(host: HostDescriptor = CODEX_HOST) {
    return Object.freeze([
        'LICENSE',
        'README.md',
        ...host.assets.map((file) => `assets/${file}`),
        ...Object.values(host.files).filter((file) => file !== 'README.md'),
        'skills/README.md',
        'skills/debugging-cdp-targets/README.md',
        'skills/debugging-cdp-targets/SKILL.md',
        'skills/debugging-cdp-targets/references/README.md',
        'skills/debugging-cdp-targets/references/question-contract.md',
        'skills/debugging-cdp-targets/references/questions.zh.md',
        'skills/debugging-cdp-targets/references/questions.en.md',
        'skills/debugging-cdp-targets/references/tool-configuration.md',
        'skills/debugging-cdp-targets/references/screenshot-compatibility.md',
        'skills/debugging-cdp-targets/references/recovery-and-events.md',
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
