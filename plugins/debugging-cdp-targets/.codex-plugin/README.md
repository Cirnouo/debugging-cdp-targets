# Codex manifest

`plugin.json` identifies the plugin, registers `../mcp.json` and declares
`../hooks/hooks.json`. Paths in the manifest resolve from the plugin root.
Codex 0.160.0 loads lifecycle Hooks from this manifest format; its root-level
Agent Plugins manifest loader skips Hooks.
