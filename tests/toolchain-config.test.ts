import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';
import { validateInstallPolicy } from '../tooling/security/security-evidence.ts';

function record(value: unknown): Record<string, unknown> {
    assert.ok(isRecord(value));
    return value;
}
function strings(value: unknown): Record<string, string> {
    const object = record(value);
    assert.ok(Object.values(object).every((item) => typeof item === 'string'));
    return object as Record<string, string>;
}
function command(mapping: Record<string, string>, name: string): string {
    const value = mapping[name];
    assert.ok(typeof value === 'string');
    return value;
}

const rootUrl = new URL('../', import.meta.url);
const packageInput: unknown = JSON.parse(await readFile(new URL('package.json', rootUrl), 'utf8'));
const packageData = record(packageInput);
const scripts = strings(packageData.scripts);
const lintStaged = strings(packageData['lint-staged']);
const biomeInput: unknown = JSON.parse(await readFile(new URL('biome.json', rootUrl), 'utf8'));
const biome = record(biomeInput);

test('default test and coverage commands select only safe root, tooling, Gateway and Host regressions with sequential files and retained floors', () => {
    assert.equal(
        command(scripts, 'test'),
        'node --test --test-concurrency=1 tests/*.test.ts tests/tooling/governance/commit-events.test.ts tests/tooling/governance/commit-grammar.test.ts tests/tooling/governance/commit-history.test.ts tests/tooling/governance/commit-validation.test.ts tests/tooling/quality/text-policy.test.ts tests/tooling/releases/release-notes.test.ts tests/tooling/releases/publication.test.ts tests/tooling/submissions/markdown.test.ts tests/tooling/submissions/pull-requests.test.ts tests/tooling/submissions/issue-forms.test.ts tests/tooling/submissions/issue-feedback.test.ts tests/tooling/submissions/issue-workflow.test.ts tests/tooling/licenses/bundled-notices.test.ts tests/tooling/distribution/host-distribution.test.ts tests/tooling/distribution/host-metadata.test.ts tests/tooling/distribution/icon-packaging.test.ts tests/tooling/distribution/physical-payloads.test.ts tests/tooling/distribution/plugin-distribution.test.ts tests/tooling/distribution/skill-presentation.test.ts tests/tooling/distribution/skill-questions.test.ts tests/tooling/distribution/thin-plugin-metadata.test.ts tests/tooling/distribution/thin-plugin-payloads.test.ts tests/tooling/distribution/version-agreement.test.ts tests/gateway/owned-tool-arguments.test.ts tests/host-plugins/payload-integrity.test.ts tests/host-plugins/payload-filesystem.test.ts tests/gateway/targets/port-and-endpoint-admission.test.ts tests/gateway/targets/chrome-profile-argument.test.ts tests/gateway/targets/data-isolation.test.ts tests/gateway/targets/structured-launch.test.ts tests/gateway/targets/chromium-features.test.ts tests/gateway/targets/chrome-profile.test.ts tests/gateway/targets/chrome-launch.test.ts tests/gateway/connections/directory-lifetime.test.ts tests/gateway/connections/directory-operation-evidence.test.ts tests/gateway/targets/directory-admission.test.ts tests/gateway/connections/construction-cleanup.test.ts tests/gateway/connections/gateway-cleanup.test.ts tests/gateway/official/options.test.ts tests/gateway/official/execution.test.ts tests/gateway/official/server-arguments.test.ts tests/gateway/official/server-arguments-environment.test.ts tests/gateway/targets/target-lifecycle.test.ts tests/gateway/targets/lifecycle-rollback.test.ts tests/gateway/targets/observer-cleanup.test.ts tests/gateway/targets/close-diagnostics.test.ts',
    );
    assert.equal(
        command(scripts, 'test:coverage'),
        'node --experimental-test-coverage --test-coverage-lines=52 --test-coverage-branches=71 --test-coverage-functions=61 --test --test-concurrency=1 tests/*.test.ts tests/tooling/governance/commit-events.test.ts tests/tooling/governance/commit-grammar.test.ts tests/tooling/governance/commit-history.test.ts tests/tooling/governance/commit-validation.test.ts tests/tooling/quality/text-policy.test.ts tests/tooling/releases/release-notes.test.ts tests/tooling/releases/publication.test.ts tests/tooling/submissions/markdown.test.ts tests/tooling/submissions/pull-requests.test.ts tests/tooling/submissions/issue-forms.test.ts tests/tooling/submissions/issue-feedback.test.ts tests/tooling/submissions/issue-workflow.test.ts tests/tooling/licenses/bundled-notices.test.ts tests/tooling/distribution/host-distribution.test.ts tests/tooling/distribution/host-metadata.test.ts tests/tooling/distribution/icon-packaging.test.ts tests/tooling/distribution/physical-payloads.test.ts tests/tooling/distribution/plugin-distribution.test.ts tests/tooling/distribution/skill-presentation.test.ts tests/tooling/distribution/skill-questions.test.ts tests/tooling/distribution/thin-plugin-metadata.test.ts tests/tooling/distribution/thin-plugin-payloads.test.ts tests/tooling/distribution/version-agreement.test.ts tests/gateway/owned-tool-arguments.test.ts tests/host-plugins/payload-integrity.test.ts tests/host-plugins/payload-filesystem.test.ts tests/gateway/targets/port-and-endpoint-admission.test.ts tests/gateway/targets/chrome-profile-argument.test.ts tests/gateway/targets/data-isolation.test.ts tests/gateway/targets/structured-launch.test.ts tests/gateway/targets/chromium-features.test.ts tests/gateway/targets/chrome-profile.test.ts tests/gateway/targets/chrome-launch.test.ts tests/gateway/connections/directory-lifetime.test.ts tests/gateway/connections/directory-operation-evidence.test.ts tests/gateway/targets/directory-admission.test.ts tests/gateway/connections/construction-cleanup.test.ts tests/gateway/connections/gateway-cleanup.test.ts tests/gateway/official/options.test.ts tests/gateway/official/execution.test.ts tests/gateway/official/server-arguments.test.ts tests/gateway/official/server-arguments-environment.test.ts tests/gateway/targets/target-lifecycle.test.ts tests/gateway/targets/lifecycle-rollback.test.ts tests/gateway/targets/observer-cleanup.test.ts tests/gateway/targets/close-diagnostics.test.ts',
    );
});

test('explicit Windows interactive command selects only interactive tests with sequential files', () => {
    assert.equal(scripts['test:windows:interactive'], 'node tooling/test-windows-interactive.ts');
});

test('package scripts expose every writing and non-writing quality gate', () => {
    const required = [
        'prepare',
        'format',
        'format:write',
        'format:check',
        'lint',
        'check:scripts',
        'test',
        'test:coverage',
        'check:repo',
        'check:distribution',
        'check:commits',
        'check:security',
        'build:security',
        'check:security:build',
        'verify:push',
    ];
    for (const script of required) {
        assert.equal(typeof scripts[script], 'string', script);
    }
    assert.doesNotMatch(command(scripts, 'verify:push'), /format(?::write)?(?:\s|$)/);
    assert.doesNotMatch(command(scripts, 'verify:push'), /check:security(?:\s|$)/);
    assert.doesNotMatch(command(scripts, 'test'), /check:security/);
    for (const gate of [
        'format:check',
        'lint',
        'check:scripts',
        'test:coverage',
        'check:repo',
        'check:distribution',
        'check:commits',
        'check:security:build',
    ]) {
        assert.match(command(scripts, 'verify:push'), new RegExp(gate.replace(':', '\\:')));
    }
});

test('committed dependency installation policy cannot bypass the security gate', async () => {
    const policyInput: unknown = parse(await readFile(new URL('pnpm-workspace.yaml', rootUrl), 'utf8'));
    const policy = record(policyInput);
    assert.doesNotThrow(() => validateInstallPolicy(policy));
    assert.deepEqual(policy.overrides, { '@types/node': '24.19.0' });
});

test('Biome owns JavaScript and JSON with repository formatting policy', () => {
    assert.deepEqual(biome.vcs, {
        enabled: true,
        clientKind: 'git',
        useIgnoreFile: true,
    });
    const formatter = record(biome.formatter);
    assert.equal(formatter.indentStyle, 'space');
    assert.equal(formatter.indentWidth, 4);
    assert.equal(formatter.lineEnding, 'lf');
    assert.equal(record(record(biome.linter).rules).preset, 'recommended');
    assert.equal(record(record(record(biome.assist).actions).source).organizeImports, 'on');
    assert.equal(record(record(biome.json).formatter).enabled, true);
});

test('lint-staged writes only Biome-supported files and preserves default protections', () => {
    assert.deepEqual(Object.keys(lintStaged), [
        '*.{ts,mts,cts,js,cjs,mjs,json}',
        '*.{md,[yY][aA][mM][lL],[yY][mM][lL],ps1,psd1,psm1,toml,sh}',
    ]);
    assert.match(command(lintStaged, '*.{ts,mts,cts,js,cjs,mjs,json}'), /biome check --write/);
    assert.equal(
        lintStaged['*.{md,[yY][aA][mM][lL],[yY][mM][lL],ps1,psd1,psm1,toml,sh}'],
        'node tooling/check-text-style.ts',
    );
    assert.doesNotMatch(JSON.stringify(lintStaged), /no-stash|hide-unstaged/i);
});

test('pnpm is the only package-manager lockfile', async () => {
    const names = await readdir(rootUrl);
    assert.equal(names.includes('pnpm-lock.yaml'), true);
    assert.deepEqual(
        names.filter((name) => /(?:package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(name)),
        [],
    );
});
