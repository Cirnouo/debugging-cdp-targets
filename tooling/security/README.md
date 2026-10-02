# Supply-chain audit tooling

- `audit-policy.ts` validates every pnpm lockfile document, full audit and
  signature reports, and narrowly reviewed vulnerability exceptions.
- `security-evidence.ts` checks installation policy, manifest/lock agreement and installed graph
  completeness, and computes code/configuration/dependency SHA-256 evidence.
- `security-runner.ts` executes pnpm without a shell and audits both the
  repository and a disposable, script-disabled official Server dependency tree;
  upstream vulnerability review precedes actual installation.
  All pnpm calls disable pnpmfile hooks and configuration-dependency loading.
- `dist/` contains the committed standalone checker and original YAML license
  so CI can audit before installing project dependencies.
- `upstream-pnpm-lock.yaml` freezes the isolated official release dependency graph.
- `AGENTS.md` defines fail-closed implementation and test requirements.

Run `pnpm check:security` for full installed-tree checks, or the standalone
entry with `--phase lockfile --root .` for repository-only pre-install checks.
Use `pnpm build:security` to generate and `pnpm check:security:build` to verify
the bundle without writing. These modules are not
Plugin runtime code and do not belong in the installable payload.
