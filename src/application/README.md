# Application orchestration

- `client-context.ts` owns client availability and response-wait detachment.
- `registrations.ts` authenticates memory-only bearer ownership and idle expiry.
- `app-management.ts` projects secret-free Core administration for validated
  management requests, checks current session routes and reports independent
  batch outcomes without adding an operation archive.
- `app-host-management.ts` composes Task5 native adapters/managers and durable
  receipt storage after App data admission, caches independent host summaries,
  protects active selections and awaits actual native work on normal shutdown.
- `host-plugin-manager.ts` provides the narrow host inspection and per-host
    install/update/URL synchronization service for the accepted App design.
    Latest candidate decisions are separate from verified current-copy URL sync;
    `null` advertises no release. Persisted management receipts survive a normal
    App restart, while every disk success remains host reload pending.
    A verified native replacement is checkpointed before URL writes, so explicit
    retries can complete synchronization without repeating a native update.
    A stale candidate also permits URL sync of a verified newer managed copy.
    `app-host-management.ts` owns the App integration and independent work accounting.
- `plugin-runtime.ts` owns the gateway registry, independent target connections,
  transport-free MCP dispatch, monitoring and independent official Server lifetimes.
    The direct HTTP App owns final cleanup; detached core clients retain resources.
    [Shared core contract](../../docs/shared-core.md) documents the seam.
- `mcp-lifecycle.ts` validates current identities and serializes per-connection
  lifecycle mutations through idempotent asynchronous operations.
- `operations.ts` owns memory-only requests, replayable bounded events, waits,
  explicit cancellation and immutable terminal results under their original owner.
- `connection-owner.ts` owns one session's acquired resources, pending work,
  cancellation and disposal attempts.
- `connection-directory.ts` holds one directory lease across all connection sessions,
  native acquisitions, successor holds and resource cleanup retries.
- `target-controller.ts` sequences launch, actual exit, live restart, disposition,
  and session-owned cleanup without blocking exit behind lifecycle admission.
- `AGENTS.md` defines transaction and rollback rules.

[ADR 0015](../../docs/adr/0015-explicit-data-directory-isolation.md) adds
connection-level directory ownership alongside session owners: the lease spans
restart, tracks late acquisition and releases only after all app/resource users
are gone. Explicit start metadata retains directory evidence through failed
startup and cleanup retries. Metadata updates preserve terminal operation state,
result and completion delivery; explicit configuration also exposes that evidence.
