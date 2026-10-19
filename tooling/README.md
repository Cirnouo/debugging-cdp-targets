# Tooling

- `app-release-inputs.json` records canonical Electron and ordinary Node archive
  identities separately from npm signature evidence. File extraction and native
  acceptance must be established for each distribution before delivery.
- `app-native-release.json` records canonical registry tarball integrity and
  every original regular file in the native advisory-lock loading closure,
  including all original licenses and platform prebuilds.
- `build-plugin.ts` assembles thin Codex and Claude Code payloads from
  `packaging/` and root `LICENSE`. Its license collector is also consumed by the
  App build; SDK inputs require exact reviewed source/map fingerprints and notices.
- `build-app.ts` builds the synchronous bootstrap, main, sandboxed preload and
  renderer, collects actual graph licenses and stages verified original native
  archives without overwriting an existing stage. It composes the complete expected
  Windows payload from actual verified source producers, emits its canonical
  manifest, verifies the actual complete tree and returns root/selection with
  descriptive source provenance. `extract-app-zip.ps1` authenticates and inventories
  the same opened read-locked ZIP stream; unsafe paths, aliases and non-regular
  entries refuse before extraction. Other platform source producers remain pending.
  The exact helper/source-input inventory also includes the fixed read-only
  Windows deployment authority C#/PowerShell and macOS JXA source. They are
  repository-owned MIT inputs, with no new third-party runtime or notice.
  Copying these sources does not enable deployment admission or enrollment.
- `native-fixture-seal.ts` binds the test-only real-core HTTP fixture, two complete
  screenshot study subjects and original native assets to the same source inputs
  and complete App stage. `native-fixture-verification.ts` checks the closed
  inventories without importing builder dependencies into study execution.
  The production manifest joins App files; thirteen separate research leaves and
  the receipt algorithm remain unchanged and exceed the production manifest.
  Dirty development receipts cannot establish final native acceptance.
- `official-release.ts` owns the canonical official release evidence independently
  of thin Plugin delivery.
- `vendored-licenses.json` records original registry tarball provenance, reviewed
  SDK input/source-map hashes, and exact vendored package licenses.
- `runtime-license-policy.ts` owns canonical YAML, semver ISC and smol-toml
  BSD-3-Clause license identities/hashes. The actual-graph App collector verifies
  them before copying notices; the standalone auditor reuses the YAML/semver data.
- `build-security.ts` builds and read-only verifies the dependency-free CI
  audit entry and its original YAML and semver licenses.
- `repository-audit.ts` checks AST layer boundaries, versions, docs, symlink and
  production safety, consuming shared text rules from `quality/`.
- `quality/` owns pure text style and YAML filename rules reused by the repository
  walker and staged text checker.
- `distribution-audit.ts` checks each physical Plugin inventory, host manifest,
  direct HTTP format, Marketplace pointer and byte-identical packaging into a disposable directory;
  this is not a host install claim.
  It parses Codex Skill presentation YAML with duplicate-key rejection and
  validates its exact interface and PluginShared icon reference against regular
  approved PNG bytes. Shared Skill identity derives from every maintained shared
  input in both directions, excluding only exact host-declared overlay files;
  host inventories independently enforce Codex-only additions.
- `host-policy.ts` owns filesystem-free host descriptors and canonical input/output paths.
- `payload-policy.ts` owns the exact thin Plugin file allowlist.
- `icon-policy.ts` owns approved artwork paths and PNG evidence validation.
    The repository's approved artwork profile is static square PNG, at least
    48 and at most 4096 pixels, at most 5 MiB, with noninterlaced 8-bit RGBA.
    These selected quality bounds remain project requirements; public-submission
    artwork rules are not a local runtime contract. The profile is narrower than the
    [PNG specification](https://www.w3.org/TR/png-3/). Validation checks chunk CRCs,
    a complete bounded pixel stream, and valid row filters. Build assembly checks
    the exact shared asset inventory and copies only each host's delivery icons.
    Delivery PNGs use only IHDR, consecutive IDAT and IEND chunks. Source artwork
    may additionally retain its original `caBX` Content Credentials before IDAT.
    [Host metadata](../docs/evidence/host-plugin-research.md) owns researched consumer support and
    limits for Claude's listing icon and Codex's retained dark composer key.
- `official-tool-catalog.ts` verifies the fixed public tools/list configuration
  matrix; `--write` deliberately regenerates tool metadata for the verified release.
- `official-tool-catalog.json` records complete names, schema variants, activation
  conditions and probe hashes from the unchanged official 1.11.0 public bin.
- `official-server-release.json` records the reviewed official npm release, its
  source tag/commit, tarball integrity and every published file digest and length.
- `governance/` owns pure commit grammar, original-line footer policy and supplied
  event/ref construction, actual commitlint execution and the Git/history audit command.
- `version-policy.ts` re-exports the pure domain version predicates and owns exact
  Package/Plugin/Skill string agreement. It also supplies security identity validation.
- [releases/](releases/README.md) separates supplied-value Markdown note extraction
  and body construction from the complete tag/remote/draft/publication transaction.
  Its publisher validates maintained/generated metadata and new tag-push identity,
  creates or resumes a correctly classified draft after reusable CI, and preserves
  the stable-only latest-release baseline.
- `governance/check-commits.ts` validates Git topology/event ranges, including complete
  rewritten ancestry when a forced push's old commit is unavailable, and full
  scheduled branch ancestry using GitHub's explicit ref without detached fallback.
  PR checks independently validate the raw title and predicted squash header with
  its actual PR number. The original description is review content validated
  against the current template only for PR events; commit body/footer rules do
  not apply to it. Every actual non-merge commit in the selected range or ancestry
  is validated directly without message normalization or commit-specific exceptions.
- [submissions/](submissions/README.md) owns supplied Markdown/PR/Issue-form
  policies, the injected recoverable Issue feedback transaction, fixed public
  REST adapter and invoked CI publisher. Governance and feedback consume the
  value policies; invocation alone owns event/forms/credentials and awaited exit.
- `test-windows-interactive.ts` is the command-line-only GUI lane runner. Without
  `--allow-gui` it returns a successful explicit skip before selecting files. With
  authorization it runs all four interactive files through native `node:test.run`,
  concurrency 1 and forwarded argv, preserving failed-test exit status.
- `check-scripts.ts` parses TypeScript with Babel, checks generated JavaScript
  with Node, and parses the Windows helper with PowerShell 5.1 and 7.
- `check-text-style.ts` audits staged non-Biome text and YAML filenames; original official release
  files are exempt only after complete independent byte verification.
- `check-security.ts` runs the opt-in, network-dependent supply-chain gate.
- `smoke-official-catalog.ts` requires explicit `--stage <verified-App-stage>` or
  `--installed`. Stage mode uses verified delivered ordinary Node/public bin;
  installed mode verifies the repository's original release and supported ordinary
  Node for release/catalog evidence only. Both isolate home/cwd, empty PATH, read
  catalog and normally dispose the child. Neither proves host or target operation.
- `security/` owns complete lock inventories, audit/exception policy,
  fingerprints, and disposable official Server dependency scans.
- `AGENTS.md` specifies validator safety and independent evidence.

Before changing host metadata validation, follow the
[independent research policy](../docs/policies/documentation.md#host-metadata-research)
and update the central [host metadata record](../docs/evidence/host-plugin-research.md).
Keep selected current fields in the [Host metadata reference](../docs/reference/host-metadata.md)
linked to that evidence.
Use package scripts for supported checks. Pure validators never mutate user state
or publish artifacts. The explicit Issue workflow runs `node tooling/submissions/publish-issue-feedback.ts`
with its trusted Issue event and step-scoped built-in token to update only owned
diagnostic labels/comments. Ordinary checks and tests never invoke that CI entry
against GitHub. The separate Release workflow runs `node tooling/releases/publish-release.ts`
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
The pure runtime owner is `src/domains/software-version.ts`; `version-policy.ts`
re-exports its predicates for tooling. The host-management service consumes its
strict comparison, while App build entries do not yet import that service.
The standalone audit bundles the parser with its original ISC notice. App notices
follow actual bundle inputs when management is composed; installing a dependency
alone does not make it an App bundle input. The type package is development-only.
Generic security identities accept any legal prerelease/build. App versions are
independent of the exact shared Skill and four peer Plugin manifest version group.

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
