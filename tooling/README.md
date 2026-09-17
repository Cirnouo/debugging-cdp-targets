# Repository tooling

This directory owns the repository's non-destructive governance, syntax,
repository, Git, and distribution validators.

- `AGENTS.md` defines the local test-first, non-destructive, cross-platform
  implementation constraints for validators.
- `check-commits.mjs` resolves local or GitHub event ranges, delegates commit
  messages to the same commitlint configuration used by the hook, and validates
  branch names through the shared grammar.
- `check-scripts.mjs` syntax-checks maintained JavaScript and parses the Windows
  helper with the required PowerShell engines.
- `check-text-style.mjs` applies the shared text-style validator to lint-staged
  file arguments without modifying them.
- `distribution-audit.mjs` verifies Skills CLI discovery and a temporary copied
  installation byte-for-byte.
- `governance.mjs` owns commit types, scopes, branch-name grammar, and the
  fail-closed commitlint process adapter used by CI.
- `payload-policy.mjs` owns the explicit installable-payload path inventory and
  required-file set shared by repository and distribution audits.
- `repository-audit.mjs` enforces repository, payload, metadata, privacy, and
  source-boundary invariants.
