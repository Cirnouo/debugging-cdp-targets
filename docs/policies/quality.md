# Quality and verification

Use four spaces, UTF-8, LF, a final newline, and no tabs. Biome formats/lints
TypeScript, generated-compatible JavaScript and JSON; repository text checks cover YAML, Markdown, PowerShell,
TOML, and shell. Generated lockfile indentation is exempt.

Original upstream bytes are verified against maintained release evidence by the
actual App/Official package consumers. Retired thin-host `dist/` paths receive no
repository formatting or directory-map exemption: staged checks refuse them
before release-evidence reads, and the walker also applies ordinary filename,
text and directory checks. Only `tooling/security/dist/check-security.mjs` keeps
its existing generated-text exemption. App-stage placement grants no
generated-text exemption. All delivered JavaScript still receives Node syntax
checks. Root and isolated pnpm locks retain pnpm's format.

## YAML filenames

Repository-maintained YAML files use lowercase `.yaml`, never `.yml` or other
case variants. The sole repository-owned filename exception is
`.github/ISSUE_TEMPLATE/config.yml`, the exact entry documented by
[GitHub's template chooser configuration](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository#configuring-the-template-chooser).
Keep that name to preserve ordinary Issue settings and private security reporting
links; equivalent `config.yaml` support has not been established. This exception
does not apply to another directory, basename match or case variant.

Complete official release content retains upstream filenames only after full
independent package verification under the
[original release delivery contract](supply-chain.md#official-release-delivery-and-upgrades).
This original-package contract grants no thin-host placement or repository
walker exemption. Repository-generated files still follow the naming rule even
when their formatting is exempt.

Repository auditing and staged text checks share the filename validator. Keep
`.yml` and case-variant matching in staged checks so incorrect names are rejected,
and retain both YAML extensions in formatting and security scan coverage.

## Toolchain compatibility

Support stable Node >=24.21.0 <25, declared as `engines.node: "^24.21.0"`.
Existing Node installations within that range are supported. Node 24.21.0
remains the exact CI and problem-reproduction baseline. Keep pnpm exactly
12.4.2 in `packageManager`, both locks and the isolated audit manifest; a Node
compatibility change does not authorize dependency upgrades or lock rewrites.
See [ADR 0016](../adr/0016-toolchain-compatibility.md) for evidence and rationale.

See the CI policy for the latest-24 job's command order and evidence scope.
[Node compatibility](continuous-integration.md#node-compatibility)

Optional `mise.toml` selects Node `24` and exact pnpm `12.4.2` for everyday work;
it is not an exact reproducibility baseline. As documented by
[mise](https://mise.jdx.dev/dev-tools/versions.html#how-a-request-resolves),
prefix requests can reuse an installed match. `mise install node@24` resolves
the newest available 24.x without writing configuration. Check `node --version`
before the trusted installation sequence; update a selected release below
24.21.0 first, then check again. Do not bypass the supported floor.

[pnpm rejects an incompatible project engine during installation](https://pnpm.io/settings/cli#enginestrict).
The manifest does not check arbitrary direct `node` invocations, including the
standalone pre-install audit or installed Plugin runtime. No runtime version
check is added. Node security updates need explicit review; they are not
implied by the optional selector or a successful build.

## Verification

Develop changed behavior test-first. Regression tests use isolated fake CDP
targets; never download packages or launch user browsers in the default suite.
`pnpm test` and `pnpm test:coverage` select `tests/*.test.ts` plus
`tests/tooling/governance/commit-events.test.ts`,
`tests/tooling/governance/commit-grammar.test.ts`,
`tests/tooling/governance/commit-history.test.ts`,
`tests/tooling/governance/commit-validation.test.ts`,
`tests/tooling/quality/text-policy.test.ts`,
`tests/tooling/quality/runtime-boundaries.test.ts`,
`tests/tooling/quality/repository-audit.test.ts`,
`tests/tooling/quality/script-syntax.test.ts`,
`tests/tooling/quality/hook-isolation.test.ts`,
`tests/tooling/quality/ci-config.test.ts`,
`tests/tooling/quality/codeql-config.test.ts`,
`tests/tooling/quality/test-lanes.test.ts`,
`tests/tooling/quality/toolchain-config.test.ts`,
`tests/tooling/quality/typescript-gates.test.ts`,
`tests/tooling/releases/release-notes.test.ts`,
`tests/tooling/releases/publication.test.ts`,
`tests/tooling/submissions/markdown.test.ts`,
`tests/tooling/submissions/pull-requests.test.ts`,
`tests/tooling/submissions/issue-forms.test.ts`,
`tests/tooling/submissions/issue-feedback.test.ts`,
`tests/tooling/submissions/issue-workflow.test.ts`,
`tests/tooling/licenses/bundled-notices.test.ts`,
`tests/tooling/distribution/host-distribution.test.ts`,
`tests/tooling/distribution/host-metadata.test.ts`,
`tests/tooling/distribution/icon-packaging.test.ts`,
`tests/tooling/distribution/physical-payloads.test.ts`,
`tests/tooling/distribution/plugin-distribution.test.ts`,
`tests/tooling/distribution/skill-presentation.test.ts`,
`tests/tooling/distribution/skill-questions.test.ts`,
`tests/tooling/distribution/thin-plugin-metadata.test.ts`,
`tests/tooling/distribution/thin-plugin-payloads.test.ts`,
`tests/tooling/distribution/version-agreement.test.ts`,
`tests/gateway/owned-tool-arguments.test.ts`,
`tests/host-plugins/payload-integrity.test.ts` and
`tests/host-plugins/payload-filesystem.test.ts`, plus exactly
`tests/gateway/targets/port-and-endpoint-admission.test.ts`,
`tests/gateway/targets/chrome-profile-argument.test.ts`,
`tests/gateway/targets/data-isolation.test.ts`,
`tests/gateway/targets/structured-launch.test.ts`,
`tests/gateway/targets/chromium-features.test.ts`,
`tests/gateway/targets/chrome-profile.test.ts` and
`tests/gateway/targets/chrome-launch.test.ts`,
`tests/gateway/connections/directory-lifetime.test.ts`,
`tests/gateway/connections/directory-operation-evidence.test.ts` and
`tests/gateway/targets/directory-admission.test.ts`,
`tests/gateway/connections/construction-cleanup.test.ts` and
`tests/gateway/connections/gateway-cleanup.test.ts`, plus exactly
`tests/gateway/official/options.test.ts`,
`tests/gateway/official/execution.test.ts`,
`tests/gateway/official/server-arguments.test.ts` and
`tests/gateway/official/server-arguments-environment.test.ts`, followed by exactly
`tests/gateway/official/package-files.test.ts`,
`tests/tooling/security/official-inputs.test.ts`,
`tests/tooling/security/lock-inventory.test.ts`,
`tests/tooling/security/registry-reports.test.ts`,
`tests/tooling/security/vulnerability-reviews.test.ts`,
`tests/tooling/security/installation-policy.test.ts`,
`tests/tooling/security/installed-tree.test.ts`,
`tests/tooling/security/fingerprints.test.ts`,
`tests/tooling/security/dependency-scan.test.ts`,
`tests/tooling/security/standalone-build.test.ts` and
`tests/tooling/quality/temporary-directory-alias.test.ts`, plus exactly
`tests/gateway/targets/target-lifecycle.test.ts`,
`tests/gateway/targets/lifecycle-rollback.test.ts`,
`tests/gateway/targets/observer-cleanup.test.ts` and
`tests/gateway/targets/close-diagnostics.test.ts`, followed by exactly
`tests/gateway/connections/cleanup.test.ts`,
`tests/gateway/connections/connection-options.test.ts`,
`tests/gateway/connections/execution-detachment.test.ts`,
`tests/gateway/connections/registration-administration.test.ts`,
`tests/gateway/connections/roots-admission.test.ts` and
`tests/gateway/connections/scoped-restart.test.ts`, followed by
`tests/gateway/official/upstream.test.ts`,
`tests/gateway/official/catalog-refresh.test.ts` and
`tests/gateway/official/upstream-lifetime.test.ts`, then
`tests/host-plugins/user-intent.test.ts`. These seventy-seven selectors
include thirty-one Gateway suites and run files sequentially
with `--test-concurrency=1`. This default local lane does not launch
GUI fixtures. Keep coverage floors at 52% lines, 71% branches, and 61% functions
across production modules.

Changes to default or coverage selection must update both independent contracts:
[tests/tooling/quality/toolchain-config.test.ts](../../tests/tooling/quality/toolchain-config.test.ts) keeps the two
literal command expectations; [tests/tooling/quality/test-lanes.test.ts](../../tests/tooling/quality/test-lanes.test.ts)
keeps the safe inventory, GUI and coverage contracts. Update both with package
scripts and the current test map, preserving sequential files and coverage floors.

GUI-opening tests must skip successfully in default local hooks, scripts and
direct Node invocations. Authorization comes only from the exact command-line
parameter `--allow-gui` (`-AllowGui` for direct PowerShell GUI entries).
CI/environment variables, display availability and the current platform never
authorize GUI execution. CI passes the parameter explicitly and must run the
existing GUI acceptance lanes. Developing, modifying and verifying GUI tests
locally is permitted with explicit opt-in; routine local verification stays GUI-free.

Run `pnpm test:windows:interactive --allow-gui` from an interactive Windows
desktop for the eighteen cases in `tests/interactive/*.test.ts`. Its native
TypeScript runner uses `node:test.run` with file concurrency 1 and forwards
argv to each subprocess. Without authorization, the runner returns a visible
successful skip before selecting files; each file also skips its individual
cases without authorization, including direct `node --test` invocations.
After opt-in, non-Windows fails and only the existing 8.3-alias prerequisites
permit conditional case skips. Preserve native assertions, deadlines and normal
Close with actual-exit evidence. See the
[interactive test inventory](../../tests/interactive/README.md).

Real GUI smoke entrypoints also require `--allow-gui` before acquiring app or
fixture resources, removing only that flag and preserving their remaining
arguments. Compile-only PowerShell helpers, passive read-only observations and
pure official-catalog listing require no GUI permission. The direct
`windows-window-evidence.ps1` entry requires `-AllowGui` for Minimize, Restore,
Foreground and Background before identity validation or native acquisition;
its None mode remains passive and ungated. Authorized TypeScript callers forward
that flag only on mutation paths, deriving it from their explicit CLI permission.
The application probes
for Tauri/Electron remain opt-in development evidence; this rule adds no CI
application acquisition or toolchain. Windows CI requires real owned native
regressions and the separate genuine Windows official/recovery Chrome job.
Record actual execution separately from these configured requirements.

Run focused Node tests, then pnpm verify:push: formatting, lint, strict typecheck, syntax,
coverage, repository audit, deterministic build, distribution, and Git rules.
Local `verify:push` and the pre-push hook use the default coverage lane, so they
do not require an interactive desktop. They do not run the interactive Windows
lane or establish its acceptance. Record local commands and results separately
from any explicit interactive run and the remote Windows tests result; include
the tested commit and any prerequisite skips or remaining limits in that evidence.
pnpm build:plugin regenerates committed thin payloads; check:build is read-only.
pnpm check:app verifies App bundle/native input/license composition without writing;
build:app stages explicitly supplied verified archives into a fresh directory.
pnpm build:security regenerates the standalone audit entry;
check:security:build is an offline, read-only comparison in verify:push.

`pnpm smoke:official --stage <verified-App-stage>` explicitly verifies and uses
App-delivered ordinary Node and original public Server. The mutually exclusive
`--installed` mode explicitly verifies the reviewed repository package and current
supported ordinary Node for independent release/catalog evidence. No default or
fallback mode exists. Both use a temporary home/cwd and empty PATH, invoke no
browser tools and normally dispose the actual child. Installed mode does not
establish App/native delivery acceptance.

Actual host Marketplace/instructions smokes remain explicit in `tests/smoke/`.
They use disposable configuration and synthetic loopback models for discovery,
complete instructions and explicit native HTTP tool-call checks against an
already running App. No target is launched by these host-only scenarios. Preserve
user configuration, global Skills and old state. Historical
Windows baselines are Codex CLI 0.160.0 and Claude Code 2.1.283; the metadata
follow-up ran 0.161.0 and 2.1.294, not the older versions. These executables are
not installed by CI. See [host metadata](../evidence/host-plugin-research.md) for the dated
primary sources, exact temporary Skill guards, Windows read-only global discovery
and public catalog HTTP limits, and separate manual Desktop acceptance. CLI
metadata and explicit model context cannot substitute for that UI evidence.
Static audits, generated comparisons and shared runtime regressions validate both
host payloads. Actual browser and host acceptance require their own evidence.
[Windows Chrome acceptance](continuous-integration.md#real-chrome-and-failure-diagnostics)

Host metadata changes follow the
[research policy](documentation.md#host-metadata-research) before implementation.
Check each host's exact inventory independently and compare all maintained shared
Skill files in both directions; only exact declared host overlays are excluded.
The approved PNG profile and asset integrity checks are repository quality
requirements, independent of public directory submission rules.

After trusted installation and before committing or pushing, follow the
per-worktree hook procedure for the actual generated entry and push evidence.
[Local Git hook initialization](git-environment.md#local-git-hook-initialization)

## Maintained TypeScript

Maintained runtime, tools, tests, fixtures, smoke and commitlint configuration
are TypeScript. Supported Node 24 releases run their erasable syntax natively.
The shared tsconfig uses strict NodeNext, noEmit, explicit TypeScript extensions,
verbatimModuleSyntax, erasableSyntaxOnly, noUncheckedIndexedAccess and
exactOptionalPropertyTypes. allowJs and skipLibCheck are false. No tsx,
ts-node, transpilation test framework, aliases, enums, parameter properties or
runtime namespaces are allowed. Owned boundary types and validation of unknown
external data are required; broad any, suppression comments, double assertions
or production exclusions must not hide migration errors.

`pnpm typecheck` is independent of esbuild. Babel parses original TypeScript for
AST and syntax checks, including type-only dependencies. Use `node --check` only
for generated JavaScript. The App build emits JavaScript and packages its
external runtime inputs separately. The standalone auditor ships
self-contained JavaScript. Installation must work without TypeScript or project
dependencies.

## Remote enforcement

Before changing CI workflows, jobs, required checks, diagnostic uploads, scans
or monitoring configuration, read the [CI policy](continuous-integration.md).
Record local default and pre-push results separately from remote interactive,
real Chrome and App/native acceptance.
