# Lifecycle implementation

Before implementing this layer’s singleton App migration, read
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md) and the
[tracked plan](../../docs/superpowers/plans/2026-10-17-singleton-app-plan.md).
These are forward requirements; current stdio rules apply until their planned cutover.

Create logical, target-generation and official-generation owners before their
respective acquisitions. The logical connection owns its stable router and
directory lease; independently owned target and official generations can restart
without disposing their healthy peer. Route every resource and pending request
through its corresponding owner. Never expose a
target before identity verification. Keep lifecycle admission per connection;
actual-exit cleanup bypasses that admission gate and cannot wait behind blocked
startup or official requests. Gate forwarding and cancel dependent work first,
attempt disposal of every resource, then remove the exited connection/session.

Each new target has an independent controller, router, upstream and connection
UUID. Keep all connections in a gateway-local registry without a fixed limit or
active-target fallback. Scope admission, exit subscriptions, notices and
cancellation per connection/session. Failed resource disposal belongs to an
internal retry ledger, not a routable dead session. Preserve ownership and
observation when an application is still alive and normal Close fails or is
cancelled. Never force-kill applications.

Store entry/connection/session identities and original launch argv/cwd/directory only in
memory. Observe the actual application from startup and latch confirmed exit;
Windows helper exit or native observation failure never proves app exit. Use
native application handle waits/events without process polling. A normal target
Close waits for actual exit without a target deadline; operation wait's 25 seconds
bounds one protocol response only. Cancelling a wait never cancels its job.

Keep/end-task retains live resources and observation. Actual exit ends task
activity and invalidates the old route regardless of prior task activity or
disposal errors. Retry after exit uses start with new connection/session IDs.
Core restart requires an explicit target, official or both scope and uses only
the admitted immutable launch/environment/official/roots snapshot. Preserve the
logical connection/router/lease and issue a fresh public session after either
side changes. Explicit fixed ports refuse collisions; automatic policy can select
a new free port from its recorded binding template. Only the transitional stdio
facade maps omitted scope to both. Never restart or replay automatically.

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
sequence may terminate only that plugin-owned child; retain failed disposal in
the ledger for gateway cleanup retries. Gateway disconnect gates and cancels all
owners, attempts every Server/catalog/router disposal in parallel with normal
target Close, and introduces no target-close deadline.

Use summary lifecycle successes and bounded failure identity/phase/code/native
evidence. Status selects configuration, diagnostics and tool details explicitly.
Authorized Hooks emit compact independent events, never complete results or
tool/configuration payloads. Successful terminal status/wait, terminal cancel and
identical mutation retry delivery acknowledges its notice; nonterminal responses
and aborted requests leave it unread. Group all expected Close/restart exits by
operationId into the operation notice, including a new Target rollback during
restart. Keep those exits and the notice unread while any related cleanup is
pending; their routes can differ from the operation's final route. Inactive exit
remains informational and an active unexpected exit may suggest a new start.
Empty Hooks return {}.

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
state/results or create another completion notice. Selected configuration may
include that evidence. Hooks/default summaries omit paths and raw filesystem
errors. Hard crash/unverified disconnect cannot promise eventual deletion.
