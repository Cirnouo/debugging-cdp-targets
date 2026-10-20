import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isSemVer } from '../../src/domains/software-version.ts';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import { validateIconPng } from './artwork-policy.ts';
import type { HostDescriptor } from './host-descriptors.ts';
import { CODEX_HOST, PLUGIN_NAME } from './host-descriptors.ts';

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function validateMcpEntries(mcp: unknown, host: HostDescriptor = CODEX_HOST) {
    if (!isRecord(mcp) || !isRecord(mcp.mcpServers)) return ['Malformed MCP entries.'];
    const codex = host.id === 'codex';
    if (codex && mcp.$schema !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')
        return ['Portable MCP manifest requires the Agent Plugins MCP schema.'];
    if (!exactKeys(mcp, codex ? ['$schema', 'mcpServers'] : ['mcpServers'])) return ['Unexpected host MCP fields.'];
    const servers = mcp.mcpServers;
    if (!exactKeys(servers, ['cdp-targets'])) return ['Plugin requires exactly one direct HTTP entry.'];
    const server = servers['cdp-targets'];
    if (
        !isRecord(server) ||
        !exactKeys(server, ['type', 'url']) ||
        server.type !== (codex ? 'streamable-http' : 'http') ||
        server.url !== 'http://127.0.0.1:27637/mcp'
    )
        return ['Invalid direct HTTP App entry: cdp-targets.'];
    return [];
}

export function validateHostManifest(manifest: unknown, host: HostDescriptor = CODEX_HOST) {
    if (
        !isRecord(manifest) ||
        manifest.name !== PLUGIN_NAME ||
        !isSemVer(manifest.version) ||
        manifest.license !== 'MIT' ||
        typeof manifest.description !== 'string' ||
        !manifest.description.trim() ||
        !isRecord(manifest.author) ||
        !exactKeys(manifest.author, ['name']) ||
        manifest.author.name !== 'Cirnouo' ||
        manifest.repository !== 'https://github.com/Cirnouo/debugging-cdp-targets' ||
        manifest.homepage !== 'https://github.com/Cirnouo/debugging-cdp-targets' ||
        !Array.isArray(manifest.keywords) ||
        !manifest.keywords.every((keyword) => typeof keyword === 'string')
    )
        return ['Malformed Plugin metadata.'];
    const common = ['name', 'version', 'description', 'author', 'repository', 'homepage', 'license', 'keywords'];
    if (host.id === 'codex') {
        if (
            !exactKeys(manifest, [...common, 'mcpServers', 'skills', 'interface']) ||
            manifest.mcpServers !== './mcp.json' ||
            manifest.skills !== './skills/' ||
            !isRecord(manifest.interface)
        )
            return ['Invalid Codex Plugin manifest paths/interface.'];
        if (
            !exactKeys(manifest.interface, [
                'displayName',
                'shortDescription',
                'longDescription',
                'developerName',
                'websiteURL',
                'category',
                'defaultPrompt',
                'logo',
                'logoDark',
                'composerIcon',
                'composerIconDark',
            ]) ||
            manifest.interface.displayName !== 'Debugging CDP Targets' ||
            manifest.interface.shortDescription !== 'Inspect verified local CDP targets with Chrome DevTools' ||
            manifest.interface.longDescription !==
                'Launch a new local Chrome browser or another verified CDP-capable application with the isolation option you choose. Use the official Chrome DevTools tools to capture screenshots, diagnose console and network issues, and inspect performance. Choose Close or Keep when the task ends.' ||
            manifest.interface.developerName !== 'Cirnouo' ||
            manifest.interface.websiteURL !== 'https://github.com/Cirnouo/debugging-cdp-targets' ||
            manifest.interface.category !== 'Developer Tools' ||
            manifest.interface.logo !== './assets/icon.png' ||
            manifest.interface.logoDark !== './assets/icon-dark.png' ||
            manifest.interface.composerIcon !== './assets/icon.png' ||
            manifest.interface.composerIconDark !== './assets/icon-dark.png'
        )
            return ['Invalid Codex Plugin interface.'];
        const prompts = manifest.interface.defaultPrompt;
        if (
            !Array.isArray(prompts) ||
            prompts.length !== 3 ||
            !prompts.every(
                (prompt: unknown) =>
                    typeof prompt === 'string' &&
                    prompt.trim().length > 0 &&
                    Array.from(prompt).length <= 128 &&
                    !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(prompt),
            ) ||
            new Set(prompts.map((prompt: string) => prompt.trim())).size !== 3
        )
            return ['Codex Plugin requires three distinct single-line starter prompts of at most 128 code points.'];
    } else if (
        !exactKeys(manifest, [...common, 'displayName', 'icon']) ||
        manifest.displayName !== 'Debugging CDP Targets' ||
        manifest.icon !== './assets/icon.png'
    )
        return ['Claude Code uses default discovery without Codex manifest fields.'];
    return [];
}

export function validateMarketplace(input: unknown, host: HostDescriptor = CODEX_HOST) {
    if (!isRecord(input) || input.name !== PLUGIN_NAME || !Array.isArray(input.plugins) || input.plugins.length !== 1)
        return ['Malformed Marketplace metadata.'];
    const plugin: unknown = input.plugins[0];
    if (!isRecord(plugin) || plugin.name !== PLUGIN_NAME) return ['Invalid Marketplace Plugin identity.'];
    if (host.id === 'codex') {
        if (
            !exactKeys(input, ['name', 'interface', 'plugins']) ||
            !isRecord(input.interface) ||
            !exactKeys(input.interface, ['displayName']) ||
            input.interface.displayName !== 'Debugging CDP Targets' ||
            !exactKeys(plugin, ['name', 'source', 'policy', 'category']) ||
            !isRecord(plugin.source) ||
            !exactKeys(plugin.source, ['source', 'path']) ||
            plugin.source.source !== 'local' ||
            plugin.source.path !== `./${host.payloadRoot}` ||
            !isRecord(plugin.policy) ||
            !exactKeys(plugin.policy, ['installation', 'authentication']) ||
            plugin.policy.installation !== 'AVAILABLE' ||
            plugin.policy.authentication !== 'ON_INSTALL' ||
            plugin.category !== 'Developer Tools'
        )
            return ['Marketplace Plugin identity/path is invalid.'];
    } else if (
        !exactKeys(input, ['name', 'owner', 'metadata', 'plugins']) ||
        !isRecord(input.owner) ||
        !exactKeys(input.owner, ['name']) ||
        input.owner.name !== 'Cirnouo' ||
        !isRecord(input.metadata) ||
        !exactKeys(input.metadata, ['description']) ||
        typeof input.metadata.description !== 'string' ||
        !exactKeys(plugin, ['name', 'source', 'description']) ||
        plugin.source !== `./${host.payloadRoot}` ||
        typeof plugin.description !== 'string'
    )
        return ['Claude Code Marketplace Plugin identity/path is invalid.'];
    return [];
}

export function parsePluginMetadata(source: string) {
    const value: unknown = JSON.parse(source);
    // YAML's real parser rejects duplicate mapping keys that JSON.parse silently discards.
    parseYaml(source, { uniqueKeys: true });
    return value;
}

export function validateCodexSkillPresentation(files: ReadonlyMap<string, Buffer>, approvedIcon: Buffer) {
    try {
        const source = files.get('skills/debugging-cdp-targets/agents/openai.yaml');
        if (!source) return ['Missing Skill presentation YAML.'];
        const metadata: unknown = parseYaml(source.toString('utf8'), { uniqueKeys: true });
        if (
            !isRecord(metadata) ||
            !exactKeys(metadata, ['interface']) ||
            !isRecord(metadata.interface) ||
            !exactKeys(metadata.interface, ['display_name', 'short_description', 'icon_small', 'icon_large']) ||
            metadata.interface.display_name !== 'Debugging CDP Targets' ||
            metadata.interface.short_description !== 'Debug verified local CDP targets'
        )
            return ['Invalid Skill presentation interface.'];
        // Codex PluginShared resolves from the Skill directory, not agents/.
        // This exact reference is not a general Plugin path traversal allowance.
        for (const key of ['icon_small', 'icon_large']) {
            const reference = metadata.interface[key];
            if (reference !== '../../assets/icon.png') return ['Invalid Skill presentation icon reference.'];
            const resolved = path.posix.normalize(path.posix.join('skills/debugging-cdp-targets', reference));
            if (resolved !== 'assets/icon.png') return ['Skill presentation icon escaped its Plugin assets.'];
            const bytes = files.get(resolved);
            if (!bytes) return ['Missing Skill presentation icon.'];
            const errors = validateIconPng(resolved, bytes);
            if (errors.length) return errors.map((error) => `Skill presentation: ${error}`);
            if (!bytes.equals(approvedIcon)) return ['Skill presentation icon differs from approved shared source.'];
        }
        return [];
    } catch (error) {
        return [`Invalid Skill presentation YAML: ${errorMessage(error)}`];
    }
}
