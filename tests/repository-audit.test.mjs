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
        'skills/debugging-cdp-targets/scripts/adapters/AGENTS.md': '# Adapter rules\n',
        'skills/debugging-cdp-targets/scripts/adapters/runtime.mjs':
            'import process from "node:process";\nexport { process };\n',
        'skills/debugging-cdp-targets/scripts/application/AGENTS.md': '# Application rules\n',
        'skills/debugging-cdp-targets/scripts/application/README.md': '# Application\n',
        'skills/debugging-cdp-targets/scripts/domains/AGENTS.md': '# Domain rules\n',
        'skills/debugging-cdp-targets/scripts/domains/README.md': '# Domains\n',
        'skills/debugging-cdp-targets/scripts/domains/cdp-target/AGENTS.md': '# CDP target rules\n',
        'skills/debugging-cdp-targets/scripts/domains/cdp-target/README.md': '# CDP target\n',
        'skills/debugging-cdp-targets/scripts/domains/cdp-target/policy.mjs': 'export const bind = "127.0.0.1";\n',
        'skills/debugging-cdp-targets/scripts/hide-mcp-console.cjs': 'module.exports = {};\n',
        'skills/debugging-cdp-targets/scripts/interface/AGENTS.md': '# Interface rules\n',
        'skills/debugging-cdp-targets/scripts/interface/README.md': '# Interface\n',
        'skills/debugging-cdp-targets/scripts/shared/README.md': '# Shared\n',
        'skills/debugging-cdp-targets/scripts/shared/AGENTS.md': '# Shared rules\n',
        'skills/debugging-cdp-targets/scripts/shared/constants.mjs': [
            'export const APPROVED_STATE_FIELDS = Object.freeze([',
            ...approvedFields.map((field) => `    "${field}",`),
            ']);',
            '',
        ].join('\n'),
        'skills/debugging-cdp-targets/scripts/windows-cdp-helper.ps1': 'param()\n',
    };

    return {
        files,
        physicalPayloadFiles: Object.keys(files).filter((filePath) =>
            filePath.startsWith('skills/debugging-cdp-targets/'),
        ),
        trackedFiles: Object.keys(files),
        trackedModes: { 'CLAUDE.md': '120000' },
        symlinks: { 'CLAUDE.md': 'AGENTS.md' },
    };
}

test('accepts a repository snapshot satisfying every audit', () => {
    assert.deepEqual(auditRepositorySnapshot(validSnapshot()), []);
});

test('rejects every import syntax that can cross domain or adapter boundaries', () => {
    const cases = [
        [
            'domain node subpath re-export',
            'export { readFile } from "node:fs/promises";\n',
            /domain.*node:fs\/promises/i,
        ],
        ['domain bare dynamic import', 'const fs = await import("fs");\n', /domain.*fs/i],
        ['domain interface import', 'export * from "../../interface/cli.mjs";\n', /domain.*interface/i],
        ['adapter interface re-export', 'export * from "../interface/cli.mjs";\n', /adapter.*interface/i],
    ];

    for (const [name, source, pattern] of cases) {
        const snapshot = validSnapshot();
        const target = name.startsWith('adapter')
            ? 'skills/debugging-cdp-targets/scripts/adapters/runtime.mjs'
            : 'skills/debugging-cdp-targets/scripts/domains/cdp-target/policy.mjs';
        snapshot.files[target] = source;
        assert.match(auditRepositorySnapshot(snapshot).join('\n'), pattern, name);
    }
});

test('requires one public entry and rejects alternate direct-execution guards elsewhere', () => {
    const alternateGuards = [
        'if (import.meta.main) { await main(); }\n',
        'if (fileURLToPath(import.meta.url) === process.argv[1]) { await main(); }\n',
        'if (require.main === module) { main(); }\n',
    ];
    for (const source of alternateGuards) {
        const snapshot = validSnapshot();
        snapshot.files['skills/debugging-cdp-targets/scripts/shared/constants.mjs'] += source;
        assert.match(auditRepositorySnapshot(snapshot).join('\n'), /only.*cdp-session\.mjs.*direct/i);
    }

    const missing = validSnapshot();
    delete missing.files['skills/debugging-cdp-targets/scripts/cdp-session.mjs'];
    missing.trackedFiles = Object.keys(missing.files);
    missing.physicalPayloadFiles = missing.physicalPayloadFiles.filter(
        (filePath) => filePath !== 'skills/debugging-cdp-targets/scripts/cdp-session.mjs',
    );
    assert.match(auditRepositorySnapshot(missing).join('\n'), /cdp-session\.mjs.*required public entry/i);
});

test('rejects process termination APIs and concrete non-loopback addresses', () => {
    const cases = [
        ['Stop-Process', 'Stop-Process -Id $Pid\n', /force-kill|termination/i],
        ['taskkill', 'const command = "taskkill /PID 42";\n', /force-kill|termination/i],
        ['child kill', 'child.kill();\n', /force-kill|termination/i],
        ['object Kill', 'target.Kill();\n', /force-kill|termination/i],
        ['chained object Kill', 'getTarget().Kill();\n', /force-kill|termination/i],
        ['external IPv4 bind', 'export const bind = "192.168.1.5";\n', /loopback/i],
    ];
    for (const [name, source, pattern] of cases) {
        const snapshot = validSnapshot();
        snapshot.files['skills/debugging-cdp-targets/scripts/adapters/runtime.mjs'] = source;
        assert.match(auditRepositorySnapshot(snapshot).join('\n'), pattern, name);
    }
});

test('rejects every legacy public identifier from the user README and payload', () => {
    const legacy = [
        'debugging-chromium-apps', // audit-allow-legacy: negative-test
        'chromium-devtools-session', // audit-allow-legacy: negative-test
        '--target-kind', // audit-allow-legacy: negative-test
        'targetKind', // audit-allow-legacy: negative-test
        'TargetKind', // audit-allow-legacy: negative-test
        'ChromiumApp', // audit-allow-legacy: negative-test
        'agent-debugging-chromium-apps', // audit-allow-legacy: negative-test
    ];
    for (const identifier of legacy) {
        for (const filePath of ['README.md', 'skills/debugging-cdp-targets/README.md']) {
            const snapshot = validSnapshot();
            snapshot.files[filePath] += `${identifier}\n`;
            assert.match(
                auditRepositorySnapshot(snapshot).join('\n'),
                /legacy public identifier/i,
                `${filePath}: ${identifier}`,
            );
        }
    }
});

test('parses and validates the Skill and OpenAI YAML schemas', () => {
    const cases = [
        [
            'malformed Skill metadata',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/SKILL.md'] = snapshot.files[
                    'skills/debugging-cdp-targets/SKILL.md'
                ].replace('metadata:', 'metadata: [')),
            /Skill frontmatter.*YAML/i,
        ],
        [
            'empty Skill description',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/SKILL.md'] = snapshot.files[
                    'skills/debugging-cdp-targets/SKILL.md'
                ].replace('description: Use when debugging local CDP targets.', 'description: ""')),
            /Skill description.*non-empty/i,
        ],
        [
            'OpenAI interface at wrong level',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/agents/openai.yaml'] = [
                    'display_name: "Debugging CDP Targets"',
                    'short_description: "Safely inspect local CDP targets on Windows"',
                    'default_prompt: "Use $debugging-cdp-targets safely."',
                    'policy:',
                    '    allow_implicit_invocation: true',
                    '',
                ].join('\n')),
            /OpenAI metadata.*interface/i,
        ],
        [
            'OpenAI boolean encoded as string',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/agents/openai.yaml'] = snapshot.files[
                    'skills/debugging-cdp-targets/agents/openai.yaml'
                ].replace('allow_implicit_invocation: true', 'allow_implicit_invocation: "true"')),
            /allow_implicit_invocation.*boolean/i,
        ],
        [
            'OpenAI dependency outside the supported schema',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/agents/openai.yaml'] +=
                    'dependencies:\n    mcp:\n        - chrome-devtools\n'),
            /OpenAI metadata.*unsupported.*dependencies/i,
        ],
    ];
    for (const [name, mutate, pattern] of cases) {
        const snapshot = validSnapshot();
        mutate(snapshot);
        assert.match(auditRepositorySnapshot(snapshot).join('\n'), pattern, name);
    }
});

test('enforces payload paths, required licenses, ignored sensitive files, and contained links', () => {
    const cases = [
        [
            'repository policy inside scripts',
            (snapshot) => {
                const filePath = 'skills/debugging-cdp-targets/scripts/docs/policy.md';
                snapshot.files[filePath] = '# Policy\n';
                snapshot.physicalPayloadFiles.push(filePath);
            },
            /payload.*scripts\/docs\/policy\.md/i,
        ],
        [
            'ignored environment file',
            (snapshot) => snapshot.physicalPayloadFiles.push('skills/debugging-cdp-targets/scripts/.env'),
            /payload.*scripts\/\.env/i,
        ],
        [
            'ignored source-shaped file',
            (snapshot) =>
                snapshot.physicalPayloadFiles.push('skills/debugging-cdp-targets/scripts/adapters/secret.mjs'),
            /payload.*secret\.mjs.*tracked/i,
        ],
        ['missing root license', (snapshot) => delete snapshot.files.LICENSE, /root LICENSE.*required/i],
        [
            'missing payload license',
            (snapshot) => delete snapshot.files['skills/debugging-cdp-targets/LICENSE'],
            /payload LICENSE.*required/i,
        ],
        [
            'escaping payload link',
            (snapshot) =>
                (snapshot.files['skills/debugging-cdp-targets/SKILL.md'] = snapshot.files[
                    'skills/debugging-cdp-targets/SKILL.md'
                ].replace('references/obsidian.md', '../../package.json')),
            /relative reference.*remain inside.*payload/i,
        ],
    ];
    for (const [name, mutate, pattern] of cases) {
        const snapshot = validSnapshot();
        mutate(snapshot);
        snapshot.trackedFiles = Object.keys(snapshot.files);
        assert.match(auditRepositorySnapshot(snapshot).join('\n'), pattern, name);
    }
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
                (snapshot.files['skills/debugging-cdp-targets/scripts/domains/cdp-target/policy.mjs'] =
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
            (snapshot) => (snapshot.files['skills/debugging-cdp-targets/README.md'] += 'Use --target-kind Chrome.\n'), // audit-allow-legacy: negative-test
            /legacy public identifier/i,
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
                (snapshot.files['skills/debugging-cdp-targets/scripts/domains/cdp-target/policy.mjs'] =
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
            (snapshot) => {
                const filePath = 'skills/debugging-cdp-targets/package.json';
                snapshot.files[filePath] = '{}\n';
                snapshot.physicalPayloadFiles.push(filePath);
            },
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
