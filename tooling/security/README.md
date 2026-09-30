# Supply-chain audit tooling

- `audit-policy.mjs` validates every pnpm lockfile document, full audit and
  signature reports, and narrowly reviewed vulnerability exceptions.
- `security-evidence.mjs` checks installation policy and installed graph
  completeness, and computes code/configuration/dependency SHA-256 evidence.
- `security-runner.mjs` executes pnpm without a shell and audits both the
  repository and a disposable, script-disabled official Server dependency tree.
- `AGENTS.md` defines fail-closed implementation and test requirements.

Run the public repository command `pnpm check:security`; these modules are not
Plugin runtime code and do not belong in the installable payload.
