# Tooling

- `build-plugin.ts` assembles complete Codex and Claude Code payloads from
  `packaging/`, root `LICENSE` and one shared runtime map. It bundles runtime and
  helpers, derives all bundled package roots
  from the esbuild metafile, and generates complete third-party license notices.
  SDK inputs also require exact reviewed source/map fingerprints and vendor notices.
- `vendored-licenses.json` records original registry tarball provenance, reviewed
  SDK input/source-map hashes, and exact vendored package licenses.
- `build-security.ts` builds and read-only verifies the dependency-free CI
  audit entry and its original YAML and semver licenses.
- `repository-audit.ts` checks text, AST layer boundaries, versions, docs,
  symlink, and production safety.
- `distribution-audit.ts` checks each physical Plugin inventory, host manifest,
  MCP/Hook format, Marketplace pointer and byte-identical packaging into a disposable directory;
  this is not a host install claim.
- `host-policy.ts` owns filesystem-free host descriptors and canonical input/output paths.
- `payload-policy.ts` owns the release-backed exact Plugin file allowlist.
- `icon-policy.ts` owns approved artwork paths and PNG evidence validation.
  [Codex artwork requirements](https://developers.openai.com/plugins/deploy/submission#icons-and-screenshots)
  accept PNG, JPEG, WebP and SVG, with square artwork at least 48 pixels and
  files at most 5 MiB. Raster dimensions are at most 4096 pixels; SVG uses square
  dimensions or a square `viewBox` at least 48 pixels.
  The repository selects static PNG with noninterlaced 8-bit RGBA as its
  artwork profile; this is narrower than the
  [PNG specification](https://www.w3.org/TR/png-3/). Validation checks chunk CRCs,
  a complete bounded pixel stream, and valid row filters. Build assembly checks
  the exact shared asset inventory and copies only each host's delivery icons.
  Delivery PNGs use only IHDR, consecutive IDAT and IEND chunks. Source artwork
  may additionally retain its original `caBX` Content Credentials before IDAT.
  [Claude directory listing metadata](https://code.claude.com/docs/en/plugins-reference#directory-listing-fields)
  documents a single `icon` field, ignored by Claude Code during loading, with
  no documented dark theme counterpart.
- `official-tool-catalog.ts` verifies the fixed public tools/list configuration
  matrix; `--write` deliberately regenerates tool metadata for the verified release.
- `official-tool-catalog.json` records complete names, schema variants, activation
  conditions and probe hashes from the unchanged official 1.10.1 public bin.
- `official-server-release.json` records the reviewed official npm release, its
  source tag/commit, tarball integrity and every published file digest and length.
- `governance.ts` owns commit type/scope and branch grammar.
- `version-policy.ts` owns strict input guards around node-semver and exact
  Package/Plugin/Skill string agreement. It also supplies security identity validation.
- `release.ts` reads both maintained packaging and generated host metadata,
  validates a new tag-push context, builds Changelog-based notes,
  and creates/resumes a stable or prerelease draft before publication after the
  reusable CI gate. It checks returned classification and preserves a stable-only
  latest-release baseline for notes and comparisons.
- `check-commits.ts` validates Git topology/event ranges, including complete
  rewritten ancestry when a forced push's old commit is unavailable, and full
  scheduled branch ancestry using GitHub's explicit ref without detached fallback.
  PR checks predict the squash header with its PR number and validate the original
  description. Every non-merge commit is validated directly without message
  normalization or commit-specific exceptions.
- `check-scripts.ts` parses TypeScript with Babel, checks generated JavaScript
  with Node, and parses the Windows helper with PowerShell 5.1 and 7.
- `check-text-style.ts` audits staged non-Biome text; original official release
  files are exempt only after complete independent byte verification.
- `check-security.ts` runs the opt-in, network-dependent supply-chain gate.
- `smoke-official-catalog.ts` independently copies both host Plugins outside
  repository dependencies, initializes each official public Server with a temporary home and empty PATH,
  reads only the catalog and closes stdin. Run it explicitly with pnpm smoke:official.
- `security/` owns complete lock inventories, audit/exception policy,
  fingerprints, and disposable official Server dependency scans.
- `AGENTS.md` specifies validator safety and independent evidence.

Use package scripts for supported checks. Validators never mutate user state
or publish artifacts. The separate Release workflow runs `node tooling/release.ts`
with its new tag-push event and built-in token; ordinary checks and tests never
invoke its publishing CLI. It does not change repository settings or upload
custom assets.

Version validation uses the public `semver/functions/parse.js` entry from
[node-semver 7.8.5](https://github.com/npm/node-semver/tree/v7.8.5) with loose parsing
disabled. The wrapper owns string-only input, exact whitespace and prefix rejection;
it never cleans or coerces versions. node-semver limits the full string to 256
characters and each core component to `Number.MAX_SAFE_INTEGER` (9007199254740991).
Numeric prerelease identifiers may exceed that integer limit within the total
length limit. Stable classification requires empty prerelease and build arrays;
release eligibility allows arbitrary legal prerelease identifiers but no build
metadata. Metadata agreement compares original strings, including build identifiers.
The parser is bundled only in the standalone audit tooling; its type package is
development-only. Generic security identities accept any legal prerelease/build.

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
