# Architecture decisions

- `0001-isolated-skill-payload.md`: historical standalone Skill distribution.
- `0002-runtime-architecture.md`: historical Node/helper and CLI layout.
- `0003-managed-session-state.md`: historical persisted single session.
- `0004-target-adapters.md`: historical adapter boundaries.
- `0005-direct-stdio-plugin.md`: accepted current Plugin, direct stdio, transient
  control, generic targets, and bundled runtime; supersedes the affected parts
  of 0001–0004.
- `0006-native-typescript.md`: native erasable TypeScript, independent strict
  typechecking, direct AST auditing and dependency-free JavaScript delivery.

Old ADRs retain decision history, not current implementation rules. Add numbered
records for durable decisions; keep local implementation rules beside code.
