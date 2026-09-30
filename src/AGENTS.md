# Runtime boundaries

Dependencies flow interface → application → domains/shared; application may
use explicit adapters. Adapters never depend on application/interface. Domains
contain no environment, file, process, network, or PowerShell I/O.

Only interface/control.mjs and interface/mcp-bootstrap.mjs execute directly.
The bootstrap never consumes or writes MCP stdin/stdout; official Server
inherits them. Tests inject adapters at I/O boundaries. Use shared/constants.mjs
for cross-layer invariants. Never add persisted session state or a CLI daemon.
