# Runtime source

Before implementing the singleton desktop App migration, read
[ADR 0017](../docs/adr/0017-singleton-desktop-app.md) and the
[accepted implementation plan](../docs/superpowers/plans/2026-10-17-singleton-app-plan.md).
They govern forward implementation; the current stdio gateway and installed Skill
remain supported until the atomic HTTP/Hook cutover in Task 4.

- `interface/`: MCP bootstrap composition.
- `application/`: independent target lifecycles and connection registry orchestration.
- `domains/`: pure launch and CDP identity/port rules.
- `adapters/`: CDP transport, official Server/catalog and native process/OS I/O.
- `shared/`: cross-layer constants.
- `AGENTS.md`: dependency, gateway transport, and transient identity constraints.

[ADR 0015](../docs/adr/0015-explicit-data-directory-isolation.md) assigns the
isolation boundary: domains validate directory intent and opaque binding;
adapters acquire/reverify/remove real directories; application holds connection
leases across restart and exposes directory evidence only through explicit
operation metadata or selected configuration.

`packaging/` owns maintained host inputs and shared Skill/documentation. The
complete generated payloads live in `plugins/codex/debugging-cdp-targets/` and
`plugins/claude-code/debugging-cdp-targets/`; each `dist/` contains the same bundled
runtime and complete verified official Server. Native-source development uses the
Codex copy of that verified release; installed runtime resolves its own local copy.
