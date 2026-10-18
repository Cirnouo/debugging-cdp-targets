import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, isReleaseVersion, isSemVer, isStableVersion } from '../src/domains/software-version.ts';

test('strict version owner rejects coercion and node-semver limits', () => {
    for (const value of [
        null,
        1,
        '',
        ' 1.2.3',
        '1.2.3 ',
        'v1.2.3',
        'V1.2.3',
        '=1.2.3',
        '01.2.3',
        '1.2.3-01',
        '9007199254740992.0.0',
        `1.2.3+${'x'.repeat(256)}`,
    ]) {
        assert.equal(isSemVer(value), false, String(value));
    }
    assert.equal(isSemVer('1.2.3-rc.1+build.5'), true);
    assert.equal(isReleaseVersion('1.2.3-rc.1'), true);
    assert.equal(isReleaseVersion('1.2.3+build'), false);
    assert.equal(isStableVersion('1.2.3-rc.1'), false);
    assert.equal(isStableVersion('1.2.3'), true);
});

test('comparison follows precedence without treating build metadata as an upgrade', () => {
    const ordered = [
        '1.0.0-alpha',
        '1.0.0-alpha.1',
        '1.0.0-alpha.beta',
        '1.0.0-beta',
        '1.0.0-beta.2',
        '1.0.0-beta.11',
        '1.0.0-rc.1',
        '1.0.0',
        '2.0.0',
    ];
    for (let index = 1; index < ordered.length; index++) {
        assert.equal(compareVersions(ordered[index - 1], ordered[index]), -1);
        assert.equal(compareVersions(ordered[index], ordered[index - 1]), 1);
    }
    assert.equal(compareVersions('1.0.0+one', '1.0.0+two'), 0);
    assert.throws(() => compareVersions('v1.0.0', '1.0.0'), /version/i);
});
