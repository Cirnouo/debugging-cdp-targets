import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { HOOK_EVENTS } from '../src/adapters/mcp-entry-server.ts';
import { isRecord } from '../src/shared/errors.ts';
import { REQUIRED_PAYLOAD_FILES } from '../tooling/payload-policy.ts';

test('plugin packages automatic non-waiting MCP Hooks for each notification boundary', async () => {
    const input: unknown = JSON.parse(
        await readFile(new URL('../plugins/codex/debugging-cdp-targets/hooks/hooks.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(input) && isRecord(input.hooks));
    assert.deepEqual(Object.keys(input.hooks), [...HOOK_EVENTS]);
    for (const event of HOOK_EVENTS) {
        const groups = input.hooks[event];
        assert.ok(Array.isArray(groups) && groups.length === 1);
        const group: unknown = groups[0];
        assert.ok(isRecord(group) && Array.isArray(group.hooks));
        assert.deepEqual(group.hooks, [
            {
                type: 'mcp_tool',
                server: 'cdp-targets',
                tool: 'dct_connection_status',
                input: { hookEventName: event },
                timeout: 3,
            },
        ]);
    }
    assert.ok(REQUIRED_PAYLOAD_FILES.includes('hooks/hooks.json'));
});
