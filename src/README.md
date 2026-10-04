# Runtime source

- `interface/`: MCP bootstrap composition.
- `application/`: independent target lifecycles and connection registry orchestration.
- `domains/`: pure launch and CDP identity/port rules.
- `adapters/`: CDP transport, official Server/catalog and native process/OS I/O.
- `shared/`: cross-layer constants.
- `AGENTS.md`: dependency, gateway transport, and transient identity constraints.

`packaging/` owns maintained host inputs and shared Skill/documentation. The
complete generated payloads live in `plugins/codex/debugging-cdp-targets/` and
`plugins/claude-code/debugging-cdp-targets/`; each `dist/` contains the same bundled
runtime and complete verified official Server. Native-source development uses the
Codex copy of that verified release; installed runtime resolves its own local copy.
