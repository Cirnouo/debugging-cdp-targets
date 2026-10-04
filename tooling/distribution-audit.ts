import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import { errorMessage, isRecord } from '../src/shared/errors.ts';
import { CODEX_HOST } from './host-policy.ts';
import {
    OFFICIAL_RELEASE,
    PLUGIN_ROOT,
    REQUIRED_PAYLOAD_FILES,
    validatePayloadFileInventory,
} from './payload-policy.ts';

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

export function validateMcpEntries(mcp: unknown) {
    if (!isRecord(mcp) || !isRecord(mcp.mcpServers)) return ['Malformed MCP entries.'];
    if (mcp.$schema !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')
        return ['Portable MCP manifest requires the Agent Plugins MCP schema.'];
    const servers = mcp.mcpServers;
    if (Object.keys(servers).length !== 1) return ['Plugin requires exactly one stdio gateway entry.'];
    const server = servers['cdp-targets'];
    if (
        !isRecord(server) ||
        server.type !== 'stdio' ||
        server.command !== 'node' ||
        JSON.stringify(server.args) !== JSON.stringify(['dist/mcp-bootstrap.mjs']) ||
        server.cwd !== '.'
    )
        return ['Invalid stdio gateway entry: cdp-targets.'];
    return [];
}

export async function readDistributionTree(directory: string, prefix = ''): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Plugin may not contain symlinks: ${relative}`);
        if (entry.isDirectory()) {
            const nested = await readDistributionTree(path.join(directory, entry.name), relative);
            if (!nested.size) throw new Error(`Unexpected empty Plugin directory: ${relative}`);
            for (const [file, data] of nested) files.set(file, data);
        } else if (entry.isFile()) files.set(relative, await readFile(path.join(directory, entry.name)));
        else throw new Error(`Unexpected Plugin entry: ${relative}`);
    }
    return files;
}

export async function auditDistribution(root: string) {
    const source = await readDistributionTree(path.join(root, PLUGIN_ROOT));
    const errors = validatePayloadFileInventory([...source.keys()]);
    try {
        const official = await verifyOfficialPackage(
            path.join(root, PLUGIN_ROOT, 'dist/official-server'),
            OFFICIAL_RELEASE,
        );
        const copied = new Map(
            [...source]
                .filter(([file]) => file.startsWith('dist/official-server/'))
                .map(([file, bytes]) => [file.slice('dist/official-server/'.length), bytes]),
        );
        errors.push(...compareDistributionTrees(official, copied));
    } catch (error) {
        errors.push(errorMessage(error));
    }
    const manifest: unknown = JSON.parse(source.get('.codex-plugin/plugin.json')?.toString() ?? 'null');
    const mcp: unknown = JSON.parse(source.get('mcp.json')?.toString() ?? 'null');
    const marketplace: unknown = JSON.parse(
        await readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'),
    );
    if (!isRecord(manifest) || !isRecord(mcp) || !isRecord(marketplace) || !Array.isArray(marketplace.plugins))
        return [...errors, 'Malformed Plugin metadata.'];
    const first: unknown = marketplace.plugins[0];
    if (
        manifest.name !== 'debugging-cdp-targets' ||
        manifest.mcpServers !== './mcp.json' ||
        manifest.hooks !== './hooks/hooks.json' ||
        marketplace.plugins.length !== 1 ||
        !isRecord(first) ||
        !isRecord(first.source) ||
        first.source.path !== `./${CODEX_HOST.payloadRoot}`
    )
        errors.push('Marketplace Plugin identity/path is invalid.');
    errors.push(...validateMcpEntries(mcp));
    if (errors.length) return errors;
    // A packaging simulation, not a claim that Codex installed or enabled it.
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'dct-distribution-'));
    try {
        for (const file of REQUIRED_PAYLOAD_FILES) {
            const destination = path.join(temporary, file);
            await mkdir(path.dirname(destination), { recursive: true });
            const contents = source.get(file);
            if (!contents) throw new Error(`Missing Plugin file: ${file}`);
            await writeFile(destination, contents);
        }
        errors.push(...compareDistributionTrees(source, await readDistributionTree(temporary)));
    } finally {
        await rm(temporary, { recursive: true });
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
