export const PLUGIN_NAME = 'debugging-cdp-targets';
export const SHARED_PACKAGING_ROOT = 'packaging/shared';
export const CODEX_HOST = Object.freeze({
    inputRoot: 'packaging/codex',
    payloadRoot: 'plugins/codex/debugging-cdp-targets',
    manifest: '.codex-plugin/plugin.json',
    mcp: 'mcp.json',
    hooks: 'hooks/hooks.json',
    files: Object.freeze({
        '.codex-plugin/README.md': '.codex-plugin/README.md',
        '.codex-plugin/plugin.json': '.codex-plugin/plugin.json',
        'mcp.json': 'mcp.json',
        'hooks/README.md': 'hooks/README.md',
        'hooks/hooks.json': 'hooks/hooks.json',
        'plugin-README.md': 'README.md',
    }),
});
export const PLUGIN_ROOT = CODEX_HOST.payloadRoot;
