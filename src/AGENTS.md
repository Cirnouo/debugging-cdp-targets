# Runtime boundaries

Dependencies flow interface → application → domains/shared; application may
use explicit adapters. Adapters never depend on application/interface. Domains
contain no environment, file, process, network, or PowerShell I/O.

Only interface/control.ts and interface/mcp-bootstrap.ts execute directly.
The bootstrap owns host MCP stdin/stdout through the official SDK; the
gateway adds only required _dct connection/session routing to official input
schemas and removes it before forwarding. Official names and results remain.
Only lifecycle status, including automatic Hook output, extends the catalog. Each gateway has an
independent entry identity and manages any number of independent connections.
Tests inject adapters at I/O boundaries. Use shared/constants.ts
for cross-layer invariants. Never add persisted session state or a CLI daemon.

Use strict, Node-erasable TypeScript with explicit `.ts` imports and owned types.
Do not use enums, parameter properties, runtime namespaces, path aliases, broad
`any`, suppression comments, double assertions, or typecheck exclusions. Treat
JSON, HTTP, IPC, helper and process output as `unknown` until runtime validation.
Type-only imports/exports and type `import()` obey the same dependency rules.
esbuild erases types for delivery; `tsc --noEmit` is the correctness gate.
