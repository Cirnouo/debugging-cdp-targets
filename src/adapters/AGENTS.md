# Adapter implementation

All child processes use shell:false. Only the actual target launch uses
windowsHide:false, with detached:true and ignored stdio, so GUI windows remain
available for normal CloseMainWindow shutdown. Windows helpers and official Server
children keep windowsHide:true. Do not hide the target GUI to suppress console windows.
Start the public upstream Server bin; never import private CLI/daemon internals.
Resolve it within the Plugin using module location and verify every published
file before each launch. Never acquire packages at runtime. Update-check suppression
belongs only to the official child's environment. Validate external evidence
from `unknown` before assigning process, endpoint, package or IPC types.

OS evidence must independently confirm path, creation time, session/user,
descendants, listener ownership, and loopback. Never signal unknown processes.
Windows closes a normal window; Unix sends only SIGTERM after identity checks.
No escalation. Report unverifiable/failed close instead of deleting evidence.

Bind router to 127.0.0.1; rewrite only CDP discovery addresses. Preserve
WebSocket frames. Each connection has its own target, port and upstream child.
The gateway has one entry control pipe and independent routers
and upstreams for all target connections. The official SDK gateway adds only
required _dct routing to tool input schemas and forwards original arguments and
results. Reject routing collisions and missing, unknown, closed or stale IDs.
Track lifecycle and busy state without logging tool contents. Confirm target
exit through child events and retained exit state from startup. Runtime verification
occurs before official calls, with no periodic health scans. Live process connection
errors never announce process exit. Chrome defaults to the fixed chrome-profile;
check native ownership and reserve canonical directories before launch, refusing
occupied or unverifiable profiles without attaching to existing targets.
