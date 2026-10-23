import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInstallPolicy } from '../../../tooling/security/installation-policy.ts';
import { ghsa } from '../../fixtures/security-audit.ts';

test('installation policy has no cooldown exemptions, ignored advisories or trust bypass', () => {
    const safe = {
        minimumReleaseAge: 1440,
        minimumReleaseAgeStrict: true,
        minimumReleaseAgeIgnoreMissingTime: false,
        trustLockfile: false,
        trustPolicy: 'no-downgrade',
        blockExoticSubdeps: true,
        strictDepBuilds: true,
        allowBuilds: { 'esbuild@0.28.2': true },
    };
    assert.doesNotThrow(() => validateInstallPolicy(safe));
    for (const changed of [
        { minimumReleaseAge: 0 },
        { trustLockfile: true },
        { trustPolicy: 'off' },
        { minimumReleaseAgeExclude: ['skills@1.6.0'] },
        { auditConfig: { ignoreGhsas: [ghsa] } },
        { audit: { ignore: [ghsa] } },
        { audit: { level: 'high' } },
        { ignoreUnfixable: true },
        { optional: false },
        { ignoredOptionalDependencies: ['helper'] },
        { allowBuilds: { '*': true } },
        { onlyBuiltDependencies: ['anything'] },
        { configDependencies: { plugin: '1.0.0' } },
    ]) {
        assert.throws(() => validateInstallPolicy({ ...safe, ...changed }));
    }
});
