# Gateway Core

`createGatewayCore()` in `src/gateway/core.ts` constructs the
transport-independent core and fixed official catalog. It attaches no client and
launches no target. Catalog discovery owns a short-lived verified official child
and router and disposes both before returning. The separately composed Electron
App owns direct SDK HTTP and final cleanup. Thin Plugins never launch a Core.
Core retains substantive registration/registry/catalog and construction-cleanup
composition. The synchronous `createManagedConnections` factory in
`src/gateway/connections/managed-connection.ts` owns state, generations, request
handling, lifecycle, execution, originating context, authorization and transfer.
`src/gateway/registry.ts` owns route membership and retained cleanup joins over
those same objects, with no runtime back edge or duplicated capability shape.
The factory runs at the original port/host point without acquisition or catalog
reads. Core supplies a synchronous live readCatalog provider at the original
validation/status/requirements regions, never cached or captured across an await.
The registry/managed cycle is erased TYPE-only. `connections/start-admission.ts`
owns the whole start, persistent callbacks, rollback and final directory retry.
It receives the same lifecycle at invocation. `connections/connection-view.ts`
owns live status/configuration/catalog projection and administration inventory,
retaining invocation-time Official launch defaults at the original guarded branch.
Both factories construct synchronously without executing providers. They share
the live state authority and depend on ManagedConnection only as a type.
The complete `src/gateway/targets/target-lifecycle.ts` transaction composes the
supplied target host/router capabilities, owns actual-exit callbacks and exposes
explicit owner cleanup. Managed connection retains generation fences and registry
retains cleanup joins. Agent/MCP disconnect does not request that cleanup.
See [desktop startup and exit](desktop-runtime.md#startup-storage-and-exit) for
the App's final owner cleanup and [HTTP request lifetime](../reference/mcp-http.md#request-lifetime)
for public transport behavior.

## Client and registration boundary

`register()` returns fresh cryptographic bearer material once, together with its
internal principal. `attachClient(bearer)` verifies the bearer and returns a client
handle. Its `request(facilities)` creates an originating request context with SDK
request identity, negotiated capabilities, roots reader, request-scoped form
elicitation/progress and response-wait signal. `detach()` makes those facilities
unavailable without cleaning resources. `core.control(request, context)` and
`core.invoke(name, arguments, context)` authorize that exact verified principal.
Each HTTP tool request explicitly authenticates its own bearer and builds its own
request context. There is no anonymous/trusted stdio principal or session current
owner. Accepted responses retain pending admission facilities until settlement or
real originating client/session disconnect.

[Registration lifetime and operation ownership](../reference/mcp-lifecycle.md#registration-lifetime)
apply independently of the transport. Idle transfer changes future resource
admission and preserves the connection roots and the original owner's
operation/result records. The Core refuses transfer during actual execution,
lifecycle mutation, pending acquisition or failed/in-progress disposal.

`admin` is a trusted in-process closure. Its registration, connection and operation
inventories, empty unregister, idle transfer, selected status and lifecycle control
cannot be enabled by agent JSON. Administrative control refuses new-target start.
Administrative unregister takes registrationId and transfer takes connectionId
and recipient registrationId from that inventory. The core resolves and validates
the current identity internally, so a GUI stores no bearer/principal mirror.
Connection establishment and last-real-operation timestamps are separate from
registration idle activity. Status, wait and UI refresh leave the last-real-operation
timestamp unchanged.

## Immutable launch and side lifetimes

Start reads initiating roots before connection directory/router/target/official
acquisition. Unsupported roots produce `[]`. A negotiated read failure aborts
start. Each official roots response returns a clone of the connection snapshot.
Explicit lifecycle cancellation or final cleanup aborts roots admission before
resources are acquired, including the request-scoped SDK reverse request. Readers
that ignore abort have their late outcomes consumed without late acquisition.
Roots notifications, ambient environment changes and ownership transfer cannot
widen an existing connection's authorization.

The admitted snapshot preserves executable, argv/cwd, effective target and
ordinary-Node official environments, official options and fixed/automatic port
policy. Prepared templates expand ordinary environment variables once, then bind
only recorded port/data-directory tokens. Inserted directory bytes stay opaque.
Windows ordinary-variable lookup and override merging are case-insensitive.
The retained supplied POSIX model preserves case-sensitive names in its
immutable snapshot. The App and gateway run on Windows.
Fixed ports refuse collisions. Automatic policy may select a new verified free
port without changing unrelated decimal/path bytes or retrying after app creation.
Changed application or official configuration requires completed Close/new start.

Core restart requires explicit `target`, `official` or `both` scope.
Logical connectionId, router and directory stay stable. Independently owned
target and official generations change only when their side is replaced. Any
scope issues a fresh public `sessionId`. Expected target exits are registered
before normal Close on the actual target owner, carrying its
operation, native identity and generation. Old target or official callbacks
cannot invalidate successors. Failed repair cleans once or reports retained
ownership, without scope escalation, launch retries or tool replay.

## Actual execution and response waits

One actual official execution occupies each connection. Independent connections
remain parallel. Client cancellation, timeout or disconnect detaches only its
response. The original context remains associated with actual execution until a
real outcome, and unavailable progress/elicitation never goes to a later client.
Official successful results remain unchanged and have no second public archive.

SDK 2.3.1 has no public option to disable its execution timer. The bridge uses the
maximum safe Node timer, 2,147,483,647 milliseconds. That deadline can still send
`notifications/cancelled` and remove SDK response handlers. A single matching wire
identity ledger therefore remains occupied after SDK timeout until a real result,
protocol error response or definitive upstream close. A late response is
consumed. The original timeout remains a failure and is never converted to
another client's success. If the upstream suppresses its response after cancellation, the slot
stays busy until explicit Close or definitive upstream termination. The bridge
passes SDK transport messages through unchanged and uses only public SDK interfaces.
Definitive send failure closes the owned official transport and clears pending
SDK state. Client wait expiry detaches the response only.

## Actual official catalogs

The [Official upstream](../../src/gateway/official/upstream.ts) owns the private
catalog publisher, public SDK wire and Server child disposal for one generation.
It consumes launch inputs from [the verified launch owner](../../src/gateway/official/server-launch.ts).
The [package verifier](../../src/gateway/official/package-files.ts) owns the
separate filesystem proof. Core retains the fixed outward tool declarations.
Managed connection retains the original execution and client facilities across
calls and waits.

When the Server advertises `tools.listChanged`, the native SDK callback marks the
catalog dirty. One serialized, uncapped page walk validates the complete
candidate. Notifications during a walk coalesce into a dirty follow-up, which
startup drains before readiness. Validation rejects repeated cursors, duplicate
names, routing collisions and definitions outside the reviewed release variants,
including their output schemas. Canonical JSON equality allows property-order
differences. Publication assigns one snapshot under the original live official
owner. Close and official restart retire that publisher. Target-only restart
preserves it.

Refresh failure retains the last-known definitions, marks the catalog unavailable
and emits a bounded diagnostic. New forwarding waits for a validated refresh
prompted by a later notification or call admission. A failed attempt returns
`OFFICIAL_CATALOG_UNAVAILABLE`. Running calls and healthy resources remain live.
Every actual call captures its accepted Tool definition through SDK output
validation. Capability-free upstreams retain startup catalog knowledge without
claiming notification support. Controlled notification fixtures establish
refresh behavior. Emission of live changes by the fixed delivered release
configuration remains unverified. The [lifecycle status contract](../reference/mcp-lifecycle.md#requests-and-status-selectors)
defines the public revision and state fields.

## Windows normal Close and resource completion

The [target lifecycle](../../src/gateway/targets/target-lifecycle.ts) composes
supplied host and router capabilities for attachment, admission, health,
normal-Close reuse, rollback and actual-exit callbacks. The Windows adapters own
structured process launch, privilege checks, one-shot elevation, listener and
endpoint identity verification and native observation. OS authorization waiting
precedes the bounded CDP readiness phase. The gateway manages the verified
application PID, creation time and handle. A helper can report evidence but
its own exit supplies no application exit evidence.

The [native Close implementation](../../src/adapters/windows-native-process.cs)
checks executable identity, creation time and Windows session, then enumerates
top-level windows for the exact application PID. It chooses the first visible,
enabled window that has no owner, lacks `WS_CHILD` and `WS_EX_TOOLWINDOW`, and
has positive width and height unless minimized. Immediately before posting
`WM_CLOSE`, it rechecks the window's existence, PID and eligibility. Application
shutdown handlers and confirmation still run. A minimized window remains
minimized, and a multiple-window application can stay pending after the single
request. A missing eligible window or failed post yields explicit Close evidence.

Normal Close pauses the router before waiting on the original native application
handle. If Close fails while the application remains alive, the router can
resume. Loss of process observation gates forwarding, clears the target route
and aborts dependent pending work. The connection is quarantined and its
official upstream is retired while target ownership is retained.

Confirmed application exit immediately gates forwarding, cancels dependent
pending work and initiates exit cleanup. Helper exit, observation failure,
window disappearance, accepted message delivery and a missing CDP listener
cannot prove application exit. Final release requires verified application exit
and completion of the independent native resource barrier. A foreign listener
neither changes target identity nor couples target Close to the official
Server's lifetime. Close uses no artificial target-exit deadline or force kill.

The Windows launch atomically assigns the new application to an anonymous job
without kill-on-close, limits or breakaway permission. Actual root exit gates
routing immediately. Resource completion separately requires an authoritative
native query reporting zero active job processes. Completion-port notifications
and bounded waits schedule queries. Ordinary official and router cleanup
precedes the native resource wait, which still gates Close completion, restart
successors and directory release. Native job creation or observation failures
remain explicit. Ownership and claims survive when completion cannot be proved.
Job creation failure prevents fallback launch without observation. Directory
release and deletion require verified resource completion. The job covers
inherited descendants, including later generations and nested jobs. Arbitrary external brokers and unrelated writers fall outside that proof.

The native regression cases cover ordered technical and application windows,
minimized windows, no eligible window, multiple eligible windows, selection races,
window disappearance without exit and actual native exit before resource
release. The [interactive inventory](../../tests/interactive/README.md) and
[2026-10-12 Tauri and Windows Close record](../tauri-close-validation.md)
separate those regression surfaces from the dated application acceptance.

## Cleanup and runtime injection

`cleanup()` denies new work, normally closes targets and attempts every peer.
Failure rejects exit, retains live/pending owners, directory leases and failed
disposal evidence, and permits retry. `admin.cleanupState()` exposes open, closing,
failed or closed. Management and observation remain available after failure.
Applications are never force-killed. Directory release still waits for every
target, official, router, pending native acquisition and native resource user.

Trusted construction may supply immutable `officialRuntime: {nodeExecutable, bin}`.
Both catalog discovery and per-connection children use that same location through
`createConnection`; no agent request accepts it. The embedding application must
first verify its ordinary Node and complete unchanged official package/evidence.
The App always injects verified bundled ordinary Node and the original public
bin. Test composition supplies its verified development or sealed input explicitly.
`OfficialUpstream.processId` identifies the actual owned child.

Trusted `onCleanupReady` receives a readonly cleanup/state capability synchronously
before first catalog acquisition. Callback failure acquires nothing. The App
retains this capability through constructor failure, waits for all startup to
settle before cleanup, and keeps its manager/lease when cleanup fails. Catalog
pending acquisitions use the same owner barrier. Successful cleanup accounts
for late resources.
