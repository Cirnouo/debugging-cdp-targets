# Plugin payload

`.codex-plugin/` owns the Codex manifest. `mcp.json` declares the portable MCP
schema and registers one reusable stdio gateway; `LICENSE` is the MIT grant.
`hooks/` contains automatic exit reminder Hooks, `skills/` contains Agent guidance,
and `dist/` contains bundled runtime files requiring no install in this directory.
Hook execution requires Codex's standard review and trust of each definition.
