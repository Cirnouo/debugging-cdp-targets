# Codex manifest

`plugin.json` identifies the plugin, registers `./mcp.json` and declares
`./hooks/hooks.json`. Paths in the manifest resolve from the plugin root.
`repository`, `homepage` and `interface.websiteURL` identify the GitHub project.
`interface` owns the display name, short and long descriptions, artwork paths
and starter prompts. The full long description is retained after manual Codex
Desktop 26.1002.52244 display confirmation; see the dated
[host metadata record](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/host-metadata.md).
Plugin MCP and Hook discovery is covered by isolated Codex 0.160.0 integration tests.
