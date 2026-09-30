# Tooling

- `build-plugin.mjs` bundles runtime and copies required licenses/helpers.
- `repository-audit.mjs` checks text, AST layer boundaries, versions, docs,
  symlink, and production safety.
- `distribution-audit.mjs` checks physical Plugin inventory and byte-identical
  packaging into a disposable directory; this is not a Codex install claim.
- `payload-policy.mjs` owns the exact Plugin file allowlist.
- `governance.mjs` owns commit type/scope and branch grammar.
- `check-commits.mjs` validates Git topology/event ranges.
- `check-scripts.mjs` parses Node and Windows PowerShell source.
- `check-text-style.mjs` audits staged non-Biome text.
- `AGENTS.md` specifies validator safety and independent evidence.

Use package scripts for supported checks. Tooling never mutates user state or
publishes artifacts.
