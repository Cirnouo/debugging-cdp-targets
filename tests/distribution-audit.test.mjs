import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDistributionTrees } from '../tooling/distribution-audit.mjs';
import { REQUIRED_PAYLOAD_FILES, validatePayloadFileInventory } from '../tooling/payload-policy.mjs';

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
                ['test.mjs', Buffer.from('extra')],
            ]),
        ).length,
        3,
    );
});
