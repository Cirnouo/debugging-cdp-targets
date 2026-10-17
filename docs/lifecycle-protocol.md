# MCP lifecycle protocol

This is the current protocol for unreleased 0.1.0. [ADR 0013](adr/0013-session-owned-exit-cleanup.md)
records session ownership and actual exit; [ADR 0015](adr/0015-explicit-data-directory-isolation.md)
records connection directory leases. [Domain language](domain-language.md)
defines its terms. The [shared core contract](shared-core.md) defines originating
clients, registration ownership, immutable snapshots and actual execution. Runtime state, requests, events and disposal retries are
gateway-local memory. There is no target takeover, persistent session or plugin
CLI/control channel.

## Requests and status selectors

The gateway exposes seven lifecycle/operation tools alongside the fixed reviewed
official catalog. Tools return the same JSON object as text content and
structuredContent. Each gateway has its own entryId. Initial empty status and
automatic Hook requests are the only requests without entryId.

| Tool | Required identity and behavior |
| --- | --- |
| `dct_connection_status` | Empty discovery, or entryId with optional connectionId, operationId or toolNames. |
| `dct_connection_start` | entryId, requestId, structured launch and required isolation; creates a new connection/session. |
| `dct_connection_restart` | entryId, connectionId, sessionId and requestId; explicit target/official/both replacement using the immutable start snapshot. |
| `dct_connection_stop` | entryId, connectionId, sessionId, requestId and explicit Close/Keep disposition. |
| `dct_connection_end_task` | entryId, connectionId, sessionId and requestId; end dependent work while retaining live resources. |
| `dct_operation_wait` | entryId and operationId, optionally the previous cursor; wait for events or completion. |
| `dct_operation_cancel` | entryId and operationId; cancel its job and await actual cleanup. |

Status and start forbid sessionId; start also forbids connectionId. Only stop
accepts disposition. Routing identities must identify the current gateway and
session; stale or removed routes fail closed.

| Status arguments | Projection |
| --- | --- |
| `{}` or `{entryId}` | `{entryId, connections}` with connection summaries only. |
| `{entryId, connectionId}` | Selected summary plus enabledTools names. |
| `{entryId, toolNames}` | Reviewed configuration requirements without asserting actual enablement or schemas. |
| `{entryId, connectionId, toolNames}` | Requested tool requirements; exact schemas and enablement only when its upstream is valid. |
| `{entryId, connectionId, include}` | Explicit configuration and/or diagnostics, combinable with toolNames. |
| `{entryId, operationId}` | Independent operation snapshot, including its terminal result or bounded failure evidence. |
| `{hookEventName}` | Automatic authorized Hook event delivery only. |

include accepts unique `configuration` and `diagnostics` values and requires
connectionId. Configuration contains mcpArgs, immutable roots/workspace sources, effective launch
and port policy, official generation evidence and isolation evidence. operationId
cannot combine with connectionId, toolNames or include. hookEventName must be the
sole argument and one of PreToolUse, PostToolUse, UserPromptSubmit or Stop.

A connection summary contains identities, target state, PID/port and other
bounded lifetime metadata, enabledToolCount and upstreamStatus. upstreamStatus is
`connected`, `disconnected` or `quarantined`. Discovery, lifecycle success and
ordinary selected status do not include tool schemas, configuration or diagnostics.
Only explicit toolNames opts into tool details. Schemas require a valid actual
tools/list; disconnected or quarantined connections return requirements only.

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
changing state, result, error, event cursor or completion notice. Query explicit
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

A terminal snapshot successfully returned through operation status, a complete
wait, cancel of an already terminal operation, or an identical repeated mutation
marks its completion notice read. The repeated mutation returns the same record
without performing the work again. Incomplete/running/cancelling responses,
cancelled waits, aborted requests and undelivered terminal records leave it
unread. These paths can replay the final record after acknowledgement;
acknowledgement only suppresses redundant Hook delivery.

## Target and resource lifetime

Logical router/directory ownership and independent target/official generation
owners exist before their acquisitions. Actual target exit immediately gates
forwarding, ends task activity, cancels dependent pending work and attempts cleanup.
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
alive. Keep/end-task retains live app/upstream/router resources and observation.

After ordinary actual exit, retry uses a new start and fresh connection/session
identities. Core restart requires target, official or both scope. The transitional
stdio facade alone maps omitted scope to both. ConnectionId, router and directory
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
Keep/end-task holds it until actual exit. Failed Close, observation or rollback
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
requests reject, then proves actual exit of the plugin-owned child. Its shutdown
sequence permits two seconds after stdin EOF, two seconds after TERM and KILL
within a total ten-second budget. Failure remains in the internal cleanup ledger.
This bounded child disposal never force-kills the target application.

Core client detach leaves resources and jobs owned. Transitional stdio EOF
explicitly requests final cleanup. Cleanup gates new work and attempts all peers
with normal target shutdown; no target-close deadline is added. Failed cleanup
rejects exit, retains live/pending ownership and observation and allows retry.
Directory release still waits for starts, replacements, native permission/late
acquisition, official/router disposal and every native resource user.

## Automatic Hooks

The four enabled, authorized host Hooks drain independent compact exit, operation
and connection events through status. With no pending event they return {} and
add no model context. Stop requests one continuation for an undelivered event;
idle chats wait for their next turn. Host trust/enablement controls remain required.

Expected Close/restart exit is grouped by operationId into its operation notice.
The notice's optional exits array contains all related actual exits, including
the old Target exit and any newly created Target rollback during one restart;
each exit retains its own identity, native exit facts and cleanupStatus or bounded
cleanupCode (`RESOURCE_CLEANUP_FAILED`). The operation's final route can differ from these exited routes.
Delivery waits until cleanup for every related exit is ready. While any related
cleanup is pending, neither its exit fact nor that operation notice is consumed.

Inactive target exit remains an informational lifetime event. Active unexpected
exit may suggest a new start; its old route is already removed. An operation
notice contains kind, entry/operation identity, action, state, phase and elapsed
time, optionally its connection/session identity, error code and compact exits.
Optional native failure fields are category, nativeError, exceptionType,
closeRequested, processExited, listenerState and closeConfirmed, each projected
as a primitive value. Full message/cause error text is excluded from notices.
Exit facts use an explicit field allowlist; raw disposal errors and directory
path, policy, state and entry-presence metadata are excluded.
It never embeds a complete result, error, configuration, diagnostics, tool schema,
tool names/counts or recipe. Connection errors while an application lives do not
announce process exit.
