# I/O adapters

- `cdp-router.ts` forwards loopback HTTP/WebSocket CDP and tracks requests.
- `control-ipc.ts` owns independent temporary control IPC for each entry.
  Unix socket names hash the user and entry identities and enforce a portable
  103-byte path limit; Windows uses entry-specific named pipes.
- `official-server.ts` acquires the pinned public MCP package and validates options.
- `mcp-bridge.ts` connects the official Server through the public SDK Client.
- `mcp-entry-server.ts` exposes the SDK gateway and lifecycle tools on stdio.
- `mcp-transport.ts` preserves cancellation for SDK request ID zero using temporary aliases.
- `hide-npm-console.ts` scopes hidden console spawning to npx acquisition.
- `target-host.ts` launches and verifies a newly created target.
- `platform-process.ts` obtains OS identity/reservations and normal shutdown.
- `windows-cdp-helper.ps1` supplies Windows API evidence and window close.
- `AGENTS.md` defines I/O safety and platform contracts.
