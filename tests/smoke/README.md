# Explicit integration smoke

- `official-server.ts` tests the bundled bootstrap against an isolated Chrome,
  including tool discovery, reusable entry start/Close, and normal closure.
- `entry-recovery.ts` launches at least three concurrent isolated Chrome targets
  through one gateway. It checks independent UUIDs and parallel tool routing,
  Keep/reuse, scoped Close, later new connections, active-task loss form delivery,
  same-port restart, stale-session rejection, idle loss deferral and explicit cancel.
  A normal Close that reports retained identity may be retried twice with the
  same IDs; retries are logged and never escalate to forced termination.
  Fixtures disable the first-run UI, background networking and background mode.
  Manual exits use identity-verified Windows CloseMainWindow and assert actual
  process/listener exit. A root that remains alive after window/listener teardown
  is a retained-close failure, not a successful smoke result.
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
