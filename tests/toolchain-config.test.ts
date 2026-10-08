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

test('default test and coverage commands select only root regressions with sequential files and retained floors', () => {
    assert.equal(command(scripts, 'test'), 'node --test --test-concurrency=1 tests/*.test.ts');
    assert.equal(
        command(scripts, 'test:coverage'),
        'node --experimental-test-coverage --test-coverage-lines=52 --test-coverage-branches=71 --test-coverage-functions=61 --test --test-concurrency=1 tests/*.test.ts',
    );
});

test('explicit Windows interactive command selects only interactive tests with sequential files', () => {
    assert.equal(scripts['test:windows:interactive'], 'node --test --test-concurrency=1 tests/interactive/*.test.ts');
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
        '*.{md,yaml,yml,ps1,psd1,psm1,toml,sh}',
    ]);
    assert.match(command(lintStaged, '*.{ts,mts,cts,js,cjs,mjs,json}'), /biome check --write/);
    assert.equal(lintStaged['*.{md,yaml,yml,ps1,psd1,psm1,toml,sh}'], 'node tooling/check-text-style.ts');
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
