import type { PackageIdentity } from './lock-inventory.ts';

export type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical';
export interface AuditCommandResult {
    exitCode: number;
    stdout: string;
    stderr?: string;
}
export interface Finding {
    ghsa: string;
    package: string;
    version: string;
    severity: Severity;
    title: string;
}
const SEVERITIES: Severity[] = ['info', 'low', 'moderate', 'high', 'critical'];
const PACKAGE = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/;
const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
function demand(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: unknown, expected: readonly string[], context: string): asserts value is Record<string, unknown> {
    demand(
        object(value) && Object.keys(value).sort().join() === [...expected].sort().join(),
        `Invalid ${context} fields.`,
    );
}
function nonempty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
function report(result: AuditCommandResult, allowedExitCodes: number[]) {
    demand(
        allowedExitCodes.includes(result.exitCode),
        `Audit command failed (exit ${result.exitCode}): ${result.stderr ?? ''}`,
    );
    let parsed: unknown;
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

export function assessAudit(result: AuditCommandResult, inventory: PackageIdentity[]): Finding[] {
    const data = report(result, [0, 1]);
    keys(data, ['advisories', 'metadata'], 'audit report');
    demand(object(data.advisories) && object(data.metadata), 'Invalid advisory report.');
    demand(
        inventory.length > 0 && data.metadata.totalDependencies === inventory.length,
        'Audit coverage differs from complete lock inventory.',
    );
    keys(data.metadata.vulnerabilities, SEVERITIES, 'vulnerability counts');
    const counts: Record<Severity, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
    const findings = new Map<string, Finding>();
    for (const advisory of Object.values(data.advisories)) {
        demand(
            object(advisory) &&
                typeof advisory.severity === 'string' &&
                SEVERITIES.some((severity) => severity === advisory.severity) &&
                typeof advisory.module_name === 'string' &&
                typeof advisory.github_advisory_id === 'string' &&
                PACKAGE.test(advisory.module_name) &&
                GHSA.test(advisory.github_advisory_id) &&
                nonempty(advisory.title),
            'Invalid advisory identity or severity.',
        );
        demand(Array.isArray(advisory.findings) && advisory.findings.length > 0, 'Advisory omits affected versions.');
        const severity = advisory.severity as Severity;
        counts[severity]++;
        for (const finding of advisory.findings as unknown[]) {
            demand(object(finding) && typeof finding.version === 'string', 'Invalid affected version.');
            demand(
                inventory.some((pkg) => pkg.name === advisory.module_name && pkg.version === finding.version),
                'Advisory version not in inventory.',
            );
            demand(
                Array.isArray(finding.paths) && finding.paths.length > 0 && finding.paths.every(nonempty),
                'Advisory omits dependency paths.',
            );
            const item: Finding = {
                ghsa: advisory.github_advisory_id,
                package: advisory.module_name,
                version: finding.version,
                severity,
                title: advisory.title,
            };
            const key = `${item.ghsa}:${item.package}:${item.version}`;
            demand(
                !findings.has(key) || findings.get(key)?.severity === item.severity,
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

export function validateSignatures(result: AuditCommandResult, expectedCount: number) {
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
