# I/O adapters

- `cdp-router.ts` forwards loopback HTTP/WebSocket CDP and tracks requests.
- `control-ipc.ts` owns temporary per-user local control IPC.
- `official-server.ts` acquires the pinned public MCP package and inherits stdio.
- `hide-npm-console.ts` scopes hidden console spawning to npx acquisition.
- `target-host.ts` launches and verifies a newly created target.
- `platform-process.ts` obtains OS identity/reservations and normal shutdown.
- `windows-cdp-helper.ps1` supplies Windows API evidence and window close.
- `AGENTS.md` defines I/O safety and platform contracts.
