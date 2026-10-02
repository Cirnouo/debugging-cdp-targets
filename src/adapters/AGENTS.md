# Adapter implementation

All child processes use shell:false. Only the actual target launch uses
windowsHide:false, with detached:true and ignored stdio, so GUI windows remain
available for normal CloseMainWindow shutdown. Windows helpers, official Server
and acquisition children keep windowsHide:true. Do not hide the target GUI to
suppress console windows. The scoped npx preload affects only acquisition.
Start the public upstream Server bin; never import private CLI/daemon internals.
The native TypeScript preload and generated CJS preload use Node `--import`.
A private build constant selects the resource name; never pass that preload or
the acquisition environment to the official Server. Validate external evidence
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
