# Contributor entry point

Use four spaces, UTF-8, LF, and no tabs. Preserve unrelated work. Read the
nearest source AGENTS.md and only the relevant policies before editing.

## Boundaries

- The reusable stdio gateway relays the official MCP catalog and results using
  the official SDK. Only dct_connection_status and dct_watch_target extend it.
  Do not create custom DevTools tools, a CLI daemon, or persistent session state.
- Manage one newly launched target per connection. Verify process, listener,
  and endpoint identity; bind only loopback. Never take over existing targets.
- Ask Close/Keep before changing entries or ending a task. Keep retains target
  and upstream; Close requests normal shutdown while preserving the entry.
  Every control request identifies the entry; restart/end-task/stop also identify
  the session. Status/start forbid session identity; only stop takes disposition.
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
