# Lifecycle implementation

Create one session owner before acquiring a target, router or upstream. Route
every acquired resource and pending request through that owner. Never expose a
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

Store entry/connection/session identities and original launch argv/cwd/profile only in
memory. Observe the actual application from startup and latch confirmed exit;
Windows helper exit or native observation failure never proves app exit. Use
native application handle waits/events without process polling. A normal target
Close waits for actual exit without a target deadline; operation wait's 25 seconds
bounds one protocol response only. Cancelling a wait never cancels its job.

Keep/end-task retains live resources and observation. Actual exit ends task
activity and invalidates the old route regardless of prior task activity or
disposal errors. Retry after exit uses start with new connection/session IDs.
Explicit live restart waits for old app exit and disposes old resources before
creating a new owner/router/upstream on the same connection and exact port.
Refuse a busy original port; never restart or replay automatically.

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
