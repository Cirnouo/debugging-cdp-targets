# Lifecycle implementation

Use explicit router/host dependencies so tests cover ordering and failed close.
Never expose a new target before identity verification. Reject busy switching,
pause new requests while disposing an old target, and invalidate old sockets.
Only explicit Keep preserves a target intentionally. Failed rollback must
report retained PID/port. Unexpected disconnect attempts normal close, never
force kill. Store target records only in memory.
