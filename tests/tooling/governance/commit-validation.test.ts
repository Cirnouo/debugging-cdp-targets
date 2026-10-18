import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import commitlintConfig from '../../../commitlint.config.ts';
import { validateCommitMessage } from '../../../tooling/governance/commit-validation.ts';

const validScopes = [
    'skill',
    'session',
    'target',
    'devtools',
    'windows',
    'app',
    'distribution',
    'testing',
    'tooling',
    'governance',
    'dependencies',
    'release',
];

test('wires every approved Conventional Commit type and scope into real commitlint validation', () => {
    const types = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];
    assert.deepEqual(commitlintConfig.rules['type-enum'], [2, 'always', types]);
    assert.deepEqual(commitlintConfig.rules['scope-enum'], [2, 'always', validScopes]);
    assert.deepEqual(validateCommitMessage('feat(app): describe change'), []);
});

test('accepts breaking commits by marker or footer', () => {
    assert.deepEqual(validateCommitMessage('feat(skill)!: change contract'), []);
    assert.deepEqual(
        validateCommitMessage('feat(skill): change contract\n\nBREAKING CHANGE: callers must migrate'),
        [],
    );
});

test('rejects malformed commit messages with actionable errors', () => {
    const invalid: [string, string][] = [
        ['feature(skill): add feature', 'type'],
        ['feat: add feature', 'scope'],
        ['feat(Skill): add feature', 'scope'],
        ['feat(not-approved): add feature', 'scope'],
        ['feat(obsidian): add feature', 'scope'],
        ['feat(skill): ', 'subject'],
        ['feat(skill): add feature.', 'full stop'],
        [`feat(skill): ${'x'.repeat(88)}`, '100'],
        ['feat(skill): add feature\nbody without blank line', 'blank line'],
        ["Merge branch 'topic'", 'type'],
    ];

    for (const [message, expected] of invalid) {
        assert.match(validateCommitMessage(message).join('\n'), new RegExp(expected, 'i'));
    }
});

test('keeps the shared validator in parity with commitlint for body, footer, and subject rules', () => {
    const invalid = [
        'feat(skill): Add feature',
        `feat(skill): change contract\n\n${'x'.repeat(101)}`,
        'feat(skill): change contract\n\nbody details\nBREAKING CHANGE: callers must migrate',
    ];

    for (const message of invalid) {
        assert.notDeepEqual(validateCommitMessage(message), [], message);
    }
});

test('ignores a merge message only when Git topology says it is a merge', () => {
    assert.deepEqual(validateCommitMessage("Merge branch 'topic'", { isMerge: true }), []);
    assert.notDeepEqual(validateCommitMessage("Merge branch 'topic'"), []);
});

test('preserves raw stdin, fixed config roots, process failures and rejection classification', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const config = fileURLToPath(new URL('../../../commitlint.config.ts', import.meta.url));
    const validator = new URL('../../../tooling/governance/commit-validation.ts', import.meta.url).href;
    const raw = 'fix(tooling): preserve raw input\n\nbody label:\nvalue\n\nRefs: #42\n';
    const processSource = [
        "import assert from 'node:assert/strict';",
        "export const failure = new Error('controlled spawn failure');",
        'export const calls = [];',
        'export function spawnSync(executable, args, options) {',
        '    assert.equal(executable, process.execPath);',
        '    assert.equal(typeof args[0], "string");',
        '    assert.deepEqual(args.slice(1), ' +
            JSON.stringify(['--config', config, '--cwd', root, '--color=false']) +
            ');',
        '    assert.deepEqual(Object.keys(options).sort(), ["encoding", "input", "windowsHide"]);',
        '    assert.equal(options.encoding, "utf8");',
        '    assert.equal(options.windowsHide, true);',
        '    calls.push(options.input);',
        `    if (options.input === ${JSON.stringify(raw)}) return { status: 0 };`,
        '    if (options.input === "reject") return { status: 1, stdout: "  syntax diagnostics  ", stderr: "stderr detail  " };',
        '    if (options.input === "empty") return { status: 1, stdout: " ", stderr: "" };',
        '    if (options.input === "fatal") return { status: 2, stderr: "invalid config" };',
        '    if (options.input === "no-status") return { status: null };',
        '    if (options.input === "error") return { error: failure };',
        '    throw new Error("Unexpected input bytes");',
        '}',
    ].join('\n');
    const source = [
        "import assert from 'node:assert/strict';",
        "import { registerHooks } from 'node:module';",
        'registerHooks({',
        '    resolve(specifier, context, nextResolve) {',
        '        if (specifier === "node:child_process") return { url: "dct-test:process", shortCircuit: true };',
        '        return nextResolve(specifier, context);',
        '    },',
        '    load(url, context, nextLoad) {',
        '        if (url === "dct-test:process") return { format: "module", source: ' +
            JSON.stringify(processSource) +
            ', shortCircuit: true };',
        '        return nextLoad(url, context);',
        '    },',
        '});',
        `const { validateCommitMessage } = await import(${JSON.stringify(validator)});`,
        'const io = await import("node:child_process");',
        `assert.deepEqual(validateCommitMessage(${JSON.stringify(raw)}), []);`,
        'assert.deepEqual(validateCommitMessage("reject"), ["syntax diagnostics  \\nstderr detail"]);',
        'assert.deepEqual(validateCommitMessage("empty"), ["Commit message violates the repository commitlint configuration."]);',
        'assert.throws(() => validateCommitMessage("fatal"), /invalid config/);',
        'assert.throws(() => validateCommitMessage("no-status"), /commitlint exited with status null/);',
        'assert.throws(() => validateCommitMessage("error"), (error) => error === io.failure);',
        'assert.deepEqual(validateCommitMessage("topology merge", { isMerge: true }), []);',
        `assert.deepEqual(io.calls, [${JSON.stringify(raw)}, "reject", "empty", "fatal", "no-status", "error"]);`,
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
