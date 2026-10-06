# Contributor entry point

Use four spaces, UTF-8, LF, and no tabs. Preserve unrelated work. Read the
nearest source AGENTS.md and only the relevant policies before editing.

Use `feat/`, `fix/`, `hotfix/`, or `chore/` with a lowercase kebab-case topic
for the task's overall purpose. Standalone documentation, refactoring, tests,
CI, and other maintenance use `chore/`; classify each commit independently.
The [branch and commit policy](docs/policies/commits-and-scope.md) owns the
complete grammar. Optional `release/<semver>` preparation branches follow that
policy; publication requires separately authorized annotated stable or prerelease tags under
the [release policy](docs/policies/releases.md).

## Pull request submissions

Whenever creating or editing a PR, read the current
[PR template](.github/PULL_REQUEST_TEMPLATE.md). Preserve every heading and
checklist label, their order, and each checklist's section. Fill the problem,
resulting behavior, and final verification with actual evidence, results, and
remaining limits. Never fabricate results or delete an unchecked required check.
Select satisfied checks; only checks containing `when applicable` may remain
unchecked with an adjacent indented `N/A: <reason>` continuation. The
[commit policy](docs/policies/commits-and-scope.md), including its 100-character
body/footer limits and raw-title/generated-squash rules, remains authoritative.

## Issue submissions

When creating or editing a typed Bug or Feature Issue, read the current
[Bug form](.github/ISSUE_TEMPLATE/bug_report.yml) or
[Feature form](.github/ISSUE_TEMPLATE/feature_request.yml). Preserve generated H3
field headings exactly once in their original order, including optional fields.
Answer each required field and use the exact dropdown choice. Apply the form's
corresponding `template:` label; the provisioned form applies it on creation.
Follow the [typed Issue policy](docs/policies/commits-and-scope.md#typed-issue-submissions).
Ordinary freeform Issues are allowed and exempt. Do not infer a typed Issue from
its body or require a general label. Redact tokens, cookies, private page content,
and personal paths; report suspected vulnerabilities privately through
[SECURITY.md](SECURITY.md).

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
- Launch through structured executable/args/cwd/env and native platform support.
  Windows privilege detection and one-shot elevation helpers belong to the
  plugin; manage the actual app PID/time/handle. Never force-kill applications.
  Keep authorization waiting separate from CDP readiness. Quarantine timed-out
  upstreams and clear pending transport state; never restart/replay automatically.

## Navigation and commands

- [Domain language](docs/domain-language.md)
- [Policies](docs/policies/README.md)
- [Decisions](docs/adr/README.md)
- [Source](src/README.md)
- [Packaging inputs](packaging/README.md) and [host payloads](plugins/README.md)
- [Plugin instructions](packaging/shared/skills/debugging-cdp-targets/SKILL.md)
- [Tests](tests/README.md) and [tooling](tooling/README.md)

Use Node 24.21.0 and pnpm 12.4.2. Run focused tests first, then
`pnpm verify:push`. Build committed runtime with `pnpm build:plugin`;
`pnpm check:build` verifies it without writing. Domain changes are test-first.
Maintained Node code is native, erasable TypeScript. Run `pnpm typecheck`;
generated JavaScript is distribution output, never a handwritten fallback.

Complete the [trusted installation sequence](docs/policies/supply-chain.md#installation-and-scan-order)
in every clone/worktree, then verify the generated Git hook entry under the
[local hook policy](docs/policies/quality.md#local-git-hook-initialization).
Do not treat a manual verification run as proof that Git will run `pre-push`.

The official Server is a complete unchanged npm release delivered in Plugin dist.
Builds verify maintained tarball/file evidence and both locks before copying;
never refresh release hashes automatically. Dependency/version upgrades require
fresh independent tarball evidence and the explicit supply-chain gate. Runtime
only verifies and launches the delivered public bin. Preserve original upstream
licenses, resources, vendor inventory and skills, and document npm graph audit scope.
