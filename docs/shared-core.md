# Shared gateway core

`createGatewayCore()` in `src/gateway/core.ts` constructs the
transport-independent core and fixed official catalog. It attaches no client and
launches no target. Catalog discovery owns a short-lived verified official child
and router and disposes both before returning. The separately composed Electron
App owns direct SDK HTTP and final cleanup; thin Plugins never launch a core.
Core owns the complete managed-connection generation/execution object;
`src/gateway/registry.ts` owns route membership and retained cleanup joins over
those same objects, with no runtime back edge or duplicated capability shape.
See [App runtime](app-runtime.md) for bootstrap, storage and request lifetime.

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

Request deduplication is registration-scoped. Every lifecycle operation captures
its owner on acceptance. Transfer changes future resource admission, preserves
old operation/result ownership and refuses actual execution, lifecycle mutation,
pending acquisition or failed/in-progress disposal. It preserves connection roots.
Empty registrations expire after 30 idle minutes; expiry is checked before an
authenticated read/admission can refresh activity. Successful authenticated reads,
including status, refresh activity. Resources and nonterminal jobs block expiry;
terminal history expires with the empty registration. No ownership is persisted.

`admin` is a trusted in-process closure. Its registration, connection and operation
inventories, empty unregister, idle transfer, selected status and lifecycle control
cannot be enabled by agent JSON. Administrative control refuses new-target start.
Administrative unregister takes registrationId and transfer takes connectionId
and recipient registrationId from that inventory. The core resolves and validates
the current identity internally, so a GUI stores no bearer/principal mirror.
Connection establishment and last-real-operation timestamps are separate from
registration idle activity; status/wait/UI refresh do not update the latter
connection timestamp.

## Immutable launch and side lifetimes

Start reads initiating roots before connection directory/router/target/official
acquisition. Unsupported roots produce `[]`; a negotiated read failure aborts
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
Windows ordinary-variable lookup and override merging are case-insensitive;
POSIX names remain case-sensitive in the immutable snapshot.
Fixed ports refuse collisions. Automatic policy may select a new verified free
port without changing unrelated decimal/path bytes or retrying after app creation.
Changed application or official configuration requires completed Close/new start.

Core restart requires explicit `target`, `official` or `both` scope.
Logical connectionId/router/directory
stay stable; independently owned target and official generations change only when
their side is replaced. Any scope issues a fresh public sessionId. Expected target
exits are registered before normal Close on the actual target owner, carrying its
operation, native identity and generation; old target/official callbacks cannot
invalidate successors. Failed repair cleans once or reports retained ownership,
without scope escalation, launch retries or tool replay.

## Actual execution and response waits

One actual official execution occupies each connection; independent connections
remain parallel. Client cancellation, timeout or disconnect detaches only its
response. The original context remains associated with actual execution until a
real outcome, and unavailable progress/elicitation never goes to a later client.
Official successful results remain unchanged and have no second public archive.

SDK 2.2.0 has no public option to disable its execution timer. The bridge uses the
maximum safe Node timer, 2,147,483,647 milliseconds. That deadline can still send
`notifications/cancelled` and remove SDK response handlers. A single matching wire
identity ledger therefore remains occupied after SDK timeout until a real result,
protocol error response or definitive upstream close. A late response is consumed;
the original timeout remains a failure and is never converted to another client's
success. If the upstream suppresses its response after cancellation, the slot
stays busy until explicit Close or definitive upstream termination. Public SDK
transport messages pass through unchanged; private SDK implementations are never
imported, patched or used to replay requests. Definitive send failure closes the
owned official transport and clears pending SDK state; client wait expiry does not.

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
`OfficialConnection.processId` identifies the actual owned child.

Trusted `onCleanupReady` receives a readonly cleanup/state capability synchronously
before first catalog acquisition. Callback failure acquires nothing. The App
retains this capability through constructor failure, waits for all startup to
settle before cleanup, and keeps its manager/lease when cleanup fails. Catalog
pending acquisitions use the same owner barrier; late resources cannot escape
a successful cleanup.
