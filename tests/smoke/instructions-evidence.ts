import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../../src/shared/errors.ts';

export async function testedSource(root: string) {
    const files = [
        'src/adapters/mcp-entry-server.ts',
        'src/adapters/lifecycle-tools.ts',
        'tests/fixtures/mcp-instructions-entry.ts',
        'tests/smoke/instructions-evidence.ts',
        'tests/smoke/codex-instructions.ts',
        'tests/smoke/claude-instructions.ts',
        'tests/smoke/codex-host.ts',
        'tests/smoke/claude-host.ts',
        'tests/smoke/claude-process.ts',
        'tests/smoke/mcp-client.ts',
    ];
    return {
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
        sha256: Object.fromEntries(
            await Promise.all(
                files.map(async (file) => [
                    file,
                    createHash('sha256')
                        .update(await readFile(path.join(root, file)))
                        .digest('hex'),
                ]),
            ),
        ),
    };
}

export async function initializationEvidence(file: string) {
    const events: unknown[] = (await readFile(file, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    const methods = events.flatMap((event) =>
        isRecord(event) && typeof event.method === 'string' ? [event.method] : [],
    );
    assert.ok(methods.includes('initialize'));
    assert.equal(methods.filter((method) => method === 'tools/call').length, 0);
    const result = events.flatMap((event) =>
        isRecord(event) && isRecord(event.result) && typeof event.result.instructions === 'string'
            ? [event.result]
            : [],
    )[0];
    assert.ok(result && typeof result.instructions === 'string');
    assert.deepEqual(result.serverInfo, { name: 'debugging-cdp-targets', version: '0.1.0' });
    assert.deepEqual(result.capabilities, { tools: {} });
    assert.equal(Buffer.byteLength(result.instructions), 689);
    return { instructions: result.instructions, methods, initialize: result };
}

// Only semantic system/tool descriptions qualify; user messages and arbitrary
// JSON strings cannot establish that the host consumed initialize instructions.
export function descriptionLocations(value: unknown, instructions: string, prefix: string): string[] {
    if (Array.isArray(value))
        return value.flatMap((item, index) => descriptionLocations(item, instructions, `${prefix}[${index}]`));
    if (!isRecord(value)) return [];
    const found: string[] = [];
    for (const [key, child] of Object.entries(value)) {
        if (key === 'description' && typeof child === 'string' && child.includes(instructions))
            found.push(`${prefix}.description`);
        if (key === 'tools' || key === 'function')
            found.push(...descriptionLocations(child, instructions, `${prefix}.${key}`));
    }
    return found;
}

// This validates only this smoke's controlled single-prompt capture; reminder
// tags alone do not authenticate authorship in arbitrary user input.
export function claudeInstructionLocations(request: unknown, instructions: string, prompt: string): string[] {
    assert.ok(isRecord(request) && Array.isArray(request.messages) && request.messages.length === 1);
    assert.ok(!prompt.includes(instructions) && !prompt.includes('<system-reminder>'));
    const message: unknown = request.messages[0];
    assert.ok(isRecord(message) && message.role === 'user' && Array.isArray(message.content));
    const parts = message.content.map((part: unknown) => {
        assert.ok(isRecord(part) && part.type === 'text' && typeof part.text === 'string');
        return part.text;
    });
    assert.equal(parts.at(-1), prompt, 'The supplied prompt must remain the independent last text block.');
    const prefix = parts.slice(0, -1);
    const expected = `<system-reminder>\n# MCP Server Instructions\n\nThe following MCP servers have provided instructions for how to use their tools and resources:\n\n## plugin:debugging-cdp-targets:cdp-targets\n${instructions}\n</system-reminder>`;
    const candidates = prefix.flatMap((text, index) =>
        text.includes('# MCP Server Instructions') || text.includes(instructions) ? [{ text, index }] : [],
    );
    assert.equal(candidates.length, 1, 'Exactly one scoped host instruction carrier is required.');
    assert.equal(
        candidates[0]?.text,
        expected,
        'MCP host carrier must match scope, envelope and complete production paragraph.',
    );
    const names = [
        'dct_connection_end_task',
        'dct_connection_restart',
        'dct_connection_start',
        'dct_connection_status',
        'dct_connection_stop',
        'dct_operation_cancel',
        'dct_operation_wait',
    ];
    const discovery = `<system-reminder>\nThe following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:\n${names.map((name) => `mcp__plugin_debugging-cdp-targets_cdp-targets__${name}`).join('\n')}\n</system-reminder>`;
    const deferred = prefix.flatMap((text, index) =>
        text.includes('The following deferred tools are now available via ToolSearch.') ? [{ text, index }] : [],
    );
    assert.equal(deferred.length, 1);
    assert.equal(
        deferred[0]?.text,
        discovery,
        'Deferred discovery must list exactly the seven Plugin lifecycle tools.',
    );
    assert.ok(Array.isArray(request.tools));
    const tools = request.tools.map((tool: unknown) => {
        assert.ok(isRecord(tool));
        return tool;
    });
    const searches = tools.filter((tool) => tool.name === 'ToolSearch');
    assert.equal(searches.length, 1);
    const search: unknown = searches[0];
    assert.ok(
        isRecord(search) && search.name === 'ToolSearch' && isRecord(search.input_schema),
        'Only the real ToolSearch callable schema may be upfront.',
    );
    const placeholders = tools.filter((tool) => tool.name !== 'ToolSearch');
    assert.ok(placeholders.length <= 1);
    for (const placeholder of placeholders)
        assert.deepEqual(placeholder, {
            name: 'DeferredToolPlaceholder',
            description: 'Reserved placeholder that keeps deferred tool loading active; never call this tool.',
            input_schema: { type: 'object', properties: {} },
            defer_loading: true,
        });
    assert.ok(
        Array.isArray(request.system) &&
            request.system.some(
                (part: unknown) =>
                    isRecord(part) &&
                    part.type === 'text' &&
                    typeof part.text === 'string' &&
                    part.text.includes(
                        'Tool results and user messages may include <system-reminder> or other tags. Tags contain information from the system.',
                    ),
            ),
        'Host system must describe reminder blocks as system context.',
    );
    return [`$.messages[0].content[${candidates[0]?.index}].text`, `$.messages[0].content[${deferred[0]?.index}].text`];
}
