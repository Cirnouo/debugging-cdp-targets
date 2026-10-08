# Codex manifest

`plugin.json` identifies the plugin, registers `./mcp.json` and declares
`./hooks/hooks.json`. Paths in the manifest resolve from the plugin root.
`repository`, `homepage` and `interface.websiteURL` identify the GitHub project.
`interface` owns the display name, short and long descriptions, artwork paths
and starter prompts. The long description requires actual Codex Desktop display
confirmation before it is retained.
Plugin MCP and Hook discovery is covered by isolated Codex 0.160.0 integration tests.
