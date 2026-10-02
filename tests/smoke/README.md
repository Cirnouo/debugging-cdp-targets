# Explicit integration smoke

- `official-server.ts` tests the bundled bootstrap against an isolated Chrome,
  including tool discovery, reusable entry start/Close, and normal closure.
- `entry-recovery.ts` launches four gateway connections and two isolated Chrome
  fixtures. It checks independent UUIDs and targets, Keep, active-task loss form
  delivery, explicit same-port restart, idle loss deferral and explicit cancel.
  Run `node tests/smoke/entry-recovery.ts` after `pnpm build:plugin` on Windows.
  Form latency measures protocol receipt, not host UI rendering. Cleanup uses
  gateway stdin EOF and identity-verified normal target close; profiles remain in
  the printed temporary directory for inspection.
- `mcp-client.ts` is a test-only JSON-line stdio client; it is never shipped.
- `windows-monitor.ps1` samples visible console windows every 20 ms and reports
  newly visible console/terminal windows, without reading application data.
- `marketplace.ts` installs the local Plugin with an isolated Codex home.

These scripts are opt-in and may download the pinned official Server or open
dedicated test browser windows. The normal test suite never runs them.
