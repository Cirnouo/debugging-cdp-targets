# MCP lifecycle protocol

This is the current protocol for unreleased 0.1.0. [ADR 0013](adr/0013-session-owned-exit-cleanup.md)
records session ownership and actual exit; [ADR 0015](adr/0015-explicit-data-directory-isolation.md)
records connection directory leases. [Domain language](reference/domain-language.md)
defines its terms. The [shared core contract](shared-core.md) defines originating
clients, registration ownership, immutable snapshots and actual execution. Runtime state, requests, events and disposal retries are
gateway-local memory. There is no target takeover, persistent session or plugin
CLI/control channel.

The direct HTTP endpoint serves strict 2026-07-28 and sessionful legacy through
the same Core and fixed declarations. [ADR 0018](adr/0018-mcp-protocol-compatibility.md)
owns per-request capabilities, modern roots/form continuation, active-response
progress and private upstream catalog freshness. Explicit registration ownership
and the operation wait/result path apply to both eras.

Both eras admit at most 1 MiB of actual UTF-8 request bytes, 10,000 cumulative
object members plus array elements and 64 container levels including the root.
The complete envelope is checked before SDK classification and dispatch,
including metadata, capabilities and inputResponses. Strings count toward bytes;
their characters are not structural elements. Malformed JSON returns 400 and
exceeding a budget returns 413 with a fixed message, without echoing input or
consuming a pending continuation. These request limits do not limit responses
or close an existing session, connection or actual official execution.
Cooperative and exact-boundary requests retain complete closed client JSON
refusals. For flooding or deliberately incomplete uploads, the server must emit
the bounded real 413 headers and fixed JSON bytes, end and locally finish the
response, then close the actual request socket without dispatch or acquisition.
The client may receive that complete response or a known closed-upload transport
error before its deadline. These are distinct outcomes: local finish does not
prove client delivery, and an error alone, partial response or timeout is not
refusal evidence. No unbounded drain or additional TCP shutdown protocol is
part of this contract.

## Requests and status selectors

The gateway exposes seven lifecycle/operation tools alongside the fixed reviewed
official catalog. Tools return the same JSON object as text content and
structuredContent. Register returns its bearer once; every other tool explicitly
authenticates registrationBearer before any owned read or effect. MCP sessions
hold no implicit current registration. There is no public entry identity.

| Tool | Required identity and behavior |
| --- | --- |
| `dct_registration_register` | No arguments; returns public registrationId and one-time private registrationBearer. |
| `dct_connection_status` | registrationBearer with optional connectionId, operationId or toolNames. |
| `dct_connection_start` | registrationBearer, requestId, structured launch and required isolation; creates a new connection/session. |
| `dct_connection_restart` | registrationBearer, connectionId, sessionId, requestId and target/official/both scope; uses the immutable start snapshot. |
| `dct_connection_stop` | registrationBearer, connectionId, sessionId, requestId and explicit Close/Keep disposition. |
| `dct_operation_wait` | registrationBearer and operationId, optionally the previous cursor; waits for events or completion. |
| `dct_operation_cancel` | registrationBearer and operationId; cancels its job and awaits actual cleanup. |

Status and start forbid sessionId; start also forbids connectionId. Only stop
accepts disposition. Routing identities must authenticate the current owner and
session; stale or removed routes fail closed.

| Status arguments | Projection |
| --- | --- |
| `{registrationBearer}` | `{connections}` belonging to that registration. |
| `{registrationBearer, connectionId}` | Owned selected summary plus enabledTools names. |
| `{registrationBearer, toolNames}` | Configuration requirements without asserting actual enablement or schemas. |
| `{registrationBearer, connectionId, toolNames}` | Exact requested schemas/enablement only when its upstream is valid. |
| `{registrationBearer, connectionId, include}` | Explicit configuration/diagnostics, combinable with toolNames. |
| `{registrationBearer, operationId}` | Owned operation snapshot, terminal result or bounded failure evidence. |

include accepts unique `configuration` and `diagnostics` values and requires
connectionId. Configuration contains mcpArgs, immutable roots/workspace sources, effective launch
and port policy, official generation evidence and isolation evidence. operationId
cannot combine with connectionId, toolNames or include. Retired entry, Hook and
task-activity fields fail strict parsing.

A connection summary contains identities, target state, PID/port and other
bounded lifetime metadata, enabledToolCount and upstreamStatus. upstreamStatus is
`connected`, `disconnected` or `quarantined`. Failed native target observation can
quarantine the connection while ownership remains retained; inspect selected
diagnostics and retry normal cleanup. Cancelling or timing out a client wait does
not quarantine a healthy official execution. Discovery, lifecycle success and
ordinary selected status do not include tool schemas, configuration or diagnostics.
Only explicit toolNames opts into tool details. Schemas require a valid actual
tools/list; disconnected connections return requirements only. Selected `toolNames`
details include `toolCatalog: {revision, state}` when supplied by the real
upstream; selected configuration includes `official.toolCatalog`. A failed
refresh retains last-known schema details marked `unavailable`, and new official
forwarding fails `OFFICIAL_CATALOG_UNAVAILABLE` until a later validated refresh.
Default summaries stay unchanged; the outward tool list remains fixed.

Enabled tools never contain suggestedMcpArgs. Supported explicitly disabled tools
and TOOL_NOT_ENABLED failures provide complete replacement mcpArgs while retaining
explicit existing configuration. Unsupported tools return their reason without
an activation recipe. Configuration changes require completed Close and an
explicitly authorized new start; the gateway never enables a tool or restarts silently.

Every start requires the exact discriminated union below. Missing, unknown or
mixed fields fail before acquisition; directory selection never falls back to
another operation. Existing path and new parent must be native absolute paths.
Existing requires a present directory. New requires an existing parent and creates
one exclusive named leaf, or a random `dct-` child when name is omitted.

```typescript
type Isolation =
    | { mode: 'none' }
    | {
        mode: 'data-dir';
        directory:
            | { kind: 'existing'; path: string }
            | { kind: 'new'; parent: string; name?: string };
        cleanup: 'retain' | 'delete-on-release';
    };
```

Data-dir requires `{dataDir}` in structured launch args or env. The actual canonical
path is inserted opaquely after ordinary expansion; inserted bytes never become
new environment or port placeholders. Executable/cwd cannot carry this placeholder.
None rejects it and performs no directory acquisition or cleanup. Chrome receives
no implicit profile path; isolated Chrome requires the effective canonical
`--user-data-dir={dataDir}` binding. Only the equals-form switch before `--` is
accepted; duplicate, separate-value and native alias forms fail. Generic apps use
the researched caller binding rather than a generated universal switch.

The Agent performs the shared read-only occupancy gate before every launch in
either mode, conservatively treating all targets as singletons. Known busy or
incomplete evidence leaves the target unlaunched. The runtime preserves native
known-root Chrome checks; omitted defaults and generic occupancy remain workflow
prerequisites rather than a guessed runtime resolver.

## Operations and delivery

Mutations return operationId immediately. requestId binds identical retries to
one operation through canonical input identity; conflicting reuse fails. Records
retain requestId, action, route, phase, elapsed time and cursor independently of
the connection registry. Removing an exited connection does not remove its
operation history.

After acquisition, the original start snapshot has isolation evidence:
`{mode:'none'}` or `{mode:'data-dir', path, cleanup, state, nonempty?}`. Data-dir
state is held, retained, deleted or cleanup-failed; nonempty records entry presence
when inspection succeeded. Path is the actual absolute real directory, including
when later startup fails or is cancelled. Explicit selected configuration exposes
the same shape. Successful lifecycle results and default summaries omit it.
Later release/retry updates this metadata even after operation completion, without
changing state, result, error or event cursor. Query explicit
operation status for current cleanup evidence after its route has been removed.

States are accepted, running, cancelling, succeeded, failed and cancelled.
Events replay after the requested cursor from a bounded in-memory queue; callers
use the returned cursor and replayTruncated indicator. One wait lasts up to
25 seconds and may return incomplete. It is a response budget, not a job or
target-close timeout. Continue waiting with the returned cursor. Cancelling a
wait leaves its job running and queryable.

Operation cancellation remains cancelling until cleanup settles. A late job
result cannot turn a cancelled operation into success or change a terminal record.
Cancelling work for an exited connection/session cannot cancel a newer session;
already-issued Close/restart operations retain their own exit observation.
Successful lifecycle results are summaries. Failures preserve exact identity,
phase/code and native close/exit/listener evidence without tools, configuration
or diagnostics. Native details.phase takes precedence; otherwise a failure
retains the operation's last active phase even when its terminal state is failed.

Terminal snapshots remain explicitly readable by their immutable operation owner.
An identical repeated mutation returns the same record without new work. There
is no notice queue or acknowledgment. Accepted responses do not detach pending
roots facilities; see [HTTP request lifetime](app-runtime.md#request-lifetime).

## Target and resource lifetime

Logical router/directory ownership and independent target/official generation
owners exist before their acquisitions. Actual target exit immediately gates
forwarding, cancels dependent pending work and attempts cleanup.
An expected target-only restart exit disposes only the old target resources; its
router and official Server remain owned. Exit cleanup bypasses lifecycle admission.
An ordinary exited connection/session is removed even if disposal fails; unclosed
owned resources remain in an internal retry ledger.

Windows helpers are not applications. Native actual-app PID/time/handle
wait/events establish exit without periodic process inspection. Helper exit,
observation failure, a closed window or a missing CDP listener does not establish
actual application exit. Native observation failure reports a connection problem
and retains the still-live application's ownership.

Close requires the user's explicit choice, requests normal app shutdown and waits
continuously for actual exit. There is no ten-second target-close deadline and
no application force kill. An unrelated CDP listener neither becomes the target
nor couples application Close to official Server lifetime. Failed or cancelled
Close retains ownership, observation and retry identity while the app remains
alive. Keep retains live app/upstream/router resources and observation.

After ordinary actual exit, retry uses a new start and fresh connection/session
identities. Restart requires target, official or both scope. ConnectionId, router and directory
lease remain stable; only requested sides are replaced, each once. Every scope
invalidates the old public session. Fixed ports refuse collisions; automatic port
policy may select another verified free port from the recorded binding template.
Restart never accepts replacement mcpArgs or changed launch/environment/roots.
Obtain fresh list_pages evidence. No automatic relaunch, scope escalation or tool
replay occurs.

Port reservation is gateway-local and synchronous before probing. It remains
owned until actual exit or evidence that no app was created. Profile reservation
likewise remains attached to application lifetime.
OS authorization waiting precedes the separate bounded CDP readiness phase.

A separate connection directory lease covers every old/current session, pending
native acquisition and replacement hold, independently of routable connections.
Restart preserves the same real directory and cleanup policy. Expected old-session
restart exit does not request final release. Actual successor exit and final failed
or cancelled restart request release; successor/pending work must first settle.
Keep holds it until actual exit. Failed Close, observation or rollback
with an unconfirmed live app retains the lease. A settled native launch cannot
later publish a newly created app; cancellation during helper authorization keeps
reading evidence until actual app identity or physical helper completion.

Final release requires no pending acquisition/successor, confirmed app exit or no
created app for every associated owner, and successful dependent resource disposal.
Retain then releases the claim while preserving contents. Delete-on-release removes
the entire actual root, including pre-existing data, after rechecking root identity.
Chrome deletion also rechecks native profile availability; external busy or
unverifiable use holds the claim even after a failed launch with no owned target.
Cleanup failures remain in memory after route removal and retry after relevant
resource transitions or gateway cleanup. Retry never restores a route or relaunches.
A hard crash or disconnect without verified exit cannot promise eventual deletion.

Official Server disposal closes its public SDK transport immediately so pending
requests reject, then proves actual exit of the App-owned child. Its shutdown
sequence permits two seconds after stdin EOF, two seconds after TERM and KILL
within a total ten-second budget. Failure remains in the internal cleanup ledger.
This bounded child disposal never force-kills the target application.

Core client detach leaves resources and jobs owned. Normal App Quit explicitly
requests final cleanup after startup settles. Cleanup gates new work and attempts all peers
with normal target shutdown; no target-close deadline is added. Failed cleanup
rejects exit, retains live/pending ownership and observation and allows retry.
Directory release still waits for starts, replacements, native permission/late
acquisition, official/router disposal and every native resource user.

## Transport and request ownership

The App uses public SDK Streamable HTTP on exact loopback authority/path.
Registration ownership is independent of chat, HTTP socket and MCP session.
Official tools require `_dct: {registrationBearer, connectionId, sessionId}`;
the entire route is stripped before forwarding original arguments/results.
Headers do not assign an owner. Status/admin/errors never read back bearers.

Every SDK call supplies original roots, form elicitation and progress through its
own context. Accepted start does not mean client disconnect. Explicit cancel or
final cleanup terminates local admission and SDK wait; late roots cannot acquire
resources or revive the operation. Wire cancellation after the original accepted
SSE ends remains best-effort under the pinned SDK; see
[the precise limitation](app-runtime.md#request-lifetime).

No automatic Hooks, taskActive, end-task or notification injection remains.
Read owned status/operations explicitly and obtain Close/Keep before ending work.
