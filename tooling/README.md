# Tooling

- `build-plugin.ts` bundles runtime and helpers, derives all bundled package roots
  from the esbuild metafile, and generates complete third-party license notices.
- `build-security.ts` builds and read-only verifies the dependency-free CI
  audit entry and its YAML license.
- `repository-audit.ts` checks text, AST layer boundaries, versions, docs,
  symlink, and production safety.
- `distribution-audit.ts` checks physical Plugin inventory and byte-identical
  packaging into a disposable directory; this is not a Codex install claim.
- `payload-policy.ts` owns the exact Plugin file allowlist.
- `governance.ts` owns commit type/scope and branch grammar.
- `version-policy.ts` owns SemVer grammar and Package/Plugin/Skill agreement.
- `release.ts` validates a new tag-push context, builds Changelog-based notes,
  and creates/resumes a draft before publication after the reusable CI gate.
- `check-commits.ts` validates Git topology/event ranges.
- `check-scripts.ts` parses TypeScript with Babel, checks generated JavaScript
  with Node, and parses the Windows helper with PowerShell 5.1 and 7.
- `check-text-style.ts` audits staged non-Biome text.
- `check-security.ts` runs the opt-in, network-dependent supply-chain gate.
- `security/` owns complete lock inventories, audit/exception policy,
  fingerprints, and disposable official Server dependency scans.
- `AGENTS.md` specifies validator safety and independent evidence.

Use package scripts for supported checks. Validators never mutate user state
or publish artifacts. The separate Release workflow runs `node tooling/release.ts`
with its new tag-push event and built-in token; ordinary checks and tests never
invoke its publishing CLI. It does not change repository settings or upload
custom assets.
