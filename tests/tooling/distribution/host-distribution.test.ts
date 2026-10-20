import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../../src/shared/errors.ts';
import {
    assembleClaudeCodePayload,
    generateHostPayloads,
    syncPluginFiles,
} from '../../../tooling/distribution/build-plugin.ts';
import { CLAUDE_CODE_HOST, CODEX_HOST, PLUGIN_HOSTS } from '../../../tooling/distribution/host-descriptors.ts';
import { validateMcpEntries } from '../../../tooling/distribution/host-metadata.ts';
import {
    REQUIRED_PAYLOAD_FILES,
    requiredPayloadFiles,
    validatePayloadFileInventory,
} from '../../../tooling/distribution/payload-inventory.ts';
import { readDistributionTree } from '../../../tooling/distribution/regular-file-tree.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));

test('Plugin inventory accepts only explicit runtime and instruction files', () => {
    assert.deepEqual(validatePayloadFileInventory(REQUIRED_PAYLOAD_FILES), []);
    assert.ok(validatePayloadFileInventory([...REQUIRED_PAYLOAD_FILES, 'node_modules/secret.txt']).length);
    assert.ok(validatePayloadFileInventory(REQUIRED_PAYLOAD_FILES.slice(1)).length);
});

test('Plugin inventory requires the complete nested conditional and question references and rejects omissions or renames', () => {
    const references = [
        'skills/debugging-cdp-targets/references/README.md',
        'skills/debugging-cdp-targets/references/question-contract.md',
        'skills/debugging-cdp-targets/references/questions.zh.md',
        'skills/debugging-cdp-targets/references/questions.en.md',
        'skills/debugging-cdp-targets/references/tool-configuration.md',
        'skills/debugging-cdp-targets/references/screenshot-compatibility.md',
        'skills/debugging-cdp-targets/references/recovery-and-events.md',
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

test('thin Plugin inventory rejects every official release file and stale runtime output', async () => {
    const release: unknown = JSON.parse(
        await readFile(new URL('../../../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release) && Array.isArray(release.files));
    for (const record of release.files) {
        assert.ok(isRecord(record) && typeof record.path === 'string');
        assert.ok(
            validatePayloadFileInventory([...REQUIRED_PAYLOAD_FILES, `dist/official-server/${record.path}`]).length,
        );
    }
});

test('Codex independently inventories its presentation overlay and Claude rejects it', () => {
    const overlay = [
        'skills/debugging-cdp-targets/agents/README.md',
        'skills/debugging-cdp-targets/agents/openai.yaml',
    ];
    const codex = requiredPayloadFiles(CODEX_HOST);
    assert.deepEqual(codex.filter((file) => file.includes('/agents/')).sort(), overlay);
    for (const file of overlay) {
        assert.ok(
            validatePayloadFileInventory(
                codex.filter((entry) => entry !== file),
                CODEX_HOST,
            ).length,
        );
        assert.ok(
            validatePayloadFileInventory([...requiredPayloadFiles(CLAUDE_CODE_HOST), file], CLAUDE_CODE_HOST).length,
        );
    }
});

test('peer hosts own explicit independent inventories and reject cross-host and malformed entries', () => {
    assert.deepEqual(
        PLUGIN_HOSTS.map((host) => host.id),
        ['codex', 'claude-code'],
    );
    for (const host of PLUGIN_HOSTS) {
        const files = requiredPayloadFiles(host);
        assert.deepEqual(
            files.filter((file) => file.startsWith('assets/')).sort(),
            host === CODEX_HOST
                ? ['assets/README.md', 'assets/icon-dark.png', 'assets/icon.png']
                : ['assets/README.md', 'assets/icon.png'],
        );
        assert.deepEqual(validatePayloadFileInventory(files, host), []);
        for (const invalid of [
            files.slice(1),
            [...files, files[0] ?? ''],
            [...files, '../escape'],
            [...files, 'extra'],
        ])
            assert.ok(validatePayloadFileInventory(invalid, host).length);
        assert.ok(
            validatePayloadFileInventory(
                requiredPayloadFiles(host === CODEX_HOST ? CLAUDE_CODE_HOST : CODEX_HOST),
                host,
            ).length,
        );
    }
});

test('Codex inventory rejects stale light artwork instead of replacing its universal base', () => {
    const files = requiredPayloadFiles(CODEX_HOST);
    assert.ok(validatePayloadFileInventory([...files, 'assets/icon-light.png'], CODEX_HOST).length);
    assert.ok(
        validatePayloadFileInventory(
            files.map((file) => (file === 'assets/icon.png' ? 'assets/icon-light.png' : file)),
            CODEX_HOST,
        ).length,
    );
});

test('one runtime produces complete peer payloads with identical shared bytes', async () => {
    const outputs = await generateHostPayloads();
    assert.deepEqual([...outputs.keys()], ['codex', 'claude-code']);
    const codex = outputs.get('codex');
    const claude = outputs.get('claude-code');
    assert.ok(codex && claude);
    for (const [file, bytes] of codex) {
        if (file === 'LICENSE' || file.startsWith('dist/')) assert.ok(claude.get(file)?.equals(bytes), file);
    }
    const sharedSkills = await readDistributionTree(path.join(root, 'packaging/shared/skills'));
    for (const [file, bytes] of sharedSkills) {
        assert.ok(codex.get(`skills/${file}`)?.equals(bytes), `codex: ${file}`);
        assert.ok(claude.get(`skills/${file}`)?.equals(bytes), `claude-code: ${file}`);
    }
    for (const [host, files] of outputs) {
        const skillRoot = 'skills/debugging-cdp-targets/';
        for (const [file, bytes] of files) {
            if (!file.startsWith(skillRoot) || !file.endsWith('.md')) continue;
            for (const match of bytes.toString().matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
                const link = match[1];
                assert.ok(link);
                if (/^[a-z]+:/i.test(link)) continue;
                const [relative, fragment] = link.split('#');
                const target = path.posix.normalize(
                    path.posix.join(path.posix.dirname(file), relative || path.posix.basename(file)),
                );
                assert.ok(target.startsWith(skillRoot), `${host}: ${file} escapes Skill: ${link}`);
                const content = files.get(target)?.toString();
                assert.ok(content, `${host}: ${file} has unresolved installed link: ${link}`);
                if (fragment) {
                    const anchors = [...content.matchAll(/^#+ (.+)$/gm)].map((heading) =>
                        (heading[1] ?? '')
                            .toLowerCase()
                            .replace(/[^a-z0-9 -]/g, '')
                            .replaceAll(' ', '-'),
                    );
                    assert.ok(anchors.includes(fragment), `${host}: ${file} has unresolved anchor: ${link}`);
                }
            }
        }
    }
    assert.equal(
        claude.get('README.md')?.toString(),
        await readFile(path.join(root, 'packaging/claude-code/plugin-README.md'), 'utf8'),
    );
    assert.ok(claude.has('.mcp.json'));
    assert.equal(claude.has('mcp.json'), false);
    const maintained: unknown = JSON.parse(
        await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
    );
    const generated: unknown = JSON.parse(codex.get(CODEX_HOST.manifest)?.toString() ?? '{}');
    assert.ok(isRecord(maintained) && isRecord(maintained.interface));
    assert.ok(isRecord(generated) && isRecord(generated.interface));
    assert.ok(Array.isArray(generated.interface.defaultPrompt));
    assert.equal(generated.interface.defaultPrompt.length, 3);
    assert.deepEqual(generated.interface.defaultPrompt, maintained.interface.defaultPrompt);
});

test('Claude assembly rejects competing, missing, linked and escaped inputs without repairing outputs', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-peer-input-')));
    try {
        await cp(path.join(root, 'packaging'), path.join(fixture, 'packaging'), { recursive: true });
        await cp(path.join(root, 'LICENSE'), path.join(fixture, 'LICENSE'));
        await cp(path.join(root, 'package.json'), path.join(fixture, 'package.json'));
        const payload = await assembleClaudeCodePayload(fixture);
        for (const file of ['LICENSE', 'dist/README.md', 'skills/competing/SKILL.md']) {
            const competing = path.join(fixture, CLAUDE_CODE_HOST.inputRoot, file);
            await mkdir(path.dirname(competing), { recursive: true });
            await writeFile(competing, 'competing');
            await assert.rejects(assembleClaudeCodePayload(fixture), /Unexpected packaging input/);
            await rm(
                file.includes('/')
                    ? path.join(fixture, CLAUDE_CODE_HOST.inputRoot, file.split('/')[0] ?? '')
                    : competing,
                { recursive: true },
            );
        }
        const manifest = path.join(fixture, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest);
        await rm(manifest);
        await assert.rejects(assembleClaudeCodePayload(fixture), /Missing packaging input/);
        await symlink(path.join(root, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest), manifest);
        await assert.rejects(assembleClaudeCodePayload(fixture), /symlink|linked/);
        await rm(manifest);
        await cp(path.join(root, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest), manifest);
        const manifestBytes = await readFile(manifest);
        await writeFile(manifest, manifestBytes.toString().replace('0.1.0', '0.1.1'));
        await assert.rejects(generateHostPayloads(fixture), /version/i);
        await writeFile(manifest, manifestBytes);
        const mcp = path.join(fixture, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.mcp);
        const mcpBytes = await readFile(mcp);
        await writeFile(mcp, mcpBytes.toString().replace('127.0.0.1', 'localhost'));
        await assert.rejects(assembleClaudeCodePayload(fixture), /HTTP|MCP/);
        await writeFile(mcp, mcpBytes);
        const destination = path.join(fixture, 'output');
        await mkdir(destination);
        await syncPluginFiles(payload, destination);
        await writeFile(path.join(destination, '.mcp.json'), 'stale');
        await assert.rejects(syncPluginFiles(payload, destination, { check: true }), /Stale/);
        assert.equal(await readFile(path.join(destination, '.mcp.json'), 'utf8'), 'stale');
        await rm(path.join(destination, '.mcp.json'));
        await assert.rejects(syncPluginFiles(payload, destination, { check: true }), /Missing/);
        await assert.rejects(readFile(path.join(destination, '.mcp.json')), /ENOENT/);
        await writeFile(path.join(destination, 'extra'), 'preserve');
        await assert.rejects(syncPluginFiles(payload, destination, { check: true }), /Unexpected/);
        assert.equal(await readFile(path.join(destination, 'extra'), 'utf8'), 'preserve');
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('copied thin peer payloads retain direct HTTP metadata without runnable payloads or cwd coupling', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-thin-peer-')));
    try {
        for (const host of PLUGIN_HOSTS) {
            const plugin = path.join(fixture, host.id);
            await cp(path.join(root, host.payloadRoot), plugin, { recursive: true });
            const files = await readDistributionTree(plugin);
            assert.deepEqual(validatePayloadFileInventory([...files.keys()], host), []);
            assert.equal(
                [...files.keys()].some((file) => /^(?:dist|hooks|node_modules)\//.test(file)),
                false,
            );
            assert.deepEqual(validateMcpEntries(JSON.parse(files.get(host.mcp)?.toString() ?? 'null'), host), []);
        }
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

test('complete host inventories use independent literal expectations for every required path', () => {
    for (const { host, expected, foreign } of [
        {
            host: CODEX_HOST,
            expected: [
                'LICENSE',
                'README.md',
                'assets/icon.png',
                'assets/icon-dark.png',
                '.codex-plugin/README.md',
                '.codex-plugin/plugin.json',
                'mcp.json',
                'assets/README.md',
                'skills/debugging-cdp-targets/agents/openai.yaml',
                'skills/debugging-cdp-targets/agents/README.md',
                'skills/README.md',
                'skills/debugging-cdp-targets/README.md',
                'skills/debugging-cdp-targets/SKILL.md',
                'skills/debugging-cdp-targets/references/README.md',
                'skills/debugging-cdp-targets/references/question-contract.md',
                'skills/debugging-cdp-targets/references/questions.zh.md',
                'skills/debugging-cdp-targets/references/questions.en.md',
                'skills/debugging-cdp-targets/references/tool-configuration.md',
                'skills/debugging-cdp-targets/references/screenshot-compatibility.md',
                'skills/debugging-cdp-targets/references/recovery-and-events.md',
            ],
            foreign: '.mcp.json',
        },
        {
            host: CLAUDE_CODE_HOST,
            expected: [
                'LICENSE',
                'README.md',
                'assets/icon.png',
                '.claude-plugin/README.md',
                '.claude-plugin/plugin.json',
                '.mcp.json',
                'assets/README.md',
                'skills/README.md',
                'skills/debugging-cdp-targets/README.md',
                'skills/debugging-cdp-targets/SKILL.md',
                'skills/debugging-cdp-targets/references/README.md',
                'skills/debugging-cdp-targets/references/question-contract.md',
                'skills/debugging-cdp-targets/references/questions.zh.md',
                'skills/debugging-cdp-targets/references/questions.en.md',
                'skills/debugging-cdp-targets/references/tool-configuration.md',
                'skills/debugging-cdp-targets/references/screenshot-compatibility.md',
                'skills/debugging-cdp-targets/references/recovery-and-events.md',
            ],
            foreign: '.codex-plugin/plugin.json',
        },
    ]) {
        assert.deepEqual([...requiredPayloadFiles(host)].sort(), [...expected].sort());
        assert.deepEqual(validatePayloadFileInventory(expected, host), []);
        for (const missing of expected) {
            assert.ok(
                validatePayloadFileInventory(
                    expected.filter((file) => file !== missing),
                    host,
                ).length,
            );
            assert.ok(
                validatePayloadFileInventory(
                    expected.map((file) => (file === missing ? `${file}.renamed` : file)),
                    host,
                ).length,
            );
        }
        assert.ok(validatePayloadFileInventory([...expected, 'LICENSE'], host).length);
        assert.ok(validatePayloadFileInventory([...expected, foreign], host).length);
    }
});
