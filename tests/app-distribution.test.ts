import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAppDistribution } from '../src/domains/app-distribution.ts';

test('App data mode is immutable delivery metadata and must match the native platform', () => {
    for (const kind of ['installed', 'portable']) {
        for (const architecture of ['x64', 'arm64']) {
            const value = { schemaVersion: 1, kind, platform: 'win32', architecture };
            const parsed = parseAppDistribution(value, { platform: 'win32', architecture });
            assert.deepEqual(parsed, value);
            assert.equal(Object.isFrozen(parsed), true);
            assert.equal(Reflect.set(parsed, 'kind', 'service'), false);
            assert.deepEqual(parsed, value);
        }
    }
    for (const native of [
        { platform: 'linux', architecture: 'x64' },
        { platform: 'darwin', architecture: 'arm64' },
        { platform: 'freebsd', architecture: 'x64' },
        { platform: 'unknown', architecture: 'arm64' },
        { platform: 'win32', architecture: 'ia32' },
        { platform: 'win32', architecture: '' },
    ]) {
        const value = { schemaVersion: 1, kind: 'portable', ...native };
        assert.throws(() => parseAppDistribution(value, native), /Invalid App distribution identity/);
    }
    for (const value of [
        null,
        { schemaVersion: 1, kind: 'portable', platform: 'linux', architecture: 'x64' },
        { schemaVersion: 1, kind: 'service', platform: 'win32', architecture: 'x64' },
        { schemaVersion: 1, kind: 'portable', platform: 'win32', architecture: 'x64', dataRoot: '/untrusted' },
    ])
        assert.throws(() => parseAppDistribution(value, { platform: 'win32', architecture: 'x64' }));
    for (const native of [
        { platform: 'win32', architecture: 'arm64' },
        { platform: 'linux', architecture: 'x64' },
    ])
        assert.throws(() =>
            parseAppDistribution(
                { schemaVersion: 1, kind: 'portable', platform: 'win32', architecture: 'x64' },
                native,
            ),
        );
});

test('Windows product support is explicit and independent of host defaults', async () => {
    const distribution = await import('../src/domains/app-distribution.ts');
    const supportsWindowsApp: unknown = Reflect.get(distribution, 'supportsWindowsApp');
    assert.ok(typeof supportsWindowsApp === 'function', 'The pure Windows App support decision must be exported.');
    for (const [platform, architecture, supported] of [
        ['win32', 'x64', true],
        ['win32', 'arm64', true],
        ['win32', 'ia32', false],
        ['win32', '', false],
        ['win32', 'X64', false],
        ['linux', 'x64', false],
        ['linux', 'arm64', false],
        ['darwin', 'x64', false],
        ['darwin', 'arm64', false],
        ['freebsd', 'x64', false],
        ['unknown', 'arm64', false],
        ['', 'x64', false],
        ['Win32', 'x64', false],
        ['', '', false],
    ] as const)
        assert.equal(supportsWindowsApp(platform, architecture), supported, `${platform}/${architecture}`);
});
