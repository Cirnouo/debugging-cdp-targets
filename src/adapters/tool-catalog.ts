import { readFile } from 'node:fs/promises';
import os from 'node:os';
import type { Tool } from '@modelcontextprotocol/client';
import { ListToolsResultSchema } from '@modelcontextprotocol/core';
import { parseMcpArgs, suggestMcpArgs } from '../domains/official-options.ts';
import { isRecord } from '../shared/errors.ts';

declare const __DCT_TOOL_CATALOG__: unknown;
type Entry = { name: string; requires: Record<string, boolean>; variants: Tool[] };
type Requirements = {
    name: string;
    supported: boolean;
    conditions?: string[];
    missingConditions?: string[];
    suggestedMcpArgs?: string[];
    reason?: string;
};
const defaults: Record<string, boolean> = {
    categoryInput: true,
    categoryNavigation: true,
    categoryEmulation: true,
    categoryPerformance: true,
    categoryNetwork: true,
    categoryDebugging: true,
    categoryMemory: true,
    categoryExtensions: true,
    javascriptEvaluation: true,
    pageIdRouting: true,
};
function distinct<T>(items: T[]): T[] {
    return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
}
export function createToolCatalog(value: unknown) {
    if (!isRecord(value) || value.version !== '1.10.1' || !Array.isArray(value.tools))
        throw new Error('Invalid fixed official tool catalog.');
    const entries = new Map<string, Entry>();
    for (const input of value.tools) {
        if (!isRecord(input) || typeof input.name !== 'string' || !isRecord(input.requires))
            throw new Error('Invalid official tool requirements.');
        const required: Record<string, boolean> = {};
        for (const [flag, enabled] of Object.entries(input.requires)) {
            if (typeof enabled !== 'boolean') throw new Error('Invalid official tool condition.');
            parseMcpArgs([`--${flag}=${enabled}`]);
            required[flag] = enabled;
        }
        const variants = ListToolsResultSchema.parse({ tools: input.variants }).tools;
        if (!variants.length || variants.some((tool) => tool.name !== input.name) || entries.has(input.name))
            throw new Error('Invalid official tool variants.');
        entries.set(input.name, { name: input.name, requires: required, variants });
    }
    function requirements(name: string, mcpArgs: string[], forceRecipe = false): Requirements {
        const entry = entries.get(name);
        if (!entry) throw new Error(`Unknown official tool: ${name}.`);
        if (entry.requires.categoryPwa)
            return {
                name,
                supported: false,
                reason: 'Official PWA tools require a pipe-launched browser; the gateway manages a verified CDP endpoint.',
            };
        const options = parseMcpArgs(mcpArgs);
        const missingConditions = Object.entries(entry.requires)
            .filter(([flag, expected]) => (options.get(flag)?.values[0] ?? defaults[flag] ?? false) !== expected)
            .map(([flag, expected]) => `--${flag}=${expected}`);
        return {
            name,
            supported: true,
            conditions: Object.entries(entry.requires).map(([flag, expected]) => `--${flag}=${expected}`),
            missingConditions,
            ...(forceRecipe || missingConditions.length > 0
                ? { suggestedMcpArgs: suggestMcpArgs(mcpArgs, entry.requires) }
                : {}),
        };
    }
    const tools = [...entries.values()]
        .map((entry) => {
            const first = entry.variants[0];
            if (!first) throw new Error('Missing official tool definition.');
            const schemas = distinct(entry.variants.map((tool) => tool.inputSchema));
            const keys = new Set(schemas.flatMap((schema) => Object.keys(schema.properties ?? {})));
            const properties = Object.fromEntries(
                [...keys].map((key) => {
                    const definitions = distinct(
                        schemas.flatMap((schema) =>
                            schema.properties?.[key] === undefined ? [] : [schema.properties[key]],
                        ),
                    );
                    return [key, definitions.length === 1 ? definitions[0] : { anyOf: definitions }];
                }),
            );
            const required = (first.inputSchema.required ?? []).filter((key) =>
                schemas.every((schema) => schema.required?.includes(key)),
            );
            const conditions = requirements(entry.name, []);
            const description =
                `${first.description ?? entry.name}\nGateway configuration: ${conditions.conditions?.join(', ') ?? ''}. ${conditions.reason ?? ''}` +
                (schemas.length > 1
                    ? '\nCompatible declaration combines official parameter variants. Query dct_connection_status with toolNames for the selected connection’s exact input schema before using configuration-sensitive arguments.'
                    : '');
            return ListToolsResultSchema.parse({
                tools: [{ ...first, description, inputSchema: { ...first.inputSchema, properties, required } }],
            }).tools[0];
        })
        .filter((tool): tool is Tool => tool !== undefined);
    return {
        tools,
        requirements,
        validate(actual: Tool[]) {
            for (const tool of actual) {
                const entry = entries.get(tool.name);
                if (
                    !entry?.variants.some(
                        (variant) => JSON.stringify(variant.inputSchema) === JSON.stringify(tool.inputSchema),
                    )
                )
                    throw new Error(`The official tool catalog changed outside the reviewed variants: ${tool.name}.`);
            }
        },
        describe(mcpArgs: string[], actual?: Tool[], names?: string[], forceRecipe = false) {
            const chosen = names ?? (actual ? actual.map((tool) => tool.name) : [...entries.keys()]);
            return chosen.map((name) => {
                const tool = actual?.find((tool) => tool.name === name);
                const { suggestedMcpArgs, ...requirement } = requirements(
                    name,
                    mcpArgs,
                    forceRecipe || (actual !== undefined && names !== undefined && tool === undefined),
                );
                return {
                    ...requirement,
                    ...(actual !== undefined && !tool && suggestedMcpArgs ? { suggestedMcpArgs } : {}),
                    ...(actual ? { enabled: tool !== undefined } : {}),
                    ...(tool ? { inputSchema: tool.inputSchema } : {}),
                };
            });
        },
    };
}
export async function loadOfficialToolCatalog(_defaults?: Tool[]) {
    const value: unknown =
        typeof __DCT_TOOL_CATALOG__ !== 'undefined'
            ? __DCT_TOOL_CATALOG__
            : JSON.parse(await readFile(new URL('../../tooling/official-tool-catalog.json', import.meta.url), 'utf8'));
    return createToolCatalog(value);
}
export function workspaceSources(mcpArgs: string[], supportsRoots: boolean) {
    const args = parseMcpArgs(mcpArgs);
    return {
        officialDirectories: args.get('filesystemRoot')?.values ?? [os.tmpdir()],
        officialSource: args.has('filesystemRoot') ? 'explicit-workspace' : 'system-temporary-directory',
        clientRoots: supportsRoots ? 'negotiated-forwarding-on-demand' : 'not-negotiated',
        unrestrictedPaths: args.get('allowUnrestrictedPaths')?.values[0] === true,
        cwdGrantsAccess: false,
    };
}
