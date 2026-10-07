# Architecture decisions

- `0001-isolated-skill-payload.md`: historical standalone Skill distribution.
- `0002-runtime-architecture.md`: historical Node/helper and CLI layout.
- `0003-managed-session-state.md`: historical persisted single session.
- `0004-target-adapters.md`: historical adapter boundaries.
- `0005-direct-stdio-plugin.md`: historical Plugin, direct stdio, transient
  control, generic targets, and bundled runtime; supersedes the affected parts
  of 0001–0004 and is partially superseded by 0007–0009.
- `0006-native-typescript.md`: native erasable TypeScript, independent strict
  typechecking, direct AST auditing and dependency-free JavaScript delivery.
- `0007-reusable-stdio-entries.md`: historical two-entry reusable SDK gateways,
  identity checks, lifecycle dispositions, and explicit manual-close recovery;
  partially superseded by 0008–0009.
- `0008-independent-target-connections.md`: one gateway, independent per-target
  MCP connections without a fixed limit, explicit routing, and parallel isolation;
  partially superseded by 0009 for monitoring and ended-task cleanup.
- `0009-process-exit-hooks.md`: native exit events, independent task activity,
  automatic trusted Codex Hooks, retired-connection cleanup and fixed profiles;
  partially superseded by 0013 for actual-exit removal and notices, and 0015
  for explicit isolation and directory cleanup policy.
- `0010-bundled-official-server.md`: accepted build-time delivery of the reviewed
  official npm release, exact artifact verification and runtime package resolution.
- `0011-mcp-native-lifecycle.md`: pure MCP operations, native launch/elevation,
  fixed catalog variants, per-connection configuration and timeout quarantine;
  supersedes previous CLI/control IPC and status-only extension constraints;
  partially superseded by 0013 for cleanup, restart and protocol projection.
- `0012-peer-host-distributions.md`: shared maintained packaging/runtime with
  independent Codex and Claude Code installation payloads, exact per-host audits
  and actual Marketplace/Hook acceptance; extends host assumptions in 0005 and 0009–0011.
- `0013-session-owned-exit-cleanup.md`: ownership before acquisition, event-driven
  actual-exit cleanup, removed dead sessions with internal disposal retries,
  bounded official-child termination, live restart and compact acknowledged events;
  partially superseded by 0015 for connection-level data directory leases.
- `0014-windows-chrome-screenshot-surface.md`: fixed Windows Chrome screenshot
  feature at the existing launch boundary, strict effective feature composition,
  conflict rollback and idempotent exact restart; generic/platform scope stays separate;
  partially superseded by 0015 for its fixed-profile assumption.
- `0015-explicit-data-directory-isolation.md`: required
    isolation intent, researched application binding, explicit directory operations,
    connection leases, preauthorized whole-directory cleanup and explicit evidence.

Old ADRs retain decision history, not current implementation rules. Add numbered
records for durable decisions; keep local implementation rules beside code.
