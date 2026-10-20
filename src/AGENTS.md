# Runtime boundaries

Before changing App ownership or transport, read
[ADR 0017](../docs/adr/0017-singleton-desktop-app.md). The singleton Electron App
owns core resources and direct HTTP; host plugins are thin.


Dependencies flow interface → application → domains/Gateway/shared;
application may use explicit adapters. Adapters may consume the delivered pure gateway argument
rules, target models and pure Official options/execution/release evidence, or its
exact diagnostics clock, and never depend on
application/interface, either mutable Gateway service or the mutable target lifecycle.
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
Only gateway/core.ts owns the existing managed-connection transaction and actual
execution/context. Its exact application value providers are client-context.ts,
mcp-lifecycle.ts and registrations.ts; its target factory and host/router types
come from gateway/targets/target-lifecycle.ts. Its reviewed adapters
remain cdp-router, chrome-profile, data-directory, fixture-diagnostics, mcp-bridge,
official-server, port-reservation, target-host and tool-catalog; its node imports
remain crypto, os and path. SDK client, resource-owner and shared client-context
are TYPE-only. Core retains its existing process.env spread, process.platform
reads and supplied-now fallback to the Date.now reference; it gains no general
ambient I/O, SDK value dependency or clock-call permission.
Only gateway/registry.ts owns route membership and the retained cleanup ledger:
its value dependencies are connections/resource-owner, adapters/fixture-diagnostics,
domains/control-contract and shared/errors. TYPE-only dependencies are the original
Core ManagedConnection, connections/directory-lease, shared/client-context and the
two exact application registrations/mcp-lifecycle ports and the target lifecycle's
TargetExitEvent TYPE. Its
sole ambient capability is the existing direct process.stderr.write diagnostic.
Neither service grants permissions to siblings, pure owners, adapters or unknown
Gateway files. Type imports, reexports, import() and require obey the same exact
role boundaries. Before editing Core or registry, read the cumulative
[Gateway instructions](gateway/AGENTS.md) and their application lifecycle trigger.
The exact gateway/targets/target-lifecycle.ts owns its complete existing target
attachment, admission, health, normal-Close reuse, rollback, actual-exit and
retirement transaction. Its named UUID, diagnostic producer, resource-owner,
target/error values and control/resource/target TYPES are enumerated in the
[target instructions](gateway/targets/AGENTS.md). Only its existing direct
new Date().toISOString() exit timestamp is permitted. Pure owners and adapters
cannot depend on this mutable lifecycle, including through erased syntax.
Before editing it, read those target instructions and the canonical
[application lifecycle obligations](application/AGENTS.md) cumulatively.
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
membership and retained cleanup/retry joins; Core retains explicit operation evidence. Target and official resources have independent generation owners alongside the
logical connection/router owner. Public session identity changes after either side
restarts and is distinct from those internal generations. Start requires explicit isolation; no fixed profile fallback
or automatic path disclosure through Hooks/default summaries is permitted.

Use strict, Node-erasable TypeScript with explicit `.ts` imports and owned types.
Do not use enums, parameter properties, runtime namespaces, path aliases, broad
`any`, suppression comments, double assertions, or typecheck exclusions. Treat
JSON, HTTP, IPC, helper and process output as `unknown` until runtime validation.
Type-only imports/exports and type `import()` obey the same dependency rules.
esbuild erases types for delivery; `tsc --noEmit` is the correctness gate.
