# Explicit integration smoke

- `official-server.ts` tests the bundled bootstrap against an isolated Chrome,
  including tool discovery, snapshot-based CSS style inspection, reusable entry
  start/Close, and normal closure.
- `entry-recovery.ts` launches at least three concurrent isolated Chrome targets
  through one gateway. It checks independent UUIDs and parallel tool routing,
  Keep/reuse, scoped Close, later new connections, active-task loss form delivery,
  same-port restart, stale-session rejection, idle loss deferral and explicit cancel.
  A normal Close that reports retained identity may be retried twice with the
  same IDs; retries are logged and never escalate to forced termination.
  Fixtures disable the first-run UI, background networking and background mode.
  Both Windows browser smokes also disable Chrome's automatic updater scheduler
  for their newly launched targets, following Chromium's
  [browser-test setup](https://github.com/chromium/chromium/blob/154.0.8037.93/chrome/test/base/in_process_browser_test.cc).
  A captured Chrome 154 shutdown waited on an updater COM activation task;
  excluding that background installer isolates the browser fixture. The plugin's
  launch defaults do not add this switch. An unresponsive updater in a regular
  target can still cause a retained normal-Close failure.
  Manual exits use identity-verified Windows CloseMainWindow and assert actual
  process/listener exit. A root that remains alive after window/listener teardown
  is a retained-close failure, not a successful smoke result.
  Run `node tests/smoke/entry-recovery.ts` after `pnpm build:plugin` on Windows.
  Form latency measures protocol receipt, not host UI rendering. Cleanup uses
  gateway stdin EOF and identity-verified normal target close; profiles remain in
  the printed temporary directory for inspection.
- `mcp-client.ts` supplies test-only MCP and generic JSON-line stdio clients;
  they are never shipped.
- `windows-monitor.ps1` samples visible console windows every 20 ms and reports
  newly visible console/terminal windows, without reading application data.
- `marketplace.ts` installs the local Plugin with an isolated Codex home, compares
  installed bytes and asks Codex's app server for the installed MCP server and
  tool catalog before directly testing the bundled gateway. Missing discovery
  fails even if directly launching the gateway would work. Run
  `node tests/smoke/marketplace.ts` after `pnpm build:plugin`; an optional first
  argument selects a Codex executable, including the Desktop app's binary.

These scripts are opt-in and may download the pinned official Server or open
dedicated test browser windows. The normal test suite never runs them.
