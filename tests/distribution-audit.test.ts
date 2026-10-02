import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDistributionTrees, validateMcpEntries } from '../tooling/distribution-audit.ts';
import { REQUIRED_PAYLOAD_FILES, validatePayloadFileInventory } from '../tooling/payload-policy.ts';

test('MCP manifest requires two reusable independently slotted stdio entries', () => {
    const entry = (slot: string) => ({
        type: 'stdio',
        command: 'node',
        args: [`\${PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`, '--slot', slot],
        cwd: `\${PLUGIN_ROOT}`,
    });
    const valid = { mcpServers: { 'cdp-target-1': entry('1'), 'cdp-target-2': entry('2') } };
    assert.deepEqual(validateMcpEntries(valid), []);
    assert.ok(validateMcpEntries({ mcpServers: { 'chrome-devtools': entry('1') } }).length);
    assert.ok(validateMcpEntries({ mcpServers: { 'cdp-target-1': entry('1'), 'cdp-target-2': entry('1') } }).length);
    assert.ok(validateMcpEntries({ mcpServers: { ...valid.mcpServers, extra: entry('3') } }).length);
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
