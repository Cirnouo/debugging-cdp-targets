# Claude Code packaging inputs

- `.claude-plugin/` owns the Claude Code manifest and default discovery guidance.
- `.mcp.json` starts the complete packaged stdio gateway using CLAUDE_PLUGIN_ROOT.
- `hooks/` owns automatic MCP Hooks.
- `assets/` owns payload artwork documentation; its icon comes from shared assets.
- `plugin-README.md` becomes the installed Plugin README.

The build combines these inputs with `packaging/shared/`, root LICENSE and the
shared generated runtime to create `plugins/claude-code/debugging-cdp-targets/`.
