# Quality, hooks, and CI

Use four spaces, UTF-8, LF, a final newline, and no tabs. Biome formats/lints
TypeScript, generated-compatible JavaScript and JSON; repository text checks cover YAML, Markdown, PowerShell,
TOML, and shell. Generated lockfile indentation is exempt.

Original upstream bytes are verified against maintained release evidence by the
actual App/Official package consumers. Retired thin-host `dist/` paths receive no
repository formatting or directory-map exemption: staged checks refuse them
before release-evidence reads, and the walker also applies ordinary filename,
text and directory checks. Only `tooling/security/dist/check-security.mjs` keeps
its existing generated-text exemption. All delivered JavaScript still receives
Node syntax checks. Root and isolated pnpm locks retain pnpm's format.

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

CI also runs `Node compatibility (24.x)` on `ubuntu-latest` after Quality succeeds.
It uses exact pnpm 12.4.2 and `setup-node` with `node-version: '24.x'` and
`check-latest: true` to select the newest available stable Node 24 release,
including when the runner cache has an older match; see the reviewed action's
[versioned check-latest documentation](https://github.com/actions/setup-node/blob/820762786026740c76f36085b0efc47a31fe5020/docs/advanced-usage.md#check-latest-version).
After a normal frozen install, it runs `pnpm typecheck`, `pnpm test`,
`pnpm check:build`, `pnpm check:security:build`, `pnpm check:app` and
`pnpm smoke:official --installed` in order.
This lane establishes Ubuntu compatibility for the default regressions, generated
build comparisons and reviewed installed original official catalog with normal
stdio shutdown. It does not establish App-delivery/native acceptance.
It launches no GUI and does not establish latest-24 Windows or browser
acceptance. The existing canonical jobs retain exact Node 24.21.0 and their
acceptance checks. See [Remote enforcement](#remote-enforcement) for the
separate merge requirements.

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
Current CI defines the Windows real-Chrome replacement described below. Static
audits, generated comparisons and shared runtime regressions validate both host
payloads without establishing actual browser or host acceptance.

Host metadata changes follow the
[research policy](documentation.md#host-metadata-research) before implementation.
Check each host's exact inventory independently and compare all maintained shared
Skill files in both directions; only exact declared host overlays are excluded.
The approved PNG profile and asset integrity checks are repository quality
requirements, independent of public directory submission rules.

Husky commit-msg checks commitlint, skipping merges only with real MERGE_HEAD.
pre-commit uses lint-staged's default stash/partial-staging protection and
4096-character command batches to accommodate Windows launcher expansion; safe
Biome writes are limited to staged TS/JS/JSON, other text is audited read-only.
The text hook refuses selected retired thin-host runtime paths before any
release-evidence read. Original-byte proof remains with the actual App/Official
verifiers; there is no inferred App-stage text exemption.
pre-push clears Git's repository routing variables before running verify:push,
so disposable Git fixtures cannot modify the repository that invoked the hook.
--no-verify and HUSKY=0 can bypass local hooks.

## Windows worktree long-path initialization

Before creating a linked worktree on Windows, require effective
`core.longpaths=true` for Git for Windows. Its
[long-path support](https://gitforwindows.org/git-cannot-create-a-file-or-directory-with-a-long-path.html)
is opt-in and covers native C-based Git commands; scripted commands and other
Windows programs can still have path limits.

A longer worktree root can make checkout fail with `Filename too long` even
when the main checkout works. This occurred in the unchanged official Server's
deep issue-description tree with `core.longpaths` unset; enabling it locally
allowed the managed worktree retry to succeed. Preserve the complete official
release rather than renaming, omitting or shortening its paths.

From the repository root, inspect the effective value and its source before
creating the worktree:

```powershell
git config --show-scope --show-origin --get core.longpaths
```

If unset or false, enable the repository-local setting and verify again:

```powershell
git config --local core.longpaths true
git config --show-scope --show-origin --get core.longpaths
```

Require the final effective value to be `true`. This setup is per clone;
Git [shares repository configuration across worktrees by default](https://git-scm.com/docs/git-worktree.html#_configuration_file).
Preserve and resolve existing worktree, command or environment overrides so
the actual worktree-creation invocation also sees `true`. Do not change global
or system Git settings or the Windows registry for this setup.

After a failed checkout, inspect `git worktree list --porcelain` and the actual
failed location and registration before retrying. Preserve unrelated work;
use the owning tool's managed lifecycle to clean up and retry tool-owned
worktrees. For a manually created disposable worktree, verify the exact target
and use normal Git worktree cleanup. Do not use force, reset, clean or recursive
deletion to recover from this failure.

## Local Git hook initialization

After completing the [trusted installation sequence](supply-chain.md#installation-and-scan-order),
initialize and verify Husky in every clone and linked worktree before committing
or pushing. The tracked `.husky/pre-push` is reached through the generated
`.husky/_/pre-push`; `.husky/_` is ignored and is not copied into a new worktree.
`--ignore-scripts` skips the root `prepare` script, so the shared Git
`core.hooksPath` setting can exist while that worktree's generated entry is absent.

Check `git config --show-origin --get core.hooksPath` and the actual hook entry in
the current worktree. This repository uses `.husky/_`. If initialization is
missing after the trusted ordinary install, run `pnpm prepare` and check again.
Preserve existing Git configuration: resolve an unexpected hook path before
running setup that would replace it; do not silently change user/global settings.
Also check that `HUSKY=0` and script-disabling settings are not bypassing setup.

Do not push with a missing or bypassed hook. A manual `pnpm verify:push` success
is useful validation but does not establish that Git will invoke `pre-push`.
Retain the actual push output and distinguish a hook verification failure from
a remote transfer failure; never report an absent hook as a successful hook run.

## SSH push initialization

For this repository's SSH pushes using OpenSSH, require `ServerAliveInterval=30` and
`ServerAliveCountMax=3` before starting Git. These are repository choices using
the [OpenSSH server-alive options](https://man.openbsd.org/ssh_config.5#ServerAliveInterval):
send encrypted keepalive requests after 30 seconds without received data and
disconnect after three unanswered requests. This protects idle transport during
the lengthy pre-push verification; it does not remedy initial connection timeouts.

Git's [core.sshCommand](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresshCommand)
can persist these options locally. This setting is not cloned, so complete this
initialization in every clone and verify the effective command in each worktree.
Inspect `git config --show-scope --show-origin --get core.sshCommand`,
`ssh.variant`, and the current process's `GIT_SSH_COMMAND`, `GIT_SSH` and
`GIT_SSH_VARIANT` before changing configuration. Git documents its
[SSH environment precedence](https://git-scm.com/docs/git#Documentation/git.txt-GITSSHCOMMAND);
the command order is `GIT_SSH_COMMAND`, effective `core.sshCommand`, `GIT_SSH`,
then `ssh`. A new local command must not hide an existing `GIT_SSH` wrapper.

When the effective client is ordinary OpenSSH with no custom command or wrapper,
run this from the clone root:

```powershell
git config --local core.sshCommand "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3"
git config --show-scope --show-origin --get core.sshCommand
```

If an existing command selects an executable, configuration, identity, proxy or
wrapper, preserve it and add the two options to its actual OpenSSH invocation.
Replace conflicting occurrences rather than appending duplicates: OpenSSH uses
the first obtained value. Ensure any higher-priority environment or worktree
override also has these settings. Other SSH clients require their own supported
equivalent; do not pass OpenSSH options to them or replace them silently. Do not
change global Git or SSH configuration for this repository setup.

Verify the effective OpenSSH executable and all existing options with `-G`, using
the actual push remote's user, host alias and port. For the ordinary GitHub case:

```powershell
ssh -G -o ServerAliveInterval=30 -o ServerAliveCountMax=3 git@github.com
```

Inspect the local output for `serveraliveinterval 30` and `serveralivecountmax 3`.
Keep initialization outside `pre-push`: Git has already opened its transport
before that hook runs, so a configuration change there cannot affect that push.
Retain the actual push and hook results under the preceding hook policy.

## Remote enforcement

CI uses frozen pnpm installs, read-only permissions, full-SHA Actions, and
cancellation of superseded ref runs. Commit messages validates topology, raw PR
titles, predicted final squash headers with the actual PR number, and source
branches. For current PR events it independently validates the complete body
against the current PR template. PR Markdown is not a commitlint body; commit
body/footer width and separator rules do not apply to the description.
Required sections, checklists, actual verification evidence, and conditional N/A
reasons follow the [submission policy](commits-and-scope.md). Format failure
blocks merge; editing the PR body reruns Commit messages through the existing
`edited` trigger. PR CI cannot prevalidate the future curated squash body. Before
merging, validate the exact final candidate through raw stdin and compare its
header with the validated title plus the actual PR suffix under the submission
policy. Local/push/scheduled history audits continue to validate original actual
commit messages strictly, without applying the current PR template, rewriting
messages or granting historical exemptions.
Quality checks policy and default-lane coverage. The required Windows tests job
waits for Quality, then runs `pnpm test` and `pnpm test:windows:interactive --allow-gui` as
separate mandatory steps after `pnpm typecheck`, without job/step conditions or
`continue-on-error`. It also parses the helper with PS 5.1/7 and tests arbitrary
cwd. Shared default/coverage regressions and their sequential selection retain
the 52/71/61 floors. Local default-lane success does not substitute for the
remote interactive result. No account data or profiles are uploaded.

The separate `Real Chrome (windows-latest)` job runs unchanged official tools
and connection recovery on `windows-latest`, within its existing 20-minute
budget. It depends on Quality, has no optional job condition or matrix, and
explicitly passes `--allow-gui` once to each smoke. After frozen installation and
typecheck, it initializes the current diagnostics collection, then calls
`requireChromeSmokeExecutable()` for the configured
`C:/Program Files/Google/Chrome/Application/chrome.exe`. Actual runner availability
is unknown until execution. Missing/nonregular Chrome fails before profile or
target acquisition; no alternate installation, acquisition, retry, ignored
failure or increased timeout is allowed. The real Core/SDK HTTP source fixture
uses verified ordinary Node and original Server bytes. Synthetic pages/profiles,
process/listener/endpoint identity, normal Close, actual exit/deletion and Windows
console-monitor assertions remain mandatory. Same-commit reusable release CI
includes both actual smokes; static or simulated checks cannot replace them.
This fixture evidence does not qualify the GUI App, native installer, default
admission or Windows arm64 delivery.

PowerShell joins the dedicated diagnostics path under `RUNNER_TEMP` and captures
init status immediately. `initialized=true` requires successful initialization
and one valid fresh UUID; refusal reports false and clears the collection ID.
Only this non-authoritative metadata step explicitly succeeds after handling its
status. Stage metadata failure cannot skip actual acceptance. Each blocking
preflight/smoke immediately preserves and checks its own native exit before a
later command can mask it. Failure of official tools leaves recovery not-run.
There are no job/step `continue-on-error` exceptions.

The ordinary controlled real Chrome job may upload diagnostic artifacts only
on failure with successful current initialization, using the reviewed
[official upload-artifact v7.0.2 commit](https://github.com/actions/upload-artifact/tree/cf430e030ddbb5b0abf93d22962f4752f3646cd9).
The exact allowlist is `job-index.json`, `official-server.events.ndjson`,
`official-server.summary.json`, `entry-recovery.events.ndjson` and
`entry-recovery.summary.json` under the separate runner-temp directory. Retain
seven-day expiry, no hidden files, no overwrite and no directory wildcards.
All other jobs remain artifact-free. The failure summary still runs when init
failed, showing only the current-collection limitation and excluding earlier
files. Valid current summaries index safe filenames, primary failure, bounded
progress and an artifact link when available.

These records contain closed safe stage/outcome metadata, UUIDs, numbers and
bounded allowlisted error cause codes. They exclude raw errors, messages/stacks,
gateway/browser stderr, tool/page content, HTTP headers/bodies, environment, argv,
process tables, lock content, hostnames and private paths. Accepted collections
can project bounded private Chrome logs to safe categories/counts and limitation
flags. Raw files stay outside profiles and the exact upload list; logging has
no inherent write cap. Scratch deletion still requires successful acceptance and
all existing cleanup proofs. Missing/unmatched logs establish no cause; optional
capture failure cannot change acceptance.

The test-only real-core SDK HTTP fixture remains outside production delivery,
with a safe subscriber preload. Sealed comparison binds its clean source and
complete App stage; development receipts say dirty. Fixture exit never proves
App GUI/exit acceptance. Streaming has fixed record/event/byte caps and exposes
rejection, truncation or write limitations. Both owned smoke children omit
inherited `NODE_OPTIONS`. Dependency-free init creates the five files and both
not-run envelopes before browser prerequisites; fresh ownership refuses prior
evidence. Stage, smoke and summary carry its UUID. Refused earlier files cannot
be uploaded or presented as current. The parent owns failure summaries; final
and interrupted presentation derive safe child progress from the bounded stream.
Diagnostic durations and remaining budgets use monotonic elapsed time without
changing the production readiness predicate or wall-clock deadline. Original
primary smoke failures remain primary while all cleanup assertions run in order.
Recorded checks do not establish complete lifecycle attribution or historical
root cause; real instrumentation overhead remains unmeasured. See the
[smoke inventory](../../tests/smoke/README.md#controlled-failure-diagnostics).

The portable product matrix, POSIX real-Chrome matrix and baseline
`ubuntu-startup-study` job/input are retired, including the study's special
concurrency and success-upload exception. Ordinary CI keeps cancellable
`ci-{workflow}-{ref}` concurrency. Baseline sampler/study source, projection and
controlled regression owners remain until their separate complete target-native
deletion cut. This does not authorize POSIX product execution or the cancelled
kernel diagnostic route. Keep dated failures and evidence historical. Ubuntu
security, governance, Quality, Node compatibility and CodeQL remain useful common
checks without Linux App support.

Advanced CodeQL scans maintained JavaScript/TypeScript, native C# and GitHub
Actions with security-extended queries, on main pushes, PRs and Mondays at
01:47 UTC. C# uses Windows with build-mode none and must prove unique extraction
of the native process, deployment inspector/query and deployment creator sources
from its database source archive. Source extraction does not compile their fixed
entry points or establish native execution. No product build or project
dependency install is run. CodeQL Actions use the independently reviewed official
v4 commit; only analysis jobs can write security events. Generated distribution
and unchanged upstream directories retain their distribution, integrity and
supply-chain gates rather than becoming maintained-source scan inputs.

For a forced push whose previous commit is absent from the checkout, commit
auditing requires complete history and checks every ancestor of the new head.
Ordinary pushes still require their base; missing heads and shallow fallback
checkouts fail closed. This audit behavior does not authorize rewriting history.

The tag-triggered Release workflow reuses the same-commit read-only CI gates.
Only the downstream publication job receives contents write permission, and
only its publisher step receives the built-in token. Same-tag Release runs
queue; ordinary CI still cancels superseded ref runs. Release automation follows
the separate release policy and uploads no custom assets.

Maintained runtime, tools, tests, fixtures, smoke and commitlint configuration
are TypeScript; supported Node 24 releases run their erasable syntax natively.
The shared tsconfig uses strict NodeNext, noEmit, explicit TypeScript extensions,
verbatimModuleSyntax, erasableSyntaxOnly, noUncheckedIndexedAccess and
exactOptionalPropertyTypes. allowJs and skipLibCheck are false. No tsx,
ts-node, transpilation test framework, aliases, enums, parameter properties or
runtime namespaces are allowed. Owned boundary types and validation of unknown
external data are required; broad any, suppression comments, double assertions
or production exclusions must not hide migration errors.

`pnpm typecheck` is independent of esbuild and runs before tests in Quality,
Node compatibility (24.x), Windows tests and Real Chrome (windows-latest).
Babel parses original TypeScript for AST and syntax checks, including type-only
dependencies. Node --check is used only for generated JavaScript.
Plugin and standalone auditor ship self-contained JS;
installation must not require TypeScript or project dependencies.

The active GitHub ruleset `24445278` protects `main`. It requires PRs,
up-to-date branches and linear history, blocks force pushes and deletion,
and has no bypass actors. It enforces eight required GitHub Actions checks
in strict mode.

- `Supply chain security`
- `Commit messages`
- `Quality`
- `Windows tests`
- `CodeQL (javascript-typescript)`
- `CodeQL (csharp)`
- `CodeQL (actions)`
- `Real Chrome (windows-latest)`

`Node compatibility (24.x)` runs as a separate CI job outside this required
check set. Single-maintainer PRs require zero additional approvals.
Only squash merges are allowed. The required `PR_TITLE` + `BLANK`
default starts with the PR title and an empty body; the merge author curates the
complete message and retains the generated PR number under the
[commit policy](commits-and-scope.md).
Actions runs after GitHub accepts a push; pre-push is the local pre-transfer gate.

Workflow configuration and ruleset settings are managed separately. Changes to
required checks need separate, explicit authorization. Before replacing a
required check, verify that its replacement passes under its actual context
name on the final head. Preserve all other governance restrictions and enforce
the active required checks throughout the transition. Do not use status aliases
or administrative bypass.

Successful initial CodeQL scans returned no findings and confirmed native helper
extraction; the former POSIX real Chrome jobs passed historically before their
observed names became required. That history does not prove Windows acceptance.
A code scanning rule additionally requires CodeQL results and rejects
high/critical security alerts. GitHub applies its
[code scanning alert gate](https://docs.github.com/en/code-security/concepts/code-scanning/merge-protection) to PR
findings whose reported lines are in the diff. Existing findings still require
review through code scanning alerts. The
[compatibility guide](../user-guide/compatibility.md) records the tested systems
and actual Chrome versions; local simulated tests cannot establish real acceptance.

Supply chain security is the first CI gate: dependency-free lockfile preflight
with full vulnerability/signature audits, script/hook-disabled frozen install,
installed-tree verification, repeat audits and reproducible audit tooling, with
narrowly reviewed exceptions
under [supply-chain policy](supply-chain.md). Commit messages and Quality require
its success before normal installation/builds. Weekly CI runs the same gates at
01:17 UTC on Monday. Scheduled commit auditing requires an explicit GitHub branch
ref and validates the full ancestry; it cannot infer a branch from a detached
checkout or accept contradictory identity fields, a tag ref or shallow history.
`pnpm check:security` requires network access and
is deliberately separate from offline regression tests and verify:push.
