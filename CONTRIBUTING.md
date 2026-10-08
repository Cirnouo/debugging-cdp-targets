# Contributing

Bug reports, documentation improvements, and focused code contributions are
welcome. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report suspected
vulnerabilities through the private channel in [SECURITY.md](SECURITY.md).

## Prepare a checkout

Fork the repository and clone your fork. Install Node 24.21.0 and pnpm 12.4.2;
the versions are also declared in mise.toml. Complete the
[trusted installation sequence](docs/policies/supply-chain.md#installation-and-scan-order)
in every clone and linked worktree. From its root, run:

```powershell
node tooling/security/dist/check-security.mjs --phase lockfile --root .
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:security
pnpm install --frozen-lockfile
pnpm rebuild --pending
```

The security checks require the public npm registry and network access. Review
the [supply-chain policy](docs/policies/supply-chain.md) if a check fails. Do not
repair the lock automatically or bypass installation trust. The ordinary
installation permits the reviewed build script; the pending rebuild completes
scripts deferred by the script-disabled install, including root `prepare`.
Then follow the
[per-worktree hook policy](docs/policies/quality.md#local-git-hook-initialization):
check `git config --show-origin --get core.hooksPath` and confirm that
`.husky/_/pre-push` exists in this worktree. If trusted setup did not generate
it, run `pnpm prepare` and check again, preserving existing Git configuration.
The ignored `.husky/_` directory is not copied from another checkout; a manual
`pnpm verify:push` result alone does not prove that the push hook will run.

Before an SSH push, follow the
[SSH push initialization policy](docs/policies/quality.md#ssh-push-initialization)
to configure and verify the fixed keepalive settings in this clone. Preserve
existing SSH commands and identity/proxy options when adding them.

## Submit an Issue

Use the [Bug form](.github/ISSUE_TEMPLATE/bug_report.yml) for reproducible unexpected
behavior or the [Feature form](.github/ISSUE_TEMPLATE/feature_request.yml) for a
problem and proposed behavior. The current YAML forms own the field headings,
order, required answers, dropdown choices, and corresponding `template:` labels.
Keep the generated H3 fields when editing the body, including optional fields;
optional answers may be empty or `_No response_`. Apply only the corresponding
form label when submitting a typed Issue through another interface. See the
[typed Issue policy](docs/policies/commits-and-scope.md#typed-issue-submissions)
and [Agent submission rules](AGENTS.md#issue-submissions).

The [remote Issue workflow](.github/workflows/issues.yml) reads the latest Issue
and reports structural form errors with a `template: invalid` label and an owned
bot comment. Edit the body or its form label to rerun validation. A repair clears
that diagnostic label and updates the existing comment to resolution. Ordinary
Issues and fresh valid typed Issues receive no new comment. Configuration or
GitHub API failures are reported as automation failures; see the
[typed Issue policy](docs/policies/commits-and-scope.md#typed-issue-submissions)
for classification, label provisioning and stale-state limits.

Ordinary freeform Issues remain available and exempt from the typed form policy.
Remove tokens, cookies, private page content, and personal paths from public
examples. Report suspected vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Make a focused change

Start with [AGENTS.md](AGENTS.md), the nearest source AGENTS.md, and the policies
relevant to your change. These files remain the authoritative contributor rules.
See [source ownership](src/README.md), [tests](tests/README.md), and
[tooling](tooling/README.md) for navigation.

Before implementing a new host or changing a metadata contract, follow the
[host research policy](docs/policies/documentation.md#host-metadata-research).
The [host metadata record](docs/host-metadata.md) owns primary sources, adopted
fields and the distinction between CLI proof and manual Desktop acceptance.

The accepted [data directory isolation design](docs/adr/0015-explicit-data-directory-isolation.md)
governs the runtime boundary. Review its intent-first research, existing/new
directory operations, connection leases across restart, deletion authorization,
late-acquisition safety and explicit path evidence before changing those boundaries.
Use the [domain glossary](docs/domain-language.md) for terminology and the
[security policy](docs/policies/security.md#data-directory-isolation-boundary)
for the required ownership and disclosure constraints.

Create a topic branch allowed by the [branch and commit policy](docs/policies/commits-and-scope.md),
using `feat/` for new functionality, `fix/` for defects, `hotfix/` for urgent
fixes, or `chore/` for standalone documentation, refactoring, tests, CI, and
other maintenance. Follow the prefix with a lowercase kebab-case topic, for
example `fix/describe-the-problem`. Choose it for the task's overall purpose
and classify individual commits independently; a `docs(governance): ...`
commit may belong on `chore/branch-policy`.

Optional `release/<semver>` branches prepare a release. Formal publication
requires separately authorized annotated stable tags under the
[release policy](docs/policies/releases.md). Discuss a substantial design or
behavior change in an issue before investing in its implementation. Preserve
unrelated work and add a failing regression test before changing behavior.

Run the affected tests first, followed by the complete local verification:

```powershell
node --test tests/target-recovery.test.ts
pnpm verify:push
```

Choose the focused test appropriate to your change. Dependency and build-input
changes also require `pnpm check:security`. When runtime source changes,
regenerate the committed distribution with `pnpm build:plugin`, then verify it
with `pnpm check:build` and the complete verification suite.

Real browser integration is separate from ordinary tests. Follow
[the smoke instructions](tests/smoke/README.md); use only newly launched isolated
targets and agree to normal Close cleanup before running them.

## Submit a pull request

Target main and use a PR title accepted by the commit policy, for example
`fix(target): reject stale session identity`. Read the current
[PR template](.github/PULL_REQUEST_TEMPLATE.md) before creating or editing the
description and follow the [Agent submission rules](AGENTS.md#pull-request-submissions).
The [submission and commit policy](docs/policies/commits-and-scope.md) owns the
required structure, evidence, conditional N/A reasons, 100-character limits,
generated squash suffix, and optional Issue trailers. Update relevant documentation
and meaningful user-facing changes in the Unreleased changelog.

The remote Commit messages check rejects a current PR that omits required
template content or fails commitlint. A failure blocks merge. Fix the reported
errors in the PR title or body; editing reruns the existing check. The body format
check runs after GitHub receives the submission.

The main Ruleset requires an up-to-date PR and successful required GitHub checks.
The maintainer reviews contributions and merges with squash, checking the actual
merge message with GitHub's generated PR number. Current single-maintainer settings
require no additional approving reviewer. Local Git hooks complement the remote checks.

Keep version 0.1.0 unreleased. Pushing, creating releases or tags, and changing
repository or user configuration require the authorization described in
AGENTS.md and the [release policy](docs/policies/releases.md).

Maintained packaging inputs live in `packaging/codex/`, `packaging/claude-code/`
and `packaging/shared/`.
Edit those inputs or `src/`, then run `pnpm build:plugin` to regenerate the complete
`plugins/codex/debugging-cdp-targets/` and
`plugins/claude-code/debugging-cdp-targets/` payloads. Root `LICENSE` is canonical;
`pnpm check:build` compares every generated payload file without writing.

The host-specific manifest and default component paths follow their respective
host interfaces. The separate input/output trees are this repository's maintenance
convention, recorded in [ADR 0012](docs/adr/0012-peer-host-distributions.md).
Both hosts share one runtime build, complete Skill and official release evidence.
Declared host-only presentation overlays supplement the exact shared maintained
Skill set; they do not replace shared instructions.
Each delivered payload must work independently outside repository dependencies.
Run the explicit Codex and Claude Marketplace/Hook smokes after changing host
configuration; ordinary tests and CI keep real host invocations opt-in.
