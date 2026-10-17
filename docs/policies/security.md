# CDP and lifecycle security

One singleton App per OS user manages independent connections without a fixed count limit. One
newly launched target belongs to each connection. Public registration, connection and session identities identify ownership and
target runs; internal diagnostic correlation never grants authority. Each connection's target,
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
until actual app exit or evidence that no app was created. Explicit fixed-port restart
must retain that port and refuse clearly when occupied; automatic port policy may
select another free port using only the recorded validated binding template. A foreign
listener found after app creation cannot authorize automatic relaunch or takeover.

The App owns direct SDK Streamable HTTP on 127.0.0.1 with exact effective
Host/Origin/port, fixed /mcp methods and bounded JSON bodies. Do not trust forwarded
authority or add permissive CORS. Each owned tool request explicitly supplies
registrationBearer, and official _dct also supplies connection/session identity.
Authenticate before resource/result reads or changes. Strip the entire _dct and
forward unchanged original arguments/results. MCP sessions carry transport state,
never an implicit owner. Register returns one token once; no token readback, long
term HTTP key or Authorization owner alias. Empty registrations expire after 30
idle minutes, with no resources or nonterminal work.
The fixed full catalog combines verified variants. Status discovery returns
connection summaries; selected status adds tool names, and explicit toolNames
requests receive exact schemas only from a valid actual upstream. Configuration
and diagnostics require selected include values. Operation selection excludes
connection/tool/include selectors; registrationBearer remains explicit on each selector.
Enabled tools have no suggestedMcpArgs. Supported explicitly disabled tools and
TOOL_NOT_ENABLED return complete replacement recipes; unavailable upstreams return
requirements only, and unsupported tools return their reason without a recipe.
Lifecycle requests use MCP, with no plugin CLI or dedicated control IPC.
Diagnostics retain bounded identity/phase/error-category/elapsed metadata only.
Do not log commands, page contents,
cookies, network/console data, secrets, or tool calls.

Create logical connection ownership before acquiring its stable router/directory,
with independently owned target and official generations and pending work.
Require explicit Close/Keep before ending a target's work. Keep
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
listeners and verify current identities before applying callbacks. Actual exit
revokes forwarding and dependent work, disposes every owned resource and removes
the old connection/session. Exit cleanup bypasses admission and blocked work.
Failure retains resource ownership and observation for retry. Keep retains the
live target and upstream. There are no task-activity flags, end-task, Hooks or
notification queues. CDP/upstream or observation failure while an app lives is a
connection error rather than evidence of process exit. No automatic restart,
process takeover or replay.

Retry after ordinary exit requires start with new connection/session IDs.
Explicit scoped restart retains immutable launch/environment/official/roots,
logical connection/router and directory lease; replace only target, official or
both side generations once. Every scope issues a fresh session and requires fresh
list_pages evidence. Fixed ports refuse collisions; automatic policy uses its
recorded validated binding template to select another verified free port. Never automatically restart or replay tools.

Official Server disposal immediately closes its public SDK transport and rejects
pending calls, then proves the App-owned child exited. Allow two seconds after
stdin EOF, two seconds after TERM, then KILL within a total ten-second budget for
this child only. Retain failed disposal ownership in the internal ledger for
gateway cleanup retries. Normal App shutdown gates/cancels all owners and
attempts every Server/catalog/router disposal in parallel with normal target
shutdown despite peer failures, without imposing a new target-close deadline.

## Data directory isolation boundary

The accepted [ADR 0015](../adr/0015-explicit-data-directory-isolation.md) replaces
the fixed Chrome profile and unconditional retention policy with the following
required boundary.

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

Before every launch in either isolation mode, conservatively treat the target as
a singleton and perform a read-only occupancy gate. Use verified application
identity and effective-root attribution when available. A related running app
whose independent scope cannot be established, known busy evidence or incomplete
inspection leaves the target unlaunched. Do not research singleton capability or
waive this gate for documented multi-instance support. A new directory alone does
not prove the absence of a shared instance namespace. Known explicit Chrome roots
also receive native runtime checks; omitted defaults and generic occupancy remain
workflow-owned, without guessed roots, generic Chrome markers or a new public carrier.

Delete-on-release must be authorized before launch and applies to the entire real
directory, including pre-existing contents. Resolve a root link/junction to its
actual target for binding and deletion; child links never widen deletion scope.
Validate launch/options before acquisition, reject concurrent canonical equal or
ancestor/descendant claims, and reverify root identity before deletion. Missing
existing directories and new-name collisions fail without switching operations.
Changed or unverifiable identity retains ownership instead of deleting a replacement.
Chrome deletion also rechecks native profile availability. External active use or
unverifiable occupancy retains the claim even after a launch fails without our app.
Preserve acquired path and ownership evidence after any post-creation verification
failure; a failed result cannot discard an acquired directory or its claim.

Hold a connection-level lease across restart and release only after no live app,
pending native acquisition/permission wait/late creation, successor or relevant
read/write resource remains. Keep retains it until actual exit. An
intermediate restart exit cannot release it; final failed/cancelled restart can
only release when the barrier is satisfied. Failed observation/Close/rollback
with live or pending app retains ownership. Failed disposal remains in the
in-memory ledger; retry completes cleanup without restoring the removed route.
Hard crash or disconnect without verified actual exit cannot guarantee subsequent
deletion. No persistence, daemon or scan of old state is permitted.

Real paths, policy and cleanup state appear only in explicit operation metadata
and selected configuration, including failed/cancelled startups. Later cleanup
updates original start metadata without changing its terminal result/state or
issuing a new completion notice. Default summaries omit paths and raw
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

Client cancellation, disconnect or response timeout detaches only that wait.
Keep the healthy official execution, target and route, and refuse overlapping
execution/transfer until its actual response or definitive upstream termination.
Forward progress and form elicitation only to the originating available request
context. The SDK deadline cannot prove actual completion: observe the matching
wire response or definitive close without replay or private SDK patches. Cancellation races
must normally close created apps or report accurate retained identity. Idempotent
request IDs, current-session checks and bounded event cursors protect mutations.
Cancelling a protocol wait leaves the operation running and queryable.

Server defaults enable extensions and disable usage statistics and CrUX. Only
compatible Chrome may use extension tools. mcpArgs are immutable after start; configuration changes require completed Close
and a new start. Core restart requires target, official or both scope and retains
connection roots and effective executable/argv/cwd/environment/official options. Do not permit upstream arguments to alter identity or
inject a shell. See [supply-chain.md](supply-chain.md) for dependency requirements.
