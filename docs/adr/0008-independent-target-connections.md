# ADR 0008: Independent per-target MCP connections

Status: accepted; partially superseded by ADR 0009 for loss monitoring, reminder
delivery and cleanup after ended tasks. Supersedes ADR 0007's fixed two-entry
topology, unchanged input-schema requirement, and entry/session-only control addressing.

One static Desktop configuration, cdp-targets, starts a reusable SDK gateway with
a random entry UUID and temporary control pipe. Every start creates an independent
connection UUID, target controller, loopback CDP router and official MCP child.
The in-memory registry has no fixed connection limit or implicit current target.
Connection-local lifecycle operations serialize without blocking other targets.

Official tool names, original parameters and results remain. Exposed input
schemas add required _dct: { connectionId, sessionId }. The gateway validates
the route, rejects stale sessions and strips _dct before forwarding. An upstream
parameter collision fails closed. This supports parallel target calls with a
stable tool catalog, without Desktop dynamic registration or custom inspection
tools. Progress, cancellation, monitoring and recovery prompts are isolated.

Status returns entryId and all connections; optional CLI connection identity
selects one. Start always allocates a connection and accepts no connection or
session identity. Restart/end-task/stop require entry, connection and session;
only stop accepts disposition. Watch requires connection and session identity.

Keep retains target and official MCP together for later tasks. Close normally
closes both and removes only the selected connection; the gateway remains.
Failed rollback/close retains retry identity and evidence. Host disconnect tries
every connection's normal cleanup even when one fails. No force kill is added.

Loss handling retains ADR 0007's confirmation and explicit recovery rules.
Recovery is the same logical task: it keeps connectionId, uses the exact original
port/argv/cwd/profile, replaces the official MCP and sessionId, and invalidates
all page IDs. It refuses occupied ports and never restarts or replays tools
automatically. State stays transient and version 0.1.0 remains Unreleased.
