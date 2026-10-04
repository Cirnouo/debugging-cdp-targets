# I/O adapters

- `cdp-router.ts` forwards loopback HTTP/WebSocket CDP and tracks requests.
- `lifecycle-tools.ts` declares the seven MCP lifecycle/operation interfaces.
- `tool-catalog.ts` exposes the fixed official catalog, parameter variants,
  actual connection enablement and configuration recipes/workspace sources.
- `official-server.ts` validates the delivered release before resolving its public Server bin and validates options.
- `official-package.ts` verifies the complete official release tree and returns its original bytes.
- `mcp-bridge.ts` connects the official Server through the public SDK Client.
- `mcp-entry-server.ts` exposes routed official and MCP lifecycle tools
  through the SDK gateway on stdio.
- `target-host.ts` launches and verifies a newly created target. Its Chrome preset
  adds `--disable-updater-scheduler` to suppress automatic updater startup in
  the debugging process and preserves explicit switches during recovery.
- `chrome-profile.ts` checks native profile locks and reserves canonical directories.
- `platform-process.ts` obtains OS identity/reservations and normal shutdown;
  Linux root creation evidence preserves kernel start tick precision.
  Darwin verifies mapped hard-link aliases against the installed executable's
  device/inode, and failures retain bounded executable identity metadata.
  Unix normal close waits for complete exit evidence across disappearing mappings,
  retaining identity failures and the bounded wait without sending another signal.
- `windows-cdp-helper.ps1` supplies Windows process/listener evidence.
- `windows-launch.ts` validates the native helper protocol and actual app events.
- `windows-native-helper.ps1` orchestrates native launch/close, permission waiting
  and authenticated one-shot elevation with private structured data transfer.
- `windows-native-process.cs` owns Win32 handles, permission/manifest evidence,
  environment-preserving process creation, pipe authentication and WM_CLOSE.
- `AGENTS.md` defines I/O safety and platform contracts.

The bundled gateway uses the public `@modelcontextprotocol/client`, `server` and
`core` SDK packages pinned to 2.2.0. It retains legacy stdio initialization, roots,
form elicitation, progress and cancellation. Catalog pages are walked without the
SDK aggregate page cap, and calls validate against the original output schemas.
