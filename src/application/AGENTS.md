# Lifecycle implementation

Before changing this layer's singleton App architecture, read
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md). The direct HTTP App owns
all resources; thin host plugins contain metadata, artwork and the shared Skill.
These complete lifecycle obligations also govern gateway/core.ts,
gateway/registry.ts and gateway/targets/target-lifecycle.ts through their explicit
before-editing instruction triggers.

Create logical, target-generation and official-generation owners before their
respective acquisitions. The logical connection owns its stable router and
directory lease; independently owned target and official generations can restart
without disposing their healthy peer. Route every resource and pending request
through its corresponding owner. Never expose a
target before identity verification. Keep lifecycle admission per connection;
actual-exit cleanup bypasses that admission gate and cannot wait behind blocked
startup or official requests. Gate forwarding and cancel dependent work first,
attempt disposal of every resource, then remove the exited connection/session.

Each new target has an independent lifecycle, router, upstream and connection
UUID. Keep all connections in a gateway-local registry without a fixed limit or
active-target fallback. Scope admission, exit subscriptions and
cancellation per connection/session. Failed resource disposal belongs to an
internal retry ledger, not a routable dead session. Preserve ownership and
observation when an application is still alive and normal Close fails or is
cancelled. Never force-kill applications.

Store internal diagnostic correlation and connection/session identities and original launch argv/cwd/directory only in
memory. Observe the actual application from startup and latch confirmed exit;
Windows helper exit or native observation failure never proves app exit. Use
native application handle waits/events without process polling. A normal target
Close waits for actual exit without a target deadline; operation wait's 25 seconds
bounds one protocol response only. Cancelling a wait never cancels its job.

Keep retains live resources and observation. Actual exit invalidates the old
route regardless of disposal errors. Retry after exit uses start with new connection/session IDs.
Core restart requires an explicit target, official or both scope and uses only
the admitted immutable launch/environment/official/roots snapshot. Preserve the
logical connection/router/lease and issue a fresh public session after either
side changes. Explicit fixed ports refuse collisions; automatic policy can select
a new free port from its recorded binding template. Never restart or replay automatically.

Authenticate agent principals before reads or effects. Registration owns current
resources; operation ownership is immutable across transfer. Keep bearers out of
snapshots, diagnostics, fingerprints and results. Trusted administration is an
in-process closure, never a caller-supplied field.

Admit one actual official execution per connection. Detaching a client wait never
cancels that execution or changes its originating roots, progress or elicitation
context. Retain its slot until the actual response or definitive upstream close.
Do not reach through a global entry for request facilities.

Final cleanup denies new work, attempts all peers and rejects while live or pending
resources/leases remain. Preserve failed disposal and live observation for retry;
never clear ownership or cache a successful exit after failure.

Official Server disposal immediately closes its public SDK transport and rejects
pending calls, then proves the owned child exited. Its bounded EOF/TERM/KILL
sequence may terminate only that App-owned child; retain failed disposal in
the ledger for gateway cleanup retries. App shutdown gates and cancels all owners, attempts every Server/catalog/router
disposal in parallel with normal target Close, and introduces no target-close
deadline. Client or MCP-session disconnect never requests this cleanup.

Use summary lifecycle successes and bounded failure identity/phase/code/native
evidence. Status selects configuration, diagnostics and tool details explicitly.
Operation status/wait/cancel and identical request retries read explicit owned
results without notice queues or acknowledgments. Keep paths and raw filesystem
errors out of default summaries. No taskActive, end-task, Hook output or automatic
notification injection remains.

During construction, synchronously expose only the trusted readonly cleanup/state
capability before first acquisition. The App retains it through construction
failure, waits for startup settlement before final cleanup, and exits only after
real cleanup succeeds. Pending/late acquisitions remain owned until disposal.


Implement [ADR 0015](../../docs/adr/0015-explicit-data-directory-isolation.md) with
a distinct connection-level directory lease.
Prevalidate before acquiring it and preserve it across session restart. Release
only after no live/pending app, permission wait, late creation, successor or
relevant read/write resource can use it. Intermediate restart exit never releases
it. Cancellation must own late-created apps through normal Close and actual exit.
Failed Close/observation/rollback retains live ownership; disposal failures keep
the directory claim in the in-memory ledger without restoring dead routes.

Honor preauthorized retain or whole-directory delete-on-release, including existing
contents. Preserve acquired path/policy/state in explicit original start operation
metadata after failure/cancellation and later cleanup; do not rewrite terminal
state/results or create another operation. Selected configuration may
include that evidence. Default summaries omit paths and raw filesystem
errors. Hard crash/unverified disconnect cannot promise eventual deletion.
