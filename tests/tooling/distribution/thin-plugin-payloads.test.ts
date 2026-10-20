import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    assembleCodexPayload,
    generateHostPayloads,
    syncPluginFiles,
} from '../../../tooling/distribution/build-plugin.ts';

test('build synchronization preserves nested paths and check mode never changes stale, missing or extra outputs', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-output-')));
    try {
        const files = new Map([
            ['gateway.mjs', Buffer.from('gateway')],
            ['official-server/a/same.js', Buffer.from('a')],
            ['official-server/b/same.js', Buffer.from('b')],
        ]);
        await syncPluginFiles(files, root);
        assert.equal((await readFile(path.join(root, 'official-server/a/same.js'))).toString(), 'a');
        assert.equal((await readFile(path.join(root, 'official-server/b/same.js'))).toString(), 'b');
        await syncPluginFiles(files, root, { check: true });
        await writeFile(path.join(root, 'gateway.mjs'), 'stale');
        await assert.rejects(syncPluginFiles(files, root, { check: true }), /Stale/);
        assert.equal((await readFile(path.join(root, 'gateway.mjs'))).toString(), 'stale');
        await rm(path.join(root, 'gateway.mjs'));
        await assert.rejects(syncPluginFiles(files, root, { check: true }), /Missing/);
        await writeFile(path.join(root, 'secret'), 'preserve');
        await assert.rejects(syncPluginFiles(files, root), /Unexpected/);
        assert.equal((await readFile(path.join(root, 'secret'))).toString(), 'preserve');
        await rm(path.join(root, 'secret'));
        await writeFile(path.join(root, 'hide-npm-console.cjs'), 'obsolete');
        await assert.rejects(syncPluginFiles(files, root, { check: true }), /Unexpected/);
        await syncPluginFiles(files, root);
        await assert.rejects(readFile(path.join(root, 'hide-npm-console.cjs')), /ENOENT/);
        await assert.rejects(syncPluginFiles(new Map([['../escape', Buffer.from('x')]]), root), /Unsafe/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Codex payload assembly copies canonical packaging inputs and root license', async () => {
    const files = await assembleCodexPayload();
    const mappings = [
        ['LICENSE', '../../../LICENSE'],
        ['README.md', '../../../packaging/codex/plugin-README.md'],
        ['.codex-plugin/plugin.json', '../../../packaging/codex/.codex-plugin/plugin.json'],
        ['mcp.json', '../../../packaging/codex/mcp.json'],
        ['skills/debugging-cdp-targets/SKILL.md', '../../../packaging/shared/skills/debugging-cdp-targets/SKILL.md'],
        ...[
            'README.md',
            'question-contract.md',
            'questions.zh.md',
            'questions.en.md',
            'tool-configuration.md',
            'screenshot-compatibility.md',
            'recovery-and-events.md',
        ].map((file) => [
            `skills/debugging-cdp-targets/references/${file}`,
            `../../../packaging/shared/skills/debugging-cdp-targets/references/${file}`,
        ]),
    ];
    for (const [destination, input] of mappings) {
        assert.ok(destination && input);
        const bytes = files.get(destination);
        assert.ok(bytes, destination);
        assert.ok(bytes.equals(await readFile(new URL(input, import.meta.url))), destination);
    }
    assert.ok([...files.keys()].every((file) => !file.startsWith('dist/') && !file.startsWith('hooks/')));
});

test('payload assembly rejects unexpected host inputs that could compete with shared sources', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-packaging-')));
    try {
        await cp(new URL('../../../packaging', import.meta.url), path.join(root, 'packaging'), { recursive: true });
        await cp(new URL('../../../LICENSE', import.meta.url), path.join(root, 'LICENSE'));
        for (const file of ['LICENSE', 'dist/README.md', 'skills/debugging-cdp-targets/SKILL.md']) {
            const competing = path.join(root, 'packaging/codex', file);
            await mkdir(path.dirname(competing), { recursive: true });
            await writeFile(competing, 'competing bytes');
            await assert.rejects(assembleCodexPayload(root), /Unexpected packaging input/);
            await rm(competing);
            if (file.startsWith('dist/')) await rmdir(path.dirname(competing));
            if (file.startsWith('skills/')) await rm(path.join(root, 'packaging/codex/skills'), { recursive: true });
        }
        for (const file of [
            'README.md',
            'question-contract.md',
            'questions.zh.md',
            'questions.en.md',
            'tool-configuration.md',
            'screenshot-compatibility.md',
            'recovery-and-events.md',
        ]) {
            const reference = path.join(root, 'packaging/shared/skills/debugging-cdp-targets/references', file);
            const original = await readFile(reference);
            await rm(reference);
            await assert.rejects(assembleCodexPayload(root), /Missing Plugin file/);
            await writeFile(`${reference}.renamed`, original);
            await assert.rejects(assembleCodexPayload(root), /Unexpected Plugin file/);
            await rm(`${reference}.renamed`);
            await writeFile(reference, original);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('payload assembly rejects a linked canonical input root', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-packaging-link-')));
    try {
        await mkdir(path.join(root, 'packaging'));
        await cp(new URL('../../../packaging/shared', import.meta.url), path.join(root, 'packaging/shared'), {
            recursive: true,
        });
        await cp(new URL('../../../LICENSE', import.meta.url), path.join(root, 'LICENSE'));
        await symlink(path.resolve('packaging/codex'), path.join(root, 'packaging/codex'), 'junction');
        await assert.rejects(assembleCodexPayload(root), /Packaging input.*linked/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('payload assembly maps host user documentation without shipping source directory documentation', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-packaging-docs-')));
    try {
        await cp(new URL('../../../packaging', import.meta.url), path.join(root, 'packaging'), { recursive: true });
        await cp(new URL('../../../LICENSE', import.meta.url), path.join(root, 'LICENSE'));
        await writeFile(path.join(root, 'packaging/codex/README.md'), '# Maintained inputs\n');
        await writeFile(path.join(root, 'packaging/codex/plugin-README.md'), '# Installed plugin\n');
        const files = await assembleCodexPayload(root);
        assert.equal(files.get('README.md')?.toString(), '# Installed plugin\n');
        assert.equal(files.has('plugin-README.md'), false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('host build accepts independent App version and rejects maintained plugin drift', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-version-build-')));
    try {
        await cp(new URL('../../../packaging', import.meta.url), path.join(root, 'packaging'), { recursive: true });
        await cp(new URL('../../../LICENSE', import.meta.url), path.join(root, 'LICENSE'));
        await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.3.4' }));
        assert.equal((await generateHostPayloads(root)).size, 2);
        const manifest = path.join(root, 'packaging/claude-code/.claude-plugin/plugin.json');
        const original = await readFile(manifest, 'utf8');
        const data = JSON.parse(original);
        await writeFile(manifest, JSON.stringify({ ...data, version: '0.2.0' }));
        await assert.rejects(generateHostPayloads(root), /version/i);
        await writeFile(manifest, original);
        const skill = path.join(root, 'packaging/shared/skills/debugging-cdp-targets/SKILL.md');
        await writeFile(skill, (await readFile(skill, 'utf8')).replace(/version:.*0\.1\.0.*/, 'version: 0.2.0'));
        await assert.rejects(generateHostPayloads(root), /version/i);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
