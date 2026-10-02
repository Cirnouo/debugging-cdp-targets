# Architecture decisions

- `0001-isolated-skill-payload.md`: historical standalone Skill distribution.
- `0002-runtime-architecture.md`: historical Node/helper and CLI layout.
- `0003-managed-session-state.md`: historical persisted single session.
- `0004-target-adapters.md`: historical adapter boundaries.
- `0005-direct-stdio-plugin.md`: historical Plugin, direct stdio, transient
  control, generic targets, and bundled runtime; supersedes the affected parts
  of 0001–0004.
- `0006-native-typescript.md`: native erasable TypeScript, independent strict
  typechecking, direct AST auditing and dependency-free JavaScript delivery.

- `0007-reusable-stdio-entries.md`: historical two-entry reusable SDK gateways,
  identity checks, lifecycle dispositions, and explicit manual-close recovery.
- `0008-independent-target-connections.md`: one gateway, independent per-target
  MCP connections without a fixed limit, explicit routing, and parallel isolation.
- `0009-process-exit-hooks.md`: native exit events, independent task activity,
  automatic trusted Codex Hooks, retired-connection cleanup and fixed profiles.

Old ADRs retain decision history, not current implementation rules. Add numbered
records for durable decisions; keep local implementation rules beside code.
