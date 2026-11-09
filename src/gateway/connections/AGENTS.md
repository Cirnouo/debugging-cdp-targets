# Managed connections, resource generations, directory leases and workspace policy

Apply root, [source](../../AGENTS.md) and [Gateway](../AGENTS.md) instructions
cumulatively. Before changing acquisition, lifetime, cleanup or explicit evidence,
read [ADR 0015](../../../docs/adr/0015-explicit-data-directory-isolation.md),
[ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md) and
[ADR 0018](../../../docs/adr/0018-mcp-protocol-compatibility.md).

workspace-policy.ts describes only supplied workspace arguments, negotiated-roots
support and a required temporary directory, using ../official/options.ts. Keep its
five-field result and parser semantics; it has no ambient defaults, path resolution,
I/O, mutable grants or connection authority. Start admission retains the pre-roots snapshot
and original construction/capture order. This pure leaf gains none of the mutable
exceptions below, including through erased syntax.

BEFORE editing managed-connection.ts, start-admission.ts or connection-view.ts, read the canonical
[application lifecycle instructions](../../application/AGENTS.md) cumulatively.
managed-connection.ts retains the original state, generations, execution/context,
handler, one lifecycle, scoped restart, actual invoke, authorization and transfer.
start-admission.ts owns the whole start, all persistent callbacks, rollback and
final directory retry. Preserve the same managed object, lifecycle supplied at
start invocation, original context/defaults, roots/environment/temp capture and
acquisition order. No getter, proxy, second lifecycle, wrapper or extra await.
Only admission retains process.env spread, process.platform === 'win32' and explicit
crypto/os/path access. The managed owner retains crypto; all timestamps are supplied.
connection-view.ts owns live status/configuration/catalog projection and admin
inventory. Preserve all guards, repeated controller/status reads, clones, private
evidence branches and summary-before-principal/clocks/generation order. Its only
value imports are ../official/server-launch.ts and control-contract, with
tool-catalog, registry and original managed TYPES. Unselected tool discovery
computes current Official launch defaults at the original guarded branch.
Only managed connection, admission and view consume the Official launch owner,
each through its exact edge. Managed connection imports the target lifecycle
factory and host/router ports as TYPES. Admission imports the factory and
TargetLifecycleHost TYPE. Use only the exact parent-reviewed value/TYPE ports.
readCatalog remains a live
synchronous read at the original four regions, never a cache, setter or captured
reference across await. View/admission factories invoke no providers at construction.
Registry, admission and view consume original ManagedConnection through TYPE-only
edges; no runtime back edge, copied interface or second state authority is allowed.

resource-owner.ts owns one target, official, logical/router or catalog resource
generation, including pending acquisitions and retryable failed disposal. Enroll
ownership before acquisition. Register and retain late resources even after
retirement; join pending work until actual settlement. Preserve per-resource close
promise identity, all-peer disposal order and failures, resource versions and
retry barriers. Actual-exit evidence comes from the controller, never helper,
transport or observation failure. Abort/retire alone cannot prove application exit.

directory-lease.ts owns one connection lease across all session generations and
removed routes. Prevalidate before acquiring it; retain early acquired evidence
after failed verification. Release requires final release intent and no pending
acquisition/permission wait/late creation, successor, live app or relevant resource
user. An intermediate restart exit cannot release it. Preserve original diagnostic
origin, DataDirectoryError identity, shared release attempts and retryable failures.
Keep adapter filesystem identity/claim/deletion rights with the existing adapter.

Normal Close waits for actual application exit, without a target deadline or
force-kill. Failed Close/observation/rollback retains live ownership. Keep preserves
resources and observation. Failed resource disposal remains in gateway/registry.ts's in-memory
cleanup ledger without restoring dead routes; final App exit cannot succeed while
live/pending resources or leases remain. Cancellation detaches client waits only:
The managed owner retains actual official execution and original roots/progress/elicitation
facilities until real completion or definitive upstream close. No new registry,
parallel ledger, automatic restart/replay or persistent session state belongs here.

Preserve preauthorized retain or whole-directory delete-on-release and original
start metadata after failure/cancellation and later cleanup, without rewriting
terminal results or creating another operation. Real paths and raw filesystem
errors remain outside default summaries; only explicit operation/selected
configuration carries path evidence. No new snapshots, awaits or admission,
roots/factory/UUID ordering changes are implied by moving these complete algorithms.

The two resource/directory lifetime roles use only the parent's exact type/adapter
dependencies. Neither lifetime role gains ambient
process/environment, clock, filesystem, network, native or external-package access;
unknown siblings remain pure. Before editing these instructions or their loading
rules, read [progressive disclosure](../../../docs/policies/documentation.md#instruction-progressive-disclosure)
and [repository organization](../../../docs/policies/repository-organization.md).
