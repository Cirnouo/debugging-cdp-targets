# Tooling

- `build-plugin.ts` bundles runtime and copies required licenses/helpers.
- `build-security.ts` builds and read-only verifies the dependency-free CI
  audit entry and its YAML license.
- `repository-audit.ts` checks text, AST layer boundaries, versions, docs,
  symlink, and production safety.
- `distribution-audit.ts` checks physical Plugin inventory and byte-identical
  packaging into a disposable directory; this is not a Codex install claim.
- `payload-policy.ts` owns the exact Plugin file allowlist.
- `governance.ts` owns commit type/scope and branch grammar.
- `check-commits.ts` validates Git topology/event ranges.
- `check-scripts.ts` parses TypeScript with Babel, checks generated JavaScript
  with Node, and parses the Windows helper with PowerShell 5.1 and 7.
- `check-text-style.ts` audits staged non-Biome text.
- `check-security.ts` runs the opt-in, network-dependent supply-chain gate.
- `security/` owns complete lock inventories, audit/exception policy,
  fingerprints, and disposable official Server dependency scans.
- `AGENTS.md` specifies validator safety and independent evidence.

Use package scripts for supported checks. Tooling never mutates user state or
publishes artifacts.
