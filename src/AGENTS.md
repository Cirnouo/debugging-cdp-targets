# Runtime boundaries

Before changing App ownership or transport, read
[ADR 0017](../docs/adr/0017-singleton-desktop-app.md). The singleton Electron App
owns core resources and direct HTTP; host plugins are thin.


Dependencies flow interface → application → domains/Gateway/shared;
application may use explicit adapters. Adapters may consume the delivered pure gateway argument
rules, target models and pure Official options/execution/release evidence, or its
exact diagnostics clock, and never depend on
application/interface or any mutable Gateway service.
The pure Official owners contain no ambient defaults, package reads, live catalog
or child/context lifetime authority. Their actual environment default capture,
child snapshot and verified bin resolution remain in adapters/official-server.ts.
Before editing those pure owners, read their cumulative
[Official instructions](gateway/official/AGENTS.md).
Pure Gateway rules may depend only on gateway/domains/shared through relative
imports; domains/shared and pure Gateway owners must not import the clock,
including through erased syntax. Domains may additionally consume only the exact
relative target value owners gateway/targets/model/isolation.ts and
gateway/targets/model/launch-command.ts; this grants no Host payload or shared
permission to depend on Gateway. Only gateway/diagnostics.ts may read its existing
performance.now() clock and depend on the pure domains/control-contract.ts.
Domains and pure Gateway owners contain no environment, file, process, network or
PowerShell I/O. The exact gateway/connections/resource-owner.ts owns resource
generation state and permits only its target-contract TYPE dependency. The exact
gateway/connections/directory-lease.ts owns connection-level lease lifetime through
the existing data-directory and fixture-diagnostics adapters, plus isolation and
resource-owner TYPE dependencies. Neither role gains ambient process/environment,
clock, filesystem, network, native or external-package access. Pure owners cannot
depend on either mutable role, including through erased syntax; unknown Gateway
files remain pure. Before changing these lifetime owners, read their cumulative
[connections instructions](gateway/connections/AGENTS.md).
Only gateway/core.ts owns registration/registry/catalog composition and trusted
construction cleanup. Its value capabilities are crypto, the existing cdp-router,
chrome-profile, data-directory, mcp-bridge and tool-catalog adapters, application
client-context/registrations, shared errors and the registry/managed factory.
SDK Tool, ControllerHost, request/diagnostic/client-context and the original moved
RuntimeRouter are TYPE-only. Its sole ambient capability is the supplied-now
fallback Date.now reference, never a clock call.
Only gateway/connections/managed-connection.ts owns managed state, generation
pointers, handler/lifecycle, actual execution/context, authorization and transfer.
Its exact value providers are crypto, official-server, port-reservation, target-host,
application client-context/mcp-lifecycle, domain control-contract/request-failure,
shared/errors, diagnostics and the start-admission/connection-view factories.
SDK client, chrome-profile/data-directory/mcp-bridge/tool-catalog, target-controller,
registrations, registry, resource-owner, directory-lease, workspace-policy and shared
client-context are TYPE-only. Its synchronous factory creates one original
lifecycle/port/host composition, without acquisition or catalog reads.
Only gateway/connections/start-admission.ts owns the whole start transaction,
persistent callbacks, rollback and final directory retry. Its value providers are
crypto/os/path, fixture-diagnostics, mcp-bridge, official-server, application
client-context/target-controller, domain control-contract, shared constants/errors,
target isolation/launch, directory-lease and workspace-policy. Chrome-profile,
data-directory, lifecycle/registrations, registry, original managed types,
resource-owner and connection-view are TYPE-only. It alone retains the existing
process.env spread and process.platform comparisons. Pass the same lifecycle at
start invocation; never add a getter, second instance, wrapper, await or snapshot.
Only gateway/connections/connection-view.ts owns live status, selected configuration,
guarded post-control catalog projection and administration inventory. Its value
providers are only official-server and domain control-contract; tool-catalog,
registry and original managed types are TYPE-only. Preserve the live bounded
reader, original branches/order and invocation-time ambient defaults for unselected
tool discovery. It gains no direct ambient, mutation, lifecycle or I/O capability.
All three use supplied services and gain no Date fallback, clock call
or general ambient I/O. View/admission factories execute no providers at construction.
Core supplies the live synchronous readCatalog reader; use it only at the original
validation, post-lifecycle status guard and optional invocation-requirements points,
never captured across await or cached. The registry/managed cycle is erased only.
The pure gateway/connections/workspace-policy.ts describes only supplied workspace
arguments, negotiated-roots support and a required temporary directory through
official/options.ts. Start admission captures that directory before awaiting roots;
the calculation gains no ambient defaults, grants or connection authority.
Only gateway/registry.ts owns route membership and the retained cleanup ledger:
its value dependencies are connections/resource-owner, adapters/fixture-diagnostics,
domains/control-contract and shared/errors. TYPE-only dependencies are the original
managed owner ManagedConnection, connections/directory-lease, shared/client-context and the
three exact application registrations/mcp-lifecycle/target-controller ports. Its
sole ambient capability is the existing direct process.stderr.write diagnostic.
None of these service roles grants permissions to siblings, pure owners, adapters or unknown
Gateway files. Type imports, reexports, import() and require obey the same exact
role boundaries. Before editing Core, registry, managed-connection, start-admission or
connection-view, read the cumulative
[Gateway instructions](gateway/AGENTS.md) and their application lifecycle trigger.
Diagnostic value/callback types remain in the current domain contract; its
complete relocation and other symbol/caller changes remain future work.
The existing semver/functions/parse.js exception remains limited to
domains/software-version.ts; pure Gateway gains no external dependency exception.
The delivered `host-plugins/` slice is also pure: it depends only on its own
domain, existing domains and shared contracts. Application and adapters consume
its payload proof directly; the remaining technical-layer owners stay in place.

Only interface/app-bootstrap.ts executes directly. It synchronously redirects
Chromium userData/sessionData to separate per-process temporary directories before
any await or controlled main import. App main owns the OS-user lease, selected
configuration and cleanup-gated normal exit. Never call Electron's singleton API.

The official SDK HTTP adapter authenticates explicit registrationBearer on every
owned tool request. Official _dct contains bearer, connectionId and sessionId;
strip it completely before forwarding unchanged arguments/results. MCP sessions
never hold an implicit owner. Accepted asynchronous jobs retain original request
facilities until admission settles or their real client/session disconnects.
Client detach never requests application-owned cleanup. Seven ordinary
registration/lifecycle/operation tools extend the catalog; no public entryId,
task activity, end-task, Hooks or injected notices. Tests replace I/O boundaries.
Never add persisted runtime state, plugin CLI or administrative control IPC.


The accepted [isolation design](../docs/adr/0015-explicit-data-directory-isolation.md)
requires pure isolation/launch validation in gateway/targets/model/,
directory filesystem evidence and claims in adapters, and connection-level lease
lifetime/release barriers in gateway/connections/. Gateway registry owns route
membership and retained cleanup/retry joins; the managed owner retains explicit operation evidence. Target and official resources have independent generation owners alongside the
logical connection/router owner. Public session identity changes after either side
restarts and is distinct from those internal generations. Start requires explicit isolation; no fixed profile fallback
or automatic path disclosure through Hooks/default summaries is permitted.

Use strict, Node-erasable TypeScript with explicit `.ts` imports and owned types.
Do not use enums, parameter properties, runtime namespaces, path aliases, broad
`any`, suppression comments, double assertions, or typecheck exclusions. Treat
JSON, HTTP, IPC, helper and process output as `unknown` until runtime validation.
Type-only imports/exports and type `import()` obey the same dependency rules.
esbuild erases types for delivery; `tsc --noEmit` is the correctness gate.
