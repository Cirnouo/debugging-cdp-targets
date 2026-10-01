# Supply-chain review and build gate

## Installation and scan order

Use pnpm 12.4.2 and the frozen lockfile. CI's Supply chain security job first
validates and audits the repository lockfile using the committed standalone Node
checker without project dependencies. It then installs with `--ignore-scripts`,
verifies the installed graph and full audits, and checks the standalone build
against its maintained source. Commit messages and Quality depend on its
success. Windows and Portable tests remain downstream of Quality. No
continue-on-error, always-run build, registry-error suppression, or audit repair
is permitted. All third-party Actions must use reviewed full commit SHAs.

Explicit installation policy is a 1,440-minute release cooldown, strict
enforcement, no missing-publish-date bypass, `trustLockfile: false`,
`trustPolicy: no-downgrade`, `blockExoticSubdeps: true`, and
`strictDepBuilds: true`. Only the exact reviewed `esbuild@0.28.2` installation
script is allowed in later ordinary installs. The isolated upstream audit allows
no scripts. Do not add automatic cooldown/trust/build exclusions; report a
rejected entry and stop. A trust downgrade is not itself proof of malware.

The reviewed development override `@types/node: 24.19.0` aligns the config
loader's unrestricted type peer with Node 24 and avoids its trust-rejected
undici-types 6.21.0 chain. This is a dependency update, not a trust exception.
Changing the override requires graph review and normal compatibility gates.

The standalone entry takes `--phase lockfile --root .` from the repository root.
This phase checks manifest/lock agreement and effective policy, then executes
`pnpm install --lockfile-only --frozen-lockfile --ignore-scripts` and registry
audits. The lock-only command must leave locked inputs unchanged and must not
create an installation tree. This phase never resolves the official MCP tree.

All audit/configuration/lock/install subprocesses explicitly disable pnpmfile
hooks and config-dependency loading. The security job also sets
`PNPM_CONFIG_IGNORE_PNPMFILE=true` and `PNPM_CONFIG_CONFIG_DEPENDENCIES={}` so
its ordinary install and pnpm script invocations have the same boundary.
`--ignore-scripts` alone disables lifecycle scripts, not executable pnpm hooks.
Reject nonempty or malformed configDependencies in the workspace and every
lock document before invoking pnpm; this project has no reviewed configuration
dependencies. These controls must not weaken the remaining effective policy.

`pnpm check:security` retains complete installed-tree checking and requires the
public npm registry and network access. Both phases
run `pnpm audit --json --audit-level=info` and `pnpm audit signatures --json`
for the complete dependency graph, including development, optional, transitive,
build-time, and package-manager dependencies across all YAML documents. It
checks the installed runtime graph and dependency groups against the lockfile.
Audited and verified counts must match that independently derived inventory;
zero/partial coverage, malformed reports, missing/invalid signatures, unknown
identities, ignored findings, command failures, and network failures all block.
No vulnerability exception can bypass these failures.

The complete command resolves the shared-constant exact official MCP version
into a new disposable lockfile with scripts disabled, isolated configuration and
store. It validates and audits this lockfile, evaluates vulnerability exceptions
with current fingerprints, and only then performs a script-disabled frozen
install and verifies the installed graph. Blocked or unverifiable findings do
not permit actual installation. The approved inputs must remain unchanged.
It never executes the Server/bin/version command,
starts a browser, or reads the user's runtime cache. All disposable files are
removed after the check. This measures the upstream dependency graph resolved
at CI time, not a guarantee about a future runtime npx download. Audit tooling,
temporary locks, packages and reports are not Plugin payload files.

## Vulnerabilities and bounded review exceptions

High and critical findings block by default; moderate, low and informational
findings remain in the structured report but do not block. Absence of a fixed
version is not a reason to allow a finding. Unknown reachability is not evidence
of safety: no-call observations, missing rules, conditional paths and incomplete
transitive coverage do not prove non-exploitability. This project does not
implement a reachability analyzer or require a paid external service.

`security-exceptions.json` has schemaVersion 1 and an initially empty exceptions
array. Each exception must contain exactly:

- `ghsa`, `package`, `version`: one GHSA and exact npm identity/version; no
  whole-package, wildcard, range, or permanent exemption.
- `scope`: `repository` or `upstream`, never both through a wildcard.
- `reason`, `triggerConditions`: the specific unaffected rationale and the
  conditions that would trigger the vulnerability.
- `evidence`: nonempty repository-relative maintained file paths documenting
  verifiable use, code or configuration; each must belong to the code or
  configuration fingerprint sets below. No unhashed prose, URLs or escaping
  paths; explanatory prose belongs in reason/triggerConditions.
- `reviewedBy`: an identified human reviewer accountable for the decision.
- `reviewedAt`, `expiresAt`: UTC ISO timestamps such as
  `2026-09-30T00:00:00.000Z`; expiry must be in the future, after review, and no
  more than 30 days later. Future review dates and invalid calendar dates fail.
- `fingerprints`: lowercase SHA-256 `code`, `configuration`, and `dependencies`
  hashes copied from the corresponding check report after human inspection.

Code hashes cover maintained runtime source/helpers, audit/build tooling and
committed runtime bundles. Configuration hashes cover package.json, workspace
policy, the lockfile, optional .npmrc, CI workflows, Plugin JSON/YAML configuration
and the Marketplace catalog. Dependency hashes cover
the parsed full lock documents, canonically sorted. File hashes include sorted
relative names, byte lengths and contents. The exception file is not hashed into
itself. Fingerprints differ between repository and upstream graphs.
Maintained TypeScript (`.ts`, `.mts`, `.cts`) and generated JavaScript are both
included. Compiler, parser and type dependencies are audited like every other
development dependency. Type or language changes do not authorize automatic
exception renewal; changed fingerprints require a fresh human review.

Only a full identity match with current evidence can waive a finding. A stale
fingerprint, expired/malformed/duplicate review fails the gate rather than
silently extending approval. Package/version/code/configuration/graph changes
require another review; never rewrite historical commits or automatically
refresh dates/hashes. Prefer upgrading/removing affected dependencies, and
document why that is not yet possible when requesting a temporary waiver.

## Local checks and remote enforcement

Default unit tests and `verify:push` stay offline with respect to audit services.
Run `check:security` separately before dependency/build changes are merged.
Reports are diagnostic evidence at a point in time, not an absolute security
claim: signatures do not certify that package contents are benign. In the pinned
pnpm implementation, both registry audits derive package identities from the
lockfile, not local package bytes; signature success is not independent local
file authentication. Frozen installation enforces pnpm tarball integrity, while
the installed-tree comparison independently checks graph and inclusion evidence.

`pnpm build:security` regenerates the committed standalone checker and original
parser license; `pnpm check:security:build` verifies them without writing or
network access. This offline check belongs in verify:push. Generated code is
checked for reproducibility, not manually formatted; maintained audit source
remains subject to normal tests and unchanged coverage floors.

After this workflow has run successfully on GitHub, the user should add
**Supply chain security** to main's strict required checks alongside existing
jobs. Use a PR-required, up-to-date, linear-history Ruleset with force-push and
deletion disabled. This change does not configure GitHub settings and Actions
still runs after a push is received, not before transfer.
