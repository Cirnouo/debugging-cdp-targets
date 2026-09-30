import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_ROOT, REQUIRED_PAYLOAD_FILES, validatePayloadFileInventory } from './payload-policy.mjs';

export function compareDistributionTrees(source, installed) {
    const errors = [];
    for (const [file, data] of source) {
        if (!installed.has(file)) errors.push(`Missing installed file: ${file}`);
        else if (!data.equals(installed.get(file))) errors.push(`Changed installed file: ${file}`);
    }
    for (const file of installed.keys()) if (!source.has(file)) errors.push(`Extra installed file: ${file}`);
    return errors;
}

export async function readDistributionTree(directory, prefix = '') {
    const files = new Map();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Plugin may not contain symlinks: ${relative}`);
        if (entry.isDirectory())
            for (const [file, data] of await readDistributionTree(path.join(directory, entry.name), relative))
                files.set(file, data);
        else if (entry.isFile()) files.set(relative, await readFile(path.join(directory, entry.name)));
        else throw new Error(`Unexpected Plugin entry: ${relative}`);
    }
    return files;
}

export async function auditDistribution(root) {
    const source = await readDistributionTree(path.join(root, PLUGIN_ROOT));
    const errors = validatePayloadFileInventory([...source.keys()]);
    const manifest = JSON.parse(source.get('plugin.json'));
    const mcp = JSON.parse(source.get('mcp.json'));
    const marketplace = JSON.parse(await readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'));
    if (
        manifest.name !== 'debugging-cdp-targets' ||
        marketplace.plugins.length !== 1 ||
        marketplace.plugins[0].source.path !== './plugins/debugging-cdp-targets'
    )
        errors.push('Marketplace Plugin identity/path is invalid.');
    const server = mcp.mcpServers?.['chrome-devtools'];
    if (
        Object.keys(mcp.mcpServers ?? {}).length !== 1 ||
        server?.type !== 'stdio' ||
        server?.command !== 'node' ||
        JSON.stringify(server.args) !== JSON.stringify([`\${PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`]) ||
        server.cwd !== `\${PLUGIN_ROOT}`
    )
        errors.push('Plugin must register only the direct stdio bootstrap.');
    if (errors.length) return errors;
    // A packaging simulation, not a claim that Codex installed or enabled it.
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'dct-distribution-'));
    try {
        for (const file of REQUIRED_PAYLOAD_FILES) {
            const destination = path.join(temporary, file);
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, source.get(file));
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
        console.error(error.message);
        process.exitCode = 1;
    }
}
