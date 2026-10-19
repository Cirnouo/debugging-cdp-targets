import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOfficialConnection } from '../../../src/adapters/mcp-bridge.ts';
import { buildServerArguments } from '../../../src/adapters/official-server.ts';
import { buildOfficialServerArguments } from '../../../src/gateway/official/options.ts';

const builders = [buildServerArguments, buildOfficialServerArguments];

test('official server receives a stable browser URL and privacy-safe defaults', () => {
    assert.deepEqual(buildServerArguments('http://127.0.0.1:30000', {}), [
        '--browserUrl=http://127.0.0.1:30000',
        '--categoryExtensions=true',
        '--no-usage-statistics',
        '--no-performance-crux',
    ]);
});

test('official server switches require explicit boolean environment overrides', () => {
    assert.deepEqual(
        buildServerArguments('http://127.0.0.1:30000', {
            DCT_EXTENSIONS: 'false',
            DCT_USAGE_STATISTICS: 'true',
            DCT_PERFORMANCE_CRUX: 'true',
        }),
        [
            '--browserUrl=http://127.0.0.1:30000',
            '--categoryExtensions=false',
            '--usage-statistics',
            '--performance-crux',
        ],
    );
    assert.throws(() => buildServerArguments('http://127.0.0.1:30000', { DCT_EXTENSIONS: 'yes' }), /boolean/i);
});

test('official argument composition reads only selected getters in order and preserves inherited POSIX settings', () => {
    for (const build of builders) {
        for (const windows of [false, true]) {
            const reads: string[] = [];
            const environment = {
                get DCT_EXTENSIONS() {
                    reads.push('extensions');
                    return 'false';
                },
                get DCT_PERFORMANCE_CRUX() {
                    reads.push('crux');
                    return 'true';
                },
                get UNRELATED(): never {
                    throw new Error('unrelated getter must not run');
                },
            };
            Object.setPrototypeOf(environment, {
                get DCT_USAGE_STATISTICS() {
                    reads.push('statistics');
                    return 'true';
                },
            });
            assert.deepEqual(build('http://127.0.0.1:30000', environment, [], windows), [
                '--browserUrl=http://127.0.0.1:30000',
                '--categoryExtensions=false',
                windows ? '--no-usage-statistics' : '--usage-statistics',
                '--performance-crux',
            ]);
            assert.deepEqual(reads, windows ? ['extensions', 'crux'] : ['extensions', 'statistics', 'crux']);
        }
    }
});

test('official argument composition selects the last Windows case getter and treats selected undefined as default', () => {
    for (const build of builders) {
        const reads: string[] = [];
        const environment = {
            get DCT_EXTENSIONS(): never {
                throw new Error('earlier case alias must not run');
            },
            get dct_extensions() {
                reads.push('extensions');
                return undefined;
            },
            get DCT_USAGE_STATISTICS(): never {
                throw new Error('earlier statistics alias must not run');
            },
            get dct_usage_statistics() {
                reads.push('statistics');
                return 'true';
            },
            get dct_performance_crux() {
                reads.push('crux');
                return 'false';
            },
            get UNRELATED(): never {
                throw new Error('unrelated getter must not run');
            },
        };
        assert.deepEqual(build('http://127.0.0.1:30000', environment, [], true), [
            '--browserUrl=http://127.0.0.1:30000',
            '--categoryExtensions=true',
            '--usage-statistics',
            '--no-performance-crux',
        ]);
        assert.deepEqual(reads, ['extensions', 'statistics', 'crux']);
    }
});

test('official argument composition validates every selected getter before overriding options or invalid arguments', () => {
    for (const build of builders) {
        const reads: string[] = [];
        const environment = {
            get DCT_EXTENSIONS() {
                reads.push('extensions');
                return 'true';
            },
            get DCT_USAGE_STATISTICS() {
                reads.push('statistics');
                return 'false';
            },
            get DCT_PERFORMANCE_CRUX() {
                reads.push('crux');
                return 'invalid';
            },
        };
        assert.throws(
            () =>
                build(
                    'http://127.0.0.1:30000',
                    environment,
                    [
                        '--categoryExtensions=false',
                        '--usage-statistics',
                        '--no-performance-crux',
                        '--browserUrl=foreign',
                    ],
                    false,
                ),
            /DCT_PERFORMANCE_CRUX must be a boolean/,
        );
        assert.deepEqual(reads, ['extensions', 'statistics', 'crux']);
    }
});

test('official argument composition refuses a non-loopback URL before reading environment getters', () => {
    for (const build of builders) {
        const environment = {
            get DCT_EXTENSIONS(): never {
                throw new Error('environment read before URL refusal');
            },
        };
        assert.throws(() => build('http://192.0.2.1:30000', environment, [], false), /local loopback browser URL/);
    }
});

test('official bridge composes omitted arguments before runtime resolution and explicit arguments bypass ambient validation', async () => {
    const previous = process.env.DCT_EXTENSIONS;
    process.env.DCT_EXTENSIONS = 'yes';
    try {
        await assert.rejects(createOfficialConnection('http://127.0.0.1:30000'), /DCT_EXTENSIONS must be a boolean/);
        await assert.rejects(
            createOfficialConnection('http://127.0.0.1:30000', { args: [] }),
            /Explicit verified runtime location/,
        );
    } finally {
        if (previous === undefined) delete process.env.DCT_EXTENSIONS;
        else process.env.DCT_EXTENSIONS = previous;
    }
});
