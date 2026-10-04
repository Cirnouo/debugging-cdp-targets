# Quality, hooks, and CI

Use four spaces, UTF-8, LF, a final newline, and no tabs. Biome formats/lints
TypeScript, generated-compatible JavaScript and JSON; repository text checks cover YAML, Markdown, PowerShell,
TOML, and shell. Generated lockfile indentation is exempt.

Only the official release subtree verified against maintained release evidence
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
Server. It copies the Plugin outside node_modules, uses a temporary home and empty
PATH, invokes no browser tools, and shuts the child down normally through stdin.

Husky commit-msg checks commitlint, skipping merges only with real MERGE_HEAD.
pre-commit uses lint-staged's default stash/partial-staging protection; safe
Biome writes are limited to staged TS/JS/JSON, other text is audited read-only.
pre-push runs verify:push. --no-verify and HUSKY=0 can bypass local hooks.

CI uses frozen pnpm installs, read-only permissions, full-SHA Actions, and
cancellation of superseded ref runs. Commit messages validates topology, PR
titles, and source branches; Quality checks policy and coverage; Windows tests
parses the helper with PS 5.1/7 and tests arbitrary cwd; Portable tests exercises
fake CDP on Linux/macOS. No account data or profiles are uploaded.

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
It has no routine bypass actors. Single-maintainer PRs require zero additional
approvals. Only squash merges are allowed, using the PR title as commit title.
Actions runs after GitHub accepts a push; pre-push is the local pre-transfer gate.

Supply chain security is the first CI gate: dependency-free lockfile preflight
with full vulnerability/signature audits, script/hook-disabled frozen install,
installed-tree verification, repeat audits and reproducible audit tooling, with
narrowly reviewed exceptions
under [supply-chain policy](supply-chain.md). Commit messages and Quality require
its success before normal installation/builds. `pnpm check:security` requires network access and
is deliberately separate from offline regression tests and verify:push.
