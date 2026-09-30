# I/O adapters

- `cdp-router.mjs` forwards loopback HTTP/WebSocket CDP and tracks requests.
- `control-ipc.mjs` owns temporary per-user local control IPC.
- `official-server.mjs` acquires the pinned public MCP package and inherits stdio.
- `hide-npm-console.cjs` scopes hidden console spawning to npx acquisition.
- `target-host.mjs` launches and verifies a newly created target.
- `platform-process.mjs` obtains OS identity/reservations and normal shutdown.
- `windows-cdp-helper.ps1` supplies Windows API evidence and window close.
- `AGENTS.md` defines I/O safety and platform contracts.
