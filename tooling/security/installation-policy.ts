import { NPM_REGISTRY } from '../../src/shared/constants.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { validateConfigurationDependencies } from './lock-inventory.ts';

export const INSTALL_POLICY = Object.freeze({
    minimumReleaseAge: 1440,
    minimumReleaseAgeStrict: true,
    minimumReleaseAgeIgnoreMissingTime: false,
    trustLockfile: false,
    trustPolicy: 'no-downgrade',
    blockExoticSubdeps: true,
    strictDepBuilds: true,
});

export function validateInstallPolicy(config: unknown, isolated = false) {
    if (!isRecord(config)) throw new Error('Invalid installation policy.');
    validateConfigurationDependencies(config.configDependencies);
    for (const [key, value] of Object.entries(INSTALL_POLICY)) {
        if (config[key] !== value) throw new Error(`Unsafe installation policy: ${key}`);
    }
    const expected = isolated ? {} : { 'esbuild@0.28.2': true };
    if (JSON.stringify(config.allowBuilds) !== JSON.stringify(expected))
        throw new Error('Unreviewed dependency build scripts.');
    for (const key of [
        'minimumReleaseAgeExclude',
        'trustPolicyExclude',
        'onlyBuiltDependencies',
        'ignoredBuiltDependencies',
        'dangerouslyAllowAllBuilds',
        'ignoredOptionalDependencies',
    ]) {
        if (Object.hasOwn(config, key)) throw new Error(`Installation bypass is prohibited: ${key}`);
    }
    if (config.auditConfig !== undefined && !isRecord(config.auditConfig))
        throw new Error('Invalid audit configuration.');
    for (const [key, value] of Object.entries(config.auditConfig ?? {})) {
        if (
            !['ignoreCves', 'ignoreGhsas', 'ignoreUnfixable'].includes(key) ||
            (Array.isArray(value) ? value.length > 0 : value !== false)
        )
            throw new Error('Audit exclusions are prohibited.');
    }
    if (config.audit !== undefined && !isRecord(config.audit)) throw new Error('Invalid audit configuration.');
    for (const [key, value] of Object.entries(config.audit ?? {})) {
        if (
            !(
                (key === 'level' && value === 'info') ||
                (key === 'ignore' && Array.isArray(value) && value.length === 0) ||
                (key === 'ignorePrune' && value === false)
            )
        )
            throw new Error('Filtered audit configuration is prohibited.');
    }
    for (const key of ['production', 'prod', 'dev', 'ignoreRegistryErrors', 'noOptional', 'ignoreUnfixable']) {
        if (config[key] === true) throw new Error(`Filtered or permissive audit configuration: ${key}`);
    }
    if (config.optional === false) throw new Error('Optional dependencies must be included.');
    if (config.registry && (typeof config.registry !== 'string' || config.registry.replace(/\/$/, '') !== NPM_REGISTRY))
        throw new Error('Unexpected audit registry.');
}
