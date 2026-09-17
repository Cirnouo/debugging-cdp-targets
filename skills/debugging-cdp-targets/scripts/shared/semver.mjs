import { SEMVER_PATTERN } from './constants.mjs';
import { fail } from './errors.mjs';

export function parseSemver(value) {
    const normalized = String(value).trim();
    const match = SEMVER_PATTERN.test(normalized)
        ? /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(normalized)
        : null;
    if (!match) fail('PACKAGE_VERSION_INVALID', `Expected a semantic version but received '${value}'.`);
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split('.') : [],
    };
}

export function semverAtLeast(actual, minimum) {
    const left = parseSemver(actual);
    const right = parseSemver(minimum);
    for (const component of ['major', 'minor', 'patch']) {
        if (left[component] > right[component]) return true;
        if (left[component] < right[component]) return false;
    }
    if (left.prerelease.length === 0) return true;
    if (right.prerelease.length === 0) return false;
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        if (left.prerelease[index] === undefined) return false;
        if (right.prerelease[index] === undefined) return true;
        const leftIdentifier = left.prerelease[index];
        const rightIdentifier = right.prerelease[index];
        if (leftIdentifier === rightIdentifier) continue;
        const leftNumeric = /^\d+$/.test(leftIdentifier);
        const rightNumeric = /^\d+$/.test(rightIdentifier);
        if (leftNumeric && rightNumeric) return Number(leftIdentifier) > Number(rightIdentifier);
        if (leftNumeric !== rightNumeric) return !leftNumeric;
        return leftIdentifier.localeCompare(rightIdentifier, 'en-US') > 0;
    }
    return true;
}

export function validatePackageSpec(packageSpec) {
    const prefix = 'chrome-devtools-mcp@';
    const selector =
        typeof packageSpec === 'string' && packageSpec.startsWith(prefix) ? packageSpec.slice(prefix.length) : '';
    if (selector !== 'latest' && !SEMVER_PATTERN.test(selector)) {
        fail('PACKAGE_SPEC_INVALID', 'PackageSpec must be chrome-devtools-mcp@latest or an exact semantic version.');
    }
    return packageSpec;
}
