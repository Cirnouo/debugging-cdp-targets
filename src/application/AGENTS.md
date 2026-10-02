# Lifecycle implementation

Use explicit router/host/gateway dependencies so tests cover ordering and failed
close. Never expose a target before identity verification. Reject busy lifecycle
changes, pause new requests while disposing a target, and invalidate old sockets.
Keep preserves target and upstream together; Close normally closes both while
retaining the reusable host transport. Failed rollback reports retained PID/port.
Unexpected host disconnect attempts normal close without force kill.

Each new target has an independent controller, router, upstream and connection
UUID. Keep all connections in a gateway-local registry without a fixed limit or
active-target fallback. Scope lifecycle serialization, prompts, polling and
cancellation per connection/session. Disconnect cleanup attempts every connection
even when one fails. Remove only successfully closed connections.

Store entry/connection/session identities and original launch argv/cwd/profile only in
memory. Manual closure needs event evidence or at least two failed polls. Active
dependent tasks receive standard MCP form elicitation within five seconds;
idle entries defer until next use. Explicit recovery uses the same port and new
session identity, refuses a busy port, and never automatically replays tools.
