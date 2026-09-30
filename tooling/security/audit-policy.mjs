import { parseAllDocuments } from 'yaml';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const SCOPES = ['repository', 'upstream'];
const VERSION = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i;
const PACKAGE = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/;
const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const MAX_REVIEW_MS = 30 * 24 * 60 * 60 * 1000;

function demand(condition, message) {
    if (!condition) throw new Error(message);
}
function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value, expected, context) {
    demand(
        object(value) && Object.keys(value).sort().join() === [...expected].sort().join(),
        `Invalid ${context} fields.`,
    );
}
function nonempty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function identity(key) {
    const match = /^((?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)@([^()]+)(?:\(.*\))?$/.exec(key);
    demand(match && PACKAGE.test(match[1]) && VERSION.test(match[2]), `Non-registry or unpinned dependency: ${key}`);
    return { name: match[1], version: match[2] };
}

export function readLockInventory(source) {
    const parsed = parseAllDocuments(source);
    demand(parsed.length > 0 && parsed.every((doc) => doc.errors.length === 0), 'Malformed lockfile YAML.');
    const documents = parsed.map((doc) => doc.toJS());
    const all = new Map();
    for (const doc of documents) {
        demand(
            object(doc) &&
                doc.lockfileVersion === '9.0' &&
                object(doc.importers?.['.']) &&
                object(doc.packages) &&
                object(doc.snapshots),
            'Incomplete lockfile inventory.',
        );
        const packageKeys = new Set();
        for (const [key, value] of Object.entries(doc.packages)) {
            const { name, version } = identity(key);
            const integrity = value?.resolution?.integrity;
            demand(
                nonempty(integrity) && /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(integrity),
                `Missing registry integrity: ${key}`,
            );
            demand(
                !value.resolution.tarball || value.resolution.tarball.startsWith('https://registry.npmjs.org/'),
                `Non-standard dependency source: ${key}`,
            );
            const previous = all.get(`${name}@${version}`);
            demand(!previous || previous.integrity === integrity, `Conflicting dependency integrity: ${key}`);
            all.set(`${name}@${version}`, { name, version, integrity });
            packageKeys.add(`${name}@${version}`);
        }
        const snapshotKeys = new Set(
            Object.keys(doc.snapshots).map((key) => {
                const item = identity(key);
                const plain = `${item.name}@${item.version}`;
                demand(packageKeys.has(plain), `Snapshot missing from inventory: ${key}`);
                return plain;
            }),
        );
        demand(snapshotKeys.size === packageKeys.size, 'Lockfile graph omits packages.');
        for (const snapshot of Object.values(doc.snapshots)) {
            for (const field of ['dependencies', 'optionalDependencies']) {
                for (const [name, version] of Object.entries(snapshot[field] ?? {})) {
                    const item = identity(`${name}@${version}`);
                    demand(
                        packageKeys.has(`${item.name}@${item.version}`),
                        `Graph references missing dependency: ${name}@${version}`,
                    );
                }
            }
        }
        for (const importer of Object.values(doc.importers)) {
            for (const field of [
                'dependencies',
                'devDependencies',
                'optionalDependencies',
                'packageManagerDependencies',
            ]) {
                for (const [name, value] of Object.entries(importer[field] ?? {})) {
                    const item = identity(`${name}@${value.version}`);
                    demand(
                        packageKeys.has(`${item.name}@${item.version}`),
                        `Importer references missing dependency: ${name}`,
                    );
                }
            }
        }
    }
    demand(all.size > 0, 'Empty dependency inventory.');
    return {
        packages: [...all.values()].sort((a, b) =>
            `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'),
        ),
        documents,
    };
}

function report(result, allowedExitCodes) {
    demand(
        allowedExitCodes.includes(result.exitCode),
        `Audit command failed (exit ${result.exitCode}): ${result.stderr ?? ''}`,
    );
    let parsed;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        throw new Error('Malformed audit JSON report.');
    }
    demand(
        object(parsed) && !parsed.error && !parsed.errors && !parsed.ignored,
        'Audit failed or report contains ignored findings.',
    );
    return parsed;
}

export function assessAudit(result, inventory) {
    const data = report(result, [0, 1]);
    keys(data, ['advisories', 'metadata'], 'audit report');
    demand(object(data.advisories) && object(data.metadata), 'Invalid advisory report.');
    demand(
        inventory.length > 0 && data.metadata.totalDependencies === inventory.length,
        'Audit coverage differs from complete lock inventory.',
    );
    keys(data.metadata.vulnerabilities, SEVERITIES, 'vulnerability counts');
    const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
    const findings = new Map();
    for (const advisory of Object.values(data.advisories)) {
        demand(
            SEVERITIES.includes(advisory.severity) &&
                PACKAGE.test(advisory.module_name) &&
                GHSA.test(advisory.github_advisory_id) &&
                nonempty(advisory.title),
            'Invalid advisory identity or severity.',
        );
        demand(Array.isArray(advisory.findings) && advisory.findings.length > 0, 'Advisory omits affected versions.');
        counts[advisory.severity]++;
        for (const finding of advisory.findings) {
            demand(
                inventory.some((pkg) => pkg.name === advisory.module_name && pkg.version === finding.version),
                'Advisory version not in inventory.',
            );
            demand(
                Array.isArray(finding.paths) && finding.paths.length > 0 && finding.paths.every(nonempty),
                'Advisory omits dependency paths.',
            );
            const item = {
                ghsa: advisory.github_advisory_id,
                package: advisory.module_name,
                version: finding.version,
                severity: advisory.severity,
                title: advisory.title,
            };
            const key = `${item.ghsa}:${item.package}:${item.version}`;
            demand(
                !findings.has(key) || findings.get(key).severity === item.severity,
                'Conflicting advisory severities.',
            );
            findings.set(key, item);
        }
    }
    for (const severity of SEVERITIES)
        demand(
            Number.isInteger(data.metadata.vulnerabilities[severity]) &&
                data.metadata.vulnerabilities[severity] === counts[severity],
            'Advisory severity counts do not match report.',
        );
    demand(
        result.exitCode === (Object.values(counts).some((count) => count > 0) ? 1 : 0),
        'Audit exit code conflicts with report.',
    );
    return [...findings.values()];
}

export function validateSignatures(result, expectedCount) {
    const data = report(result, [0]);
    keys(data, ['audited', 'verified', 'invalid', 'missing'], 'signature report');
    demand(
        Number.isInteger(expectedCount) &&
            expectedCount > 0 &&
            data.audited === expectedCount &&
            data.verified === expectedCount,
        'Signature coverage differs from lock inventory.',
    );
    demand(
        Array.isArray(data.invalid) &&
            data.invalid.length === 0 &&
            Array.isArray(data.missing) &&
            data.missing.length === 0,
        'Missing or invalid registry signatures.',
    );
}

function utc(value) {
    demand(
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value),
        'Review dates must be UTC ISO timestamps.',
    );
    const date = new Date(value);
    demand(Number.isFinite(date.getTime()) && date.toISOString() === value, 'Invalid review date.');
    return date.getTime();
}
export function validateExceptions(data, now = new Date()) {
    keys(data, ['schemaVersion', 'exceptions'], 'exception manifest');
    demand(data.schemaVersion === 1 && Array.isArray(data.exceptions), 'Invalid exception schema.');
    const seen = new Set();
    for (const item of data.exceptions) {
        keys(
            item,
            [
                'ghsa',
                'package',
                'version',
                'scope',
                'reason',
                'triggerConditions',
                'evidence',
                'reviewedBy',
                'reviewedAt',
                'expiresAt',
                'fingerprints',
            ],
            'exception',
        );
        demand(
            GHSA.test(item.ghsa) &&
                typeof item.package === 'string' &&
                PACKAGE.test(item.package) &&
                VERSION.test(item.version) &&
                SCOPES.includes(item.scope),
            'Exception needs an exact GHSA, package, version and scope.',
        );
        for (const field of ['reason', 'triggerConditions', 'reviewedBy'])
            demand(nonempty(item[field]), `Exception omits ${field}.`);
        demand(
            Array.isArray(item.evidence) &&
                item.evidence.length > 0 &&
                item.evidence.every(
                    (file) =>
                        nonempty(file) &&
                        !file.startsWith('/') &&
                        !file.includes('..') &&
                        !file.includes('\\') &&
                        !file.includes(':'),
                ),
            'Exception needs repository-relative evidence files.',
        );
        keys(item.fingerprints, ['code', 'configuration', 'dependencies'], 'fingerprint');
        demand(
            Object.values(item.fingerprints).every(
                (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
            ),
            'Invalid SHA-256 fingerprint.',
        );
        const reviewed = utc(item.reviewedAt);
        const expires = utc(item.expiresAt);
        demand(
            reviewed <= now.getTime() &&
                expires > now.getTime() &&
                expires > reviewed &&
                expires - reviewed <= MAX_REVIEW_MS,
            'Expired, future or over-30-day exception.',
        );
        const key = `${item.scope}:${item.ghsa}:${item.package}:${item.version}`;
        demand(!seen.has(key), 'Duplicate exception.');
        seen.add(key);
    }
    return data.exceptions;
}

export function evaluateFindings(findings, exceptions, contexts) {
    const scope = Object.keys(contexts)[0];
    demand(Object.keys(contexts).length === 1 && SCOPES.includes(scope), 'Choose exactly one audit scope.');
    const result = { blocked: [], waived: [], reported: findings.map((item) => ({ ...item, scope })) };
    for (const exception of exceptions.filter((item) => item.scope === scope)) {
        demand(
            Object.keys(exception.fingerprints).every((key) => exception.fingerprints[key] === contexts[scope][key]),
            'Exception evidence fingerprint changed; review required.',
        );
    }
    for (const item of result.reported) {
        const waived = exceptions.some(
            (exception) =>
                exception.scope === scope &&
                exception.ghsa === item.ghsa &&
                exception.package === item.package &&
                exception.version === item.version,
        );
        if (waived) result.waived.push(item);
        else if (['high', 'critical'].includes(item.severity)) result.blocked.push(item);
    }
    return result;
}
