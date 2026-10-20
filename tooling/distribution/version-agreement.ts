import { isSemVer } from '../../src/domains/software-version.ts';

export function validateVersionAgreement(appVersion: unknown, pluginVersion: unknown, skillVersion: unknown) {
    return isSemVer(appVersion) && isSemVer(skillVersion) && pluginVersion === skillVersion
        ? []
        : ['App version must be valid SemVer; Plugin and Skill versions must agree on a valid SemVer version.'];
}
