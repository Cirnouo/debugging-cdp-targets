# Adapter implementation

Node child processes use shell:false. Portable target launches use windowsHide:false,
detached:true and ignored stdio. Windows native support preserves normal GUI show
state while suppressing auxiliary consoles; fixed helpers remain hidden.
Native Windows launch inspects manifest/AppCompat, handles native elevation errors,
preserves full env/cwd/argv, and observes the actual app handle. A helper's exit
is an observation failure, not evidence of app exit. One-shot ShellExecuteEx runas
helpers may launch/close elevated apps; no persistent privileged service.
Start the public upstream Server bin; never import private CLI/daemon internals.
Resolve it within the Plugin using module location and verify every published
file before each launch. Never acquire packages at runtime. Update-check suppression
belongs only to the official child's environment. Validate external evidence
from `unknown` before assigning process, endpoint, package or IPC types.

OS evidence must independently confirm path, creation time, session/user,
descendants, listener ownership, and loopback. Never signal unknown processes.
Windows closes a normal window; Unix sends only SIGTERM after identity checks.
When normal close requires elevation, use the authenticated one-shot close helper.
Report native stage/error, request/exit/listener evidence and retry identity.
An absent listener permits verified app cleanup; a foreign listener is distinct.

Bind router to 127.0.0.1; rewrite only CDP discovery addresses. Preserve
WebSocket frames. Each connection has its own target, port and upstream child.
The gateway has independent routers and upstreams for all target connections.
Lifecycle management is native MCP, with no CLI or dedicated control pipe.
Fixed full schemas combine reviewed official variants and add required _dct
routing. Report actual tools/schema/configuration before calls, reject disabled
tools with an explicit recipe, and forward original arguments/results.
Reject routing collisions and missing, unknown, closed or stale IDs.
Track lifecycle and busy state without logging tool contents. Confirm target
exit through child events and retained exit state from startup. Runtime verification
occurs before official calls, with no periodic health scans. Live process connection
errors never announce process exit. The accepted
[isolation design](../../docs/adr/0015-explicit-data-directory-isolation.md)
removes the implicit fixed Chrome fallback. Preserve native
ownership checks, reject occupied or unverifiable profiles, and verify isolated
Chrome's effective --user-data-dir against the acquired real directory.
Apply known-root Chrome checks in either isolation mode and recheck availability
before authorized data-directory deletion; external use or unverifiable evidence
retains the directory claim. Omitted defaults and generic occupancy belong to the
shared Agent prelaunch gate; do not add guessed roots or generic Chrome markers.

Acquire existing directories only if present; create a named exclusive leaf or
random dct- child only under an existing absolute parent. Resolve root links and
junctions, record/reverify real directory identity, and reserve equal or overlapping
ancestor/descendant claims. Preserve children-link boundaries during authorized
whole-directory cleanup. Identity/disposal failure retains the claim and evidence.
The acquired path is opaque during launch binding. Expose bounded filesystem
failure categories to summaries/Hooks; paths belong in explicit directory evidence.
No directory-location denylist, fallback operation or scan of old state is allowed.
