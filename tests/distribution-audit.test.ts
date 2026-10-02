import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDistributionTrees, validateMcpEntries } from '../tooling/distribution-audit.ts';
import { REQUIRED_PAYLOAD_FILES, validatePayloadFileInventory } from '../tooling/payload-policy.ts';

test('MCP manifest requires one gateway entry without slots or connection limits', () => {
    const entry = {
        type: 'stdio',
        command: 'node',
        args: ['dist/mcp-bootstrap.mjs'],
        cwd: '.',
    };
    const valid = {
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: { 'cdp-targets': entry },
    };
    assert.deepEqual(validateMcpEntries(valid), []);
    assert.ok(validateMcpEntries({ ...valid, mcpServers: { 'chrome-devtools': entry } }).length);
    assert.ok(validateMcpEntries({ ...valid, mcpServers: { 'cdp-target-1': entry, 'cdp-target-2': entry } }).length);
    assert.ok(validateMcpEntries({ ...valid, mcpServers: { ...valid.mcpServers, extra: entry } }).length);
    for (const invalid of [
        { ...entry, args: [...entry.args, '--slot', '1'] },
        { ...entry, args: [...entry.args, '--max-connections', '2'] },
        { ...entry, command: 'npx' },
        { ...entry, type: 'http' },
        { ...entry, args: [`\${PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`], cwd: `\${PLUGIN_ROOT}` },
    ])
        assert.ok(validateMcpEntries({ ...valid, mcpServers: { 'cdp-targets': invalid } }).length);
    for (const $schema of [undefined, null, 1, '', 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'])
        assert.ok(validateMcpEntries({ ...valid, $schema }).some((error) => /schema/.test(error)));
});

test('Plugin inventory accepts only explicit runtime and instruction files', () => {
    assert.deepEqual(validatePayloadFileInventory(REQUIRED_PAYLOAD_FILES), []);
    assert.ok(validatePayloadFileInventory([...REQUIRED_PAYLOAD_FILES, 'node_modules/secret.txt']).length);
    assert.ok(validatePayloadFileInventory(REQUIRED_PAYLOAD_FILES.slice(1)).length);
});

test('installation comparison reports missing, changed, and extra bytes', () => {
    const source = new Map([
        ['plugin.json', Buffer.from('one')],
        ['mcp.json', Buffer.from('two')],
    ]);
    assert.deepEqual(compareDistributionTrees(source, source), []);
    assert.equal(
        compareDistributionTrees(
            source,
            new Map([
                ['plugin.json', Buffer.from('wrong')],
                ['test.ts', Buffer.from('extra')],
            ]),
        ).length,
        3,
    );
});
