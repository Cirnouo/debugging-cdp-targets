# Explicit integration smoke

- `official-server.ts` tests the bundled bootstrap against an isolated Chrome,
  including tool discovery, snapshot-based CSS style inspection, reusable entry
  start/Close, and normal closure.
- `entry-recovery.ts` launches at least three concurrent isolated Chrome targets
  through one gateway. It checks independent UUIDs and parallel tool routing,
  Keep/reuse, scoped Close, later new connections, active-task recorded exit delivery,
  same-port restart, stale-session rejection, silent cleanup after kept target exit.
  A normal Close that reports retained identity may be retried twice with the
  same IDs; retries are logged and never escalate to forced termination.
  Fixtures disable the first-run UI, background networking and background mode.
  Both Windows browser smokes use the Chrome launch preset to disable the
  automatic updater scheduler for their newly launched targets, following Chromium's
  [browser-test setup](https://github.com/chromium/chromium/blob/154.0.8037.93/chrome/test/base/in_process_browser_test.cc).
  A captured Chrome 154 shutdown waited on an updater COM activation task;
  excluding that background installer isolates the browser fixture. Fixture
  commands omit this switch to exercise the production preset. Other updater
  requests can still cause a retained normal-Close failure.
  Manual exits use identity-verified Windows CloseMainWindow and assert actual
  process/listener exit. A root that remains alive after window/listener teardown
  is a retained-close failure, not a successful smoke result.
  Run `node tests/smoke/entry-recovery.ts` after `pnpm build:plugin` on Windows.
  Recorded exit latency measures gateway event capture, not Agent context delivery. Cleanup uses
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

- `codex-hooks.ts` installs byte-identical Codex manifest/Hook definitions in
  temporary homes and runs the actual Codex app-server against a local SSE model
  substitute and production gateway with fake process/CDP/upstream I/O. It checks
  actual outbound model requests for PostToolUse, one Stop continuation, and
  idle-next-turn delivery, confirms no watch call, and verifies untrusted Hooks
  do not run. Only temporary config is trusted; no real browser or account API
  is used. Run `node tests/smoke/codex-hooks.ts`; an optional first argument selects
  a Codex executable. Enable Hooks in this isolated config for the test.

These scripts are opt-in and may download the pinned official Server or open
dedicated test browser windows. The normal test suite never runs them.
