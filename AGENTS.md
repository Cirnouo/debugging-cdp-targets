# Contributor entry point

Use four spaces, UTF-8, LF, and no tabs. Preserve unrelated work. Read the
nearest source AGENTS.md and only the relevant policies before editing.

## Boundaries

- The reusable stdio gateway relays official MCP tools and results using
  the official SDK. Only dct_connection_status extends it, including automatic Hooks.
  Do not create custom DevTools tools, a CLI daemon, or persistent session state.
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

## Navigation and commands

- [Domain language](docs/domain-language.md)
- [Policies](docs/policies/README.md)
- [Decisions](docs/adr/README.md)
- [Source](src/README.md)
- [Plugin instructions](plugins/debugging-cdp-targets/skills/debugging-cdp-targets/SKILL.md)
- [Tests](tests/README.md) and [tooling](tooling/README.md)

Use Node 24.21.0 and pnpm 12.4.2. Run focused tests first, then
`pnpm verify:push`. Build committed runtime with `pnpm build:plugin`;
`pnpm check:build` verifies it without writing. Domain changes are test-first.
Maintained Node code is native, erasable TypeScript. Run `pnpm typecheck`;
generated JavaScript is distribution output, never a handwritten fallback.

The official Server is a complete unchanged npm release delivered in Plugin dist.
Builds verify maintained tarball/file evidence and both locks before copying;
never refresh release hashes automatically. Dependency/version upgrades require
fresh independent tarball evidence and the explicit supply-chain gate. Runtime
only verifies and launches the delivered public bin. Preserve original upstream
licenses, resources, vendor inventory and skills, and document npm graph audit scope.
