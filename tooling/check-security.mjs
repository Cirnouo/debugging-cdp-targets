import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateFindings, readLockInventory, validateExceptions } from './security/audit-policy.mjs';
import { fingerprintInputs } from './security/security-evidence.mjs';
import { scanRepository, scanUpstream } from './security/security-runner.mjs';

export async function checkSecurity(root, options = {}) {
    const phase = options.phase ?? 'complete';
    if (!['complete', 'lockfile'].includes(phase)) throw new Error(`Unknown security phase: ${phase}`);
    const paths = [
        ...new Set(
            execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
                cwd: root,
                encoding: 'utf8',
                windowsHide: true,
            })
                .split('\0')
                .filter(Boolean),
        ),
    ];
    const exceptions = validateExceptions(
        JSON.parse(await readFile(path.join(root, 'docs/policies/security-exceptions.json'), 'utf8')),
        options.now,
    );
    const code = paths.filter(
        (file) =>
            /^(?:src|tooling)\/.*\.(?:mjs|cjs|ps1)$/.test(file) ||
            /^plugins\/.*\/dist\/.*\.(?:mjs|cjs|ps1)$/.test(file),
    );
    const configuration = paths.filter(
        (file) =>
            /^\.github\/workflows\/.*\.ya?ml$/.test(file) ||
            /^plugins\/.*\.(?:json|ya?ml)$/.test(file) ||
            /^\.agents\/plugins\/.*\.json$/.test(file) ||
            ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc'].includes(file),
    );
    for (const exception of exceptions) {
        for (const file of exception.evidence) {
            if (
                (!code.includes(file) && !configuration.includes(file)) ||
                !(await lstat(path.join(root, file))).isFile()
            )
                throw new Error(`Unreviewable fingerprinted evidence: ${file}`);
        }
    }
    const results = {};
    const initialInventory = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    const initialEvidence = await fingerprintInputs(root, code, configuration, initialInventory);
    async function review(scope, result) {
        const fingerprints = await fingerprintInputs(root, code, configuration, result.inventory);
        if (fingerprints.code !== initialEvidence.code || fingerprints.configuration !== initialEvidence.configuration)
            throw new Error('Audit evidence changed during scan; retry with stable inputs.');
        return {
            ...evaluateFindings(result.findings, exceptions, { [scope]: fingerprints }),
            signatures: result.signatures,
            fingerprints,
        };
    }
    results.repository = await review('repository', await scanRepository({ root, ...options, phase }));
    if (phase === 'complete') {
        const result = await scanUpstream({ ...options, review: (result) => review('upstream', result) });
        results.upstream = await review('upstream', result);
    }
    const finalEvidence = await fingerprintInputs(root, code, configuration, initialInventory);
    if (finalEvidence.code !== initialEvidence.code || finalEvidence.configuration !== initialEvidence.configuration)
        throw new Error('Audit evidence changed during scan; retry with stable inputs.');
    return { ok: Object.values(results).every((result) => result.blocked.length === 0), scopes: results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        let root;
        let phase = 'complete';
        const seen = new Set();
        while (args.length) {
            const flag = args.shift();
            const value = args.shift();
            if (!['--phase', '--root'].includes(flag) || seen.has(flag) || !value || value.startsWith('--'))
                throw new Error('Usage: check-security.mjs --root <repository> [--phase complete|lockfile]');
            seen.add(flag);
            if (flag === '--phase') phase = value;
            else root = path.resolve(value);
        }
        if (!root) throw new Error('Usage: check-security.mjs --root <repository> [--phase complete|lockfile]');
        const result = await checkSecurity(root, { phase });
        console.log(JSON.stringify(result, null, 4));
        if (!result.ok) process.exitCode = 1;
    } catch (error) {
        console.error(JSON.stringify({ ok: false, error: error.message }, null, 4));
        process.exitCode = 1;
    }
}
