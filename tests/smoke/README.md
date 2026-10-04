# Explicit integration smoke

`timeout-isolation.ts` exercises an intentionally unfinished official handler on
two isolated Chrome targets, validates timeout quarantine and peer availability,
then explicitly restarts and normally closes them. It retains test profiles.

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
  On Windows, both browser smokes use the Chrome launch preset to disable the
  automatic updater scheduler for their newly launched targets, following Chromium's
  [browser-test setup](https://github.com/chromium/chromium/blob/154.0.8037.93/chrome/test/base/in_process_browser_test.cc).
  A captured Chrome 154 shutdown waited on an updater COM activation task;
  excluding that background installer isolates the browser fixture. Fixture
  commands omit this switch to exercise the production preset. Other updater
  requests can still cause a retained normal-Close failure.
  Manual exits use identity-verified Windows CloseMainWindow or Unix SIGTERM and assert actual
  process/listener exit. A root that remains alive after window/listener teardown
  is a retained-close failure, not a successful smoke result.
  Run `node tests/smoke/entry-recovery.ts` against a verified committed Plugin build.
  Recorded exit latency measures gateway event capture, not Agent context delivery. Cleanup uses
  gateway stdin EOF and identity-verified normal target close; profiles remain in
  the printed temporary directory for inspection.
- `mcp-client.ts` supplies test-only MCP and generic JSON-line stdio clients;
  they are never shipped.
- `chrome-host.ts` shares literal Chrome launch arguments, executable preflight,
  process/user/creation-time and loopback endpoint checks, and actual browser
  version evidence for the two cross-platform browser smokes.
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
  idle-next-turn delivery, checks the gateway tool catalog, and verifies untrusted
  Hooks do not run. Only temporary config is trusted; no real browser or account API
  is used. Run `node tests/smoke/codex-hooks.ts`; an optional first argument selects
  a Codex executable. Enable Hooks in this isolated config for the test.

- `claude-marketplace.ts` validates, adds and installs the actual Claude Marketplace
  into an isolated home outside the repository. It compares the complete installed
  cache and actual init source bytes, checks component inventory, namespaced Skill,
  connected gateway and all 73 tools through real Claude discovery. A separate direct
  gateway check supplements host discovery. Run `node tests/smoke/claude-marketplace.ts`
  after `pnpm build:plugin`; an optional first argument selects a Claude executable.
- `claude-hooks.ts` installs the committed Claude manifest, Hook and Skill bytes in
  temporary homes and substitutes only process/CDP/upstream I/O with the production
  gateway fixture. Actual Anthropic model requests prove PreToolUse, PostToolUse,
  next-turn UserPromptSubmit, one Stop continuation, lifecycle result delivery and
  complete namespaced Skill instructions. `disableAllHooks` keeps MCP connected and
  suppresses Hooks. Run `node tests/smoke/claude-hooks.ts`; an optional first argument
  selects Claude and an optional second selects one scenario. The default runs all
  seven scenarios. An intentional blocking Stop can emit Claude's `stop-hook-error`
  notification while the Hook and final turn succeed; the script checks the actual
  continuation and successful result.
- `claude-host.ts` owns tested allowlisted environments, explicit loopback model
  endpoints, baseline versions, strict request/result parsing, Hook context and SSE.
- `claude-process.ts` launches actual Claude with disposable config/home/workspace/TMP
  outside the repository, synthetic credentials and a loopback model. It checks actual
  init credentials/version/memory paths and records argv, environment, transcripts,
  stderr and debug output. Claude 2.1.283 is the first supported host. Claude smokes
  retain their printed temporary evidence directories, call no account model API,
  install no global Skill and launch no real target.

- `lifecycle-client.ts` supplies a test-only MCP mutation/wait adapter and bounded
  retries of explicitly selected normal Close when pending CDP traffic is busy.
  It keeps the entry/connection/session identity and does not retry other failures.
- `screenshot-layers.ts` compares official direct/routed screenshots on isolated
  normal and minimized Chrome windows with phase-only CDP timing. It retains its
  profiles, screenshots and metadata; a timeout records evidence and fails.
- `readest-native.ts` accepts an explicitly selected Readest executable and creates
  independent portable copies, comparing native/CDP launch window geometry and
  actual normal close. It preserves the source and all test directories.
- `windows-window-evidence.ps1` samples window identity, visibility, classes and
  geometry for one test PID; no titles or page content are recorded.
- `windows-elevation.ts` compiles a disposable manifested GUI and exercises real
  Windows authorization, preserved environment, limited-query identity, actual
  app-handle exit observation and elevated normal close. It may
  show UAC; cancellation is reported, never treated as successful elevated launch.
- `windows-elevated-mcp.ts` verifies the same elevation through the delivered
  gateway's start/wait/status/Close tools, using the fixture's loopback discovery
  endpoint for real process/listener/readiness verification. The fixture does not
  implement browser tools; Chrome smokes verify those separately. Run from an
  ordinary process; launch and normal close may each require Windows authorization.

These scripts are opt-in and may open dedicated test browser/application windows.
They use the delivered official package without dependency download. The normal
test suite never runs them. Codex tests create only disposable homes/configuration.

`official-server.ts` and `entry-recovery.ts` support Windows, Linux and macOS.
Set `DCT_SMOKE_CHROME_EXECUTABLE` to the absolute path of the actual Chrome
binary on Linux/macOS; launcher scripts and PATH fallback are not used. Windows
keeps `C:/Program Files/Google/Chrome/Application/chrome.exe` as its default and
accepts an explicit absolute override. Chrome 149 or newer is required. Missing
executables, process inspection prerequisites or required browser tools fail.
The scripts print OS, architecture, Chrome version and verified target evidence.
The official tools smoke retains its visible-console monitor on Windows.

CI runs both smokes on `ubuntu-24.04` with Xvfb and on `macos-15` with ordinary
Chrome. It uses the runner's existing Chrome, `ps` and `lsof`; Linux additionally
requires Xvfb, xvfb-run, xauth and getconf. It downloads no browser, starts no headless
substitute and uploads no profiles or browser content. These jobs are also part
of the reusable release CI. Both platform checks passed on GitHub before becoming
required main checks; see the root README for tested hosts and actual Chrome versions.

Each target has its own temporary profile and synthetic local page. The tests
preselect normal Close for their newly launched fixtures; they never take over
an existing browser or escalate to forced termination. Profiles remain at the
printed temporary path for local inspection.
