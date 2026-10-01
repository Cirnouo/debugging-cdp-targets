import assert from 'node:assert/strict';
import test from 'node:test';
import { isSemVer, isStableVersion, validateVersionAgreement } from '../tooling/version-policy.ts';

test('version policy accepts SemVer and rejects malformed or non-string versions', () => {
    for (const version of ['0.1.0', '12.34.56', '1.2.3-alpha.1+build.9']) {
        assert.equal(isSemVer(version), true, version);
    }
    for (const version of ['01.2.3', '1.02.3', '1.2.03', 'v1.2.3', '1.2', '1.2.3-01', '1.2.3\n', '', null, 1]) {
        assert.equal(isSemVer(version), false, String(version));
    }
    assert.equal(isStableVersion('12.34.56'), true);
    assert.equal(isStableVersion('1.2.3-alpha.1'), false);
    assert.equal(isStableVersion('1.2.3+build.9'), false);
});

test('version agreement supports future releases without accepting invalid or mismatched metadata', () => {
    assert.deepEqual(validateVersionAgreement('0.1.0', '0.1.0', '0.1.0'), []);
    assert.deepEqual(validateVersionAgreement('2.3.4', '2.3.4', '2.3.4'), []);
    for (const versions of [
        ['1.2.3', '1.2.4', '1.2.3'],
        ['1.2.3', '1.2.3', '1.2.4'],
        ['01.2.3', '01.2.3', '01.2.3'],
        [null, null, null],
    ]) {
        assert.ok(validateVersionAgreement(versions[0], versions[1], versions[2]).length);
    }
});
