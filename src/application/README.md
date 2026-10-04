# Application orchestration

- `plugin-runtime.ts` owns the gateway registry, independent target connections,
  MCP dispatch, timeout isolation, monitoring and official Server lifetimes.
- `mcp-lifecycle.ts` validates current identities and serializes per-connection
  lifecycle mutations through idempotent asynchronous operations.
- `operations.ts` owns memory-only requests, replayable bounded events, waits,
  explicit cancellation and one-shot terminal Hook notices.
- `target-controller.ts` sequences launch, loss, explicit recovery, disposition, and cleanup.
- `AGENTS.md` defines transaction and rollback rules.
