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
  archives without overwriting an existing stage. `extract-app-zip.ps1` rejects
  unsafe archive paths, duplicate destinations and link entries before extraction.
- `native-fixture-seal.ts` binds the test-only real-core HTTP fixture, two complete
  screenshot study subjects and original native assets to the same source inputs
  and complete App stage. `native-fixture-verification.ts` checks the closed
  inventories without importing builder dependencies into study execution.
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
    [Host metadata](../docs/host-metadata.md) owns researched consumer support and
    limits for Claude's listing icon and Codex's retained dark composer key.
- `official-tool-catalog.ts` verifies the fixed public tools/list configuration
  matrix; `--write` deliberately regenerates tool metadata for the verified release.
- `official-tool-catalog.json` records complete names, schema variants, activation
  conditions and probe hashes from the unchanged official 1.11.0 public bin.
- `official-server-release.json` records the reviewed official npm release, its
  source tag/commit, tarball integrity and every published file digest and length.
- `governance/` owns pure commit type/scope and branch grammar separately from
  actual commitlint execution. The root command entries consume those owners.
- `commit-footer-rule.ts` supplies the local commitlint `footer-leading-blank`
  rule. It checks original message lines, preserves body labels without a
  preceding blank line, and requires separation before reserved footer syntax.
  A separated generic trailer can begin a group of adjacent footer lines.
- `version-policy.ts` re-exports the pure domain version predicates and owns exact
  Package/Plugin/Skill string agreement. It also supplies security identity validation.
- `release.ts` reads both maintained packaging and generated host metadata,
  validates a new tag-push context, builds Changelog-based notes,
  and creates/resumes a stable or prerelease draft before publication after the
  reusable CI gate. It checks returned classification and preserves a stable-only
  latest-release baseline for notes and comparisons.
- `check-commits.ts` validates Git topology/event ranges, including complete
  rewritten ancestry when a forced push's old commit is unavailable, and full
  scheduled branch ancestry using GitHub's explicit ref without detached fallback.
  PR checks independently validate the raw title and predicted squash header with
  its actual PR number. The original description is review content validated
  against the current template only for PR events; commit body/footer rules do
  not apply to it. Every actual non-merge commit in the selected range or ancestry
  is validated directly without message normalization or commit-specific exceptions.
- `pull-request-policy.ts` validates current PR section order, canonical checklist
  labels/placement, selections, conditional N/A reasons, and evidence by reading
  the supplied current template. The CLI loads `.github/PULL_REQUEST_TEMPLATE.md`;
  the low-level Git range/message builder remains independent of that template.
- `issue-policy.ts` parses supplied current Issue form YAML and derives classification
  labels, H3 field order, required responses, and exact single-choice dropdown options.
  It returns skipped, valid, or invalid body diagnostics; malformed or unsupported
  forms throw a distinct configuration error. Ordinary unlabeled Issues are exempt.
  This pure policy has no CLI or local submission hook.
- `issue-feedback.ts` is the CI-only Issue publisher: it validates trusted event
  and live Issue identity, consumes current form YAML through the pure policy,
  paginates owned bot comments, checks stale snapshots and publishes recoverable
  diagnostic labels/comments. Invalid content fails only after feedback completes.
  Closed Issues and diagnostic-label events are skipped; ordinary Issues are exempt
  and stale owned diagnosis is cleared. It has no package command or local hook.
- `issue-github.ts` owns the fixed public GitHub REST boundary for Issue feedback,
  bounded requests, redirect refusal, token headers and sanitized transport errors.
- `submission-markdown.ts` scans submission sections at a selected heading depth,
  logical wrapped checkbox labels, adjacent continuations, and content paragraphs.
  Paragraphs retain their text and whether it includes literal code or quoted
  content. Shared line readers identify headings/checklists without rescanning
  literal output as Markdown structure.
  Fences, indented code, quotes, and comments cannot supply structural headings
  or checklists; code and quoted content can supply evidence beyond starter prose.
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
and update the central [host metadata record](../docs/host-metadata.md).
Use package scripts for supported checks. Pure validators never mutate user state
or publish artifacts. The explicit Issue workflow runs `node tooling/issue-feedback.ts`
with its trusted Issue event and step-scoped built-in token to update only owned
diagnostic labels/comments. Ordinary checks and tests never invoke that CI entry
against GitHub. The separate Release workflow runs `node tooling/release.ts`
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
