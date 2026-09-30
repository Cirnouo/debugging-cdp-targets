# Explicit integration smoke

- `official-server.mjs` tests the bundled bootstrap against an isolated Chrome,
  including tool discovery, target switching, and normal closure.
- `mcp-client.mjs` is a test-only JSON-line stdio client; it is never shipped.
- `windows-monitor.ps1` samples visible console windows every 20 ms and reports
  newly visible console/terminal windows, without reading application data.
- `marketplace.mjs` installs the local Plugin with an isolated Codex home.

These scripts are opt-in and may download the pinned official Server or open
dedicated test browser windows. The normal test suite never runs them.
