import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { readRegularFile } from '../src/adapters/file-evidence.ts';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import { errorMessage, isRecord } from '../src/shared/errors.ts';
import type { HostDescriptor } from './host-policy.ts';
import { CODEX_HOST, PLUGIN_HOSTS, PLUGIN_NAME } from './host-policy.ts';
import { validateIconPng } from './icon-policy.ts';
import { OFFICIAL_RELEASE, requiredPayloadFiles, validatePayloadFileInventory } from './payload-policy.ts';
import { isSemVer } from './version-policy.ts';

export function compareDistributionTrees(source: Map<string, Buffer>, installed: Map<string, Buffer>) {
    const errors = [];
    for (const [file, data] of source) {
        const installedData = installed.get(file);
        if (!installedData) errors.push(`Missing installed file: ${file}`);
        else if (!data.equals(installedData)) errors.push(`Changed installed file: ${file}`);
    }
    for (const file of installed.keys()) if (!source.has(file)) errors.push(`Extra installed file: ${file}`);
    return errors;
}

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
    if (!exactKeys(servers, ['cdp-targets'])) return ['Plugin requires exactly one stdio gateway entry.'];
    const server = servers['cdp-targets'];
    if (
        !isRecord(server) ||
        !exactKeys(server, codex ? ['type', 'command', 'args', 'cwd'] : ['type', 'command', 'args']) ||
        server.type !== 'stdio' ||
        server.command !== 'node' ||
        JSON.stringify(server.args) !==
            JSON.stringify([codex ? 'dist/mcp-bootstrap.mjs' : `\${CLAUDE_PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`]) ||
        (codex && server.cwd !== '.')
    )
        return ['Invalid stdio gateway entry: cdp-targets.'];
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
        !Array.isArray(manifest.keywords) ||
        !manifest.keywords.every((keyword) => typeof keyword === 'string')
    )
        return ['Malformed Plugin metadata.'];
    const common = ['name', 'version', 'description', 'author', 'repository', 'license', 'keywords'];
    if (host.id === 'codex') {
        if (
            !exactKeys(manifest, [...common, 'mcpServers', 'hooks', 'interface']) ||
            manifest.mcpServers !== './mcp.json' ||
            manifest.hooks !== './hooks/hooks.json' ||
            !isRecord(manifest.interface)
        )
            return ['Invalid Codex Plugin manifest paths/interface.'];
        if (
            !exactKeys(manifest.interface, [
                'displayName',
                'shortDescription',
                'developerName',
                'category',
                'defaultPrompt',
                'logo',
                'logoDark',
                'composerIcon',
                'composerIconDark',
            ]) ||
            manifest.interface.displayName !== 'Debugging CDP Targets' ||
            manifest.interface.shortDescription !== 'Inspect verified local CDP targets with Chrome DevTools' ||
            manifest.interface.developerName !== 'Cirnouo' ||
            manifest.interface.category !== 'Developer Tools' ||
            manifest.interface.logo !== './assets/icon-light.png' ||
            manifest.interface.logoDark !== './assets/icon-dark.png' ||
            manifest.interface.composerIcon !== './assets/icon-light.png' ||
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
                    prompt.length <= 128 &&
                    !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(prompt),
            ) ||
            new Set(prompts.map((prompt: string) => prompt.trim())).size !== 3
        )
            return ['Codex Plugin requires three distinct single-line starter prompts of at most 128 characters.'];
    } else if (!exactKeys(manifest, [...common, 'icon']) || manifest.icon !== './assets/icon.png')
        return ['Claude Code uses default discovery without Codex manifest fields.'];
    return [];
}

export function validateHooks(input: unknown, host: HostDescriptor = CODEX_HOST) {
    if (!isRecord(input) || !exactKeys(input, ['hooks']) || !isRecord(input.hooks)) return ['Malformed Plugin Hooks.'];
    const events = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'];
    if (!exactKeys(input.hooks, events)) return ['Plugin requires exactly four Hook events.'];
    const server = host.id === 'codex' ? 'cdp-targets' : 'plugin:debugging-cdp-targets:cdp-targets';
    for (const event of events) {
        const groups = input.hooks[event];
        if (!Array.isArray(groups) || groups.length !== 1 || !isRecord(groups[0]) || !exactKeys(groups[0], ['hooks']))
            return ['Invalid Plugin Hook group.'];
        const hooks = groups[0].hooks;
        if (
            !Array.isArray(hooks) ||
            hooks.length !== 1 ||
            !isRecord(hooks[0]) ||
            !exactKeys(hooks[0], ['type', 'server', 'tool', 'input', 'timeout']) ||
            hooks[0].type !== 'mcp_tool' ||
            hooks[0].server !== server ||
            hooks[0].tool !== 'dct_connection_status' ||
            hooks[0].timeout !== 3 ||
            !isRecord(hooks[0].input) ||
            !exactKeys(hooks[0].input, ['hookEventName']) ||
            hooks[0].input.hookEventName !== event
        )
            return ['Invalid host MCP Hook identity, input or timeout.'];
    }
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

async function readMetadataFile(file: string) {
    if (path.relative(path.resolve(file), await realpath(file)) !== '')
        throw new Error('Plugin metadata must not contain linked paths.');
    return readRegularFile(file);
}

export async function readDistributionTree(directory: string, prefix = ''): Promise<Map<string, Buffer>> {
    const owned = path.resolve(directory);
    if (!(await lstat(owned)).isDirectory() || path.relative(owned, await realpath(owned)) !== '')
        throw new Error('Plugin directories must be regular and must not contain linked paths.');
    const files = new Map<string, Buffer>();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Plugin may not contain symlinks: ${relative}`);
        if (entry.isDirectory()) {
            const nested = await readDistributionTree(path.join(directory, entry.name), relative);
            if (!nested.size) throw new Error(`Unexpected empty Plugin directory: ${relative}`);
            for (const [file, data] of nested) files.set(file, data);
        } else if (entry.isFile()) files.set(relative, await readRegularFile(path.join(directory, entry.name)));
        else throw new Error(`Unexpected Plugin entry: ${relative}`);
    }
    return files;
}

export async function auditDistribution(root: string) {
    const errors: string[] = [];
    const payloads = new Map<string, Map<string, Buffer>>();
    const packageData = parsePluginMetadata((await readMetadataFile(path.join(root, 'package.json'))).toString());
    const license = await readMetadataFile(path.join(root, 'LICENSE'));
    for (const host of PLUGIN_HOSTS) {
        try {
            const source = await readDistributionTree(path.join(root, host.payloadRoot));
            payloads.set(host.id, source);
            errors.push(
                ...validatePayloadFileInventory([...source.keys()], host).map((error) => `${host.id}: ${error}`),
            );
            for (const asset of host.assets) {
                const file = `assets/${asset}`;
                const bytes = source.get(file);
                if (bytes) errors.push(...validateIconPng(file, bytes));
            }
            const official = await verifyOfficialPackage(
                path.join(root, host.payloadRoot, 'dist/official-server'),
                OFFICIAL_RELEASE,
            );
            const copied = new Map(
                [...source]
                    .filter(([file]) => file.startsWith('dist/official-server/'))
                    .map(([file, bytes]) => [file.slice('dist/official-server/'.length), bytes]),
            );
            errors.push(...compareDistributionTrees(official, copied));
            const manifest = parsePluginMetadata(source.get(host.manifest)?.toString() ?? 'null');
            errors.push(...validateHostManifest(manifest, host));
            errors.push(...validateMcpEntries(parsePluginMetadata(source.get(host.mcp)?.toString() ?? 'null'), host));
            errors.push(...validateHooks(parsePluginMetadata(source.get(host.hooks)?.toString() ?? 'null'), host));
            errors.push(
                ...validateMarketplace(
                    parsePluginMetadata((await readMetadataFile(path.join(root, host.marketplace))).toString()),
                    host,
                ),
            );
            if (!isRecord(manifest) || !isRecord(packageData) || manifest.version !== packageData.version)
                errors.push(`${host.id}: Plugin and repository versions must agree.`);
            if (!source.get('LICENSE')?.equals(license))
                errors.push(`${host.id}: Root and Plugin licenses must match.`);
            const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-distribution-')));
            try {
                for (const file of requiredPayloadFiles(host)) {
                    const contents = source.get(file);
                    if (!contents) continue;
                    const destination = path.join(temporary, file);
                    await mkdir(path.dirname(destination), { recursive: true });
                    await writeFile(destination, contents);
                }
                errors.push(...compareDistributionTrees(source, await readDistributionTree(temporary)));
            } finally {
                await rm(temporary, { recursive: true });
            }
        } catch (error) {
            errors.push(`${host.id}: ${errorMessage(error)}`);
        }
    }
    const codex = payloads.get('codex');
    const claude = payloads.get('claude-code');
    if (codex && claude) {
        for (const [file, bytes] of codex)
            if (
                (file === 'LICENSE' || file.startsWith('dist/') || file.startsWith('skills/')) &&
                !claude.get(file)?.equals(bytes)
            )
                errors.push(`Shared payload bytes differ: ${file}`);
    }
    return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const errors = await auditDistribution(process.cwd());
        if (errors.length) throw new Error(errors.join('\n'));
        console.log('Plugin inventory, manifests, and byte-identical packaging passed.');
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
    }
}
