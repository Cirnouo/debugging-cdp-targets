# ADR 0007: Reusable independent stdio entries

Status: Accepted. Supersedes the direct inherited stdio and single OS-user entry
parts of ADR 0005, and the corresponding stdio statement in ADR 0006.

Two static configurations, cdp-target-1 and cdp-target-2, use the same bundled
bootstrap with optional --slot labels. Labels distinguish diagnostics, not
identity. Every gateway gets a random entry UUID and independent control pipe;
every target start gets a fresh session UUID. No state persists across gateways.

The official MCP SDK transfers host stdio to a gateway. The gateway relays the
unmodified official tool catalog and results and adds only dct_connection_status
and dct_watch_target. Each entry owns a target, loopback CDP port, and official
Server child. No custom DevTools tools, CLI daemon, or process takeover is added.

Keep retains the target and upstream. Close normally closes both while retaining
the host transport for later start. Switching means selecting the other static
entry; there is no switch command. All control requests require --entry-id, and
restart/end-task/stop require --session-id. Status/start prohibit --session-id
even with an existing session. Only stop accepts disposition. End-task ends the
active watch while retaining target and upstream.

Manual closure requires event evidence or two failed polls. Active tasks receive
standard MCP form elicitation within five seconds; idle entries ask on next use.
Recovery is explicit, uses the original port and in-memory argv/cwd/profile, and
fails if that port is busy. It creates new session identity and invalidates page
IDs. Automatic restart and replay are prohibited. Version 0.1.0 remains Unreleased.
