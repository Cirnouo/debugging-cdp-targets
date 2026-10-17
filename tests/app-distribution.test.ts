import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAppDistribution } from '../src/domains/app-distribution.ts';

test('App data mode is immutable delivery metadata and must match the native platform', () => {
    for (const kind of ['installed', 'portable']) {
        const value = { schemaVersion: 1, kind, platform: 'win32', architecture: 'x64' };
        assert.deepEqual(parseAppDistribution(value, { platform: 'win32', architecture: 'x64' }), value);
    }
    for (const value of [
        null,
        { schemaVersion: 1, kind: 'portable', platform: 'linux', architecture: 'x64' },
        { schemaVersion: 1, kind: 'service', platform: 'win32', architecture: 'x64' },
        { schemaVersion: 1, kind: 'portable', platform: 'win32', architecture: 'x64', dataRoot: '/untrusted' },
    ])
        assert.throws(() => parseAppDistribution(value, { platform: 'win32', architecture: 'x64' }));
});
