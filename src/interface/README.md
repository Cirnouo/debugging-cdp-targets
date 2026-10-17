# Composition interfaces

- `app-window.ts` composes the sandboxed local management window, fixed asset
  protocol and sender/frame-checked management channel.
- `app-preload.ts` exposes only validated inspect, configure, quit and restart
  actions through a frozen context bridge.
- `app-renderer.ts`, `app.html` and `app.css` render desired/effective settings
  and startup/cleanup status. The window cannot start target applications.
- `mcp-bootstrap.ts` starts the reusable gateway, which owns host MCP stdio
  through the official SDK.
- `AGENTS.md` defines public entry and output contracts.
