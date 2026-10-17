# Composition interfaces

- `app-window.ts` composes the sandboxed local management window, fixed asset
  protocol and sender/frame-checked management channel.
- `app-preload.ts` exposes only validated inspect, configure, quit and restart
  actions through a frozen context bridge.
- `app-renderer.ts`, `app.html` and `app.css` render desired/effective settings
  and startup/cleanup status. The window cannot start target applications.
- `app-bootstrap.ts` synchronously redirects Chromium caches before dynamically
  importing App composition; no asynchronous dependency precedes that redirect.
- `app-main.ts` verifies delivered resources, obtains singleton ownership before
  selected data creation, starts the shared core and direct SDK HTTP, and keeps
  the manager available when startup or normal cleanup fails. Quit waits for
  startup settlement and real cleanup success before releasing the process.
- `AGENTS.md` defines public entry and output contracts.
