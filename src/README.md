# Runtime source

Before implementing the singleton desktop App migration, read
[ADR 0017](../docs/adr/0017-singleton-desktop-app.md) and the
[accepted implementation plan](../docs/superpowers/plans/2026-10-17-singleton-app-plan.md).
The singleton App owns direct HTTP, management and native resources. The
[runtime contract](../docs/app-runtime.md) describes its startup and cleanup.

- `interface/`: synchronous Electron bootstrap, App composition and sandboxed UI.
- `application/`: independent target lifecycles and connection registry orchestration.
- `domains/`: pure launch and CDP identity/port rules.
- `adapters/`: CDP transport, official Server/catalog and native process/OS I/O.
- `shared/`: request facilities, cross-layer types and constants.
- `AGENTS.md`: dependency, gateway transport, and transient identity constraints.

[ADR 0015](../docs/adr/0015-explicit-data-directory-isolation.md) assigns the
isolation boundary: domains validate directory intent and opaque binding;
adapters acquire/reverify/remove real directories; application holds connection
leases across restart and exposes directory evidence only through explicit
operation metadata or selected configuration.

`packaging/` owns maintained thin host inputs and shared Skill/documentation.
Generated payloads live in `plugins/codex/debugging-cdp-targets/` and
`plugins/claude-code/debugging-cdp-targets/`. They contain no executable runtime,
Hooks, dependency installation or official Server. The App delivers verified
ordinary Node, the complete unchanged official release and native loading closure.
Test-only HTTP composition is under `tests/fixtures/`, outside delivery.
