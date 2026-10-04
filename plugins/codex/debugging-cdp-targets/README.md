# Plugin payload

`.codex-plugin/` owns the Codex manifest. `mcp.json` declares the portable MCP
schema and registers one reusable stdio gateway; `LICENSE` is the MIT grant.
`hooks/` contains automatic exit reminder Hooks, `skills/` contains Agent guidance,
and `dist/` contains bundled runtime files requiring no install in this directory.
Hook execution requires Codex's standard review and trust of each definition.

`dist/official-server/` delivers the unchanged official chrome-devtools-mcp 1.10.1
release, including its public Server bin, resources, licenses, vendor notices and
published skills. The gateway verifies all of these bytes before each launch.
Consumers need Node 24.21.0; package preparation is a contributor task.
