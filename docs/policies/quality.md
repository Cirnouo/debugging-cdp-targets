# Quality, hooks, and CI

Use four spaces, UTF-8, LF, a final newline, and no tabs. Biome formats/lints
JavaScript and JSON; repository text checks cover YAML, Markdown, PowerShell,
TOML, and shell. Generated lockfile indentation is exempt.

Develop changed behavior test-first. Regression tests use isolated fake CDP
targets; never download packages or launch user browsers in the default suite.
Explicit integration smoke commands are separate. Keep coverage floors at
52% lines, 71% branches, and 61% functions across production modules.

Run focused Node tests, then pnpm verify:push: formatting, lint, syntax,
coverage, repository audit, deterministic build, distribution, and Git rules.
pnpm build:plugin regenerates committed bundles; check:build is read-only.
pnpm build:security regenerates the standalone audit entry;
check:security:build is an offline, read-only comparison in verify:push.

Husky commit-msg checks commitlint, skipping merges only with real MERGE_HEAD.
pre-commit uses lint-staged's default stash/partial-staging protection; safe
Biome writes are limited to staged JS/JSON, other text is audited read-only.
pre-push runs verify:push. --no-verify and HUSKY=0 can bypass local hooks.

CI uses frozen pnpm installs, read-only permissions, full-SHA Actions, and
cancellation of superseded ref runs. Commit messages validates topology, PR
titles, and source branches; Quality checks policy and coverage; Windows tests
parses the helper with PS 5.1/7 and tests arbitrary cwd; Portable tests exercises
fake CDP on Linux/macOS. No account data or profiles are uploaded.

After CI succeeds on GitHub, the user may enable a main Ruleset requiring PRs,
up-to-date branches, linear history, no force pushes/deletion, and strict
required checks: Commit messages, Quality, Windows tests, and both Portable
tests matrix checks. Keep squash merge only. Actions runs after GitHub accepts
a push, not before; pre-push is the local pre-transfer gate. This change does
not alter GitHub settings.

Supply chain security is the first CI gate: dependency-free lockfile preflight
with full vulnerability/signature audits, script/hook-disabled frozen install,
installed-tree verification, repeat audits and reproducible audit tooling, with
narrowly reviewed exceptions
under [supply-chain policy](supply-chain.md). Commit messages and Quality require
its success before normal installation/builds. Add Supply chain security to the
future strict required checks. `pnpm check:security` requires network access and
is deliberately separate from offline regression tests and verify:push.
