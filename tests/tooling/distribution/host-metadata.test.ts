import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isRecord } from '../../../src/shared/errors.ts';
import { CLAUDE_CODE_HOST, CODEX_HOST, PLUGIN_HOSTS } from '../../../tooling/distribution/host-descriptors.ts';
import {
    validateHostManifest,
    validateMarketplace,
    validateMcpEntries,
} from '../../../tooling/distribution/host-metadata.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));

test('Codex requires explicit Skill discovery while Claude retains default discovery', async () => {
    for (const host of PLUGIN_HOSTS) {
        const manifest: unknown = JSON.parse(await readFile(path.join(root, host.inputRoot, host.manifest), 'utf8'));
        assert.ok(isRecord(manifest));
        if (host === CODEX_HOST) {
            assert.deepEqual(validateHostManifest({ ...manifest, skills: './skills/' }, host), []);
            const missing = { ...manifest };
            delete missing.skills;
            assert.ok(validateHostManifest(missing, host).length);
            for (const skills of [null, [], {}, 1, '', './skills', '../skills/', './other/'])
                assert.ok(validateHostManifest({ ...manifest, skills }, host).length);
        } else {
            assert.ok(validateHostManifest({ ...manifest, skills: './skills/' }, host).length);
        }
    }
});

test('host metadata rejects wrong argv, discovery fields, hooks and marketplace routing', async () => {
    for (const host of PLUGIN_HOSTS) {
        const read = async (file: string): Promise<unknown> =>
            JSON.parse(await readFile(path.join(root, host.inputRoot, file), 'utf8'));
        const manifest = await read(host.manifest);
        const mcp = await read(host.mcp);
        const marketplace: unknown = JSON.parse(await readFile(path.join(root, host.marketplace), 'utf8'));
        assert.deepEqual(validateHostManifest(manifest, host), []);
        assert.deepEqual(validateMcpEntries(mcp, host), []);
        assert.deepEqual(validateMarketplace(marketplace, host), []);
        const other = host === CODEX_HOST ? CLAUDE_CODE_HOST : CODEX_HOST;
        assert.ok(validateHostManifest(manifest, other).length);
        assert.ok(validateMcpEntries(mcp, other).length);
        assert.ok(validateMarketplace(marketplace, other).length);
        assert.ok(isRecord(manifest));
        assert.ok(validateHostManifest({ ...manifest, hooks: './hooks/hooks.json' }, host).length);
        for (const invalid of [
            null,
            [],
            {},
            { plugins: [] },
            { plugins: [{ name: 'debugging-cdp-targets', source: '../escape' }] },
        ])
            assert.ok(validateMarketplace(invalid, host).length);
    }
});

test('host manifests accept explicit project links and host display metadata', async () => {
    for (const host of PLUGIN_HOSTS) {
        const manifest: unknown = JSON.parse(await readFile(path.join(root, host.inputRoot, host.manifest), 'utf8'));
        assert.ok(isRecord(manifest));
        const metadata = { ...manifest, homepage: 'https://github.com/Cirnouo/debugging-cdp-targets' };
        if (host === CODEX_HOST) {
            assert.ok(isRecord(manifest.interface));
            assert.deepEqual(
                validateHostManifest({
                    ...metadata,
                    interface: {
                        ...manifest.interface,
                        websiteURL: 'https://github.com/Cirnouo/debugging-cdp-targets',
                        longDescription:
                            'Launch a new local Chrome browser or another verified CDP-capable application with the isolation option you choose. Use the official Chrome DevTools tools to capture screenshots, diagnose console and network issues, and inspect performance. Choose Close or Keep when the task ends.',
                    },
                }),
                [],
            );
        } else {
            assert.deepEqual(validateHostManifest({ ...metadata, displayName: 'Debugging CDP Targets' }, host), []);
        }
    }
});

test('host manifests reject missing, malformed or wrong project homepages', async () => {
    for (const host of PLUGIN_HOSTS) {
        const manifest: unknown = JSON.parse(await readFile(path.join(root, host.inputRoot, host.manifest), 'utf8'));
        assert.ok(isRecord(manifest));
        const missing = { ...manifest };
        delete missing.homepage;
        assert.ok(validateHostManifest(missing, host).length, `${host.id}: missing homepage`);
        for (const homepage of [undefined, null, 1, {}, [], '', 'https://example.com'])
            assert.ok(validateHostManifest({ ...manifest, homepage }, host).length, `${host.id}: ${homepage}`);
    }
});

test('Codex rejects missing, malformed or wrong website and long description metadata', async () => {
    const manifest: unknown = JSON.parse(
        await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
    );
    assert.ok(isRecord(manifest) && isRecord(manifest.interface));
    for (const key of ['websiteURL', 'longDescription']) {
        const missing = { ...manifest.interface };
        delete missing[key];
        assert.ok(validateHostManifest({ ...manifest, interface: missing }).length, `missing ${key}`);
        for (const value of [undefined, null, 1, {}, [], '', 'https://example.com', 'Other description'])
            assert.ok(
                validateHostManifest({ ...manifest, interface: { ...manifest.interface, [key]: value } }).length,
                key,
            );
    }
});

test('Claude rejects missing, malformed or wrong display names and Codex website fields', async () => {
    const manifest: unknown = JSON.parse(
        await readFile(path.join(root, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest), 'utf8'),
    );
    assert.ok(isRecord(manifest));
    const missing = { ...manifest };
    delete missing.displayName;
    assert.ok(validateHostManifest(missing, CLAUDE_CODE_HOST).length, 'missing displayName');
    for (const displayName of [undefined, null, 1, {}, [], '', 'Other display name'])
        assert.ok(validateHostManifest({ ...manifest, displayName }, CLAUDE_CODE_HOST).length);
    assert.ok(
        validateHostManifest(
            { ...manifest, websiteURL: 'https://github.com/Cirnouo/debugging-cdp-targets' },
            CLAUDE_CODE_HOST,
        ).length,
    );
});

test('Codex accepts three distinct single-line starter prompts within the runtime code point boundary', async () => {
    const manifest: unknown = JSON.parse(
        await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
    );
    assert.ok(isRecord(manifest) && isRecord(manifest.interface));
    for (const prompts of [
        ['Capture a screenshot.', 'Inspect failed requests.', 'Profile a page load.'],
        ['x'.repeat(128), 'Inspect failed requests.', 'Profile a page load.'],
        ['😀'.repeat(128), 'Inspect failed requests.', 'Profile a page load.'],
    ]) {
        assert.deepEqual(
            validateHostManifest({ ...manifest, interface: { ...manifest.interface, defaultPrompt: prompts } }),
            [],
        );
    }
});

test('Codex rejects missing or malformed starter prompts while Claude rejects Codex-only fields', async () => {
    const manifest: unknown = JSON.parse(
        await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
    );
    const claude: unknown = JSON.parse(
        await readFile(path.join(root, CLAUDE_CODE_HOST.inputRoot, CLAUDE_CODE_HOST.manifest), 'utf8'),
    );
    assert.ok(isRecord(manifest) && isRecord(manifest.interface) && isRecord(claude));
    const missing = { ...manifest.interface };
    delete missing.defaultPrompt;
    assert.ok(validateHostManifest({ ...manifest, interface: missing }).length, 'missing field');
    const invalid: [string, unknown][] = [
        ['null', null],
        ['object', {}],
        ['string', 'Capture a screenshot.'],
        ['empty list', []],
        ['one prompt', ['Capture a screenshot.']],
        ['two prompts', ['Capture a screenshot.', 'Inspect failed requests.']],
        ['four prompts', ['One', 'Two', 'Three', 'Four']],
        ['non-string', ['One', 'Two', 3]],
        ['empty', ['One', 'Two', '']],
        ['whitespace', ['One', 'Two', '   ']],
        ['duplicate', ['One', 'One', 'Three']],
        ['trimmed duplicate', ['One', ' One ', 'Three']],
        ['line feed', ['One', 'Two', 'Three\nFour']],
        ['carriage return', ['One', 'Two', 'Three\rFour']],
        ['tab', ['One', 'Two', 'Three\tFour']],
        ['null byte', ['One', 'Two', 'Three\u0000Four']],
        ['delete control', ['One', 'Two', 'Three\u007fFour']],
        ['next-line control', ['One', 'Two', 'Three\u0085Four']],
        ['line separator', ['One', 'Two', 'Three\u2028Four']],
        ['paragraph separator', ['One', 'Two', 'Three\u2029Four']],
        ['129 ASCII code points', ['One', 'Two', 'x'.repeat(129)]],
        ['129 non-BMP code points', ['One', 'Two', '😀'.repeat(129)]],
    ];
    for (const [name, prompts] of invalid)
        assert.ok(
            validateHostManifest({ ...manifest, interface: { ...manifest.interface, defaultPrompt: prompts } }).length,
            name,
        );
    assert.ok(validateHostManifest({ ...claude, defaultPrompt: ['One', 'Two', 'Three'] }, CLAUDE_CODE_HOST).length);
    assert.ok(
        validateHostManifest({ ...claude, interface: { defaultPrompt: ['One', 'Two', 'Three'] } }, CLAUDE_CODE_HOST)
            .length,
    );
});

// Hooks constrain executed imports, not global environment access. Unchanged YAML
// LOG_TOKENS/LOG_STREAM/warnings and SemVer NODE_DEBUG diagnostics remain.
const childSource = [
    "import assert from 'node:assert/strict';",
    "import { registerHooks } from 'node:module';",
    '',
    'const subject = process.env.B3_SUBJECT_URL;',
    'const mode = process.env.B3_SUBJECT_MODE;',
    'const allowedParents = JSON.parse(process.env.B3_YAML_PARENTS);',
    'const fixtures = JSON.parse(process.env.B3_FIXTURES);',
    "assert.equal(typeof subject, 'string');",
    "assert.ok(subject.startsWith('file:'));",
    'assert.equal(allowedParents.length, 3);',
    'const resolve = (specifier, context, nextResolve) => {',
    '    const io = /^(?:node:)?(?:fs|child_process|process|http|https|http2|net|tls|dns|dgram)(?:\\/|$)/;',
    '    const invoked = /(?:distribution-audit|audit-plugins|build-plugin|regular-file-tree)\\.ts$/;',
    "    const reviewedYamlProcess = specifier === 'process' && allowedParents.includes(context.parentURL);",
    '    if ((io.test(specifier) && !reviewedYamlProcess) ||',
    "        (mode === 'descriptors' && context.parentURL === subject) ||",
    '        (specifier !== subject && invoked.test(specifier))) {',
    "        const error = new Error('B3 forbidden import edge');",
    "        error.code = 'B3_FORBIDDEN_EDGE';",
    '        error.specifier = specifier;',
    '        error.parentURL = context.parentURL;',
    '        throw error;',
    '    }',
    '    return nextResolve(specifier, context);',
    '};',
    'try {',
    '    const forbidden = [',
    "        'process', 'node:process', 'fs', 'node:fs/promises',",
    "        'child_process', 'node:child_process', 'http', 'node:http',",
    "        'https', 'node:https', 'http2', 'node:http2', 'net', 'node:net',",
    "        'tls', 'node:tls', 'dns', 'node:dns/promises', 'dgram', 'node:dgram',",
    '    ];',
    "    const unallowed = new URL('./unallowed-parent.ts', subject).href;",
    '    let deniedPairs = 0;',
    '    for (const parentURL of [subject, unallowed, ...allowedParents]) {',
    '        for (const specifier of forbidden) {',
    '            const context = { parentURL };',
    "            if (specifier === 'process' && allowedParents.includes(parentURL)) {",
    "                const forwarded = { url: 'node:process' };",
    '                assert.equal(resolve(specifier, context, () => forwarded), forwarded);',
    '            } else {',
    '                assert.throws(',
    "                    () => resolve(specifier, context, () => assert.fail('Forbidden edge forwarded')),",
    "                    error => error.code === 'B3_FORBIDDEN_EDGE' &&",
    '                        error.specifier === specifier && error.parentURL === parentURL,',
    '                );',
    '                deniedPairs++;',
    '            }',
    '        }',
    '    }',
    '    assert.equal(deniedPairs, 97);',
    '    registerHooks({ resolve });',
    '    const api = await import(subject);',
    "    if (mode === 'metadata') {",
    '        assert.deepEqual(api.validateMcpEntries({',
    "            $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',",
    "            mcpServers: { 'cdp-targets': { type: 'streamable-http', url: 'http://127.0.0.1:27637/mcp' } },",
    '        }), []);',
    '        assert.deepEqual(api.parsePluginMetadata(\'{"name":"supplied","version":"0.1.0"}\'),',
    "            { name: 'supplied', version: '0.1.0' });",
    '        assert.throws(() => api.parsePluginMetadata(\'{"name":"first","name":"second"}\'),',
    '            /Map keys must be unique/);',
    '        const manifest = JSON.parse(fixtures.manifest);',
    '        assert.deepEqual(api.validateHostManifest(manifest), []);',
    "        for (const version of ['1.2.3', '1.2.3-beta.1+build'])",
    '            assert.deepEqual(api.validateHostManifest({ ...manifest, version }), []);',
    "        for (const version of ['', 'v1.2.3', '1.2', ' 1.2.3', 1, null])",
    '            assert.ok(api.validateHostManifest({ ...manifest, version }).length);',
    "        const icon = Buffer.from(fixtures.icon, 'base64');",
    "        const presentationKey = 'skills/debugging-cdp-targets/agents/openai.yaml';",
    '        const files = new Map([',
    '            [presentationKey, Buffer.from(fixtures.presentation)],',
    "            ['assets/icon.png', icon],",
    '        ]);',
    '        assert.deepEqual(api.validateCodexSkillPresentation(files, icon), []);',
    "        files.set(presentationKey, Buffer.from(fixtures.presentation + '\\ninterface: {}\\n'));",
    "        assert.match(api.validateCodexSkillPresentation(files, icon).join('\\n'), /Map keys must be unique/);",
    '        files.set(presentationKey, Buffer.from(fixtures.presentation));',
    "        files.set('assets/icon.png', Buffer.from('not a PNG'));",
    '        assert.ok(api.validateCodexSkillPresentation(files, icon).length);',
    "        files.set('assets/icon.png', icon);",
    '        assert.deepEqual(api.validateCodexSkillPresentation(files, icon), []);',
    "    } else if (mode === 'descriptors') {",
    "        assert.equal(api.CODEX_HOST.id, 'codex');",
    "        assert.equal(api.CLAUDE_CODE_HOST.id, 'claude-code');",
    "    } else if (mode === 'inventory') {",
    "        assert.ok(api.requiredPayloadFiles().includes('skills/debugging-cdp-targets/SKILL.md'));",
    "        assert.ok(api.validatePayloadFileInventory(['foreign']).length);",
    "    } else if (mode === 'artwork') {",
    "        assert.ok(api.validateIconPng('icon.png', Buffer.from('not a PNG')).length);",
    "    } else if (mode === 'agreement') {",
    "        assert.deepEqual(api.validateVersionAgreement('2.3.4', '0.1.0', '0.1.0'), []);",
    "        assert.ok(api.validateVersionAgreement('invalid', '0.1.0', '0.1.0').length);",
    "        assert.ok(api.validateVersionAgreement('2.3.4', '0.1.0', '0.1.1').length);",
    "    } else assert.fail('Unknown supplied owner exercise');",
    "    console.log(JSON.stringify({ outcome: 'PASS', subject, deniedPairs }));",
    '} catch (error) {',
    '    console.error(JSON.stringify({',
    '        code: error?.code,',
    '        specifier: error?.specifier,',
    '        parentURL: error?.parentURL,',
    '    }));',
    '    process.exitCode = 42;',
    '}',
].join(String.fromCharCode(10));

type BoundaryFixtures = { manifest: string; presentation: string; icon: string };

function runSubject(subject: string, mode: string, allowedParents: readonly string[], fixtures: BoundaryFixtures) {
    return spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
        env: {
            ...process.env,
            B3_SUBJECT_URL: subject,
            B3_SUBJECT_MODE: mode,
            B3_YAML_PARENTS: JSON.stringify(allowedParents),
            B3_FIXTURES: JSON.stringify(fixtures),
        },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
}

test('supplied metadata owners preserve maintained import boundaries and reviewed parser edges', async () => {
    // Resolve only: do not preload the subject graph before its hooks register.
    const yamlEntry = import.meta.resolve('yaml');
    const yamlPackage: unknown = JSON.parse(await readFile(new URL('../package.json', yamlEntry), 'utf8'));
    assert.ok(isRecord(yamlPackage));
    assert.equal(yamlPackage.version, '2.9.1');
    const allowedParents = [];
    for (const [leaf, bytes, sha256] of [
        ['compose/composer.js', 8692, '509c0bdb4cef641cc784c130b6cc2b350752f6841798daa1a13cbcaf4fc74c46'],
        ['parse/parser.js', 35551, '0adc5ffa51ffa4c0ceed1f80efa8b188d10f58c7b9389a6d46bc861e6bff34e1'],
        ['log.js', 459, 'f6ccc3593357801851aa1023b202f842733043ac3b25773048d836f89de8108d'],
    ] as const) {
        const parent = new URL(leaf, yamlEntry);
        const source = await readFile(parent);
        assert.equal(source.length, bytes);
        assert.equal(createHash('sha256').update(source).digest('hex'), sha256);
        allowedParents.push(parent.href);
    }
    const fixtures = {
        manifest: await readFile(path.join(root, CODEX_HOST.inputRoot, CODEX_HOST.manifest), 'utf8'),
        presentation: await readFile(path.join(root, 'packaging/codex/skill-openai.yaml'), 'utf8'),
        icon: (await readFile(path.join(root, 'packaging/shared/assets/icon.png'))).toString('base64'),
    };
    for (const [file, mode] of [
        ['host-metadata', 'metadata'],
        ['host-descriptors', 'descriptors'],
        ['payload-inventory', 'inventory'],
        ['artwork-policy', 'artwork'],
        ['version-agreement', 'agreement'],
    ] as const) {
        const subject = new URL(`../../../tooling/distribution/${file}.ts`, import.meta.url).href;
        const result = runSubject(subject, mode, allowedParents, fixtures);
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const response: unknown = JSON.parse(result.stdout.trim());
        assert.deepEqual(response, { outcome: 'PASS', subject, deniedPairs: 97 });
    }
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-metadata-edge-')));
    try {
        const fixture = path.join(temporary, 'bad-metadata.mjs');
        await writeFile(
            fixture,
            ["import 'node:fs/promises';", 'export const validateMcpEntries = () => [];', ''].join(
                String.fromCharCode(10),
            ),
        );
        const subject = pathToFileURL(fixture).href;
        const result = runSubject(subject, 'metadata', allowedParents, fixtures);
        assert.ifError(result.error);
        assert.equal(result.status, 42, result.stdout + result.stderr);
        const refusal: unknown = JSON.parse(result.stderr.trim());
        assert.deepEqual(refusal, {
            code: 'B3_FORBIDDEN_EDGE',
            specifier: 'node:fs/promises',
            parentURL: subject,
        });
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
});
