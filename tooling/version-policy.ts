const semverPattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const stablePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isSemVer(value: unknown): value is string {
    return typeof value === 'string' && value === value.trim() && semverPattern.test(value);
}

export function isStableVersion(value: unknown): value is string {
    return typeof value === 'string' && value === value.trim() && stablePattern.test(value);
}

export function validateVersionAgreement(packageVersion: unknown, pluginVersion: unknown, skillVersion: unknown) {
    return isSemVer(packageVersion) && pluginVersion === packageVersion && skillVersion === packageVersion
        ? []
        : ['Package, Plugin, and Skill versions must agree on a valid SemVer version.'];
}
