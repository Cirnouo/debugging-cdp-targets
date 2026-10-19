import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildServerArguments } from '../src/adapters/official-server.ts';
import { mergeLaunchEnvironment } from '../src/gateway/targets/model/launch-command.ts';

const browserUrl = 'http://127.0.0.1:30000';
const defaults = [
    `--browserUrl=${browserUrl}`,
    '--categoryExtensions=true',
    '--no-usage-statistics',
    '--no-performance-crux',
];
const enabled = [
    `--browserUrl=${browserUrl}`,
    '--categoryExtensions=false',
    '--usage-statistics',
    '--performance-crux',
];

test('official flags preserve lowercase Windows names in an immutable environment snapshot', () => {
    const environment = Object.freeze({
        dct_extensions: 'false',
        dct_usage_statistics: 'true',
        dct_performance_crux: 'true',
    });
    assert.deepEqual(buildServerArguments(browserUrl, environment, [], true), enabled);
    assert.deepEqual(Object.keys(environment), ['dct_extensions', 'dct_usage_statistics', 'dct_performance_crux']);
});

test('official flags preserve mixed-case Windows names', () => {
    assert.deepEqual(
        buildServerArguments(
            browserUrl,
            { DcT_eXtEnSiOnS: 'false', DcT_uSaGe_StAtIsTiCs: 'true', DcT_pErFoRmAnCe_CrUx: 'true' },
            [],
            true,
        ),
        enabled,
    );
});

test('official flags use the last Windows case variant like the effective launch environment', () => {
    const environment = {
        DCT_EXTENSIONS: 'true',
        dct_extensions: 'false',
        DCT_USAGE_STATISTICS: 'false',
        dct_usage_statistics: 'true',
        DCT_PERFORMANCE_CRUX: 'false',
        dct_performance_crux: 'true',
    };
    assert.deepEqual(buildServerArguments(browserUrl, environment, [], true), enabled);
    assert.deepEqual(
        buildServerArguments(browserUrl, mergeLaunchEnvironment(environment, {}, true), [], true),
        enabled,
    );
    const reversed = Object.fromEntries(Object.entries(environment).reverse());
    assert.deepEqual(buildServerArguments(browserUrl, reversed, [], true), defaults);
    assert.deepEqual(buildServerArguments(browserUrl, mergeLaunchEnvironment(reversed, {}, true), [], true), defaults);
});

test('official flags keep exact POSIX names and ignore differently cased names', () => {
    assert.deepEqual(
        buildServerArguments(
            browserUrl,
            {
                DCT_EXTENSIONS: 'false',
                dct_extensions: 'true',
                DCT_USAGE_STATISTICS: 'true',
                dct_usage_statistics: 'false',
                DCT_PERFORMANCE_CRUX: 'true',
                dct_performance_crux: 'false',
            },
            [],
            false,
        ),
        enabled,
    );
    assert.deepEqual(
        buildServerArguments(
            browserUrl,
            { dct_extensions: 'invalid', dct_usage_statistics: 'invalid', dct_performance_crux: 'invalid' },
            [],
            false,
        ),
        defaults,
    );
});

test('official flags retain defaults for missing or undefined values on both platforms', () => {
    for (const windows of [false, true]) {
        assert.deepEqual(buildServerArguments(browserUrl, {}, [], windows), defaults);
        assert.deepEqual(
            buildServerArguments(
                browserUrl,
                { DCT_EXTENSIONS: undefined, DCT_USAGE_STATISTICS: undefined, DCT_PERFORMANCE_CRUX: undefined },
                [],
                windows,
            ),
            defaults,
        );
    }
});

test('official flags validate every selected environment boolean even with explicit mcpArgs', () => {
    const settings = [
        ['DCT_EXTENSIONS', '--categoryExtensions=false'],
        ['DCT_USAGE_STATISTICS', '--no-usage-statistics'],
        ['DCT_PERFORMANCE_CRUX', '--no-performance-crux'],
    ];
    for (const [name, argument] of settings) {
        assert.ok(name && argument);
        for (const windows of [false, true]) {
            const key = windows ? name.toLowerCase() : name;
            for (const value of ['yes', 'TRUE', '']) {
                assert.throws(() => buildServerArguments(browserUrl, { [key]: value }, [], windows), /boolean/);
                assert.throws(() => buildServerArguments(browserUrl, { [key]: value }, [argument], windows), /boolean/);
            }
        }
    }
});

test('explicit official mcpArgs override environment-derived flag insertion on both platforms', () => {
    const mcpArgs = ['--categoryExtensions=false', '--usage-statistics', '--performance-crux'];
    for (const windows of [false, true]) {
        const environment = windows
            ? { dct_extensions: 'true', dct_usage_statistics: 'false', dct_performance_crux: 'false' }
            : { DCT_EXTENSIONS: 'true', DCT_USAGE_STATISTICS: 'false', DCT_PERFORMANCE_CRUX: 'false' };
        assert.deepEqual(buildServerArguments(browserUrl, environment, mcpArgs, windows), [
            `--browserUrl=${browserUrl}`,
            ...mcpArgs,
        ]);
        assert.deepEqual(mcpArgs, ['--categoryExtensions=false', '--usage-statistics', '--performance-crux']);
    }
});
