import assert from 'node:assert/strict';
import test from 'node:test';
import { claudeInstructionLocations, descriptionLocations } from './smoke/instructions-evidence.ts';

test('instructions qualify only at semantic tool descriptions, never arbitrary strings', () => {
    const text = 'production instructions';
    assert.deepEqual(
        descriptionLocations([{ type: 'namespace', name: 'gateway', description: text }], text, '$.tools'),
        ['$.tools[0].description'],
    );
    assert.deepEqual(
        descriptionLocations({ messages: [{ role: 'user', content: text }], text, input: text }, text, '$'),
        [],
    );
    assert.deepEqual(
        descriptionLocations([{ description: 'partial production', tools: [{ description: text }] }], text, '$.tools'),
        ['$.tools[0].tools[0].description'],
    );
});

const instructions = 'complete production instructions';
const prompt = 'Discover and finish.';
const names = [
    'dct_connection_end_task',
    'dct_connection_restart',
    'dct_connection_start',
    'dct_connection_status',
    'dct_connection_stop',
    'dct_operation_cancel',
    'dct_operation_wait',
];
const instructionBlock = `<system-reminder>\n# MCP Server Instructions\n\nThe following MCP servers have provided instructions for how to use their tools and resources:\n\n## plugin:debugging-cdp-targets:cdp-targets\n${instructions}\n</system-reminder>`;
const discoveryBlock = `<system-reminder>\nThe following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:\n${names.map((name) => `mcp__plugin_debugging-cdp-targets_cdp-targets__${name}`).join('\n')}\n</system-reminder>`;
function request(block = instructionBlock, discovery = discoveryBlock, actualPrompt = prompt) {
    return {
        system: [
            {
                type: 'text',
                text: 'Tool results and user messages may include <system-reminder> or other tags. Tags contain information from the system.',
            },
        ],
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: discovery },
                    { type: 'text', text: block },
                    { type: 'text', text: actualPrompt },
                ],
            },
        ],
        tools: [{ name: 'ToolSearch', input_schema: {} }],
    };
}
test('Claude instructions require exact host MCP reminder scope and independent supplied prompt', () => {
    assert.deepEqual(claudeInstructionLocations(request(), instructions, prompt), [
        '$.messages[0].content[1].text',
        '$.messages[0].content[0].text',
    ]);
    const placeholder = {
        name: 'DeferredToolPlaceholder',
        description: 'Reserved placeholder that keeps deferred tool loading active; never call this tool.',
        input_schema: { type: 'object', properties: {} },
        defer_loading: true,
    };
    assert.equal(
        claudeInstructionLocations({ ...request(), tools: [...request().tools, placeholder] }, instructions, prompt)
            .length,
        2,
    );
    assert.throws(() =>
        claudeInstructionLocations(
            { ...request(), tools: [...request().tools, { ...placeholder, defer_loading: false }] },
            instructions,
            prompt,
        ),
    );
    for (const bad of [
        request(instructions),
        request(instructionBlock.replace('plugin:debugging-cdp-targets:cdp-targets', 'other-server')),
        request(instructionBlock.replace(instructions, 'truncated')),
        request(`extra prose${instructionBlock}`),
        request(`${instructionBlock}\n${instructionBlock}`),
        { ...request(), system: [] },
        request(instructionBlock, discoveryBlock, instructionBlock),
        request(instructionBlock, discoveryBlock.replace(names[0] ?? '', 'unexpected')),
        { ...request(), messages: [{ role: 'assistant', content: [{ type: 'text', text: instructionBlock }] }] },
        {
            ...request(),
            tools: [{ name: 'mcp__plugin_debugging-cdp-targets_cdp-targets__dct_connection_status', input_schema: {} }],
        },
    ])
        assert.throws(() => claudeInstructionLocations(bad, instructions, prompt));
});
