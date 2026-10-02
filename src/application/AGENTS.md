# Lifecycle implementation

Use explicit router/host/gateway dependencies so tests cover ordering and failed
close. Never expose a target before identity verification. Reject busy lifecycle
changes, pause new requests while disposing a target, and invalidate old sockets.
Keep preserves target and upstream together; Close normally closes both while
retaining the reusable host transport. Failed rollback reports retained PID/port.
Unexpected host disconnect attempts normal close without force kill.

Each new target has an independent controller, router, upstream and connection
UUID. Keep all connections in a gateway-local registry without a fixed limit or
active-target fallback. Scope lifecycle serialization, exit subscriptions, reminders and
cancellation per connection/session. Disconnect cleanup attempts every connection
even when one fails. Remove only successfully closed connections.

Store entry/connection/session identities and original launch argv/cwd/profile only in
memory. Observe child exit from startup, latch missed events and revoke old subscriptions.
Separate task activity from process lifetime; never run background health scans.
Queue one reminder for an active task's unexpected exit; automatic trusted Codex
Hooks deliver it at a tool boundary, Stop, or the next idle turn. Ended tasks keep
live targets/upstreams and retire only their own connection after exit. Retain
retry identity on cleanup failure. Explicit recovery uses the same port and new
session identity, refuses a busy port, and never automatically replays tools.
