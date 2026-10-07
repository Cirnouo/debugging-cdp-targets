# CDP and lifecycle security

Each gateway manages independent connections without a fixed count limit. One
newly launched target belongs to each connection. Entry, connection and session
UUIDs identify the gateway, task and target run. Each connection's target,
CDP router/port and upstream child are independent. No persistent
session record, CLI daemon, or process takeover is permitted. An isolated
package cache cannot authorize attaching to a process.

Validate executable path, launch creation time, user/session, process tree,
loopback listener ownership, and browser-level WebSocket endpoint.
On Linux, derive root creation time from `/proc` boot time and process start
ticks with the system `CLK_TCK`, preserving fractional precision instead of
the rounded `ps lstart` display. Missing or malformed evidence fails closed.
On macOS, an absolute installed executable can also be verified through a unique
mapped hard-link alias: its regular-file device/inode must match the kernel's
`lsof` text mapping for the target PID. This covers Chrome's asynchronous
[code-sign clone](https://chromium.googlesource.com/chromium/src.git/+/2d20934f814ddd688b6dd4bd0052019391114f8d/chrome/browser/mac/code_sign_clone_manager.mm)
without accepting same-name copies, missing identity or ambiguous aliases.
Reserve each candidate port synchronously for its session owner before probing;
skip occupied, privileged, and OS-excluded ports on new launches. Gateway-local
reservations prevent peer launches from selecting the same port and remain held
until actual app exit or evidence that no app was created. Explicit live restart
must use the original port and refuse clearly when it is occupied. A foreign
listener found after app creation cannot authorize automatic relaunch or takeover.

The official SDK gateway owns host stdio and preserves the official Server's tool
names and results. Exposed schemas add required _dct connection/session routing;
validate and remove it before forwarding original arguments. Reject missing,
unknown, closed, stale or colliding routing identities. Never select an implicit
current target. Seven MCP lifecycle/operation tools extend the catalog; status
also carries four automatic Hook event names. Empty discovery is read-only.
The fixed full catalog combines verified variants. Status discovery returns
connection summaries; selected status adds tool names, and explicit toolNames
requests receive exact schemas only from a valid actual upstream. Configuration
and diagnostics require selected include values. Operation selection excludes
connection/tool/include selectors; an automatic hookEventName is the sole argument.
Enabled tools have no suggestedMcpArgs. Supported explicitly disabled tools and
TOOL_NOT_ENABLED return complete replacement recipes; unavailable upstreams return
requirements only, and unsupported tools return their reason without a recipe.
Lifecycle requests use MCP, with no plugin CLI or dedicated control IPC.
Diagnostics retain bounded identity/phase/error-category/elapsed metadata only.
Do not log commands, page contents,
cookies, network/console data, secrets, or tool calls.

Create one session owner before acquiring target/router/upstream resources or
pending work. Require explicit Close/Keep before ending a target's work. Keep
retains live application, upstream, router and observation. Close requests normal
application shutdown and waits for actual exit without a target-close deadline.
Cancelled or failed normal Close retains ownership, observation and retry identity
while the app remains alive. Never force-kill applications. Normal app Close is
independent of unrelated CDP listeners and official MCP transport lifetime.
Preserve old experimental state and global installations.

Observe the actual gateway-launched application from startup and retain confirmed
exit state to close subscription gaps. Windows Node children are helpers; native
actual-app handles and reliable waits/events establish exit without process
polling. Helper exit and observation failure cannot prove application exit. Revoke
listeners and verify current identities before applying callbacks. Task activity
is independent of process lifetime;
start/restart and official reuse activate it, Keep/end-task end it. No background
process scan, automatic restart or tool replay is permitted. Keep
bounded startup readiness and pre-tool process/listener/endpoint verification.

Actual exit gates forwarding, ends task activity, cancels dependent pending work,
attempts disposal of every owned resource and removes the old connection/session.
Exit cleanup bypasses lifecycle admission and blocked startup/tool work. Disposal
failure retains plugin-owned resource evidence in an internal retry ledger rather
than preserving a routable dead session. Enabled, authorized host MCP Tool Hooks drain
in-memory events at PreToolUse, PostToolUse, UserPromptSubmit or Stop; no events
return empty JSON without model context. Stop continues once for an undelivered
event. Idle chats wait for the next turn. Exit reminders contain target kind,
PID, port, identities, native exit facts, expected operation ID and cleanup status.
Operation completion and quarantine
events report compact operation/session evidence without full results, errors,
configuration, diagnostics, schemas, recipes or application inputs. Successful
terminal status/wait, terminal cancel or identical mutation retry delivery
acknowledges its notice; aborted requests and nonterminal responses leave it
unread. Inactive exit remains informational; active unexpected exit may suggest a
new start. Group every expected Close/restart actual exit by operation ID into
its notice, including new Target rollback. Pending related cleanup retains both
exit facts and the operation notice until all cleanup results are ready. Compact
failure notices retain phase/code and primitive native evidence without complete
message/cause error text or tool names/counts.
Follow each host's standard controls: Codex requires explicit definition trust;
Claude Code loads enabled Plugin Hooks and honors disableAllHooks. Review the
Plugin before enabling its code and Hooks. CDP/upstream or observation failure
while an app lives reports a connection error, not process exit.

Retry after ordinary exit requires start with new connection/session IDs.
Explicit restart of a live connection retains argv/cwd/data directory/exact port and
connection identity, waits for old exit and disposes old resources before creating
a fresh owner/router/upstream and session. Require fresh list_pages evidence and
page IDs. Never automatically restart or replay tools.

Official Server disposal immediately closes its public SDK transport and rejects
pending calls, then proves the plugin-owned child exited. Allow two seconds after
stdin EOF, two seconds after TERM, then KILL within a total ten-second budget for
this child only. Retain failed disposal ownership in the internal ledger for
gateway cleanup retries. Handled gateway disconnect gates/cancels all owners and
attempts every Server/catalog/router disposal in parallel with normal target
shutdown despite peer failures, without imposing a new target-close deadline.

## Data directory isolation boundary

The accepted [ADR 0015](../adr/0015-explicit-data-directory-isolation.md) replaces
the fixed Chrome profile and unconditional retention policy with the following
required boundary. Runtime implementation is pending; these are contributor
requirements for that implementation.

Require explicit start isolation: none or data-dir with existing/new directory
selection and retain/delete-on-release. None neither creates nor deletes a data
directory and forbids its placeholder. Remove the implicit Chrome profile fallback
while preserving native ownership checks. Isolated Chrome's effective --user-data-dir
must match the acquired real directory. Generic args/env binding uses opaque
{dataDir} substitution and cannot itself prove complete application isolation.

Ask isolation intent first. Research exact application/version startup support
before acquiring directories or connecting. Full support proceeds; partial
support discloses production effects and asks isolation or none; unsupported and
unknown support leave the app unlaunched, with unknown kept distinct. Do not ask
for the user's reasons or impose a directory location denylist. User-selected
existing nonempty directories default to retain and disclosure without a cleanup
question when no cleanup instruction exists. Other choices need an authorized
retain/delete decision. Hidden entries count; inspect entries, not contents.
Full Agent delegation includes selecting a parent but grants no implicit deletion.
None skips isolation research and directory questions.

Delete-on-release must be authorized before launch and applies to the entire real
directory, including pre-existing contents. Resolve a root link/junction to its
actual target for binding and deletion; child links never widen deletion scope.
Validate launch/options before acquisition, reject concurrent canonical equal or
ancestor/descendant claims, and reverify root identity before deletion. Missing
existing directories and new-name collisions fail without switching operations.
Changed or unverifiable identity retains ownership instead of deleting a replacement.
Preserve acquired path and ownership evidence after any post-creation verification
failure; a failed result cannot discard an acquired directory or its claim.

Hold a connection-level lease across restart and release only after no live app,
pending native acquisition/permission wait/late creation, successor or relevant
read/write resource remains. Keep/end-task retains it until actual exit. An
intermediate restart exit cannot release it; final failed/cancelled restart can
only release when the barrier is satisfied. Failed observation/Close/rollback
with live or pending app retains ownership. Failed disposal remains in the
in-memory ledger; retry completes cleanup without restoring the removed route.
Hard crash or disconnect without verified actual exit cannot guarantee subsequent
deletion. No persistence, daemon or scan of old state is permitted.

Real paths, policy and cleanup state appear only in explicit operation metadata
and selected configuration, including failed/cancelled startups. Later cleanup
updates original start metadata without changing its terminal result/state or
issuing a new completion notice. Default summaries and Hooks omit paths and raw
filesystem errors. Agent reads explicit evidence and reports every retained
actual absolute path, even after failed or cancelled launch.

## Native launch and transport

Windows launch preserves env/argv/cwd across elevation, distinguishes native
manifest/AppCompat/elevation errors from unrelated access denial, and observes
the actual app handle. Permission waiting is separate from CDP readiness. Fixed
helpers use private authenticated one-shot pipes; no resident privileged service.
Elevated normal-close helpers are allowed when needed. Native close reports
request/actual-exit evidence; listener evidence is separate from application
lifetime. Keep the actual-app observer until exit even if a Close wait is cancelled.

After an interrupted official call, revoke that connection's forwarding, close
its upstream normally and clear pending HTTP/CDP transports. Preserve app identity
for explicit live restart or Close; never automatically restart or replay. Cancellation races
must normally close created apps or report accurate retained identity. Idempotent
request IDs, current-session checks and bounded event cursors protect mutations.
Cancelling a protocol wait leaves the operation running and queryable.

Server defaults enable extensions and disable usage statistics and CrUX. Only
compatible Chrome may use extension tools. mcpArgs overrides require an explicit
start or restart with a fresh session. Do not permit upstream arguments to alter identity or
inject a shell. See [supply-chain.md](supply-chain.md) for dependency requirements.
