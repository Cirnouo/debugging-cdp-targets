# Runtime boundaries

Before changing App ownership or transport, read
[ADR 0017](../docs/adr/0017-singleton-desktop-app.md). The singleton Electron App
owns core resources and direct HTTP; host plugins are thin.


Dependencies flow interface → application → domains/shared; application may
use explicit adapters. Adapters may consume the delivered pure gateway argument
rules and never depend on application/interface. The current gateway slice may
depend only on gateway/domains/shared through relative imports. Domains and
gateway contain no environment, file, process, network, or PowerShell I/O.
The existing semver/functions/parse.js exception remains limited to
domains/software-version.ts; gateway gains no external dependency exception.
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
requires pure isolation/launch validation in domains,
directory filesystem evidence and claims in adapters, and connection-level leases,
release barriers and explicit operation evidence in application. Target and official resources have independent generation owners alongside the
logical connection/router owner. Public session identity changes after either side
restarts and is distinct from those internal generations. Start requires explicit isolation; no fixed profile fallback
or automatic path disclosure through Hooks/default summaries is permitted.

Use strict, Node-erasable TypeScript with explicit `.ts` imports and owned types.
Do not use enums, parameter properties, runtime namespaces, path aliases, broad
`any`, suppression comments, double assertions, or typecheck exclusions. Treat
JSON, HTTP, IPC, helper and process output as `unknown` until runtime validation.
Type-only imports/exports and type `import()` obey the same dependency rules.
esbuild erases types for delivery; `tsc --noEmit` is the correctness gate.
