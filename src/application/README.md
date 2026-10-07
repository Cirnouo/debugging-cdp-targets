# Application orchestration

- `plugin-runtime.ts` owns the gateway registry, independent target connections,
  MCP dispatch, timeout isolation, monitoring and official Server lifetimes.
- `mcp-lifecycle.ts` validates current identities and serializes per-connection
  lifecycle mutations through idempotent asynchronous operations.
- `operations.ts` owns memory-only requests, replayable bounded events, waits,
  explicit cancellation, delivered-result acknowledgement and compact terminal Hook notices.
- `connection-owner.ts` owns one session's acquired resources, pending work,
  cancellation and disposal attempts.
- `target-controller.ts` sequences launch, actual exit, live restart, disposition,
  and session-owned cleanup without blocking exit behind lifecycle admission.
- `AGENTS.md` defines transaction and rollback rules.

[ADR 0015](../../docs/adr/0015-explicit-data-directory-isolation.md) adds planned
connection-level directory ownership alongside session owners: the lease spans
restart, tracks late acquisition and releases only after all app/resource users
are gone. Explicit start metadata retains directory evidence through failed
startup and cleanup retries. Runtime implementation is pending.
