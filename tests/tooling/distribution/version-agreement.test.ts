import assert from 'node:assert/strict';
import test from 'node:test';
import { validateVersionAgreement } from '../../../tooling/distribution/version-agreement.ts';

test('version agreement supports future releases without accepting invalid or mismatched metadata', () => {
    assert.deepEqual(validateVersionAgreement('0.1.0', '0.1.0', '0.1.0'), []);
    assert.deepEqual(validateVersionAgreement('2.3.4', '1.5.0', '1.5.0'), []);
    assert.deepEqual(validateVersionAgreement('1.2.3', '2.0.0+build.1', '2.0.0+build.1'), []);
    assert.deepEqual(validateVersionAgreement('1.2.3+build.1', '1.2.3+build.1', '1.2.3+build.1'), []);
    for (const versions of [
        ['1.2.3', '1.2.4', '1.2.3'],
        ['1.2.3', '1.2.3', '1.2.4'],
        ['01.2.3', '01.2.3', '01.2.3'],
        ['2.3.4', '01.2.3', '01.2.3'],
        ['2.3.4', null, null],
        ['1.2.3+build.1', '1.2.3+build.2', '1.2.3+build.1'],
        ['1.2.3+build.1', '1.2.3+build.1', '1.2.3+build.2'],
        [null, null, null],
    ]) {
        assert.ok(validateVersionAgreement(versions[0], versions[1], versions[2]).length);
    }
});
