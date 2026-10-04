# CDP and lifecycle security

Each gateway manages independent connections without a fixed count limit. One
newly launched target belongs to each connection. Entry, connection and session
UUIDs identify the gateway, task and target run. Each connection's target,
CDP router/port and upstream child are independent. No persistent
session record, CLI daemon, or process takeover is permitted. An isolated
package cache cannot authorize attaching to a process.

Validate executable path, launch creation time, user/session, process tree,
loopback listener ownership, and browser-level WebSocket endpoint. Skip occupied,
privileged, and OS-excluded ports on new launches. Recovery must use the original
port and refuse clearly when it is occupied; never silently choose another port.

The official SDK gateway owns host stdio and preserves the official Server's tool
names and results. Exposed schemas add required _dct connection/session routing;
validate and remove it before forwarding original arguments. Reject missing,
unknown, closed, stale or colliding routing identities. Never select an implicit
current target. Seven MCP lifecycle/operation tools extend the catalog; status
also carries four automatic Hook event names. Empty discovery is read-only.
The fixed full catalog combines verified variants and reports exact per-connection
schemas/enablement. Disabled tools return complete explicit configuration recipes.
Lifecycle requests use MCP, with no plugin CLI or dedicated control IPC.
Diagnostics retain bounded identity/phase/error-category/elapsed metadata only.
Do not log commands, page contents,
cookies, network/console data, secrets, or tool calls.

Require explicit Close/Keep before ending a target's work. Keep retains
both application and upstream child. Close requests normal shutdown of both and
removes only that connection and keeps the host transport reusable. Failure
retains retry identity and reports PID/port without force kill.
Handled host disconnect attempts normal close for every connection despite
individual failures; force termination cannot guarantee
cleanup. Preserve old experimental state and global installations.

Observe the gateway-launched child's exit event from startup and retain exit
state to close subscription gaps. Revoke listeners and verify current identities
before applying callbacks. Task activity is independent of process lifetime;
start/restart and official reuse activate it, Keep/end-task end it. No background
process scan, automatic restart or tool replay is permitted. Keep
bounded startup readiness and pre-tool process/listener/endpoint verification.

Active unexpected exit gates forwarding, retains exact launch identity and
queues one reminder per connection/session. Trusted Codex MCP Tool Hooks drain
in-memory events at PreToolUse, PostToolUse, UserPromptSubmit or Stop; no events
return empty JSON without model context. Stop continues once for an undelivered
event. Idle chats wait for the next turn. Only target kind, PID, port, identities
and exit reason belong in exit reminders. Operation completion and quarantine
events report corresponding operation/session evidence without application inputs.
Require the standard user trust review;
installation cannot implicitly grant Hook trust. End-task/Keep/Close/restart
clear notices. Expected close/restart/disconnect events stay silent. CDP/upstream
failure while a process lives reports a connection error, not process exit.

Ended tasks retain live targets/upstreams. On exit, close only that upstream and
router and remove its connection; end-task/Keep after exit also clean up. Failed
cleanup retains retry identity and reports the actual failure without force kill.
Explicit recovery retains argv/cwd/profile/port and connection identity, replaces
session identity and requires fresh list_pages evidence and page IDs.

Chrome uses the fixed user-home .cache/chrome-devtools-mcp/chrome-profile unless
an explicit --user-data-dir overrides it. Check native profile ownership and
reserve canonical directories across gateway launches. Occupied or unverifiable
profiles fail closed and require an explicit alternative; never attach to their
owner or silently generate another profile. Release a reservation on actual exit
or confirmed normal close. Profiles remain on disk after Close.

Windows launch preserves env/argv/cwd across elevation, distinguishes native
manifest/AppCompat/elevation errors from unrelated access denial, and observes
the actual app handle. Permission waiting is separate from CDP readiness. Fixed
helpers use private authenticated one-shot pipes; no resident privileged service.
A helper exit never proves app exit. Elevated normal-close helpers are allowed
when needed. Native close reports request/exit evidence; missing/foreign listeners
are distinct. Never force-kill applications.

After an interrupted official call, revoke that connection's forwarding, close
its upstream normally and clear pending HTTP/CDP transports. Preserve app identity
for explicit recovery; never automatically restart or replay. Cancellation races
must normally close created apps or report accurate retained identity. Idempotent
request IDs, current-session checks and bounded event cursors protect mutations.
Cancelling a protocol wait leaves the operation running and queryable.

Server defaults enable extensions and disable usage statistics and CrUX. Only
compatible Chrome may use extension tools. mcpArgs overrides require an explicit
start or restart with a fresh session. Do not permit upstream arguments to alter identity or
inject a shell. See [supply-chain.md](supply-chain.md) for dependency requirements.
