import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAUDE_CODE_HOST, CODEX_HOST } from '../../../tooling/distribution/host-descriptors.ts';
import { validateMcpEntries } from '../../../tooling/distribution/host-metadata.ts';
import { requiredPayloadFiles, validatePayloadFileInventory } from '../../../tooling/distribution/payload-inventory.ts';

test('MCP manifest requires one gateway entry without slots or connection limits', () => {
    const entry = { type: 'streamable-http', url: 'http://127.0.0.1:27637/mcp' };
    const valid = {
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: { 'cdp-targets': entry },
    };
    assert.deepEqual(validateMcpEntries(valid), []);
    assert.ok(validateMcpEntries({ ...valid, mcpServers: { 'chrome-devtools': entry } }).length);
    assert.ok(validateMcpEntries({ ...valid, mcpServers: { 'cdp-target-1': entry, 'cdp-target-2': entry } }).length);
    assert.ok(validateMcpEntries({ ...valid, mcpServers: { ...valid.mcpServers, extra: entry } }).length);
    for (const invalid of [
        { ...entry, args: ['--slot', '1'] },
        { ...entry, command: 'node' },
        { ...entry, command: 'npx' },
        { ...entry, type: 'http' },
        { ...entry, args: [`\${PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`], cwd: `\${PLUGIN_ROOT}` },
    ])
        assert.ok(validateMcpEntries({ ...valid, mcpServers: { 'cdp-targets': invalid } }).length);
    for (const $schema of [undefined, null, 1, '', 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'])
        assert.ok(validateMcpEntries({ ...valid, $schema }).some((error) => /schema/.test(error)));
});

test('thin plugins use independently supported direct HTTP manifests without credentials or executable helpers', () => {
    for (const host of [CODEX_HOST, CLAUDE_CODE_HOST]) {
        const entry = { type: host.id === 'codex' ? 'streamable-http' : 'http', url: 'http://127.0.0.1:27637/mcp' };
        const manifest = {
            ...(host.id === 'codex' ? { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' } : {}),
            mcpServers: { 'cdp-targets': entry },
        };
        assert.deepEqual(validateMcpEntries(manifest, host), []);
        for (const changed of [
            { ...entry, command: 'node' },
            { ...entry, args: [] },
            { ...entry, headers: { Authorization: 'Bearer forbidden' } },
            { ...entry, url: 'http://localhost:27637/mcp' },
            { ...entry, url: 'http://127.0.0.1:27637/other' },
            { ...entry, url: 'https://example.invalid/mcp' },
        ])
            assert.ok(validateMcpEntries({ ...manifest, mcpServers: { 'cdp-targets': changed } }, host).length);
        const inventory = requiredPayloadFiles(host);
        assert.ok(inventory.every((file) => !file.startsWith('dist/') && !file.startsWith('hooks/')));
        for (const stale of ['dist/mcp-bootstrap.mjs', 'dist/official-server/package.json', 'hooks/hooks.json'])
            assert.ok(validatePayloadFileInventory([...inventory, stale], host).length);
    }
});
