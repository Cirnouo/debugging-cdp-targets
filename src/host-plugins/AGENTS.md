# Pure Host payload proof

Keep payload validation, endpoint evidence and byte overlays deterministic and free
of filesystem, process, environment and network I/O. Import only this domain,
existing pure domains and shared contracts. The exact `payload-integrity.ts`
owner may use `node:util` for pure comparison; other Node dependencies stay out.

Filesystem reads, Claude leases and the complete atomic write/readback transaction
remain in `../adapters/verified-plugin-files.ts`. Git, receipts and management
retain their current owners; this directory contains only the delivered proof.
