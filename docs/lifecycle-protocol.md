# MCP lifecycle protocol

This is the current protocol for unreleased 0.1.0. [ADR 0013](adr/0013-session-owned-exit-cleanup.md)
records the ownership and actual-exit decision; [domain language](domain-language.md)
defines its terms. Runtime state, requests, events and disposal retries are
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
| `dct_connection_start` | entryId and requestId; structured launch creates a new connection/session. |
| `dct_connection_restart` | entryId, connectionId, sessionId and requestId; replace a still-live session on the original port. |
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
connectionId. Configuration contains mcpArgs and workspace sources. operationId
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
an activation recipe. The caller must authorize a start/restart to change
configuration; the gateway never enables a tool or restarts silently.

## Operations and delivery

Mutations return operationId immediately. requestId binds identical retries to
one operation through canonical input identity; conflicting reuse fails. Records
retain requestId, action, route, phase, elapsed time and cursor independently of
the connection registry. Removing an exited connection does not remove its
operation history.

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

One owner exists for each session before launch or resource acquisition. It owns
the actual target, router, official Server, subscriptions, reservations and
pending work. Actual target exit immediately gates forwarding, ends task
activity, cancels dependent pending work and attempts cleanup of every resource.
Exit cleanup bypasses lifecycle admission, so blocked startup or tool work cannot
delay it. The exited connection/session is removed even if a disposal fails;
unclosed plugin-owned resources enter an internal retry ledger.

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

After ordinary actual exit, retry uses a new start and new connection/session
identities. Explicit live restart keeps connectionId and the exact original port,
waits for old actual exit, disposes old resources and acquires a fresh owner,
router/upstream and session. A busy original port fails clearly. There is no
automatic restart, relaunch after a foreign-listener collision, or tool replay.

Port reservation is gateway-local and synchronous before probing. It remains
owned until actual exit or evidence that no app was created. Profile reservation
likewise remains attached to application lifetime; profile data remains on disk.
OS authorization waiting precedes the separate bounded CDP readiness phase.

Official Server disposal closes its public SDK transport immediately so pending
requests reject, then proves actual exit of the plugin-owned child. Its shutdown
sequence permits two seconds after stdin EOF, two seconds after TERM and KILL
within a total ten-second budget. Failure remains in the internal cleanup ledger.
This bounded child disposal never force-kills the target application.

Gateway disconnect first gates/cancels all owners, then attempts every official
Server, catalog and router disposal in parallel with normal target shutdown.
Peer cleanup continues after individual failures. Target shutdown gains no
additional deadline from gateway disconnect.

## Automatic Hooks

The four enabled, authorized host Hooks drain independent compact exit, operation
and connection events through status. With no pending event they return {} and
add no model context. Stop requests one continuation for an undelivered event;
idle chats wait for their next turn. Host trust/enablement controls remain required.

Expected Close/restart exit is grouped by operationId into its operation notice.
The notice's optional exits array contains all related actual exits, including
the old Target exit and any newly created Target rollback during one restart;
each exit retains its own identity, native exit facts and cleanupStatus or bounded
cleanupError. The operation's final route can differ from these exited routes.
Delivery waits until cleanup for every related exit is ready. While any related
cleanup is pending, neither its exit fact nor that operation notice is consumed.

Inactive target exit remains an informational lifetime event. Active unexpected
exit may suggest a new start; its old route is already removed. An operation
notice contains kind, entry/operation identity, action, state, phase and elapsed
time, optionally its connection/session identity, error code and compact exits.
Optional native failure fields are category, nativeError, exceptionType,
closeRequested, processExited, listenerState and closeConfirmed, each projected
as a primitive value. Full message/cause error text is excluded from notices.
It never embeds a complete result, error, configuration, diagnostics, tool schema,
tool names/counts or recipe. Connection errors while an application lives do not
announce process exit.
