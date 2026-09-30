# Repository policies

This directory owns enforceable repository-wide contributor policy.

- `commits-and-scope.md` owns branch, commit, authorization, and scope-evolution
  rules.
- `documentation.md` owns README, local `AGENTS.md`, glossary, and audience
  boundaries.
- `quality.md` owns formatting, tests, coverage, hooks, CI, and verification.
- `releases.md` owns versioning, changelog, tagging, and release authorization.
- `security.md` owns CDP, session, cache, privacy, and shutdown constraints.
- `supply-chain.md` owns installation trust, complete dependency audits, and
  bounded vulnerability review exceptions.
- `security-exceptions.json` is the machine-validated, initially empty review
  exception manifest; it cannot waive signature or check failures.

Module-specific implementation rules belong in the nearest module
`AGENTS.md`, not in these repository-wide policies.
