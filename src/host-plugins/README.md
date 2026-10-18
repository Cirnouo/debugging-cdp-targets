# Host plugin payload proof

- `payload-integrity.ts` verifies immutable payload byte maps, proves the own MCP
    endpoint literal and overlays only that literal without I/O.
- `AGENTS.md` defines this pure boundary and its exact comparison dependency.

The filesystem transaction remains in `../adapters/verified-plugin-files.ts`;
Git sources, managed receipts, native host adapters and the application manager
retain their existing mapped owners. Host URL rules remain in the pure
`../domains/host-management.ts` model.
