# Runtime source

- `interface/`: MCP bootstrap and local control CLI composition.
- `application/`: independent target lifecycles and connection registry orchestration.
- `domains/`: pure launch and CDP identity/port rules.
- `adapters/`: local IPC, CDP transport, official Server, process/OS I/O.
- `shared/`: cross-layer constants.
- `AGENTS.md`: dependency, gateway transport, and transient identity constraints.

Generated installable code lives in plugins/debugging-cdp-targets/dist.
