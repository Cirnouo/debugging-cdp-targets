# MCP lifecycle protocol

This is the current lifecycle protocol for 0.1.0 Unreleased. The seven tools
operate through both eras of [MCP HTTP](mcp-http.md). The
[Gateway Core](../architecture/gateway-core.md) owns originating contexts,
immutable snapshots and actual execution. Requests, events, resources and
disposal retries live in gateway-local memory. A connection owns one newly
launched target. There is no target takeover, persistent session or Plugin
CLI/control channel.

[ADR 0013](../adr/0013-session-owned-exit-cleanup.md) records session ownership
and actual exit. [ADR 0015](../adr/0015-explicit-data-directory-isolation.md)
records connection directory leases. [Domain language](domain-language.md)
defines the shared terms.

## Requests and status selectors

The gateway exposes seven lifecycle/operation tools alongside the fixed reviewed
official catalog. Tools return the same JSON object as text content and
structuredContent. Register returns its bearer once. Every other tool explicitly
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

Status and start forbid `sessionId`. Start also forbids `connectionId`. Only stop
accepts `disposition`. Routing identities must authenticate the current owner and
session. Stale or removed routes fail closed.

| Status arguments | Projection |
| --- | --- |
| `{registrationBearer}` | `{connections}` belonging to that registration. |
| `{registrationBearer, connectionId}` | Owned selected summary plus enabledTools names. |
| `{registrationBearer, toolNames}` | Configuration requirements without asserting actual enablement or schemas. |
| `{registrationBearer, connectionId, toolNames}` | Exact requested schemas/enablement only when its upstream is valid. |
| `{registrationBearer, connectionId, include}` | Explicit configuration/diagnostics, combinable with toolNames. |
| `{registrationBearer, operationId}` | Owned operation snapshot, terminal result or bounded failure evidence. |

`include` accepts unique `configuration` and `diagnostics` values and requires
`connectionId`. Configuration contains `mcpArgs`, immutable roots and workspace
sources, effective launch and port policy, official generation evidence and
isolation evidence. `operationId`
cannot combine with connectionId, toolNames or include. Retired entry, Hook and
task-activity fields fail strict parsing.

A connection summary contains identities, target state, PID/port and other
bounded lifetime metadata, `enabledToolCount` and `upstreamStatus`. The
`upstreamStatus` field is `connected`, `disconnected` or `quarantined`, independently
of the target state. Failed native target observation can
quarantine the connection while ownership remains retained. Inspect selected
diagnostics and retry normal cleanup. Cancelling or timing out a client wait does
not quarantine a healthy official execution. Discovery, lifecycle success and
ordinary selected status do not include tool schemas, configuration or diagnostics.
Only explicit toolNames opts into tool details. Schemas require a valid actual
`tools/list`. Disconnected connections return requirements only. Selected `toolNames`
details include `toolCatalog: {revision, state}` when supplied by the real
upstream. Selected configuration includes `official.toolCatalog`. Catalog state
is `current`, `refreshing` or `unavailable`. A failed refresh retains last-known
schema details marked `unavailable`. New official forwarding fails with
`OFFICIAL_CATALOG_UNAVAILABLE` until a later validated refresh. The catalog
projection stays out of default summaries, and the outward tool list remains fixed.

Enabled tools never contain suggestedMcpArgs. Supported explicitly disabled tools
and TOOL_NOT_ENABLED failures provide complete replacement mcpArgs while retaining
explicit existing configuration. Unsupported tools return their reason without
an activation recipe. Configuration changes require completed Close and an
explicitly authorized new start. The gateway never enables a tool or restarts silently.

## Registration lifetime

An empty registration expires after 30 idle minutes. Expiry is checked before an
authenticated read or admission can refresh activity. Successful authenticated
reads, including status, refresh activity. Resources and nonterminal jobs block
expiry. Terminal history expires with the empty registration. Ownership stays in
memory.

Deduplication is scoped to the registration. An operation captures its owner on
acceptance. Idle transfer changes future resource admission while keeping
previous operation results with the original owner. See the
[Core client and registration boundary](../architecture/gateway-core.md#client-and-registration-boundary)
for trusted administrative admission and transfer guards.

## Start isolation

Every start requires the exact discriminated union below. Missing, unknown or
mixed fields fail before acquisition. Directory selection requires the explicit
operation. Existing path and new parent must be native absolute paths.
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
path is inserted opaquely after ordinary expansion. Inserted bytes never become
new environment or port placeholders. Executable/cwd cannot carry this placeholder.
None rejects it and performs no directory acquisition or cleanup. Chrome receives
no implicit profile path. Isolated Chrome requires the effective canonical
`--user-data-dir={dataDir}` binding. The runtime accepts only the equals-form switch before `--`. Duplicate,
separate-value and native alias forms fail. Generic apps use
the researched caller binding rather than a generated universal switch.

The Agent performs the shared read-only occupancy gate before every launch in
either mode, conservatively treating all targets as singletons. Known busy or
incomplete evidence leaves the target unlaunched. The runtime preserves native
known-root Chrome checks. Omitted defaults and generic occupancy remain Agent workflow
prerequisites.

## Operations and delivery

Mutations return operationId immediately. requestId binds identical retries to
one operation through canonical input identity. Conflicting reuse fails. Records
retain requestId, action, route, phase, elapsed time and cursor independently of
the connection registry. Removing an exited connection does not remove its
operation history.

After acquisition, the original start snapshot carries isolation evidence as
`{mode:'none'}` or `{mode:'data-dir', path, cleanup, state, nonempty?}`. Data-dir
state is held, retained, deleted or cleanup-failed. The `nonempty` field records
entry presence when inspection succeeded. Path is the actual absolute real directory, including
when later startup fails or is cancelled. Explicit selected configuration exposes
the same shape. Successful lifecycle results and default summaries omit it.
Later release/retry updates this metadata even after operation completion, without
changing state, result, error or event cursor. Query explicit
operation status for current cleanup evidence after its route has been removed.

States are accepted, running, cancelling, succeeded, failed and cancelled.
Events replay after the requested cursor from a bounded in-memory queue. Callers
use the returned cursor and `replayTruncated` indicator. One wait lasts up to
25 seconds and may return incomplete. The response budget leaves the job and target Close running. Continue waiting with the returned cursor. Cancelling a
wait leaves its job running and queryable.

Operation cancellation remains cancelling until cleanup settles. A late job
result cannot turn a cancelled operation into success or change a terminal record.
Cancelling work for an exited connection/session cannot cancel a newer session. Already-issued Close and restart operations retain their
own exit observation.
Successful lifecycle results are summaries. Failures preserve exact identity,
phase/code and native close/exit/listener evidence without tools, configuration
or diagnostics. Native `details.phase` takes precedence. Without that field,
a failure retains the operation's last active phase even after it becomes terminal.

Terminal snapshots remain explicitly readable by their immutable operation owner.
An identical repeated mutation returns the same record without new work. There
is no notice queue or acknowledgment. Accepted responses do not detach pending
roots facilities. See [HTTP request lifetime](mcp-http.md#request-lifetime).

## Target and resource lifetime

Logical router/directory ownership and independent target/official generation
owners exist before their acquisitions. Actual target exit immediately gates
forwarding, cancels dependent pending work and attempts cleanup.
An expected target-only restart exit disposes only the old target resources. Its
router and official Server remain owned. Exit cleanup bypasses lifecycle admission.
An ordinary exited connection and session are removed even when disposal fails.
Unclosed resources remain owned in an internal retry ledger.

Windows native wait and events establish actual application exit from the
verified PID, creation time and handle without periodic process inspection.
Helper exit, observation failure, window disappearance and a missing CDP listener
supply no exit proof. Observation failure reports a connection problem and
retains ownership. The [native Close and resource completion contract](../architecture/gateway-core.md#windows-normal-close-and-resource-completion)
separates root exit from completion of the descendant job, which also gates
Close completion, restart successors and directory release.

Close requires the user's explicit choice, requests normal app shutdown and waits
continuously for actual exit. There is no ten-second target-close deadline and
no application force kill. An unrelated CDP listener neither becomes the target
nor couples application Close to official Server lifetime. Failed or cancelled
Close retains ownership, observation and retry identity while the app remains
alive. Keep retains live app/upstream/router resources and observation.

After ordinary actual exit, retry uses a new start and fresh connection/session
identities. Restart requires target, official or both scope. The connectionId,
router and directory lease stay stable. Each requested side is replaced once. Every scope
invalidates the old public session. Fixed ports refuse collisions. Automatic
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
or cancelled restart request release after successor and pending work settle.
Keep holds it until actual exit. Failed Close, observation or rollback
with an unconfirmed live app retains the lease. A settled native launch cannot
later publish a newly created app. Cancellation during helper authorization
keeps reading evidence until actual app identity or physical helper completion.

Final release requires no pending acquisition/successor, confirmed app exit or no
created app for every associated owner, and successful dependent resource disposal.
Retain then releases the claim while preserving contents. Delete-on-release removes
the entire actual root, including pre-existing data, after rechecking root identity.
Chrome deletion also rechecks native profile availability. External busy or
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
with normal target shutdown and no target-close deadline. Failed cleanup
rejects exit, retains live/pending ownership and observation and allows retry.
Directory release still waits for starts, replacements, native permission/late
acquisition, official/router disposal and every native resource user.

## Transport and request ownership

Official calls supply the current bearer, connection and session in `_dct`.
The [HTTP authentication and request contracts](mcp-http.md#http-and-authentication)
define routing, original facilities and input admission. The
[request lifetime](mcp-http.md#request-lifetime) covers best-effort wire
cancellation after the original accepted SSE ends. Explicit cancel or final
cleanup ends local admission and its SDK wait. Late roots cannot acquire
resources or revive the operation.

Read owned status and operations explicitly. No automatic Hooks, `taskActive`,
`end-task`, notification injection or replay is available. Obtain Close or Keep
before ending target work.
