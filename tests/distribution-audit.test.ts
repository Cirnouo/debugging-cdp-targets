import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { isRecord } from '../src/shared/errors.ts';
import { compareDistributionTrees, readDistributionTree, validateMcpEntries } from '../tooling/distribution-audit.ts';
import { PLUGIN_HOSTS } from '../tooling/host-policy.ts';
import {
    REQUIRED_PAYLOAD_FILES,
    requiredPayloadFiles,
    validatePayloadFileInventory,
} from '../tooling/payload-policy.ts';

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

test('Plugin inventory requires the complete nested question references and rejects omissions or renames', () => {
    const references = [
        'skills/debugging-cdp-targets/references/README.md',
        'skills/debugging-cdp-targets/references/question-contract.md',
        'skills/debugging-cdp-targets/references/questions.zh.md',
        'skills/debugging-cdp-targets/references/questions.en.md',
    ];
    for (const host of PLUGIN_HOSTS) {
        const files = requiredPayloadFiles(host);
        assert.deepEqual(
            files.filter((file) => file.startsWith('skills/debugging-cdp-targets/references/')),
            references,
        );
        for (const reference of references) {
            assert.ok(
                validatePayloadFileInventory(
                    files.filter((file) => file !== reference),
                    host,
                ).length,
            );
            assert.ok(
                validatePayloadFileInventory(
                    files.map((file) => (file === reference ? `${file}.renamed` : file)),
                    host,
                ).length,
            );
        }
    }
});

test('Plugin allowlist independently includes every reviewed official release path', async () => {
    const release: unknown = JSON.parse(
        await readFile(new URL('../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release) && Array.isArray(release.files));
    for (const record of release.files) {
        assert.ok(isRecord(record) && typeof record.path === 'string');
        assert.ok(REQUIRED_PAYLOAD_FILES.includes(`dist/official-server/${record.path}`));
    }
    assert.ok(validatePayloadFileInventory([...REQUIRED_PAYLOAD_FILES, 'dist/official-server/extra.js']).length);
});

test('physical Plugin inventory rejects unexpected empty directories', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-empty-directory-')));
    try {
        await mkdir(path.join(root, 'extra'));
        await assert.rejects(readDistributionTree(root), /empty|unexpected/i);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
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
