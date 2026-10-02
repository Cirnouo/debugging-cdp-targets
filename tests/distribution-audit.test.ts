import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDistributionTrees, validateMcpEntries } from '../tooling/distribution-audit.ts';
import { REQUIRED_PAYLOAD_FILES, validatePayloadFileInventory } from '../tooling/payload-policy.ts';

test('MCP manifest requires one gateway entry without slots or connection limits', () => {
    const entry = {
        type: 'stdio',
        command: 'node',
        args: [`\${PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`],
        cwd: `\${PLUGIN_ROOT}`,
    };
    const valid = { mcpServers: { 'cdp-targets': entry } };
    assert.deepEqual(validateMcpEntries(valid), []);
    assert.ok(validateMcpEntries({ mcpServers: { 'chrome-devtools': entry } }).length);
    assert.ok(validateMcpEntries({ mcpServers: { 'cdp-target-1': entry, 'cdp-target-2': entry } }).length);
    assert.ok(validateMcpEntries({ mcpServers: { ...valid.mcpServers, extra: entry } }).length);
    for (const invalid of [
        { ...entry, args: [...entry.args, '--slot', '1'] },
        { ...entry, args: [...entry.args, '--max-connections', '2'] },
        { ...entry, command: 'npx' },
        { ...entry, type: 'http' },
    ])
        assert.ok(validateMcpEntries({ mcpServers: { 'cdp-targets': invalid } }).length);
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
