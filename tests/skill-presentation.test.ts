import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assembleCodexPayload, generateRuntimeFiles } from '../tooling/build-plugin.ts';
import {
    auditDistribution,
    readDistributionTree,
    validateCodexSkillPresentation,
} from '../tooling/distribution-audit.ts';
import { CODEX_HOST, PLUGIN_HOSTS } from '../tooling/host-policy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const presentation = 'skills/debugging-cdp-targets/agents/openai.yaml';
const valid = `interface:
    display_name: "Debugging CDP Targets"
    short_description: "Debug verified local CDP targets"
    icon_small: "../../assets/icon.png"
    icon_large: "../../assets/icon.png"
`;

test('Skill presentation rejects malformed, duplicate, unknown, missing and typed fields at the audit boundary', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-skill-presentation-')));
    try {
        for (const file of ['plugins', 'packaging', '.agents', '.claude-plugin', 'package.json', 'LICENSE'])
            await cp(path.join(root, file), path.join(fixture, file), { recursive: true });
        const target = path.join(fixture, CODEX_HOST.payloadRoot, presentation);
        await mkdir(path.dirname(target), { recursive: true });
        const files = await readDistributionTree(path.join(fixture, CODEX_HOST.payloadRoot));
        const approvedIcon = await readFile(path.join(fixture, 'packaging/shared/assets/icon.png'));
        assert.deepEqual(validateCodexSkillPresentation(files, approvedIcon), []);
        const invalid = [
            'interface: [',
            `${valid}interface: {}\n`,
            `${valid}    display_name: "Duplicate"\n`,
            `${valid}unknown: true\n`,
            `${valid}    unknown: true\n`,
            'interface: null\n',
            'interface: []\n',
            'interface: {}\n',
        ];
        for (const key of ['display_name', 'short_description', 'icon_small', 'icon_large']) {
            invalid.push(valid.replace(new RegExp(`^    ${key}:.*\\n`, 'm'), ''));
            for (const value of ['null', '1', 'true', '[]', '{}', '""', '"Wrong value"'])
                invalid.push(valid.replace(new RegExp(`(^    ${key}: ).*`, 'm'), `$1${value}`));
        }
        for (const source of invalid) {
            files.set(presentation, Buffer.from(source));
            assert.ok(validateCodexSkillPresentation(files, approvedIcon).length, source);
        }
        // Exercise the physical audit for syntax, duplicate mapping and unknown
        // interface fields; the full adversarial matrix uses the same validator.
        for (const source of ['interface: [', `${valid}interface: {}\n`, `${valid}    unknown: true\n`]) {
            await writeFile(target, source);
            assert.ok(
                (await auditDistribution(fixture)).some((error) => /Skill presentation/.test(error)),
                source,
            );
        }
        await writeFile(target, valid);
        await rm(target);
        assert.ok((await auditDistribution(fixture)).some((error) => /Skill presentation/.test(error)));
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('Skill icons resolve only the approved PluginShared reference to regular approved PNG bytes', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-skill-icons-')));
    try {
        for (const file of ['plugins', 'packaging', '.agents', '.claude-plugin', 'package.json', 'LICENSE'])
            await cp(path.join(root, file), path.join(fixture, file), { recursive: true });
        const target = path.join(fixture, CODEX_HOST.payloadRoot, presentation);
        await mkdir(path.dirname(target), { recursive: true });
        const files = await readDistributionTree(path.join(fixture, CODEX_HOST.payloadRoot));
        const approvedIcon = await readFile(path.join(fixture, 'packaging/shared/assets/icon.png'));
        for (const icon of [
            '../../assets/icon-dark.png',
            '../../../assets/icon.png',
            '../../../../packaging/shared/assets/icon.png',
            '/assets/icon.png',
            'C:/assets/icon.png',
            '..\\..\\assets\\icon.png',
            'https://example.com/icon.png',
        ]) {
            files.set(presentation, Buffer.from(valid.replaceAll('../../assets/icon.png', icon)));
            assert.ok(validateCodexSkillPresentation(files, approvedIcon).length, icon);
        }
        await writeFile(target, valid.replaceAll('../../assets/icon.png', '../../../assets/icon.png'));
        assert.ok((await auditDistribution(fixture)).some((error) => /Skill presentation/.test(error)));
        await writeFile(target, valid);
        const icon = path.join(fixture, CODEX_HOST.payloadRoot, 'assets/icon.png');
        const bytes = await readFile(icon);
        await writeFile(icon, 'not PNG');
        assert.ok((await auditDistribution(fixture)).some((error) => /Skill presentation/.test(error)));
        await cp(path.join(root, 'packaging/shared/assets/icon-dark.png'), icon);
        assert.ok((await auditDistribution(fixture)).some((error) => /Skill presentation.*approved/.test(error)));
        await rm(icon);
        assert.ok((await auditDistribution(fixture)).some((error) => /Skill presentation/.test(error)));
        await symlink(path.join(root, 'packaging/shared/assets/icon.png'), icon);
        assert.ok((await auditDistribution(fixture)).some((error) => /link|symlink/.test(error)));
        await rm(icon);
        await writeFile(icon, bytes);
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('both hosts must preserve every maintained shared Skill file even when peer bytes agree', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-shared-skills-')));
    try {
        for (const file of ['plugins', 'packaging', '.agents', '.claude-plugin', 'package.json', 'LICENSE'])
            await cp(path.join(root, file), path.join(fixture, file), { recursive: true });
        assert.deepEqual(await auditDistribution(fixture), []);
        for (const file of ['README.md', 'debugging-cdp-targets/README.md', 'debugging-cdp-targets/SKILL.md']) {
            const original = await readFile(path.join(fixture, 'packaging/shared/skills', file));
            for (const host of PLUGIN_HOSTS)
                await writeFile(
                    path.join(fixture, host.payloadRoot, 'skills', file),
                    Buffer.concat([original, Buffer.from('\nDrift\n')]),
                );
            const errors = await auditDistribution(fixture);
            for (const host of PLUGIN_HOSTS)
                assert.ok(
                    errors.some((error) => error.includes(`${host.id}: Changed shared Skill file: ${file}`)),
                    host.id,
                );
            for (const host of PLUGIN_HOSTS)
                await writeFile(path.join(fixture, host.payloadRoot, 'skills', file), original);
        }
        await writeFile(path.join(fixture, 'packaging/shared/skills/extra.md'), 'new maintained input\n');
        const errors = await auditDistribution(fixture);
        for (const host of PLUGIN_HOSTS)
            assert.ok(
                errors.some((error) => error.includes(`${host.id}: Missing shared Skill file: extra.md`)),
                host.id,
            );
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('Codex assembly audits maintained presentation before copying and preserves shared instructions', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-skill-assembly-')));
    try {
        for (const file of ['packaging', 'package.json', 'LICENSE'])
            await cp(path.join(root, file), path.join(fixture, file), { recursive: true });
        const input = path.join(fixture, 'packaging/codex/skill-openai.yaml');
        await writeFile(input, valid);
        const runtime = await generateRuntimeFiles();
        const payload = await assembleCodexPayload(runtime, fixture);
        assert.equal(payload.get(presentation)?.toString(), valid);
        assert.ok(
            payload
                .get('skills/debugging-cdp-targets/SKILL.md')
                ?.equals(await readFile(path.join(root, 'packaging/shared/skills/debugging-cdp-targets/SKILL.md'))),
        );
        await writeFile(input, `${valid}    display_name: "duplicate"\n`);
        await assert.rejects(assembleCodexPayload(runtime, fixture), /Skill presentation/);
        assert.match(await readFile(input, 'utf8'), /duplicate/);
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});

test('shared Skill inventory rejects stale delivered files after maintained sources are deleted or renamed', async () => {
    const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-stale-shared-skills-')));
    try {
        for (const file of ['plugins', 'packaging', '.agents', '.claude-plugin', 'package.json', 'LICENSE'])
            await cp(path.join(root, file), path.join(fixture, file), { recursive: true });
        assert.deepEqual(await auditDistribution(fixture), []);
        for (const [file, rename] of [
            ['debugging-cdp-targets/SKILL.md', false],
            ['debugging-cdp-targets/README.md', true],
        ] as const) {
            const maintained = path.join(fixture, 'packaging/shared/skills', file);
            const original = await readFile(maintained);
            await rm(maintained);
            if (rename) await writeFile(`${maintained}.renamed`, original);
            for (const differentPeers of [false, true]) {
                if (differentPeers)
                    for (const host of PLUGIN_HOSTS)
                        await writeFile(
                            path.join(fixture, host.payloadRoot, 'skills', file),
                            `${host.id} stale bytes\n`,
                        );
                const errors = await auditDistribution(fixture);
                for (const host of PLUGIN_HOSTS) {
                    assert.ok(
                        errors.some((error) => error.includes(`${host.id}: Unexpected shared Skill file: ${file}`)),
                        `${host.id}: ${file}, renamed=${rename}, differentPeers=${differentPeers}`,
                    );
                    if (rename)
                        assert.ok(
                            errors.some((error) =>
                                error.includes(`${host.id}: Missing shared Skill file: ${file}.renamed`),
                            ),
                            host.id,
                        );
                }
            }
            if (rename) await rm(`${maintained}.renamed`);
            await writeFile(maintained, original);
            for (const host of PLUGIN_HOSTS)
                await writeFile(path.join(fixture, host.payloadRoot, 'skills', file), original);
        }
        assert.deepEqual(await auditDistribution(fixture), []);
    } finally {
        await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});
