# Contributor entry point

Use four spaces, UTF-8, LF, and no tabs. Preserve unrelated work. Read the
nearest source AGENTS.md and only the relevant policies before editing.

## Boundaries

- Official MCP owns tools and inherits stdin/stdout directly. Do not create a
  MCP proxy, custom DevTools tools, CLI daemon, or persistent session state.
- Manage one newly launched target per connection. Verify process, listener,
  and endpoint identity; bind only loopback. Never take over existing targets.
- Ask Close/Keep before switch or stop. Normal close only; no force kill.
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
