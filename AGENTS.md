# Contributor entry point

Use four spaces, UTF-8, LF, and no tabs. Preserve unrelated work. Before editing,
read applicable ancestor and local AGENTS.md files together, plus only the
relevant policies. Local instructions do not replace parent instructions.

Before editing AGENTS/Skill instructions, references or their layout/loading
rules, read the [instruction progressive-disclosure policy](docs/policies/documentation.md#instruction-progressive-disclosure).

Use `feat/`, `fix/`, `hotfix/`, or `chore/` with a lowercase kebab-case topic
for the task's overall purpose. Standalone documentation, refactoring, tests,
CI, and other maintenance use `chore/`; classify each commit independently.
Before choosing a branch or preparing a commit, read the
[branch and commit policy](docs/policies/commits-and-scope.md) for complete grammar
and release-branch rules. Before release preparation, tagging or publication,
read the [release policy](docs/policies/releases.md); publication requires
separately authorized annotated stable or prerelease tags.

## Boundaries

- The reusable stdio gateway relays official MCP tools and results using
  the official SDK. Seven MCP lifecycle/operation tools extend it; status also
  carries automatic Hooks. Fixed official catalog variants and per-connection
  enablement follow ADR 0011. Do not create custom DevTools tools, a plugin CLI,
  dedicated control IPC, or persistent session state.
- Manage one newly launched target per connection. Verify process, listener,
  and endpoint identity; bind only loopback. Never take over existing targets.
- Create one independent official MCP connection per new target, without a
  fixed connection limit. Official tools require _dct connection/session routing;
  remove it before forwarding original arguments. Reject stale identities.
- Ask Close/Keep before ending a target's task. Keep retains target and upstream;
  Close normally closes only that connection while preserving the gateway.
  Every control request identifies the entry; restart/end-task/stop also identify
  connection and session. Status optionally selects a connection; start creates
  one. Status/start forbid session identity; only stop takes disposition.
- Keep 0.1.0 unreleased. Never push, publish, tag, open a PR, or modify user
  config/global Skills/old state without explicit authorization.
- Redact tokens, cookies, private page content and personal paths from public
    submissions; report suspected vulnerabilities privately through
    [SECURITY.md](SECURITY.md).
- Launch through structured executable/args/cwd/env and native platform support.
  Windows privilege detection and one-shot elevation helpers belong to the
  plugin; manage the actual app PID/time/handle. Never force-kill applications.
  Keep authorization waiting separate from CDP readiness. Quarantine timed-out
  upstreams and clear pending transport state; never restart/replay automatically.
- Implement the accepted [isolation design](docs/adr/0015-explicit-data-directory-isolation.md)
    with required start intent, researched application binding and no fixed Chrome
    profile fallback. Data directories have connection-level leases across restart;
    preauthorized whole-directory cleanup waits for all live/pending app and resource
    users. Keep path evidence in explicit operation metadata/selected configuration,
    never automatic Hooks or default summaries.

## Navigation and commands

Before editing `CHANGELOG.md`, read the
[changelog editing workflow](docs/policies/releases.md#changelog-editing-workflow).
Before creating or editing a PR, read the current
[PR template](.github/PULL_REQUEST_TEMPLATE.md) and
[submission/commit rules](docs/policies/commits-and-scope.md#commits).
Before creating or editing a typed Bug or Feature Issue, read the matching
[Bug form](.github/ISSUE_TEMPLATE/bug_report.yml) or
[Feature form](.github/ISSUE_TEMPLATE/feature_request.yml) and the
[typed Issue policy](docs/policies/commits-and-scope.md#typed-issue-submissions).
Ordinary freeform Issues remain allowed and exempt; classification follows the
form labels, never body shape or a required general label.

Before changing the root README, read and follow the
[README content boundary](docs/policies/documentation.md#root-readme-content-boundary).

Before implementing a new host or changing a host metadata contract, follow the
[independent host research policy](docs/policies/documentation.md#host-metadata-research)
and update the [host metadata evidence](docs/host-metadata.md).

- [Domain language](docs/domain-language.md)
- [Host metadata](docs/host-metadata.md)
- [Policies](docs/policies/README.md)
- [Decisions](docs/adr/README.md)
- [Source](src/README.md)
- [Packaging inputs](packaging/README.md) and [host payloads](plugins/README.md)
- [Plugin instructions](packaging/shared/skills/debugging-cdp-targets/SKILL.md)
- [Tests](tests/README.md) and [tooling](tooling/README.md)

Use stable Node >=24.21.0 <25 and exact pnpm 12.4.2. Existing Node installations
within that range are supported; Node 24.21.0 is the CI and problem-reproduction
baseline. Before installation or toolchain changes, read the
[toolchain policy](docs/policies/quality.md#toolchain-compatibility).

Run focused tests first, then
`pnpm verify:push`. Build committed runtime with `pnpm build:plugin`;
`pnpm check:build` verifies it without writing. Domain changes are test-first.
Maintained Node code is native, erasable TypeScript. Run `pnpm typecheck`;
generated JavaScript is distribution output, never a handwritten fallback.
Before changing runtime, tests or tooling, read applicable ancestor/local
AGENTS.md files, the relevant [security policy](docs/policies/security.md),
[verification policy](docs/policies/quality.md#verification) and accepted ADRs.

Before creating a linked worktree on Windows, complete the
[long-path initialization](docs/policies/quality.md#windows-worktree-long-path-initialization)
in the existing clone and verify effective `core.longpaths=true`.

When initializing each clone/worktree, and before installing dependencies,
read and complete the
[trusted installation sequence](docs/policies/supply-chain.md#installation-and-scan-order).
After setup and before committing/pushing, read and verify the generated hook under the
[local hook policy](docs/policies/quality.md#local-git-hook-initialization).
Do not treat a manual verification run as proof that Git will run `pre-push`.
Before starting an SSH push, read and complete the
[SSH push initialization](docs/policies/quality.md#ssh-push-initialization).

The official Server is a complete unchanged npm release delivered in Plugin dist.
Never refresh release hashes automatically. Runtime only verifies and launches
the delivered public bin. Before building Plugin delivery, dependency upgrades or
official release/evidence/build-input changes, read the
[supply-chain policy](docs/policies/supply-chain.md),
including its [official delivery and upgrade contract](docs/policies/supply-chain.md#official-release-delivery-and-upgrades).
