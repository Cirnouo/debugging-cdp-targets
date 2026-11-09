import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAudit, validateSignatures } from '../../../tooling/security/registry-reports.ts';
import { audit, inventory, required } from '../../fixtures/security-audit.ts';

test('an audit with no advisories still must cover the entire lock inventory', () => {
    const report = audit();
    report.advisories = {};
    report.metadata.vulnerabilities.high = 0;
    assert.deepEqual(assessAudit({ stdout: JSON.stringify(report), exitCode: 0 }, inventory), []);
    report.metadata.totalDependencies = 0;
    assert.throws(() => assessAudit({ stdout: JSON.stringify(report), exitCode: 0 }, inventory), /inventory|coverage/i);
});

test('audit failures, unknown identities, severity mismatches and filtered reports fail closed', () => {
    for (const result of [
        { stdout: '{', exitCode: 1 },
        { stdout: JSON.stringify({ error: { code: 'ENETUNREACH' } }), exitCode: 1 },
        { stdout: JSON.stringify(audit()), exitCode: 2 },
        { stdout: JSON.stringify(audit('high', '8.21.0')), exitCode: 1 },
        { stdout: JSON.stringify({ ...audit(), advisories: {} }), exitCode: 1 },
        { stdout: JSON.stringify({ ...audit(), ignored: ['hidden'] }), exitCode: 1 },
    ])
        assert.throws(() => assessAudit(result, inventory));
    const report = audit();
    required(report.advisories[1]).severity = 'unknown';
    assert.throws(() => assessAudit({ stdout: JSON.stringify(report), exitCode: 1 }, inventory));
});

test('signature checks reject zero coverage, missing or invalid signatures and command failures', () => {
    assert.doesNotThrow(() =>
        validateSignatures({ stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}', exitCode: 0 }, 3),
    );
    for (const report of [
        { audited: 0, verified: 0, invalid: [], missing: [] },
        { audited: 3, verified: 2, invalid: [], missing: ['ws'] },
        { audited: 3, verified: 2, invalid: ['ws'], missing: [] },
        { audited: 3, verified: 3 },
    ])
        assert.throws(() => validateSignatures({ stdout: JSON.stringify(report), exitCode: 0 }, 3));
    assert.throws(() => validateSignatures({ stdout: '{}', exitCode: 1 }, 3));
});
