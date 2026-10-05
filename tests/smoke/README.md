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
  new-connection retry after actual exit, live same-port restart, stale-session
  rejection and informational exit delivery after a kept target exits. An actual
  exit removes the old connection; restart requires a still-live session. Default
  status and lifecycle success are checked as summaries before test adapters read
  them, and compact Hook payloads must exclude tool schemas and configuration.
  Fixtures disable the first-run UI, background networking and background mode.
  On Windows, both browser smokes use the Chrome launch preset to disable the
  automatic updater scheduler for their newly launched targets, following Chromium's
  [browser-test setup](https://github.com/chromium/chromium/blob/154.0.8037.93/chrome/test/base/in_process_browser_test.cc).
  A captured Chrome 154 shutdown waited on an updater COM activation task;
  excluding that background installer isolates the browser fixture. Fixture
  commands omit this switch to exercise the production preset. Other updater
  requests can still cause a retained normal-Close failure.
  External exit stimuli request identity-verified Windows CloseMainWindow or Unix
  SIGTERM. These inspect-only fixtures do not own an exit observer; request acceptance
  is recorded separately from the gateway's actual application exit and cleanup.
  Bounded status checks require removal of the exited connection, and Hook facts
  retain the original process and session identities. A root that remains alive
  after gateway EOF cleanup is reported as retained and fails the smoke, even if a
  fallback normal Close request is accepted.
  Run `node tests/smoke/entry-recovery.ts` against a verified committed Plugin build.
  Recorded exit latency measures gateway event capture, not Agent context delivery. Cleanup uses
  gateway stdin EOF and identity-verified normal target close; profiles remain in
  the printed temporary directory for inspection.
- `mcp-client.ts` supplies test-only MCP and generic JSON-line stdio clients;
  they are never shipped.
- `chrome-host.ts` shares literal Chrome launch arguments, executable preflight,
  process/user/creation-time and loopback endpoint checks, and actual browser
  version evidence for the two cross-platform browser smokes. Its external normal
  Close helper reports request acceptance without claiming application exit.
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
  actual outbound model requests for PreToolUse, PostToolUse, one Stop continuation,
  idle-next-turn delivery, inactive-task exit and operation completion. Every event
  is parsed at that model-request boundary and checked for exact identity, event
  kind and operation action, with no full result, tool schema or configuration
  leakage. The Post scenario checks successful original official content and
  completed tool status before its separately observed exit, using an event-loop
  milestone for exit before the immediate PostToolUse boundary. A controlled
  second launch completes before the wait Hook, proving a
  compact unread operation notice reaches the model independently of the wait
  result. It checks the gateway tool catalog and verifies untrusted Hooks do not
  run. Only temporary config is trusted; no real browser or account API is used.
  Run `node tests/smoke/codex-hooks.ts`; an optional first argument selects a Codex
  executable and an optional second selects one of `untrusted`, `pre`, `post`,
  `stop`, `idle`, `inactive` or `lifecycle`. The default runs all seven scenarios.
  Hooks are enabled only in the isolated test config.

- `claude-marketplace.ts` validates, adds and installs the actual Claude Marketplace
  into an isolated home outside the repository. It compares the complete installed
  cache and actual init source bytes, checks component inventory, namespaced Skill,
  connected gateway and all 73 tools through real Claude discovery. A separate direct
  gateway check supplements host discovery. Run `node tests/smoke/claude-marketplace.ts`
  after `pnpm build:plugin`; an optional first argument selects a Claude executable.
- `claude-hooks.ts` installs the committed Claude manifest, Hook and Skill bytes in
  temporary homes and substitutes only process/CDP/upstream I/O with the production
  gateway fixture. Actual Anthropic model requests prove PreToolUse, PostToolUse,
  next-turn UserPromptSubmit, one Stop continuation, inactive-task exit, compact
  operation completion and complete namespaced Skill instructions. The payload
  checks use actual outbound request context and exact event identity/action;
  operation notices cannot carry results, tool schemas or configuration. The
  Post scenario verifies the original successful tool_result content in its
  actual text-array format and exact PostToolUse delivery. Its fixture schedules
  exit after the SDK success response through an event-loop milestone.
  separately delivered successful wait result must be a connection summary.
  `disableAllHooks` keeps MCP connected and suppresses Hooks. Run
  `node tests/smoke/claude-hooks.ts`; an optional first argument selects Claude and
  an optional second selects `pre`, `post`, `stop`, `idle`, `inactive`, `lifecycle`,
  `skill` or `disabled`. The default runs all eight scenarios. An intentional
  blocking Stop can emit Claude's `stop-hook-error`
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
- `screenshot-layers.ts` accepts an explicit Windows application fixture JSON and
  an absolute evidence parent directory. It creates independent baseline/candidate
  targets for direct official and complete generated gateway routes, with native
  HWND/process/state evidence before and after every PNG. Candidate normal A and
  minimized B/C each exercise viewport, fullPage and element with new snapshot
  selection, DOM readback, opaque updated pixels and a below-viewport color patch.
  Normal A must complete every mode. Only a confirmed minimized B/C baseline
  SDK timeout is diagnostic; a candidate timeout fails. Gateway baseline
  timeout also checks a peer while pending and after quarantine. Normal Close is
  preselected for these newly created targets; all peers are attempted on failure,
  with final empty gateway status and actual stdio exit checked. Blocked native
  state cannot pass. Profiles, PNGs and evidence.json remain in the printed directory.
- `screenshot-fixture.ts` validates explicit single-feature launch comparisons,
  fixture paths, decoded pixels, fresh session diagnostics and complete peer cleanup.
- `windows-png-evidence.ps1` uses the existing Windows System.Drawing implementation
  to read PNG dimensions and selected RGBA pixels; no image dependency is added.
- `readest-native.ts` accepts an explicitly selected Readest executable and creates
  independent portable copies, comparing native/CDP launch window geometry and
  actual normal close. It preserves the source and all test directories.
- `windows-window-evidence.ps1` samples window identity, visibility, classes and
  geometry for one test PID, plus native minimized state and placement. Mutation
  requires the launched executable/creation time and selects one owned HWND;
  asynchronous request acceptance is separate from its bounded state postcondition.
  Restore uses SW_RESTORE. No titles or page content are recorded.
- `window-evidence.ts` validates native evidence against the launch identity and
  rejects missing/ambiguous windows, denied actions and unobserved state changes.
- `windows-elevation.ts` compiles a disposable manifested GUI and exercises real
  Windows authorization, preserved environment, limited-query identity, actual
  app-handle exit observation and elevated normal close. It may
  show UAC; cancellation is reported, never treated as successful elevated launch.
  Its first argument is an evidence directory and its second selects a mode:

  | Mode | Evidence |
  | --- | --- |
  | `normal` | Actual elevated application identity, preserved environment and native handle-based exit after normal Close. |
  | `access-denied-return` | The production `RequestClose` native API returns UIPI access denied (`5`) from the unelevated caller. The production helper normally detects elevation before that call, so this is native return-value evidence, without claiming coverage of a return-value fallback branch. |
  | `access-denied-exception` | An optional fixture-only DACL on its own process makes production `IsProcessElevated` throw native access denied (`5`); normal close then uses one elevation helper. |

  Use a separate evidence directory for each mode. All modes wait for the actual
  application handle to exit after normal Close. UAC cancellation does not trigger
  another authorization request, and application targets are never force-killed.
- `windows-elevated-mcp.ts` verifies the same elevation through the delivered
  gateway's start/wait/status/Close tools, using the fixture's loopback discovery
  endpoint for real process/listener/readiness verification. The fixture does not
  implement browser tools; Chrome smokes verify those separately. Run from an
  ordinary process; launch and normal close may each require Windows authorization.

These scripts are opt-in and may open dedicated test browser/application windows.
They use the delivered official package without dependency download. The normal
test suite never runs them. Codex tests create only disposable homes/configuration.

For the window screenshot acceptance, supply an explicitly reviewed fixture:

```powershell
node tests/smoke/screenshot-layers.ts 'C:/Test/fixture.json' 'C:/Test/evidence'
```

The JSON has `label` (lowercase name), `targetKind`, `launch` (structured
executable/args/cwd/env), `candidateArgs` (complete argv), and `pageTitle` (a
literal substring matching exactly one managed main renderer). Baseline uses
launch.args; candidateArgs may only add the bare CDPScreenshotNewSurface feature
in one effective canonical enable token before `--`. Both explicitly reference
the test-only `{fixture}` directory placeholder; `{port}` retains its runtime
meaning. Optional `fixtureFiles` maps confined relative paths to synthetic UTF-8
text; its contents also expand `{fixture}`. Optional `minimizeFunction` uses the
target's own documented window control through official evaluate_script. Native
state remains mandatory. No user profile, application config or global Skill is
copied or modified by this experiment. Configuration is not a product MCP field.

Build the shared delivered payload once with `pnpm build:plugin` before running
host Hook smokes so their copied manifests, Hooks and Skill match maintained
sources. On the current Windows host, the discovered executable commands are:

```powershell
node tests/smoke/codex-hooks.ts 'C:/Users/ciilyn/AppData/Local/Programs/OpenAI/Codex/bin/codex.exe'
node tests/smoke/claude-hooks.ts 'C:/Users/ciilyn/.local/bin/claude.exe'
```

Append `lifecycle` or `inactive` to run those isolated scenarios separately.
These local discovery paths are host-specific. `entry-recovery.ts` is a separate
opt-in real-Chrome smoke; adapting its protocol assertions does not establish a
new real-browser acceptance result.

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
