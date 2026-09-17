import assert from 'node:assert/strict';
import test from 'node:test';

import { auditRepositorySnapshot } from '../tooling/repository-audit.mjs';

const license = 'MIT License\n';
const approvedFields = [
    'schemaVersion',
    'status',
    'targetAdapter',
    'executablePath',
    'rootProcessId',
    'port',
    'browserProduct',
    'browserMajorVersion',
    'webSocketDebuggerUrl',
    'requestedPackageSpec',
    'resolvedPackageVersion',
    'extensionsEnabled',
    'workspaces',
    'startedAtUtc',
    'daemonProcessId',
];

function validSnapshot() {
    const files = {
        'AGENTS.md': '# Rules\n',
        'CHANGELOG.md': '# Changelog\n\n## [0.1.0] - 2026-09-17\n',
        'CLAUDE.md': 'AGENTS.md',
        LICENSE: license,
        'README.md': '# Project\n',
        'mise.toml': '[tools]\nnode = "24.21.0"\npnpm = "12.4.2"\n',
        'package.json': `${JSON.stringify(
            {
                name: 'debugging-cdp-targets',
                version: '0.1.0',
                private: true,
                type: 'module',
                license: 'MIT',
                engines: { node: '24.21.0' },
                packageManager: 'pnpm@12.4.2',
                devDependencies: {
                    '@biomejs/biome': '2.5.14',
                    '@commitlint/cli': '21.2.2',
                    '@commitlint/config-conventional': '21.2.2',
                    husky: '9.1.7',
                    'lint-staged': '17.5.1',
                    skills: '1.6.0',
                    yaml: '2.9.1',
                },
            },
            null,
            4,
        )}\n`,
        'skills/README.md': '# Skills\n',
        'skills/debugging-cdp-targets/AGENTS.md': '# Skill rules\n',
        'skills/debugging-cdp-targets/LICENSE': license,
        'skills/debugging-cdp-targets/README.md': '# Payload\n',
        'skills/debugging-cdp-targets/SKILL.md': [
            '---',
            'name: debugging-cdp-targets',
            'description: Use when debugging local CDP targets.',
            'license: MIT',
            'metadata:',
            '    version: "0.1.0"',
            '---',
            '',
            '# Debugging CDP Targets',
            '',
            'Compatibility: Windows 10 or later with Node.js 24.21.0 and `npx` available.',
            '',
            'Read [the reference](references/obsidian.md).',
            '',
        ].join('\n'),
        'skills/debugging-cdp-targets/agents/README.md': '# Agent metadata\n',
        'skills/debugging-cdp-targets/agents/openai.yaml': [
            'interface:',
            '    display_name: "Debugging CDP Targets"',
            '    short_description: "Safely inspect local CDP targets on Windows"',
            '    default_prompt: "Use $debugging-cdp-targets safely."',
            'policy:',
            '    allow_implicit_invocation: true',
            '',
        ].join('\n'),
        'skills/debugging-cdp-targets/references/README.md': '# References\n',
        'skills/debugging-cdp-targets/references/obsidian.md': '# Obsidian\n',
        'skills/debugging-cdp-targets/scripts/AGENTS.md': '# Runtime rules\n',
        'skills/debugging-cdp-targets/scripts/README.md': '# Runtime\n',
        'skills/debugging-cdp-targets/scripts/cdp-session.mjs': [
            '#!/usr/bin/env node',
            'if (import.meta.url === invokedPath) {',
            '    await Promise.resolve();',
            '}',
            '',
        ].join('\n'),
        'skills/debugging-cdp-targets/scripts/adapters/README.md': '# Adapters\n',
        'skills/debugging-cdp-targets/scripts/adapters/runtime.mjs':
            'import process from "node:process";\nexport { process };\n',
        'skills/debugging-cdp-targets/scripts/domains/README.md': '# Domains\n',
        'skills/debugging-cdp-targets/scripts/domains/policy.mjs': 'export const bind = "127.0.0.1";\n',
        'skills/debugging-cdp-targets/scripts/shared/README.md': '# Shared\n',
        'skills/debugging-cdp-targets/scripts/shared/constants.mjs': [
            'export const APPROVED_STATE_FIELDS = Object.freeze([',
            ...approvedFields.map((field) => `    "${field}",`),
            ']);',
            '',
        ].join('\n'),
    };

    return {
        files,
        trackedFiles: Object.keys(files),
        trackedModes: { 'CLAUDE.md': '120000' },
        symlinks: { 'CLAUDE.md': 'AGENTS.md' },
    };
}

test('accepts a repository snapshot satisfying every audit', () => {
    assert.deepEqual(auditRepositorySnapshot(validSnapshot()), []);
});

test('reports each repository policy violation with an actionable message', () => {
    const cases = [
        ['missing directory README', (snapshot) => delete snapshot.files['skills/README.md'], /skills.*README\.md/i],
        ['wrong CLAUDE mode', (snapshot) => (snapshot.trackedModes['CLAUDE.md'] = '100644'), /CLAUDE\.md.*120000/i],
        [
            'wrong CLAUDE target',
            (snapshot) => (snapshot.symlinks['CLAUDE.md'] = 'README.md'),
            /CLAUDE\.md.*AGENTS\.md/i,
        ],
        [
            'version mismatch',
            (snapshot) => (snapshot.files['mise.toml'] = snapshot.files['mise.toml'].replace('24.21.0', '24.20.0')),
            /version.*24\.21\.0/i,
        ],
        [
            'runtime dependency',
            (snapshot) => {
                const packageData = JSON.parse(snapshot.files['package.json']);
                packageData.dependencies = { unexpected: '1.0.0' };
                snapshot.files['package.json'] = `${JSON.stringify(packageData, null, 4)}\n`;
            },
            /runtime dependencies/i,
        ],
        [
            'wrong dev dependency',
            (snapshot) => {
                const packageData = JSON.parse(snapshot.files['package.json']);
                packageData.devDependencies.skills = 'latest';
                snapshot.files['package.json'] = `${JSON.stringify(packageData, null, 4)}\n`;
            },
            /dev dependencies.*skills/i,
        ],
        [
            'non-private package',
            (snapshot) => {
                const packageData = JSON.parse(snapshot.files['package.json']);
                packageData.private = false;
                snapshot.files['package.json'] = `${JSON.stringify(packageData, null, 4)}\n`;
            },
            /package.*private/i,
        ],
        [
            'license mismatch',
            (snapshot) => (snapshot.files['skills/debugging-cdp-targets/LICENSE'] = 'other\n'),
            /licenses.*byte-identical/i,
        ],
        ['tab', (snapshot) => (snapshot.files['README.md'] = '# Project\n\tbad\n'), /README\.md.*tab/i],
        ['CRLF', (snapshot) => (snapshot.files['README.md'] = '# Project\r\n'), /README\.md.*LF/i],
        [
            'missing final newline',
            (snapshot) => (snapshot.files['README.md'] = '# Project'),
            /README\.md.*final newline/i,
        ],
        [
            'two-space structural indentation',
            (snapshot) => (snapshot.files['package.json'] = '{\n  "version": "0.1.0"\n}\n'),
            /package\.json.*four-space/i,
        ],
        [
            'extra executable entry',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/scripts/shared/constants.mjs'] +=
                    'if (import.meta.url === invokedPath) {}\n'),
            /only.*cdp-session\.mjs.*direct/i,
        ],
        [
            'domain I/O import',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/scripts/domains/policy.mjs'] =
                    'import fs from "node:fs";\nexport { fs };\n'),
            /domain.*node:fs/i,
        ],
        [
            'adapter application import',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/scripts/adapters/runtime.mjs'] =
                    'import "../application/commands.mjs";\n'),
            /adapter.*application/i,
        ],
        [
            'old identifier',
            (snapshot) => (snapshot.files['skills/debugging-cdp-targets/README.md'] += 'Use --target-kind Chrome.\n'),
            /old public identifier.*--target-kind/i,
        ],
        [
            'force kill',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/scripts/adapters/runtime.mjs'] =
                    'export const command = "taskkill /F";\n'),
            /force-kill/i,
        ],
        [
            'external binding',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/scripts/domains/policy.mjs'] =
                    'export const bind = "0.0.0.0";\n'),
            /loopback/i,
        ],
        [
            'PWA category',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/scripts/adapters/runtime.mjs'] =
                    'export const option = "--category-pwa";\n'),
            /PWA category/i,
        ],
        [
            'sensitive state field',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/scripts/shared/constants.mjs'] = snapshot.files[
                    'skills/debugging-cdp-targets/scripts/shared/constants.mjs'
                ].replace('    "daemonProcessId",', '    "cookies",\n    "daemonProcessId",')),
            /state fields.*cookies/i,
        ],
        [
            'bad Skill name',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/SKILL.md'] = snapshot.files[
                    'skills/debugging-cdp-targets/SKILL.md'
                ].replace('name: debugging-cdp-targets', 'name: other')),
            /Skill name.*folder/i,
        ],
        [
            'bad compatibility',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/SKILL.md'] = snapshot.files[
                    'skills/debugging-cdp-targets/SKILL.md'
                ].replace('Windows 10 or later', 'Linux')),
            /compatibility.*Windows 10/i,
        ],
        [
            'bad default prompt',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/agents/openai.yaml'] = snapshot.files[
                    'skills/debugging-cdp-targets/agents/openai.yaml'
                ].replace('$debugging-cdp-targets', '$other')),
            /default prompt.*\$debugging-cdp-targets/i,
        ],
        [
            'broken relative reference',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/SKILL.md'] = snapshot.files[
                    'skills/debugging-cdp-targets/SKILL.md'
                ].replace('references/obsidian.md', 'references/missing.md')),
            /relative reference.*missing/i,
        ],
        [
            'repository file in payload',
            (snapshot) => (snapshot.files['skills/debugging-cdp-targets/package.json'] = '{}\n'),
            /production payload.*package\.json/i,
        ],
        [
            'second Skill discovery',
            (snapshot) => (snapshot.files['other/SKILL.md'] = '---\nname: other\n---\n'),
            /exactly one Skill.*other\/SKILL\.md/i,
        ],
    ];

    for (const [name, mutate, pattern] of cases) {
        const snapshot = validSnapshot();
        mutate(snapshot);
        snapshot.trackedFiles = Object.keys(snapshot.files);
        assert.match(auditRepositorySnapshot(snapshot).join('\n'), pattern, name);
    }
});
