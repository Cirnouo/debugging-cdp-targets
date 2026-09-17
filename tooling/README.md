# Repository tooling

This directory owns the repository's non-destructive governance, syntax,
repository, Git, and distribution validators.

- `check-commits.mjs` resolves local or GitHub event ranges and validates commit
  messages and branches through the shared grammar.
- `check-scripts.mjs` syntax-checks maintained JavaScript and parses the Windows
  helper with the required PowerShell engines.
- `check-text-style.mjs` applies the shared text-style validator to lint-staged
  file arguments without modifying them.
- `distribution-audit.mjs` verifies Skills CLI discovery and a temporary copied
  installation byte-for-byte.
- `governance.mjs` owns Conventional Commit and branch-name grammar.
- `repository-audit.mjs` enforces repository, payload, metadata, privacy, and
  source-boundary invariants.
