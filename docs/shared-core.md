# Shared gateway core

`createGatewayCore()` in `src/application/plugin-runtime.ts` constructs the
transport-independent core and fixed official catalog. It attaches no client and
launches no target. Catalog discovery owns a short-lived verified official child
and router and disposes both before returning. The delivered stdio wrapper still
owns entryId, seven lifecycle tools, task activity and Hooks; EOF explicitly asks
for final cleanup. This seam does not deliver HTTP or a desktop App.

## Client and registration boundary

`register()` returns fresh cryptographic bearer material once, together with its
internal principal. `attachClient(bearer)` verifies the bearer and returns a client
handle. Its `request(facilities)` creates an originating request context with SDK
request identity, negotiated capabilities, roots reader, request-scoped form
elicitation/progress and response-wait signal. `detach()` makes those facilities
unavailable without cleaning resources. `core.control(request, context)` and
`core.invoke(name, arguments, context)` authorize that exact verified principal.
The stdio facade uses a trusted in-process principal without bearer recovery or
agent idle expiry; it is excluded from the agent-registration inventory.

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
Roots notifications, ambient environment changes and ownership transfer cannot
widen an existing connection's authorization.

The admitted snapshot preserves executable, argv/cwd, effective target and
ordinary-Node official environments, official options and fixed/automatic port
policy. Prepared templates expand ordinary environment variables once, then bind
only recorded port/data-directory tokens. Inserted directory bytes stay opaque.
Fixed ports refuse collisions. Automatic policy may select a new verified free
port without changing unrelated decimal/path bytes or retrying after app creation.
Changed application or official configuration requires completed Close/new start.

Core restart requires explicit `target`, `official` or `both` scope. Only the old
stdio facade maps omitted scope to `both`. Logical connectionId/router/directory
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
The default stdio path uses `process.execPath` and module-relative complete-release
verification. `OfficialConnection.processId` identifies the actual owned child.
