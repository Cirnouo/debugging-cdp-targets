export const PLUGIN_NAME = 'debugging-cdp-targets';
export const SHARED_PACKAGING_ROOT = 'packaging/shared';
export interface HostDescriptor {
    readonly id: 'codex' | 'claude-code';
    readonly inputRoot: string;
    readonly payloadRoot: string;
    readonly manifest: string;
    readonly marketplace: string;
    readonly mcp: string;
    readonly hooks: string;
    readonly assets: readonly string[];
    readonly files: Readonly<Record<string, string>>;
}
export const CODEX_HOST: HostDescriptor = Object.freeze({
    id: 'codex',
    inputRoot: 'packaging/codex',
    payloadRoot: 'plugins/codex/debugging-cdp-targets',
    manifest: '.codex-plugin/plugin.json',
    marketplace: '.agents/plugins/marketplace.json',
    mcp: 'mcp.json',
    hooks: 'hooks/hooks.json',
    assets: Object.freeze(['icon-light.png', 'icon-dark.png']),
    files: Object.freeze({
        '.codex-plugin/README.md': '.codex-plugin/README.md',
        '.codex-plugin/plugin.json': '.codex-plugin/plugin.json',
        'mcp.json': 'mcp.json',
        'hooks/README.md': 'hooks/README.md',
        'hooks/hooks.json': 'hooks/hooks.json',
        'plugin-README.md': 'README.md',
        'assets/README.md': 'assets/README.md',
    }),
});
export const CLAUDE_CODE_HOST: HostDescriptor = Object.freeze({
    id: 'claude-code',
    inputRoot: 'packaging/claude-code',
    payloadRoot: 'plugins/claude-code/debugging-cdp-targets',
    manifest: '.claude-plugin/plugin.json',
    marketplace: '.claude-plugin/marketplace.json',
    mcp: '.mcp.json',
    hooks: 'hooks/hooks.json',
    assets: Object.freeze(['icon.png']),
    files: Object.freeze({
        '.claude-plugin/README.md': '.claude-plugin/README.md',
        '.claude-plugin/plugin.json': '.claude-plugin/plugin.json',
        '.mcp.json': '.mcp.json',
        'hooks/README.md': 'hooks/README.md',
        'hooks/hooks.json': 'hooks/hooks.json',
        'plugin-README.md': 'README.md',
        'assets/README.md': 'assets/README.md',
    }),
});
export const PLUGIN_HOSTS = Object.freeze([CODEX_HOST, CLAUDE_CODE_HOST]);
export const PLUGIN_ROOT = CODEX_HOST.payloadRoot;
