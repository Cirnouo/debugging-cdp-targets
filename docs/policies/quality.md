# Quality, hooks, and CI

Use four spaces, UTF-8, LF, a final newline, and no tabs. Biome formats/lints
TypeScript, generated-compatible JavaScript and JSON; repository text checks cover YAML, Markdown, PowerShell,
TOML, and shell. Generated lockfile indentation is exempt.

Only each official release subtree verified against maintained release evidence
keeps upstream formatting and directory documentation. All delivered JavaScript
still receives Node syntax checks. Root and isolated pnpm locks retain pnpm's format.

Develop changed behavior test-first. Regression tests use isolated fake CDP
targets; never download packages or launch user browsers in the default suite.
Explicit integration smoke commands are separate. Keep coverage floors at
52% lines, 71% branches, and 61% functions across production modules.

Run focused Node tests, then pnpm verify:push: formatting, lint, strict typecheck, syntax,
coverage, repository audit, deterministic build, distribution, and Git rules.
pnpm build:plugin regenerates committed bundles; check:build is read-only.
pnpm build:security regenerates the standalone audit entry;
check:security:build is an offline, read-only comparison in verify:push.

`pnpm smoke:official` is a separate explicit catalog smoke of the delivered public
Server. It copies both host Plugins outside node_modules, uses a temporary home and empty
PATH, invokes no browser tools, and shuts the child down normally through stdin.

Actual host Marketplace and Hook smokes remain explicit commands in `tests/smoke/`.
They use disposable configuration and synthetic loopback models to prove host
discovery, explicitly invoked full Skill context, all four Hook boundaries, one
Stop continuation, idle-next-turn delivery and each host's disabled/untrusted
negative. Preserve user configuration, global Skills and old state. Historical
Windows baselines are Codex CLI 0.160.0 and Claude Code 2.1.283; the metadata
follow-up ran 0.161.0 and 2.1.294, not the older versions. These executables are
not installed by CI. See [host metadata](../host-metadata.md) for the dated
primary sources, exact temporary Skill guards, Windows read-only global discovery
and public catalog HTTP limits, and separate manual Desktop acceptance. CLI
metadata and explicit model context cannot substitute for that UI evidence.
Existing CI check names and real Chrome acceptance remain unchanged. Static audits,
generated comparisons and shared runtime regressions validate both host payloads.

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
The text hook exempts original upstream files only after verifying their complete
official release; altered or incomplete releases fail closed.
pre-push clears Git's repository routing variables before running verify:push,
so disposable Git fixtures cannot modify the repository that invoked the hook.
--no-verify and HUSKY=0 can bypass local hooks.

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

## Remote enforcement

CI uses frozen pnpm installs, read-only permissions, full-SHA Actions, and
cancellation of superseded ref runs. Commit messages validates topology, raw PR
titles, predicted squash messages with the PR number and original description,
and source branches. For current PR events it also validates the complete body
against the current PR template, with no history exemptions or body rewriting.
Required sections, checklists, actual verification evidence, and conditional N/A
reasons follow the [submission policy](commits-and-scope.md). Format failure
blocks merge; editing the PR body reruns Commit messages through the existing
`edited` trigger. Local/push/scheduled history audits do not apply this template.
Quality checks policy and coverage; Windows tests
parses the helper with PS 5.1/7 and tests arbitrary cwd; Portable tests exercises
fake CDP on Linux/macOS. No account data or profiles are uploaded.

Separate real Chrome jobs run official tools and connection recovery on
ubuntu-24.04 and macos-15 using explicit actual Chrome paths, temporary profiles
and synthetic local pages. Linux uses Xvfb; macOS uses ordinary Chrome. Missing
browser or inspection prerequisites fail. The scripts preserve identity checks,
normal Close and Windows visible-console monitoring. These jobs also run in
same-commit release CI; simulated tests do not substitute for real acceptance.

Advanced CodeQL scans maintained JavaScript/TypeScript, native C# and GitHub
Actions with security-extended queries, on main pushes, PRs and Mondays at
01:47 UTC. C# uses Windows with build-mode none and must prove extraction of the
native helper from its database source archive. No product build or project
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
are TypeScript; Node 24.21.0 runs their erasable syntax natively. The shared
tsconfig uses strict NodeNext, noEmit, explicit TypeScript extensions,
verbatimModuleSyntax, erasableSyntaxOnly, noUncheckedIndexedAccess and
exactOptionalPropertyTypes. allowJs and skipLibCheck are false. No tsx,
ts-node, transpilation test framework, aliases, enums, parameter properties or
runtime namespaces are allowed. Owned boundary types and validation of unknown
external data are required; broad any, suppression comments, double assertions
or production exclusions must not hide migration errors.

`pnpm typecheck` is independent of esbuild and runs before tests in Quality,
Windows tests and Portable tests. Babel parses original TypeScript for AST and
syntax checks, including type-only dependencies. Node --check is used only for
generated JavaScript. Plugin and standalone auditor ship self-contained JS;
installation must not require TypeScript or project dependencies.

The active main Ruleset requires PRs, up-to-date branches, linear history, no
force pushes/deletion, and strict GitHub Actions checks: Supply chain security,
Commit messages, Quality, Windows tests, and both Portable tests matrix checks.
It also requires CodeQL (javascript-typescript), CodeQL (csharp), CodeQL (actions),
Real Chrome (ubuntu-24.04) and Real Chrome (macos-15), for eleven checks total.
It has no routine bypass actors. Single-maintainer PRs require zero additional
approvals. Only squash merges are allowed, using the PR title and generated PR
number as the commit title under the [commit policy](commits-and-scope.md).
Actions runs after GitHub accepts a push; pre-push is the local pre-transfer gate.

Successful initial CodeQL scans returned no findings and confirmed native helper
extraction; both real Chrome jobs passed on GitHub before promoting their observed
check names. A code scanning rule additionally requires CodeQL results and rejects
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
