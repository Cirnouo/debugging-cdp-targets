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
  retain the original process and session identities. Route removal can precede
  completion of upstream cleanup, so both exit cases separately wait for the
  first nonempty Hook response using the existing 15-second/100ms readiness
  polling budget; pending RPCs keep their existing timeout and responses arriving
  after readiness expires cannot pass. They validate that first batch without
  filtering identities or
  discarding other events, then require the next Hook response to be empty.
  A root that remains alive
  after gateway EOF cleanup is reported as retained and fails the smoke, even if a
  fallback normal Close request is accepted.
  Run `node tests/smoke/entry-recovery.ts` against a verified committed Plugin build.
  Recorded timing distinguishes normal Close request acceptance, connection
  retirement observation, and Hook delivery. Connection retirement observation
  does not establish that upstream cleanup has completed or measure Agent context
  delivery. Cleanup uses
  gateway stdin EOF and identity-verified normal target close. Managed profiles
  must be deleted by the gateway; the parent container remains for evidence.
- `mcp-client.ts` supplies test-only MCP and generic JSON-line stdio clients;
  they are never shipped. Normal close waits for the owned child process and all
  stdio to close before temporary-file cleanup; process exit alone is insufficient.
- `fixture-artifacts.ts` supplies the opt-in bounded streaming collector and
  first-failure-preserving cleanup recorder for the two controlled Chrome smokes.
  `fixture-preload.ts` subscribes safely to the internal fixture channel through
  `--import`; the original delivered `dist/mcp-bootstrap.mjs` remains the child
  entry. Query parameters configure only that Node subscriber, without
  `NODE_OPTIONS`, gateway environment switches or inherited browser configuration.
  `fixture-ci.ts` initializes the dependency-free job index before prerequisite
  checks and writes the failure job summary using only fixed labels and safe IDs.
- `chrome-host.ts` shares literal Chrome launch arguments, executable preflight,
  process/user/creation-time and loopback endpoint checks, and actual browser
  version evidence for the two cross-platform browser smokes. Its external normal
  Close helper reports request acceptance without claiming application exit.
- `chrome-profile-probe.ts` observes the actual Profile Path of those newly
  launched, independently verified fixtures through Chrome's native debugging
  HTTP endpoint and one temporary page WebSocket. It is test-only and never shipped.
- `windows-monitor.ps1` samples visible console windows every 20 ms and reports
  newly visible console/terminal windows, without reading application data.
- `marketplace.ts` installs the local Plugin with a disposable Codex configuration,
  compares the complete installed tree, discovers the marketplace path and Plugin
  identity, and checks `plugin/read` project/display metadata and component inventory.
  Scoped, reloaded `skills/list` must have no errors and expose the installed
  namespaced Skill with the correct Plugin ID, enabled state, user scope, exact
  presentation and absolute installed PNG paths. The PNG bytes must match the
  approved shared asset. Homepage/repository are checked in the installed manifest;
  the API exposes `interface.websiteUrl`. It also asks Codex's app server for the
  installed MCP server and tool catalog before directly testing the bundled gateway.
  Missing discovery fails even if directly launching the gateway would work. Run
  `node tests/smoke/marketplace.ts` after `pnpm build:plugin`; an optional first
  argument selects a Codex executable, including the Desktop app's binary.

- `codex-hooks.ts` installs byte-identical Codex manifest, Hook, production Skill
  and asset files in temporary configuration and runs the actual Codex app-server
  against a local SSE model substitute and production gateway with fake
  process/CDP/upstream I/O. It checks
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
  `stop`, `idle`, `inactive`, `lifecycle` or `skill`. The default runs all eight
  scenarios.
  Hooks are enabled only in the isolated test config.
  The `skill` case sends a formal Skill input using its discovered name/path and
  requires the complete installed body in the first actual outbound model request,
  including the current isolation intent, none-mode, support classification,
  occupancy and Close/Keep instructions. It then disables that Skill through
  `skills/config/write`, reloads discovery, requires zero enabled Skills, and
  creates a distinct new thread for a neutral text-only turn. That request must
  omit the complete instructions and the distinctive isolation section. Captures
  from the positive thread remain intact.
- `codex-host.ts` supplies an allowlisted child environment and disposable
  `CODEX_HOME` for both Codex smokes. Child-only `GIT_ALLOW_PROTOCOL=file` and
  `GIT_TERMINAL_PROMPT=0` keep Git local-only without editing any Git config.
  Codex's unrelated default remote marketplace Git probe therefore fails promptly;
  the selected real local marketplace must still load without errors. The
  marketplace smoke records the unrelated load-error count separately. This
  prevents remote Git helpers from retaining fixture streams after app-server
  exit. The supported protocol whitelist is documented in
  [Git's environment reference](https://git-scm.com/docs/git#Documentation/git.txt-GITALLOWPROTOCOL).
  Codex may still fetch public marketplace metadata through its own HTTP fallback.
  The Git policy does not disable all host networking; model requests use only
  the explicit loopback substitute.
  Windows known-folder resolution can still
  discover and internally read user-global `.agents` Skill files despite temporary
  `HOME`/`USERPROFILE`. The smokes use supported `skills/config/write` operations
  only in the temporary Codex config to disable every unrelated discovered Skill,
  require `effectiveEnabled: false`, and reload discovery before any thread starts.
  Only the exact installed Plugin Skill may remain enabled; model captures must
  omit off-fixture Skill paths and distinct unrelated summaries/descriptions.
  Metadata identical to the approved Skill is allowed because the exact enabled
  catalog and installed path establish its identity. This proves configuration
  and model-context isolation; it does not establish operating-system home isolation
  or absence of read-only global discovery. No real config or Skill file is modified.
  Explicit CLI invocation does not prove automatic Desktop starter-prompt injection
  or Desktop rendering, which retain a separate manual acceptance gate.

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

On 2026-10-08, these Marketplace checks and all eight scenarios per host passed
on Windows with Codex CLI 0.161.0 and Claude Code 2.1.294. Codex's dedicated Skill
case captured two actual model requests: complete instructions after formal
invocation, then no instructions in a distinct new thread after disable/reload.
Claude's existing namespaced Skill case captured the complete installed body.
These results do not establish Desktop rendering, automatic starter-prompt Skill
injection, or acceptance on the earlier historical host baselines.

- `lifecycle-client.ts` supplies a test-only MCP mutation/wait adapter and bounded
  retries of explicitly selected normal Close when pending CDP traffic is busy.
  It keeps the entry/connection/session identity and does not retry other failures.
- `screenshot-timeout-probe.ts` runs one explicitly supplied screenshot experiment
  through the complete committed Codex gateway. `screenshot-timeout-fixture.ts`
  validates its fixture and owns the fail-fast sequence; neither runs in default
  tests. `windows-selected-tab-evidence.ps1` reads UIA/MSAA selection only within
  the verified owned HWND and samples the foreground HWND separately. Unsupported,
  incomplete or ambiguous selection remains unknown. It never changes selection,
  focus or window state.
- `screenshot-background-anchor.ts` owns an optional opaque related native window,
  verified foreground handoff and geometric containment, passive checks of both
  identities, and normal Close/actual-exit cleanup. It is test-only and requires
  confirmed cleanup before another anchor acquisition.
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
- `application-screenshot-fixture.ts` validates complete test-only Obsidian/Readest/Tauri
  launch pairs, known existing-page selectors, confined synthetic text and fresh
  profiles. It verifies an explicit source SHA256 before preparation, verifies a
  controlled Readest/Tauri executable copy, expands `{fixture}` after pair comparison,
  and supplies a Windows-alias-safe gateway environment without WebView2 carriers.
  Real launch recipes belong in explicit external experiment inputs.
  The closed `tauri-fixture` kind requires the exact owned native copy/cwd and
  sibling profile; its shared helper decodes the declared browser carrier.
- `application-screenshot-probe.ts` accepts one explicit reviewed application
  experiment with absolute config/evidence paths, an arm, native condition and
  qualification/viewport/fullPage mode. `application-screenshot-core.ts` verifies
  the complete sealed payload receipt from source
  `eef90b4d974600c3a6697d40dc76e99037466315` before fixture or gateway acquisition.
  It selects a unique existing renderer by exact URL, declared title/identity and
  observed fresh userData/vault paths. It selects a unique owned main HWND by
  declared class/title and never creates pages.
  Qualification takes zero screenshots. A formal cell installs opaque yellow,
  establishes its native condition, reads back fresh green/nonce/geometry and
  performs exactly one official capture. Output is fixed to `screenshot.png`
  inside the fresh fixture workspace; conflicting fixture files fail before
  preparation. Geometry retains the fractional fixed `100vw`/`100vh` DOMRect and
  the actual root DOMRect separately from integer inner/scroll measurements.
  Fast captures retain PNG evidence with
  an insufficient-condition result when no complete passive sample fits inside
  the local MCP pending interval. This interval does not expose CDP method timing.
  An observer completion failure preserves the primary capture receipt and saved
  PNG evidence while recording a separate condition-evidence failure.
- `application-screenshot-adapter.ts` reuses the stdio client, lifecycle Close,
  screenshot observer, background anchor and native PNG decoder for those cells.
  Its injectable boundaries also verify actual root/browser/listener/endpoint
  identity, runtime version/hash, ordinary token level and consumed profile/port
  argv. Observed feature argv must pass the existing strict effective grammar
  without altering the receipt. Cleanup attempts all owned resources and requires
  identity-bound actual process exits,
  no owned listener, empty gateway status and actual stdio exit. Uncertain cleanup
  retains gateway stdio and identities; the caller must stop subsequent acquisition.
  Close and witness failures retain separate resource/phase reasons in the ledger.
  Unexpected permission waiting, permission handshake or ERROR740 evidence blocks
  the attempt, cancels its existing operation and performs only bounded cancellation
  settlement and cleanup. It does not authorize elevation or continue CDP readiness.
- `application-screenshot-native.ts` and `windows-application-evidence.ps1` are
  test-only read-only native evidence boundaries. The script compares CIM argv
  against an opened native process identity, uses Windows argv parsing and reads
  executable version/hash and the actual same-handle token elevation. Its passive
  exit witness arms process handles before Close and waits on those handles after
  the lifecycle receipt, without issuing any target mutation or termination.
  Finalization waits for child stdio closure and all output-record writes.

The application config is an external JSON object with `fixture` (the complete
application fixture pair), `payload: {root, receipt}` (the inline complete sealed
receipt), `mainWindow: {className, titleIncludes}`, `identityFunction` and
`preflight: {status, reason}`. The caller supplies a reviewed read-only identity
function accepting the exact fresh directory as its `fixtureDirectory` parameter
and returning `{url, title, userData, vaultPath, identity?}` plus any runtime facts.
The core safely encodes the directory as a JSON string argument; it does not
replace placeholders in the function source. For Obsidian, observed `userData`
must match the expanded `--user-data-dir` carrier, and observed `vaultPath` must
match the sole open vault in the synthetic `<profile>/obsidian.json`. Both paths
must be fresh fixture descendants; the vault's synthetic `.obsidian/app.json`
must also be present. Configured title and identity fields must both match when
supplied, and an opaque identity does not replace actual consumer-path evidence.
Main-window criteria must come from prior static evidence, never a launch to
discover a class. `preflight.status: "blocked"` records
the block with zero fixture/gateway/app acquisition. The selected Readest binary
is always blocked before acquisition because its unconditional protocol setup
changes user configuration. Neither test-only input support nor the fake tests
establish real Readest compatibility. Obsidian requires the caller's independently
reviewed protocol/singleton guard before an approved preflight.

For example, with fictional external paths:

```powershell
node tests/smoke/application-screenshot-probe.ts 'C:/Test/application.json' 'C:/Test/evidence' candidate foreground-normal qualification
node tests/smoke/application-screenshot-probe.ts 'C:/Test/application.json' 'C:/Test/evidence' baseline minimized fullPage
```

Each invocation retains its new fixture, PNG and raw evidence outside the repository.
The runner hashes its Node executable, configuration and helper sources into that
private evidence. The archived payload SHA256 is receipt provenance; extracted
inventory verification does not independently rehash the archive. Normal Close
is preselected only for these newly acquired test targets and related anchors.
Root owns experiment ordering/caps and publication redaction. Do not run another
cell until the previous invocation has confirmed cleanup.

The bounded Windows results and qualification limits are recorded in
[application screenshot validation](../../docs/application-screenshot-validation.md).
Its original geometry failures remain failed; later fake regression verification
does not establish a new accepted real-application matrix.
The separate closed `tauri-fixture` follow-up requires a reviewed external fixed
build and existing renderer; its actual builds, two failed qualifications and
separate abnormal helper dispositions are recorded in
[Tauri screenshot validation](../../docs/tauri-screenshot-validation.md).

- `screenshot-fixture.ts` validates explicit single-feature launch comparisons,
  strict canonical ASCII feature values and effective Windows parsing boundaries,
  fixture paths, decoded pixels, fresh session diagnostics and complete peer cleanup.
  It rejects fixed-preset Chrome comparisons before acquisition.
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

For a one-shot screenshot timeout investigation, first verify the committed build
with `pnpm check:build`, then supply an explicitly reviewed fixture and evidence
parent outside the worktree:

```powershell
node tests/smoke/screenshot-timeout-probe.ts 'C:/Test/probe.json' 'C:/Test/evidence'
```

The JSON fields are `label`, `url`, structured `launch`, `background`, `fullPage`,
`colorScheme` (`light` or `dark`), `viewport`, and `evaluations` (an ordered array
of `{function, waitForStableDom?}`). Optional `bringToFront` requests select_page;
omitting it skips selection entirely, while `false` is passed literally. Launch
args must contain one confined `--user-data-dir={fixture}/profile` (or another
confined child) in the fresh evidence directory, before any exact literal `--`
boundary. Only one unpadded canonical `--user-data-dir=value` switch is accepted;
separate values, case variants, native Windows aliases, duplicate profiles and
padded profile switches or boundaries are rejected before acquisition. Native
Windows outer whitespace includes NEL but excludes FEFF, following Chromium's
command-line parser. Genuine positionals after an exact `--` remain positionals
and retain their supplied bytes; they cannot establish the required profile.
The runner expands only the test directory placeholder and passes the directory
as the official `--workspace`.
Profile paths containing `%NAME%` or `${NAME}` environment substitutions are
rejected before acquisition, including tokens introduced by the evidence-directory
placeholder expansion, so inherited environment expansion cannot escape. Dynamic
argument names or whole-argument substitutions before the boundary are also
rejected because they could conceal a later profile override. Ordinary environment
substitutions in fixed unrelated switch values or boundary positionals remain
available to the inherited launch resolver. These are stricter opt-in fixture
requirements; they do not change product launch/profile parsing.

Optional `windowCondition` accepts `foreground-normal`, `background-normal`, or
`minimized`. Omitting it preserves the original official preparation, metadata,
passive normal-window validation and one-shot capture sequence. Explicit conditions
are applied after page metadata and verified owned HWND discovery, before required
before-capture observations. Foreground preparation minimizes/restores only its
explicitly verified owned window and waits for foreground, normal state and restored
bounds. Minimized preparation explicitly minimizes that same HWND.

Background preparation compiles and launches one disposable opaque WinForms anchor
in the evidence directory. Its native bounds must contain the target's bounds. The
probe verifies the new anchor's executable, exact process creation time and HWND,
then minimizes/restores only the anchor to make it foreground. The target must
already be normal/background before guarded `HWND_BOTTOM`/`SWP_NOACTIVATE`; the
background operation never minimizes/restores the target. Before, during and after
capture, passive samples verify both identities, foreground handoff and geometric
containment. Every native transition records before/after identity, state, bounds,
foreground HWND, request acceptance and postcondition. No unrelated app is activated
or manipulated. Geometric coverage and z-order do not prove compositor occlusion;
this controlled owned-window switch differs from the user's ordinary Codex click.
The anchor remains alive through capture/cleanup, then normally Closes with actual
native process-exit evidence, even when target preparation or capture fails. Failed
or uncertain anchor cleanup retains its ownership and forbids another acquisition.

The first and only screenshot sends `pageId`, `fullPage` and `filePath`, with no
explicit format/quality. Supplied evaluations retain their exact arguments.
One marked, read-only metadata evaluation records title, URL, focus, viewport and
scroll dimensions identically across runs. Without an explicit native condition,
no restore, minimize or extra native preparation is performed. No screenshot replay,
restart or alternate profile is performed.
The runner uses a 90-second MCP client deadline to receive the unchanged gateway
60-second timeout/quarantine result. Tool errors stop dependent preparation.

Each printed evidence directory retains the fixture/profile, individual evaluation
results, timed requests/results/routing, independent process/listener/endpoint
identity, raw and validated native samples, passive tab observations, before/after
bounded gateway diagnostics, PNG SHA-256/decoded dimensions, and Close receipts.
Method-level focus-emulation timing and actual CDP capture params remain explicitly
unavailable. Native visibility/minimized flags do not prove compositor visibility
or occlusion; JS focus never establishes the selected native tab. A failed capture
is a diagnostic outcome and still triggers every discovered owned connection's
preselected normal Close, final empty-connection check and gateway exit check.
Cleanup failure reports retained identities. Evidence/profile files are retained.
Final `capture` preserves the primary screenshot result/outcome/error separately
from required post-capture `observations` and their errors. Recovery or client
timeout retains its primary outcome even when after-evidence fails; a successful
capture with invalid required evidence reports an overall blocked outcome.
Native correlation records reliability/reasons for both UIA and MSAA; either
provider's ambiguity, incomplete traversal or disagreement makes it unknown.
Passive sampling always uses `State None`. A sampling error or condition loss
invalidates required observations while preserving the primary screenshot result
and its recovery/client-error classification. Explicit controlled captures also
require a successful native sample that starts and finishes validation while the
actual local MCP screenshot request is pending. `screenshot-capture-observer.ts`
starts from the test stdio client's post-write dispatch hook and stops at its
resolve-or-reject hook, including timeout or gateway exit. `capture-interval`
records monotonic ordering/times and qualified counts. Pre-dispatch,
post-settlement and crossing samples cannot qualify; official/MCP evidence writes
are outside that interval. These are observed MCP client boundaries, not CDP
method timing. Intentional AbortError while stopping native or tab observation
does not invalidate a prior valid sample; genuine observer/write errors do.
A capture that finishes too quickly for
the native observer retains its actual result with an overall blocked-evidence
outcome. Omitted conditions require no minimum count, while any actual passive
failure still invalidates overall evidence; preservation refers to the official
call sequence, passive normal-state validation and primary capture/quarantine
result. Native PowerShell JSON stdout is BOM-free UTF-8, including Unicode paths.

For the window screenshot acceptance, supply an explicitly reviewed fixture:

```powershell
node tests/smoke/screenshot-layers.ts 'C:/Test/fixture.json' 'C:/Test/evidence'
```

The JSON has `label` (lowercase name), `targetKind: "generic-cdp"`, `launch` (structured
executable/args/cwd/env), `candidateArgs` (complete argv), and `pageTitle` (a
literal substring matching exactly one managed main renderer). Baseline uses
launch.args; candidateArgs may only add the bare CDPScreenshotNewSurface feature
in one effective canonical enable token before exact `--`. Fixed Windows Chrome
presets would enable both arms, so `targetKind: "chrome"` fails before acquiring
either target. An explicit experimental generic-cdp Chrome launch compares raw
arguments and retains actual process/listener/endpoint identity evidence.
Relevant feature values must be ASCII; duplicate or equivalent switches, padded
terminators, single-argument parsing and target decoration/disable conflicts fail
before acquisition. Unrelated Unicode args and the exact positional tail remain
unchanged. Both explicitly reference
the test-only `{fixture}` directory placeholder; `{port}` retains its runtime
meaning. Optional `fixtureFiles` maps confined relative paths to synthetic UTF-8
text; its contents also expand `{fixture}`. Optional `minimizeFunction` uses the
target's own documented window control through official evaluate_script. Native
state remains mandatory. No user profile, application config or global Skill is
copied or modified by this experiment. Configuration is not a product MCP field.

Window evidence records `actualExecutablePath` exactly as queried from the native
process. Its compatible `executablePath` uses the caller's spelling only after
both executable paths pass the same .NET normalization and strict identity
comparison; without a requested path it uses the native query result. The
TypeScript sampler retains both fields in before/after evidence and requires
the actual path for native samples. Synthetic or legacy parsed fixtures may
omit the additional actual-path field. PID, exact creation ticks and selected
HWND checks remain mandatory for native mutations.

Build the shared delivered payload once with `pnpm build:plugin` before running
host Hook smokes so their copied manifests, Hooks and Skill match maintained
sources. Select the actual executable locally. These commands use fictional
Windows paths:

```powershell
node tests/smoke/codex-hooks.ts 'C:/Test/codex.exe'
node tests/smoke/claude-hooks.ts 'C:/Test/claude.exe'
```

Append `lifecycle` or `inactive` to run those isolated scenarios separately.
Keep actual executable paths, usernames, hostnames, private addresses and local
experiment receipts in untracked configuration or external evidence directories.
Tracked tests and documentation must use explicitly synthetic identities and
paths. Loopback protocol fixtures do not identify a particular host.
`entry-recovery.ts` is a separate
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
required main checks; see the [compatibility guide](../../docs/user-guide/compatibility.md)
for tested systems and actual Chrome versions.

Each target explicitly requests a new managed profile with delete-on-release
and a synthetic local page. The official Server rejects and filters
`chrome://version/`, so a test-only native HTTP/CDP probe creates that temporary
page through `PUT /json/new`, validates its exact page WebSocket on the owned
IPv4 loopback listener, and reads the version document's actual `#profile_path`.
It waits at most 45 seconds for the exact document and a nonempty path, including
native process/listener/browser identity checks around the probe. Cleanup closes
the transient socket and fresh target with a separate 20-second budget; changed
ownership refuses target mutation and fails the smoke. A missing creation
response cannot supply a safe cleanup ID; gateway normal Close still owns the
fixture. The canonical Profile Path must have the canonical lease as its direct
parent for these fresh default-profile launches. The official application page
selection is restored after success or failure. Recovery checks
that restart keeps the same directory and a marker file, and that final Close,
ordinary/kept exit and gateway cleanup actually delete managed roots. Tests do not
externally remove these roots to hide a cleanup failure. The tests
preselect normal Close for their newly launched fixtures; they never take over
an existing browser or escalate to forced termination. Parent containers may
remain at the printed temporary path for evidence.

## Controlled failure diagnostics

Diagnostics are opt-in for `official-server.ts` and `entry-recovery.ts`. The
artifact directory must be absolute and outside their managed profile roots.
The two fixture labels and five output filenames are fixed. The dependency-free
initializer creates the index, both independent `not-run` envelopes and both
empty streams before executable/native inspection checks. The index records
`prerequisites`. It
marks each smoke as running immediately before execution, so an earlier failure
leaves the later smoke not-run. The existing acceptance scripts run once, with
their original prerequisites, assertions and deadlines.

After verifying the committed Plugin build and actual Chrome prerequisites,
reproduce on Linux from the repository root with the explicit installed browser:

```sh
export DCT_SMOKE_CHROME_EXECUTABLE=/opt/google/chrome/chrome
set -euo pipefail
fixtureDiagnosticsDirectory="$(mktemp -d "${TMPDIR:-/tmp}/dct-fixture-diagnostics.XXXXXX")"
collectionId=""
if collectionId="$(node tests/smoke/fixture-ci.ts init "$fixtureDiagnosticsDirectory")"; then :; fi
test -x "$DCT_SMOKE_CHROME_EXECUTABLE"
command -v lsof
command -v getconf
command -v Xvfb
command -v xvfb-run
command -v xauth
command -v xdpyinfo
if node tests/smoke/fixture-ci.ts stage "$fixtureDiagnosticsDirectory" official-server "$collectionId"; then :; fi
xvfb-run -a node tests/smoke/official-server.ts --diagnostics "$fixtureDiagnosticsDirectory" --collection-id "$collectionId"
if node tests/smoke/fixture-ci.ts stage "$fixtureDiagnosticsDirectory" entry-recovery "$collectionId"; then :; fi
xvfb-run -a node tests/smoke/entry-recovery.ts --diagnostics "$fixtureDiagnosticsDirectory" --collection-id "$collectionId"
```

The command creates a fresh invocation directory and preserves earlier runs.
If set, `TMPDIR` must name an existing absolute temporary parent; otherwise it
uses `/tmp`. Initialization refuses existing fixed collector files.
The successful initializer prints its collection UUID; refusal exits 1 and
prints no UUID. Stage, smoke and summary commands carry that successful
initialization identity. Invalid or absent identity leaves earlier files intact;
summary prints only an explicit current-collection limitation. The shell guards
only diagnostic setup/stage commands so the actual prerequisite and smoke exits
retain their existing behavior. A collector
adopts only its current initialized not-run envelope with an empty stream; the
preload must present the parent's current collection UUID. Reused or unowned
collections are disabled with a safe diagnostic limitation, preserving previous
evidence and the actual smoke outcome. Do not interpret previous files as a new
run. On macOS use
`DCT_SMOKE_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`,
retain `test -x` and `command -v lsof`, and run the two `node` smoke commands
without `xvfb-run`; Linux-only prerequisites do not apply. CI uses the identical
sequence with each job's fresh `RUNNER_TEMP/dct-fixture-diagnostics` directory.
To index a failed run afterward, run
`node tests/smoke/fixture-ci.ts summary "<absolute-artifact-directory>" "$collectionId"`.
Without `--diagnostics`, the original child runs without a subscriber or files.
Both smoke launch sites use a copied child environment that omits inherited
`NODE_OPTIONS`; the shared stdio client's general environment contract is unchanged.

Each NDJSON record is at most 4,096 bytes; each fixture stream is limited to
2,000 records plus one truncation marker and 1,048,576 total bytes. A test-only
nonblocking directory lock serializes the parent/preload bound check and append;
there is one immediate attempt, no waiting or queue. Lock/write failure is a
diagnostic limitation, never a runtime failure. The parent owns the small summary
envelope, with run/attempt/commit/platform, primary and up to 32 secondary failures,
safe operation identity, last stage, counts, absence/incomplete/write/truncation
flags. `smokeStage` names the parent's acceptance/cleanup stage. Final `lastStage`,
operation and gateway counts are reconstructed from the bounded child stream.
For an interrupted run, the stored parent envelope can predate child progress;
the CI summary reconstructs and labels the last runtime boundary, operation and
count from that stream, rather than treating stored zero counts as runtime facts.
The child appends only its validated closed events and never writes the parent's
failure envelope. BEGIN records persist
before settlement, so a hung child can leave a running summary and unfinished
stage evidence. A failed final write cannot erase already streamed progress.

Use the job index to distinguish prerequisite failure from either smoke stage.
The stream records direct native startup, readiness, listener/endpoint,
profile and data-directory checks for the controlled target. These boundaries
help locate the failed check; they do not establish complete lifecycle attribution.
The primary record keeps the original smoke
failure; subsequent cleanup failures remain secondary, and every existing cleanup
check still runs in order. Safe cause codes can narrow a failing boundary but do
not establish an unrecorded cause. Absence, truncation, validation rejection and
incomplete cleanup are evidence limitations.
Diagnostic durations and readiness `remainingMs` use monotonic elapsed time;
the production readiness predicate and its existing wall-clock deadline remain
unchanged. Opt-in synchronous observation can perturb timing; its overhead on
real Linux/macOS Chrome fixtures has not been measured.

An accepted current diagnostics collection also enables `chrome-startup.ts`.
On Linux, `xdpyinfo` queries the inherited `DISPLAY` inside the smoke's
`xvfb-run` session with ignored output and a separate five-second bound.
An unresponsive display fails the prerequisite check before Chrome starts.
Refused or unconfigured collections add no browser logging flags or files.
Controlled launches add plain `--enable-logging` and an absolute `--log-file`
in a canonical private scratch sibling outside profiles and the upload directory.
Chrome stdio stays ignored, and the original delivered gateway remains the entry.
Each startup settlement reads its own log; restart samples before reuse and
after settlement because Chrome may overwrite the same file on restart.

The reader requires an initially matching regular file identity with one hard link;
unsafe links, aliases and replacements before opening are rejected. Later identity
or content changes retain only a limited projection marked incomplete; disappearance
after observation begins is read-failed/incomplete, rather than initial absence.
It reads at most the first and last
64 KiB, without double counting overlapping ranges. Partial, oversized or excess
lines and changing files expose incomplete evidence. Only closed categories for
X display, sandbox, helper, zygote, singleton and DevTools bind errors, severity
counts, and absent/read-failed/truncated/incomplete flags enter the existing
bounded stream and summary. One validated JSON projection per initially configured log slot,
plus display and scratch cleanup booleans, is printed in controlled job logs so
successful CI can establish that the browser actually wrote the chosen file.
Raw text, log paths, URLs and interpolated values never enter these records.
Restart reuses its slot. The summary keeps the latest sample per slot; the bounded
event stream retains earlier and pre-restart observations until its existing caps.

Native records also expose the fixed Linux `rootProcessState` from existing
proc-stat reads and a unique `ownedDescendantCount`, separate from listener counts.
Retained `exitObserved`, exit code, signal and `monitoringFailed` evidence is sampled
before rollback Close. These fields add no process scan, watcher or readiness deadline.

These matchers use [Chromium logging setup](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/logging_chrome.cc),
the [current LOG formatter](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/base/logging.cc)
and its [older parentheses formatter](https://raw.githubusercontent.com/chromium/chromium/120.0.6099.0/base/logging.cc),
and the direct source messages in
[X11 initialization](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/ozone/platform/x11/ozone_platform_x11.cc),
[zygote initialization](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/zygote_host/zygote_host_impl_linux.cc),
[CHECK message prefix](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/base/check.cc),
[sandbox helper validation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/sandbox/linux/suid/client/setuid_sandbox_host.cc),
[profile singleton](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/process_singleton_posix.cc)
and [DevTools HTTP startup](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/devtools_http_handler.cc).
Source main can differ from the installed release; unmatched errors stay unknown.
Nonfatal DBus errors establish no cause. File logging can miss early initialization,
sandboxed children, crashes without a matching LOG message, and policy/default-data
directory refusals written directly to ignored stderr. Absence establishes no cause.
Official non-DCHECK builds can omit CHECK message streaming entirely through
[CHECK build guards](https://raw.githubusercontent.com/chromium/chromium/main/base/check.h);
a missing file message cannot exclude a CHECK startup failure.
The read cap does not cap Chrome's private on-disk writes; verbose logging is not
enabled. Instrumentation timing and storage overhead have not been measured.
Private scratch is deleted only after successful acceptance, normal gateway exit
and all existing profile deletion checks; failures or uncertain cleanup retain it.
Optional logging or scratch removal errors remain nonfatal safe limitations.
The raw file is excluded from the exact five uploaded files, including when retained.

Records exclude raw messages/stacks, browser/gateway stderr, full environment,
argv/process tables, lock content, hostnames/private paths, HTTP headers/bodies
and page/tool content. Only the newly owned controlled fixture is observed.
These new records cannot explain old runs retrospectively: the underlying roots
of historical portable CI failures remain **UNKNOWN** until supported by new
evidence. Static or synthetic tests also do not establish real Chrome acceptance.
