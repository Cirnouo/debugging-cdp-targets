# Runtime source

- `interface/`: MCP bootstrap composition.
- `application/`: independent target lifecycles and connection registry orchestration.
- `domains/`: pure launch and CDP identity/port rules.
- `adapters/`: CDP transport, official Server/catalog and native process/OS I/O.
- `shared/`: cross-layer constants.
- `AGENTS.md`: dependency, gateway transport, and transient identity constraints.

`packaging/` owns maintained host inputs and shared Skill/documentation. The
complete generated Codex payload lives in `plugins/codex/debugging-cdp-targets/`;
its `dist/` contains this bundled runtime and the verified official Server.
