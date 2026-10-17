# Claude Code packaging inputs

- `.claude-plugin/` owns the Claude Code manifest and default discovery guidance.
- `.mcp.json` connects directly to the App's fixed loopback HTTP URL.
- `assets/` owns payload artwork documentation; its icon comes from shared assets.
- `plugin-README.md` becomes the installed Plugin README.

The build combines these inputs with `packaging/shared/` and root LICENSE to
create the thin `plugins/claude-code/debugging-cdp-targets/` payload.
