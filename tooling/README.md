# Tooling

- `build-plugin.ts` bundles runtime and helpers, derives all bundled package roots
  from the esbuild metafile, and generates complete third-party license notices.
  SDK inputs also require exact reviewed source/map fingerprints and vendor notices.
- `vendored-licenses.json` records original registry tarball provenance, reviewed
  SDK input/source-map hashes, and exact vendored package licenses.
- `build-security.ts` builds and read-only verifies the dependency-free CI
  audit entry and its YAML license.
- `repository-audit.ts` checks text, AST layer boundaries, versions, docs,
  symlink, and production safety.
- `distribution-audit.ts` checks physical Plugin inventory, the portable MCP
  schema declaration and byte-identical packaging into a disposable directory;
  this is not a Codex install claim.
- `payload-policy.ts` owns the exact Plugin file allowlist.
- `official-server-release.json` records the reviewed official npm release, its
  source tag/commit, tarball integrity and every published file digest and length.
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

Vendored notice evidence is build-only and adds no runtime dependency. For SDK
2.2.0, every SDK input used by esbuild was independently compared with its original
npm tarball after checking the registry SHA-512 integrity. The included source maps
identify ajv 8.18.0, ajv-formats 3.0.1, content-type 1.0.5, fast-deep-equal 3.1.3,
fast-uri 3.1.0 and json-schema-traverse 1.0.0. Their nonempty executable sources
match the corresponding original npm tarball files; AJV JSON schema source-map
contents are empty, so the complete SDK chunk and map hashes also bind those
embedded schemas. Original vendor LICENSE text and its SHA-256 come from those
exact integrity-checked tarballs. No downloaded source or executable is retained.

The build reads only actual esbuild inputs, verifies their reviewed hashes, derives
vendored identities from the verified maps and deduplicates their notices. Unused
browser chunks do not add notices. Unknown input/vendor identities, changed code,
changed maps, missing maps and altered license text fail the build. A future SDK
upgrade requires a fresh comparison against its registry tarballs and original
vendor licenses before updating the reviewed evidence; do not auto-refresh hashes.
