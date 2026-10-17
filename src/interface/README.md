# Composition interfaces

- `app-window.ts` composes the sandboxed local management window, fixed asset
  protocol and sender/frame-checked management channel.
- `app-preload.ts` exposes only validated inspect, configure, manage, quit and restart
  actions through a frozen context bridge.
- `app-renderer.ts` mounts the React `app-manager.ts` dashboard. `app.html` and
  `app.css` provide fixed local assets and the desktop layout. The dashboard
  displays registrations, connections and the Core operation registry, scoped
  restart, Close/idle transfer, cached host management and desired/effective
  settings. Local clock ticks and summary refreshes invoke no host CLI.
  The window cannot start target applications.
- `app-bootstrap.ts` synchronously redirects Chromium caches before dynamically
  importing App composition; no asynchronous dependency precedes that redirect.
- `app-main.ts` verifies delivered resources, obtains singleton ownership before
  selected data creation, starts the shared core and direct SDK HTTP, and keeps
  the manager available when startup or normal cleanup fails. Quit waits for
  startup settlement, admitted configuration writes, native host-management work
  and real Core cleanup success before releasing the process.
- `AGENTS.md` defines public entry and output contracts.
