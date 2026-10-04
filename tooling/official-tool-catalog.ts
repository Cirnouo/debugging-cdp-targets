import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/client';
import { createOfficialConnection } from '../src/adapters/mcp-bridge.ts';
import { resolveServerBin } from '../src/adapters/official-server.ts';
import { CATALOG_FLAGS } from '../src/domains/official-options.ts';
import { OFFICIAL_RELEASE } from './payload-policy.ts';

type Entry = { name: string; requires: Record<string, boolean>; variants: Tool[] };
const evidencePath = new URL('./official-tool-catalog.json', import.meta.url);

/** Only the verified public bin and MCP tools/list supply catalog evidence. No browser is launched. */
export async function generateOfficialToolCatalog() {
    const bin = await resolveServerBin();
    const entries = new Map<string, Entry>();
    const profiles: { mcpArgs: string[]; sha256: string }[] = [];
    const base = Object.fromEntries(CATALOG_FLAGS.map((flag) => [flag, true]));
    async function probe(settings: Record<string, boolean>) {
        const mcpArgs = [
            ...Object.entries(settings).map(([key, value]) => `--${key}=${value}`),
            '--no-usage-statistics',
            '--no-performance-crux',
        ];
        const upstream = await createOfficialConnection('http://127.0.0.1:1', { bin, args: mcpArgs });
        try {
            const tools = upstream.tools.toSorted((a, b) => a.name.localeCompare(b.name));
            profiles.push({ mcpArgs, sha256: createHash('sha256').update(JSON.stringify(tools)).digest('hex') });
            for (const tool of tools) {
                let entry = entries.get(tool.name);
                if (!entry) {
                    entry = { name: tool.name, requires: { slim: settings.slim ?? false }, variants: [] };
                    entries.set(tool.name, entry);
                }
                if (!entry.variants.some((variant) => JSON.stringify(variant) === JSON.stringify(tool)))
                    entry.variants.push(tool);
            }
            return tools;
        } finally {
            await upstream.close();
        }
    }
    for (const slim of [false, true]) {
        const all = await probe({ ...base, slim });
        for (const flag of CATALOG_FLAGS) {
            const without = new Set((await probe({ ...base, slim, [flag]: false })).map((tool) => tool.name));
            for (const tool of all)
                if (!without.has(tool.name)) {
                    const entry = entries.get(tool.name);
                    if (entry) entry.requires[flag] = true;
                }
        }
        for (const pageIdRouting of [false, true])
            for (const categoryExtensions of [false, true])
                for (const javascriptEvaluation of [false, true])
                    await probe({ ...base, slim, pageIdRouting, categoryExtensions, javascriptEvaluation });
    }
    // Plugin defaults differ from upstream only for extensions and privacy controls.
    const defaults = await probe({ categoryExtensions: true });
    return {
        version: OFFICIAL_RELEASE.version,
        tools: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
        profiles,
        defaults,
    };
}
export async function verifyOfficialToolCatalog() {
    const expected = JSON.parse(await readFile(evidencePath, 'utf8'));
    const actual = await generateOfficialToolCatalog();
    if (JSON.stringify(expected) !== JSON.stringify(actual))
        throw new Error(
            'Official catalog evidence differs from public tools/list; review the fixed-release matrix before regenerating.',
        );
    return expected;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length === 3 && process.argv[2] === '--write') {
        const evidence = await generateOfficialToolCatalog();
        await writeFile(evidencePath, `${JSON.stringify(evidence, null, 4)}\n`, 'utf8');
        console.log(
            `Recorded ${evidence.tools.length} tools across ${evidence.profiles.length} official configurations.`,
        );
    } else if (process.argv.length === 2) {
        await verifyOfficialToolCatalog();
        console.log('Official tool catalog matches the reviewed configuration matrix.');
    } else throw new Error('Use --write only to deliberately refresh tool metadata for the already verified release.');
}
