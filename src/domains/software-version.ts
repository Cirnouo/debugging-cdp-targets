import parse from 'semver/functions/parse.js';

function parseStrictVersion(value: unknown) {
    if (typeof value !== 'string' || value !== value.trim() || value.startsWith('v') || value.startsWith('V'))
        return null;
    return parse(value, { loose: false });
}

export function isSemVer(value: unknown): value is string {
    return parseStrictVersion(value) !== null;
}

export function isReleaseVersion(value: unknown): value is string {
    const parsed = parseStrictVersion(value);
    return parsed !== null && parsed.build.length === 0;
}

export function isStableVersion(value: unknown): value is string {
    const parsed = parseStrictVersion(value);
    return parsed !== null && parsed.prerelease.length === 0 && parsed.build.length === 0;
}

export function compareVersions(left: unknown, right: unknown): -1 | 0 | 1 {
    const a = parseStrictVersion(left);
    const b = parseStrictVersion(right);
    if (!a || !b) throw new Error('Invalid software version.');
    return a.compare(b);
}
