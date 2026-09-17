import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);
const packageData = JSON.parse(await readFile(new URL('package.json', rootUrl), 'utf8'));
const biome = JSON.parse(await readFile(new URL('biome.json', rootUrl), 'utf8'));

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
        'verify:push',
    ];
    for (const script of required) {
        assert.equal(typeof packageData.scripts[script], 'string', script);
    }
    assert.doesNotMatch(packageData.scripts['verify:push'], /format(?::write)?(?:\s|$)/);
    for (const gate of [
        'format:check',
        'lint',
        'check:scripts',
        'test:coverage',
        'check:repo',
        'check:distribution',
        'check:commits',
    ]) {
        assert.match(packageData.scripts['verify:push'], new RegExp(gate.replace(':', '\\:')));
    }
});

test('Biome owns JavaScript and JSON with repository formatting policy', () => {
    assert.deepEqual(biome.vcs, {
        enabled: true,
        clientKind: 'git',
        useIgnoreFile: true,
    });
    assert.equal(biome.formatter.indentStyle, 'space');
    assert.equal(biome.formatter.indentWidth, 4);
    assert.equal(biome.formatter.lineEnding, 'lf');
    assert.equal(biome.linter.rules.preset, 'recommended');
    assert.equal(biome.assist.actions.source.organizeImports, 'on');
    assert.equal(biome.json.formatter.enabled, true);
});

test('lint-staged writes only Biome-supported files and preserves default protections', () => {
    assert.deepEqual(Object.keys(packageData['lint-staged']), [
        '*.{js,cjs,mjs,json}',
        '*.{md,yaml,yml,ps1,psd1,psm1,toml,sh}',
    ]);
    assert.match(packageData['lint-staged']['*.{js,cjs,mjs,json}'], /biome check --write/);
    assert.equal(
        packageData['lint-staged']['*.{md,yaml,yml,ps1,psd1,psm1,toml,sh}'],
        'node tooling/check-text-style.mjs',
    );
    assert.doesNotMatch(JSON.stringify(packageData['lint-staged']), /no-stash|hide-unstaged/i);
});

test('pnpm is the only package-manager lockfile', async () => {
    const names = await readdir(rootUrl);
    assert.equal(names.includes('pnpm-lock.yaml'), true);
    assert.deepEqual(
        names.filter((name) => /(?:package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(name)),
        [],
    );
});
