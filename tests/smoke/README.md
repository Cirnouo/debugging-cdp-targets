# Explicit integration smoke

Real GUI smoke entrypoints require the exact command-line flag `--allow-gui`.
Without it they return a visible successful skip before app or resource acquisition;
all other arguments retain their existing order after that flag is removed.
Neither CI/environment variables nor platform/display detection grant permission.
This covers `official-server.ts`, `entry-recovery.ts`, `timeout-isolation.ts`,
`screenshot-layers.ts`, `screenshot-timeout-probe.ts`, `application-screenshot-probe.ts`,
`readest-native.ts`, `windows-elevation.ts` and `windows-elevated-mcp.ts`. Local
development and verification of these tests may opt in explicitly; routine local
hooks and scripts remain GUI-free. The pure `pnpm smoke:official` catalog smoke,
compile-only PowerShell helpers and passive observers launch no GUI and remain
ungated. Direct `windows-window-evidence.ps1` mutation modes require `-AllowGui`;
its default None observation remains passive and ungated.

Windows CI explicitly opts in to real owned native fixture regressions, and
Linux/macOS CI explicitly opts in to real Chrome acceptance. Tauri/Electron
application probes remain development verification with separately selected
fixtures; this change adds no application acquisition or toolchain to CI. These
forms of evidence remain distinct.

`codex-instructions.ts` and `claude-instructions.ts` install the production
Plugin metadata and Skill into temporary host environments, substituting only
the MCP command with `mcp-instructions-entry.ts`. Run them explicitly:

```text
node tests/smoke/codex-instructions.ts [codex-executable]
node tests/smoke/claude-instructions.ts [claude-executable]
```

`instructions-evidence.ts` checks production initialization evidence, semantic
request carriers and source fingerprints for these smokes.

The loopback substitute model captures real outbound requests and checks the
complete production initialize paragraph at semantic metadata locations. Codex
returns one controlled search request followed by final text. Claude enables
ToolSearch only for this child and returns final text without executing search.
Its scoped MCP Server Instructions reminder is host-generated system context
transported in a user-role message; the parser requires the exact envelope,
Plugin scope, paragraph and separate seven-name deferred discovery block before
the independently verified supplied prompt. It also checks the actual host
system's reminder contract. This is a controlled-capture assertion, not a rule
that arbitrary user reminder tags prove authorship.
Both disable Hooks, invoke no Skill, forbid all MCP tool calls, and launch no
target or official upstream. Existing Hook/Skill smokes retain their defaults
and their separate fake process/CDP/upstream I/O boundary.

Each new smoke prints and retains its temporary evidence directory, including
raw requests, MCP initialize/discovery records and successful acceptance metadata.
Failure captures remain available for diagnosis. Temporary configuration uses no
account credentials; Codex may discover Windows known-folder Skills despite HOME
relocation, so its existing isolation guard disables unrelated Skills only in
temporary CODEX_HOME before starting the thread. Consumption establishes host
delivery to the substitute model, not real-model adherence, automatic Skill
matching, Claude search execution or Desktop presentation.

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
  Run `node tests/smoke/entry-recovery.ts --allow-gui` against a verified committed Plugin build.
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
  `fixture-stream-quota.ts` applies the armed stream's fixed class quotas.
  `fixture-preload.ts` subscribes safely to the internal fixture channel through
  `--import`; the original delivered `dist/mcp-bootstrap.mjs` remains the child
  entry. Query parameters configure only that Node subscriber, without
  `NODE_OPTIONS`, gateway environment switches or inherited browser configuration.
  `fixture-ci.ts` initializes the dependency-free job index before prerequisite
  checks and writes the diagnostic job summary using only fixed labels and safe IDs.
- `linux-startup-wait.ts` supplies the test-only Linux verified-root wait sampler,
  bounded fixed proc reads and closed projections for the same diagnostic stream.
  `linux-startup-resources.ts` supplies its optional kernel wait classification,
  mapped block-device counters and visible cgroup evidence.
- `linux-first-start-capture.ts`, `linux-first-start-capture-io.ts`,
  `linux-first-start-capture-record.ts` and `first-start-capture-ci.ts`
  supply the separately admitted, failure-focused
  first-start observer. Ordinary successful starts discard detailed samples;
  a failed first start retains completed device and visible resource context.
- `linux-readahead-study.ts` supplies the separately opted-in Linux queue lease,
  bounded research observations and closed evidence for actual release and
  original-value restoration. It is test-only and never shipped.
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
node tests/smoke/application-screenshot-probe.ts --allow-gui 'C:/Test/application.json' 'C:/Test/evidence' candidate foreground-normal qualification
node tests/smoke/application-screenshot-probe.ts --allow-gui 'C:/Test/application.json' 'C:/Test/evidence' baseline minimized fullPage
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
  requires explicit `-AllowGui`, the launched executable/creation time and one owned HWND.
  Minimize, Restore, Foreground and Background skip successfully without the flag
  before identity validation or native acquisition, including CI-only invocations.
  None remains read-only and takes no authorization flag from TypeScript callers;
  mutation callers forward the flag only when their CLI includes `--allow-gui`.
  Asynchronous request acceptance is separate from its bounded state postcondition.
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
node tests/smoke/screenshot-timeout-probe.ts --allow-gui 'C:/Test/probe.json' 'C:/Test/evidence'
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
node tests/smoke/screenshot-layers.ts --allow-gui 'C:/Test/fixture.json' 'C:/Test/evidence'
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
if node tests/smoke/fixture-ci.ts stage "$fixtureDiagnosticsDirectory" official-server "$collectionId"; then :; fi
xvfb-run -a node tests/smoke/official-server.ts --allow-gui --diagnostics "$fixtureDiagnosticsDirectory" --collection-id "$collectionId"
if node tests/smoke/fixture-ci.ts stage "$fixtureDiagnosticsDirectory" entry-recovery "$collectionId"; then :; fi
xvfb-run -a node tests/smoke/entry-recovery.ts --allow-gui --diagnostics "$fixtureDiagnosticsDirectory" --collection-id "$collectionId"
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
unchanged. Opt-in synchronous observation can perturb timing. The preload
measures the full synchronous collector callback, including validation, lock,
file size checks, append and cleanup, using monotonic elapsed milliseconds.
It directly appends one closed `collector-cost` record at normal stream shutdown:
`callbacks`, cumulative `totalMs`, and largest `maxMs`. Rejected events count once;
write failures remain in the measurement. Publishing this terminal record does
not recursively enter the diagnostics channel or measure itself. An interrupted
child or capped stream can lack the terminal record; absence means unknown cost.
Invalid clock evidence is marked unavailable. Asynchronous Linux sample elapsed
time is recorded separately. Neither metric measures all Chrome logging costs,
kernel I/O disturbance, event-loop scheduling delay or instrumentation causation.
No real Linux/macOS collector-cost acceptance is established by synthetic tests.

An accepted current diagnostics collection also enables `chrome-startup.ts`.
On Linux, `xdpyinfo` queries the inherited `DISPLAY` inside the smoke's
`xvfb-run` session with ignored output and a separate five-second bound.
The utility is optional: missing query support records `available=false` and
`responsive=false`, leaving display responsiveness unknown. The original Xvfb,
Chrome and actual CDP acceptance checks remain mandatory. An available utility's
failed or timed-out query fails the prerequisite check before Chrome starts.
Refused or unconfigured collections add no browser logging flags or files.
Controlled launches add plain `--enable-logging` and an absolute `--log-file`
in a canonical private scratch sibling outside profiles and the upload directory.
The opt-in startup study's `off` arm omits only those two flags; its missing
Chrome log projection is expected, while capture and display preflight remain enabled.
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
Successful proc-stat decisions optionally include `rootStartTicks`,
`rootUserTicks`, `rootSystemTicks`, `rootMajorFaults` and `rootBlockIoTicks`.
The tick fields retain kernel units rather than assuming a clock frequency;
major faults are counts. They parse only the existing stat buffer, without an
additional runtime read. Missing or unsafe optional counters remain absent;
they never weaken PID/creation-time identity checks.
Retained `exitObserved`, exit code, signal and `monitoringFailed` evidence is sampled
before rollback Close. These fields add no process scan, watcher or readiness deadline.

For an accepted Linux diagnostics collection, the preload also enables the
test-only `linux-startup-wait` sampler. It pins entry, connection, session, PID
and creation ticks only after the proc-stat decision belongs to the same
completed native snapshot and the following root identity validation succeeds.
A successful proc-stat read or snapshot END alone does not authorize sampling.
Concurrent connections stay independent; restart establishes a fresh identity.
Overlapping frames or a new BEGIN before the previous validation decision are
quarantined until every outstanding END and successful-END validation decision
has drained. Quarantined candidates never authorize a read, including the event
that finally drains the overlap. Missing decisions conservatively leave later
observation unavailable until a fresh session; this can occur for health/verify
snapshots that do not publish a root-validation decision. For a previously
verified root, further affected triggers record `snapshot-ambiguous` or
`snapshot-unvalidated` skips.
Before an identity was verified, only the safe native frames remain as evidence
of that limitation. This trades incomplete diagnostics for unambiguous identity.

Each verified root consumes at most four one-shot triggers: first validated
snapshot (`baseline`), at least one second of continuously observed `D`
(`continuous-d`), first owned listener (`first-owned-listener`), and the
`rollback-request` decision. The D span requires validated observations no more
than 500 ms apart, conservatively covering the existing 200 ms polling interval;
non-D, failed/interrupted frames, reversed time or a larger gap reset the span.
Failed and busy samples consume their trigger without retry or a queue.
Rollback means triggered when rollback was requested, and may race normal Close.
Nothing in the runtime waits for this asynchronous sample.

Generic sampler callers retain seven fixed reads: `/proc/<verified-pid>/stat`,
`wchan`, `io`, system `/proc/pressure/cpu`, `memory`, `io`, and the process stat
again. The controlled Linux preload explicitly enables resource evidence,
raising the ceiling to 22 accounted reads plus four stat/realpath metadata
operations. Each read accepts fewer than 4,096 bytes; a full buffer is
conservatively overlong and is not parsed. The conservative aggregate
retained/accounted input ceiling is 90,112 bytes, and the serialized record
cap remains 4,096 bytes. Helper transport chunks can cross the per-read
threshold before SIGTERM takes effect; this is not a physical transport cap.
The shared 250 ms total deadline stops publication of metrics and subsequent
reads. The timer is unreferenced. An already pending filesystem call or helper
can settle later; bounded bytes and a timer cannot cap kernel syscall latency
or synchronous event-loop disturbance. The root stays busy until that work
settles, so another trigger records a skip. Every opened handle is closed even
after late settlement. Exited/inaccessible roots, timeout, unsafe counters,
unknown wait symbols, and old-session completion carry closed limitations.
Before/after creation ticks must match the pinned root; identity uncertainty or
a stale session discards metrics. Late completion never updates a successor.

| Projection | Unit and interpretation |
| --- | --- |
| `process.userTicks`, `systemTicks`, `blockIoTicks` | Kernel ticks; corresponding `*Delta` is within the sample's stat pair. |
| `process.majorFaults`, `majorFaultsDelta` | Fault counts and within-pair change. |
| `process.readBytes`, `writeBytes` | Absolute process I/O byte counters, with no invented delta. |
| `wchan` | Closed symbol class: futex, pipe, poll, I/O, scheduler, or unknown. It is an observation of a wait category. |
| `ioWaitKind` | Optional I/O detail: `io-scheduling`, `page-bit-wait`, `buffer-wait`, `writeback-wait`, or `block-tag-wait`, derived from the same wchan read. |
| `systemPsi.*TotalUs` | System-wide cumulative stall microseconds for CPU, memory or I/O `some`/`full`; `scope` is always `system`. |
| `resources.kernel` | Closed exact-frame classification: filemap fault, buffered read, writeback, dirty throttling, unspecified page wait, other, or unavailable. |
| `resources.storage`, `major`, `minor` | Filesystem block device derived from the verified executable's metadata; partition counters retain their own device identity. |
| `resources.readsCompleted`, `sectorsRead`, `readMs`, `writesCompleted`, `writeMs`, `inFlight`, `ioMs`, `weightedIoMs` | Absolute system-device counters; sectors are 512-byte units and times are milliseconds. These are not Chrome-exclusive throughput. |
| `resources.queueMajor`, `queueMinor`, `readAheadKb`, `rotational` | Actual queue metadata, from the parent device for a partition; readahead is in KiB and rotational is 0 or 1. |
| `resources.cgroup`, `fileRefault`, `pgscan`, `pgsteal`, `memoryHighEvents`, `memoryMaxEvents`, `nrThrottled`, `throttledUs` | Visible target cgroup only: reclaim/event counts and cumulative CPU throttling microseconds, with explicit counter availability. |
| `resources.memoryHighLimit`, `memoryMaxLimit`, `cpuQuotaLimit` | Visible finite, max or unavailable states; finite memory limits are bytes and CPU quota/period are microseconds. |
| `resources.ioMax`, `readBpsLimit`, `writeBpsLimit`, `readIopsLimit`, `writeIopsLimit` | Visible leaf `io.max` for the mapped queue device only; unavailable, unmapped, absent-entry and configured states remain distinct. Configured limits retain finite/max states. |
| `elapsedMs`, `reads`, `bytes` | Sampler elapsed time and bounded read requests/returned bytes, separate from synchronous collector cost. |

Missing, unsafe or decreasing counters remain unknown rather than zero.
Process and system counters are also checked against the previous sample for
the same verified root. Wchan classification is deliberately closed: an
unmatched symbol remains unknown and raw symbols never enter the stream.
The optional `ioWaitKind` refines only `wchan=io`; older records remain valid
without it. It adds no file read, trigger, timer or deadline. A closed wait kind
does not identify the filesystem, device, syscall or causal source of a delay.
[Linux proc documentation](https://docs.kernel.org/filesystems/proc.html)
defines the process counters and wait channel;
[Linux PSI documentation](https://docs.kernel.org/accounting/psi.html)
defines system resource pressure. Concurrent system pressure can correlate
with Chrome's delay, but alone cannot prove what this root was waiting for.
System CPU `full` is undefined and kernels since 5.13 report zero for backward
compatibility; that supplied zero cannot establish absence of CPU contention.
Resource evidence uses one fixed structured helper, `/usr/bin/sudo -n
/usr/bin/cat /proc/<verified-pid>/stack`, because ordinary unprivileged reads
may be denied. It uses no shell, ignores stderr and caps stdout. Deadline or
overflow sends SIGTERM only to that helper; pending ownership remains until
its actual close. Missing or denied helper support leaves a closed limitation.
Only exact known frame tokens classify a wait; a page-wait frame alone does not
prove a filemap fault, and compiler suffixes are never stripped to invent a match.
Raw stack text, symbols and addresses never enter the stream or summary.

Executable metadata and canonical sysfs mapping are rechecked before accepting
device evidence. Overlay/non-block/unsupported mappings remain unavailable.
The cgroup probe accepts one unambiguous unified mount at `/sys/fs/cgroup` and
maps the target membership through its visible mount root; unsupported or
escaped layouts remain unavailable. It does not enumerate ancestors. A visible
leaf's max or absent limit cannot exclude ancestor, host or VM constraints.
[Linux block statistics](https://docs.kernel.org/admin-guide/iostats.html) and
[cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html)
define these counters and scopes. Process `readBytes` measures submitted I/O,
and major faults are not block-request counts; use device completion deltas
with their explicit shared scope when studying storage progress.
No syscall parameters, thread/descendant traversal, mount/cgroup paths or raw
file content enters diagnostics. Unconfigured/refused diagnostics and non-Linux
platforms create no Linux sampler, reads, helpers or timers.

Wait records use the same bounded stream and five filenames. The small summary
retains the latest eight validated samples; `linuxStartupWaitOmitted` explicitly
counts earlier summary records and marks the summary incomplete. Consult the
stream for those earlier samples, subject to its unchanged caps. Completion
callbacks also contribute to `collector-cost`; an inline busy result nested in
the channel callback counts only once. Only closed identities, categories,
safe numbers and limitations survive either projection.

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

### PR 32 first Ubuntu startup failure

The [first PR 32 Ubuntu job](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/37915060872/job/113771178523)
failed before connecting the official MCP Server. Its head was
`85123e915dc77efa65c81f9d6ad5a1136de9cf27`; the job checked out virtual merge
`7f47f5fc895b973538b318f703c17390aaedbd30`, whose tree
`6f39713e5cf2ac0e3b3dd4a3264e47cdfee84435` matched the head tree and the passing
push and later single rerun. Those passes establish intermittency, not a fix.
The [original five-file artifact](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/37915060872/artifacts/11609822561)
has archive SHA-256
`f5c8d1706cb2b4f5d681e0c99c95acd04ca706a053b5eabbc9b5c5014607fdf0`.
The original full job logs, exact artifact and timing analysis are preserved in
external task evidence; uploaded artifacts remain subject to GitHub retention.

| Readiness elapsed | Observed boundary |
| --- | --- |
| 30.666 ms | First root sample in `D`; no listener. |
| First 71 attempts | No owned listener and endpoint connection refused. |
| 18,261.502 ms | First correctly owned listener. |
| Following two probes | `/json/version` timed out after 1,002.015 and 1,000.747 ms. |
| 20,719.039 ms | Startup failed; retained child exit evidence still reported alive. |
| Rollback | Normal Close accepted in 59.531 ms; exit observed after 2,213.688 ms; managed directory deletion succeeded. |

The 73 readiness snapshots recorded 64 `D` and nine `S` states. Native snapshot
calls totaled 3,917.854 ms, averaging 53.669 ms with a 94.564 ms maximum; there
was no observed individual native command hang. The last endpoint probe began
with 535.489 ms remaining but retained its existing one-second request budget;
that explains part of the final deadline overshoot, not the preceding startup
delay. The first failure was preserved independently of successful cleanup.

Linux [`/proc` documentation](https://docs.kernel.org/filesystems/proc.html)
defines `D` as uninterruptible wait. It does not identify storage congestion or
the responsible wait point by itself. The historical records cannot distinguish
Chrome's own blocking from diagnostic collection disturbance. The startup limit
remains 20 seconds. New samples must establish a concrete wait point, resource
change or collection effect before a minimal causal fix and single-variable
verification can be selected. A successful diagnostic run verifies observation
capability only; without a reproduced failure the root cause remains unknown.

### Darwin listener ownership evidence

With the controlled subscriber enabled, Darwin snapshots additionally derive
`listener-owner-evidence` decisions from the same process rows and listener
records already read by `ps` and `lsof`. This adds no native invocation, file
read, retry, observer or timer. The public process evidence and all acceptance
and normal-Close decisions retain their original behavior. Other platforms do
not emit this Darwin projection; an unconfigured subscriber does no extra
ownership classification.

Each snapshot emits one count record and at most eight distinct parsed-owner records.
The count record carries total listener records, distinct parsed owners, emitted owners
and omitted owners. A positive omitted count explicitly means the owner
projection is incomplete; consult the unchanged bounded stream without assuming
an omitted owner was owned. Per-owner records retain the root in `pid`, use
`listenerOwnerPid` for the observed owner, and count duplicate listener records
for that owner. `listenerOwnerOwned` preserves membership in the original owned
process set; a bounded classifier's depth limit does not change that membership.
Safe available owner/parent PIDs, UID and creation epoch
milliseconds, plus the root UID and creation epoch milliseconds, allow cautious
comparison of readiness and rollback observations. Missing or unsafe values are
omitted. Malformed owner values have the closed invalid-owner relation and no
usable owner PID; parsed-value counts cannot establish distinct real owners for
such records. An ancestry walk is limited to 32 edges of the existing rows.

The closed relation is root, owned-descendant, owner-row-missing,
ancestor-row-missing, uid-mismatch, child-before-parent, unrelated-root, cycle,
depth-limit, invalid-owner or root-absent. These are facts about that captured
observation, not permission to accept a listener. In particular,
owner-row-missing cannot establish that an owner was unrelated or was a newly
created child. The existing Darwin creation evidence has second resolution;
matching PID/time observations cannot exclude reuse within that resolution or
recover the identity of a vanished owner. No additional ancestry scan, raw
process table, executable claim, address, argv or environment is collected.

The native-close end event also preserves the already returned closed listener
state as `status: owned`, `foreign` or `absent`. It describes the existing
pre-close snapshot, not the listener at an earlier readiness rejection or after
actual process exit. Missing state remains absent, including early-exit and
legacy close paths. Only an own data property with an exact closed value is
projected; accessors and invalid metadata cannot alter Close or its original
error. The collector's cost measures its receive/validation/write path, not the
producer's optional classification work or all native observation overhead.

### PR 33 macOS ownership rejection

The [first push macOS job for PR 33](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/37925889399/job/113806384938)
failed on attempt 7 at listener ownership, before any endpoint request on that
attempt. The checked-out head was
`bd96e88c37e925e647ac4905cb9285b709b56a8d`, with tree
`fa465350be9e777362f77447dbff0611d648869a`. The successful PR checkout and one
later rerun used the same tree. They establish passing executions, not the
cause of the original rejection. The
[original five-file artifact](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/37925889399/artifacts/11613929634)
has verified archive SHA-256
`c7b420b7154063bff11d7c33be546b0a3b99d96d0f9813120e14710db4a0df97`.

Readiness lasted 2,558.597 ms, with roughly 17.5 seconds remaining. Attempts
1-6 found no listener. Attempt 7 observed a valid root, four unique owned
descendants and two listener records; at least one later listener owner was
outside the earlier process set. Two records do not establish two owner PIDs
or two sockets. The process observation preceded listener observation, but the
old artifact has no owner/ancestry correlation. A real foreign listener and an
observation gap remain unproved alternatives. Raising the startup timeout
would not address this immediate rejection.

Rollback immediately took another process/listener snapshot and successfully
requested normal Close; actual exit and directory cleanup succeeded. That
snapshot's returned listener state was previously omitted from diagnostics.
The new projection preserves this already available evidence and can narrow a
future failure without extra native reads. It cannot recover the original
mismatching owner retrospectively. The historical macOS cause remains unknown
and unresolved; synthetic interleavings verify diagnostic behavior only.

### Failed first-start completed I/O capture

The additional first-start observer defaults off. The existing ordinary Linux
job can admit it for one explicitly authorized, non-forced push transition on
`fix/chrome-startup-stall` from
`1a598a7ca01c4e17535c5c9c98cd4564d6369e77`. Admission requires attempt one,
the exact repository/ref, consistent event `after`, `GITHUB_SHA`, actual clean
checkout and commit-tree identity. PR, edited, scheduled, manual, created,
deleted and rerun events never enable this observer. The gate verifies runtime
identity; the human approval of the specific new head/tree is independently
recorded before the one push. It is not a persistent global consumption lock.
Do not dispatch or rerun CI to fill a quota or continue until a failure occurs.
Ordinary PR checks and both ordinary smoke flows remain required.

The flag configures only the accepted official-server child's private preload
query. It is removed from the gateway's inherited environment, cannot enable
the study or entry-recovery fixture, and does not change Chrome arguments,
queue readahead, readiness, normal Close or cleanup. Only the first selected
operation may supply samples. The root is admitted after its completed native
snapshot and successful identity validation; a later start is not a substitute.
The internal `readinessExitReason` distinguishes actual budget exhaustion from
foreign-listener, terminal-condition and interrupted-poll exits without a new
clock read or native probe. A fixture failure alone is not proof of that symptom.

The armed preload alone requests the internal creation-identity observer;
ordinary diagnostic subscribers do not enable it. It observes the selected
first start's actual creation-time comparison and the same existing proc-stat,
boot-time and `CLK_TCK` reads. It adds no operating-system read or helper call.
Six monotonic interval bounds describe those three reads, without claiming an
atomic snapshot. Private metadata binds to the actual returned root object and
its saved values and origin. Missing, copied, mutated or inconsistent evidence
cannot supply a complete source association.

One shared budget admits at most 128 observation frames before added source
timing or metadata. Failed source attempts consume their reservation. A source
and its first comparison share one frame; repeated or independent comparisons
need another. Already admitted work may finish at the cap, while further
admission stops. This budget never stops production polling. A rollback decision
immediately stops new creation observation and sampling. The matching waiting-CDP
END locks the first readiness outcome; the operation terminal is a fallback only
when readiness never began. Missing readiness END stays incomplete, including
after a later operation or Close result. Revocation preserves Close/exit receivers
and admitted pending ownership.

Reached, verifiable comparisons retain numeric expected/observed UTC. A complete
source association additionally retains the original computed Number, boot
seconds/start ticks/clock ticks and read bounds. Unreached or unverifiable
comparisons retain their status without fabricated comparison UTC. Records
identify the actual branch and whether
the original upper-bound wall-clock call ran. The original 1,000 ms tolerance,
`Date.now()` short-circuit, error priority and readiness predicate remain.
Added timing, metadata or subscriber failures only remove diagnostic evidence;
they cannot replace the original I/O or comparison result. Producer CPU cost is
explicitly unmeasured; existing subscriber count/total/max costs remain distinct
from read intervals. No raw time string, process text, stack or path is retained.

At most six slots run: baseline on the first verified root, then waiting-CDP
BEGIN-relative 4, 8, 12, 16 and 19 seconds on the gateway monotonic clock.
Baseline retains its actual time. Slots over 250 ms late, unavailable or busy
are recorded without backfill. Process/system PSI, executable-backing device
and visible cgroup families have independent discovery, 250 ms result limits
and actual pending ownership. Each family performs API work sequentially;
a blocked stack helper or cgroup discovery cannot discard a completed device
family. There is no periodic privileged stack helper or new postfailure sample.
An expired result does not cancel a native read; the same owner remains busy
until it settles and closes the handle.

The per-slot file acquisition caps are 8 process, 12 device and 36 cgroup,
plus at most 10 discovery acquisitions: 346 total, at most 1,417,216 returned
bytes and 2,768 read calls. A new reader opens each file once, advances by actual
bytes read and requires EOF in at most eight calls. A cumulative full 4,096
bytes is conservatively unknown even for an exactly full file. A short read
alone cannot prove EOF or a unique mount mapping. Mountinfo above this bound
leaves cgroup mapping unavailable; never accept its prefix as a complete table.
Sampling metadata has a separate conservative hard cap of 336 API calls.
All figures bound application operations and returned data, not kernel work,
physical I/O or event-loop latency. Required close/unlock work is reserved
before admission and is not abandoned at an outcome deadline.

Device and parent queue counters retain separate identity epochs and actual
acquisition intervals. Their completed reads/sectors are shared-device work;
512-byte sectors determine the completed-byte conversion. Cumulative read time
is not wall time, and `inFlight` is a gauge. The executable device need not hold
every library or profile and does not represent all Chrome descendants.
The cgroup family projects leaf plus at most three visible ancestors, selected
and queue `io.max` keys, CPU quota/throttle and memory limit/event context.
Depth caps, missing controllers, root-not-applicable, unavailable counters and
membership/namespace changes remain explicit. Non-root leaf `io.stat` is bio
accounting, not completed device I/O. Neither an absent visible policy nor a
visible mount root excludes hidden ancestors or Azure host/backend throttling.

The observer caches fixed closed records in memory, at most 64 records/256 KiB
of serialized UTF-8 including newlines, with at most 4,096 bytes per record.
Two existing auxiliary-capacity slots retain the first comparison and the
first distinct rejected comparison; private invocation identity distinguishes
them even when timestamps coincide. An initial rejected comparison occupies
only the first slot. The 36 family, eight cost and 12 auxiliary slots allocate
at most 56 records without increasing any stream or writer budget.
Each comparison record carries a closed nested `creation` group; accepted
comparisons use `complete`, while rejected comparisons use `identity-invalid`.
The existing `limitations` slot adds an optional closed `creationObservation`
receipt. Available producer statistics report source attempts, comparisons,
reserved tokens, cap refusal, diagnostic disable and normal revocation separately,
with `omitted = comparisons - retained`. Unavailable or inconsistent statistics
remain explicitly unavailable; retained/omitted then describe only observed cache
calls, without invented producer counts. Producer CPU remains `unmeasured`.
First readiness success discards these two comparison details and the bounded
family/epoch details, retaining existing binding/selection/cost/discard receipts.
This outcome is separate from subsequent upstream, Close, cleanup and fixture
results. The parallel legacy wait sampler still retains its ordinary successful
I/O/PSI/resource records; a later fixture failure can upload those earlier
records. They cannot stand in for a failed first-start sample.
Failure stops new admissions and permits
one static-order flush only after the matching `native-close END` or confirmed
actual exit. A Close BEGIN is too early: its identity snapshot may still be
pending before normal shutdown is submitted. A failed Close END is retained as
failed, never as proof that shutdown was submitted. There is no native lifecycle
await on diagnostic flushing. A hung Close path or early process death may lose
the cache and must remain incomplete.

The same five artifact files and failure-only ordinary upload are used. Armed
streams reserve 100 records/400 KiB within the existing 2,000-record/1 MiB
limit; ordinary records use at most 1,900/624 KiB. The reservation contains
closed capture records, fixed lifecycle slots and all markers/fallbacks.
Ordinary exhaustion keeps the overall summary incomplete while allowing the
reserved classes to proceed. Both writers enforce the same count/class rules
under one immediate non-waiting lock attempt. The cache summary has its own
bounded slots; it does not evict the existing wait or readahead summaries.
Added writer work has separate scan/write/metadata accounting and limits;
the aggregate limits are 68 attempts, 408 reserved metadata operations and
two MiB of incremental scans. The child owns 64 attempts/384 operations/one MiB,
including four marker attempts; the parent owns four attempts/24 operations/one
MiB, including retained-summary reconstruction. Each transaction reserves six
operations before its first filesystem API and keeps required release work
inside that reservation. Exhaustion can sacrifice detail, so these caps are
not a retention guarantee. Job-index and unarmed summaries retain their 64 KiB
read limit; armed summary presentation is separately bounded by one MiB.
Costs with pending work or an unmeasured final self-report write cannot be
reported as complete. Raw stacks, symbols, cgroup/mount paths and private
content never enter these artifacts.

Report every authorized position, including cancellation, zero starts,
identity rejection, missing artifacts and cleanup failures. For a useful
budget-failed first start, seek two compatible device endpoints completed
before Close, including one within 1.5 seconds before failure, and show the
actual process/PSI and visible-policy windows alongside them. Missing evidence
is not zero and post-Close work cannot replace the endpoint. If the single
ordinary opportunity passes, report failure not reproduced and stop; do not
repeat a success batch or claim a repair. Commit/push and the resulting real
CI capture require separate authorization after local patch and code review.

## Bounded Ubuntu startup study

The diagnostic-only `official-server.ts --startup-study --chrome-file-logging on|off`
mode is Linux-only and requires both explicit `--allow-gui` authorization and a
valid, freshly initialized diagnostics collection. The two study arguments must
appear together exactly once, with the literal arm `on` or `off`; malformed,
unknown or duplicate arguments fail before resource acquisition after the GUI
authorization check. A refused or missing current collection cannot run a study.
This mode is outside the default test lane.

Both arms preserve the normal smoke's initialization, official catalog, initial
status and first-start prefix. They launch exactly one new owned Chrome, verify
process/listener/endpoint identity, actual browser version and managed Profile
Path, then run the existing finally cleanup. They skip later CSS, extension,
multiple-target and recovery acceptance. A successful sample establishes only
those first-start checks; ordinary CI continues to run the complete official
tools and entry-recovery smokes on both existing platforms. The production
readiness predicate, polling strategy and 20-second deadline stay unchanged.

The `on` arm retains the existing `--enable-logging` and absolute `--log-file`
switches. The `off` arm omits only these two switches. Both retain the same
parent behavior, accepted collector/preload, private capture, display preflight,
Linux sampler and cleanup. The closed study result in stdout identifies
`chromeFileLogging` and `expectedLogAbsence`; `off` expects the absent-log
projection. Absence in that arm is not evidence of a Chrome logging failure.
Raw Chrome logs remain excluded from uploads even when private scratch is retained.

After verifying the committed Plugin build, run one explicitly authorized local
Linux sample with a fresh collection, choosing exactly one arm:

```sh
export DCT_SMOKE_CHROME_EXECUTABLE=/opt/google/chrome/chrome
set -euo pipefail
fixtureDiagnosticsDirectory="$(mktemp -d "${TMPDIR:-/tmp}/dct-startup-study.XXXXXX")"
collectionId="$(node tests/smoke/fixture-ci.ts init "$fixtureDiagnosticsDirectory")"
test -x "$DCT_SMOKE_CHROME_EXECUTABLE"
command -v lsof
command -v getconf
command -v Xvfb
command -v xvfb-run
command -v xauth
if node tests/smoke/fixture-ci.ts stage "$fixtureDiagnosticsDirectory" official-server "$collectionId"; then :; fi
xvfb-run -a node tests/smoke/official-server.ts --allow-gui --startup-study --chrome-file-logging off --diagnostics "$fixtureDiagnosticsDirectory" --collection-id "$collectionId"
```

After either outcome, index only that current collection with
`node tests/smoke/fixture-ci.ts summary "<absolute-artifact-directory>" "$collectionId"`.
Do not run a Chrome version/hash command or warmup before its first start.
The example does not retry a failed sample. `TMPDIR`, when provided, must be an
existing absolute temporary parent. Every invocation uses a fresh directory;
earlier evidence is preserved and never presented as current.

The CI input `ubuntu-startup-study` defaults to false. Dispatch `ci.yaml` once
against the reviewed branch with it set to true, using Actions or
`gh workflow run ci.yaml --ref <reviewed-branch> -f ubuntu-startup-study=true`.
Quality and its supply-chain prerequisite must pass before the study starts.
The matrix is fixed: blocks 1, 2 and 3 crossed with file logging `on` and `off`,
six independent fresh `ubuntu-24.04` runner slots, Node 24.21.0, pnpm 12.4.2
and `/opt/google/chrome/chrome`. Fail-fast is false, with no ignored failures,
retries, extra batches or replacement slots. A cancelled or incomplete slot is
recorded as such. The study dispatch has its own run-ID concurrency group and
cannot cancel ordinary CI's workflow/ref group.

Both manual studies upload on success and failure, using `always()`
and the successful current-initialization guard. Each artifact is named
`ubuntu-startup-study-block-<block>-logging-<on|off>-<run-id>-<attempt>` and retains
exactly `job-index.json`, `official-server.events.ndjson`,
`official-server.summary.json`, `entry-recovery.events.ndjson` and
`entry-recovery.summary.json` for seven days. The entry-recovery envelope stays
not-run and its stream stays empty. Hidden files and overwrite remain disabled;
missing files warn. The neutral job summary indexes the same safe evidence and
artifact link after either outcome. Ordinary real Chrome jobs retain failure-only
uploads, and other jobs remain artifact-free.

Compare the first readiness outcome and its monotonic duration as the primary
measure. Secondary evidence is time to first owned listener, endpoint outcomes,
safe process counters, `wchan`/optional closed `ioWaitKind`, system PSI,
native-command and collector costs, and actual exit/profile/scratch cleanup.
Preserve the tested commit and tree, Actions runner image/toolchain identities,
actual endpoint browser version, arm and slot alongside the five-file artifacts
and safe job logs. The controlled preload retains four one-shot triggers,
up to 22 accounted reads plus four metadata operations, and a shared 250 ms
budget, as described in the sampler contract above. Each read retains/accounts
at most 4,096 bytes; helper transport chunks may cross that threshold. Streams still
allow 4,096 bytes per record, 2,000 records plus one truncation marker and 1 MiB
total. Missing terminal cost records, absent cleanup, omitted samples or truncated
evidence must remain explicit limits.

Fresh runners do not establish known cold caches. Blocks do not place the two
arms on the same machine, and host load, storage, image and scheduling can differ.
These six pilot samples cannot prove a causal logging effect or rare-failure
reliability; an arm difference is association only. If all samples pass, the
historical failure was not reproduced and the root cause remains unknown.
The study does not change or replace full real Chrome acceptance.

## Bounded Ubuntu readahead study

The separate Linux-only queue intervention adds `--readahead-kb 128|1024` to
`official-server.ts --allow-gui --startup-study --chrome-file-logging on`.
It requires explicit GUI authorization, a valid freshly initialized collection
and fixed file logging on. It remains test-only and outside the default lane.
The default-false `ubuntu-readahead-study` manual input selects this job; leave
`ubuntu-startup-study` false. Selecting both inputs fails Quality before any
research Chrome starts, and neither research job runs. One explicitly authorized
dispatch is:

```sh
gh workflow run ci.yaml --ref <reviewed-branch> -f ubuntu-readahead-study=true
```

Quality and the existing supply-chain gate precede the six independent fresh
`ubuntu-24.04` runner slots. Node 24.21.0, pnpm 12.4.2, the explicit executable,
trusted frozen install, typecheck, current collection initialization, stage and
Xvfb prerequisites remain the same. Allocations are fixed before execution:

| Slot | Block | Assigned queue RA (KiB) |
| --- | --- | --- |
| 1 | 1 | 128 |
| 2 | 1 | 1024 |
| 3 | 2 | 1024 |
| 4 | 2 | 128 |
| 5 | 3 | 128 |
| 6 | 3 | 1024 |

Matrix order is not chronological scheduling, and block labels do not pair
samples on a machine. Logging stays on in all six slots. Fail-fast is false;
there are no retries, replacement slots, adaptive extra batches or ignored
failures. An admission failure retains its assignment with zero Chrome starts;
an admitted slot starts at most once. The run-ID-specific concurrency group
cannot cancel ordinary CI's workflow/ref group. Both ordinary acceptance smokes
still run with their original commands and gates on Linux and macOS.

The CI invocation after accepted initialization and staging is exactly:

```sh
xvfb-run -a node tests/smoke/official-server.ts --allow-gui --startup-study --chrome-file-logging on --readahead-kb "${{ matrix.readaheadKb }}" --diagnostics "$RUNNER_TEMP/dct-fixture-diagnostics" --collection-id "$collectionId"
```

For an explicitly authorized disposable Linux sample outside Actions, use the
startup-study initialization/prerequisite sequence above with a fresh directory,
then this command, choosing one literal assigned value:

```sh
xvfb-run -a node tests/smoke/official-server.ts --allow-gui --startup-study --chrome-file-logging on --readahead-kb 128 --diagnostics "$fixtureDiagnosticsDirectory" --collection-id "$collectionId"
```

Do not query Chrome's version, hash or read its entire executable, copy the
browser, benchmark storage, warm caches or use `drop_caches` before the first
start. No browser download or extra OS package installation belongs to this
protocol. Actual Chrome version comes from verified CDP output; any whole-file
fingerprint belongs after actual exit. A fresh runner's first start does not
prove every page/cache layer is cold.

Before launch, the fixture derives the explicit canonical executable's device
and unique partition/parent-queue mapping from metadata. It records the original
RA, explicitly sets either assigned value and verifies readback. The 128 KiB
arm does not assume the original value was 128. Canonical identity must be
reverified before each write and restoration, and the launched executable must
map to that same selected device/queue. Ambiguous, unsupported or changed mapping,
unavailable permissions or mismatched readback makes admission unavailable;
there is no guessed device or fallback. This intervention changes a disposable
runner guest queue used by other processes, not a Chrome-exclusive setting.

Partial, failed or timed-out writes retain responsibility for the original RA
even if no Chrome started. Every pending write helper must actually settle before
restoration, so a late write cannot invalidate a claimed restore. After normal
Close, actual owned application and relevant resource exit must be proved before
restoring and verifying the original RA on the same verified queue. Gateway-child
exit and a successful smoke alone do not prove that barrier. Cleanup, pending
ownership, missing exit proof and restoration failure remain explicit outcomes;
Chrome is never force-killed to complete a sample. Preserve primary startup
failures while reporting cleanup and restoration separately.

Small prelaunch and terminal device-counter observations supplement the existing
bounded wait/resource samples. Terminal observation must not block or delay
readiness, immediate rollback or normal Close. Retain its observation start and
completion times and whether cleanup overlaps. A terminal window not proved
complete before Close/rollback is overlapped or unavailable and excluded from
clean-window comparisons. Failed startup remains in its assigned arm regardless.
Closed enum/numeric research records reuse the existing 4,096-byte record,
2,000-event plus truncation-marker and 1 MiB stream caps; raw errors, stacks,
symbols, paths and page content are excluded. Missing, rejected, malformed or
truncated records cannot prove readiness, exit or restoration.

Each new observation phase has a 250 ms result budget, with at most 64 text
reads of 4,096 bytes each; canonical/stat/directory operations are counted
separately as `metadataOps`. This budget does not cancel actual filesystem work
or a privileged writer. Pending work retains ownership until settlement. Cost
records distinguish complete, pending and unavailable byte accounting; the final
gateway observer record reconciles its lifetime costs and must not be added to
the phase records again. Parent and gateway timestamps use different clock
origins and cannot be subtracted. Existing wait-sampler limits remain unchanged.

Final restoration evidence records `startCalls` as zero or one control start
calls, rather than inferring a process count from absent events. Verified
admission and restoration include the independently observed `readAheadKb`.
Missing final evidence cannot establish zero starts or a successful restore.

Upload and index use `always()` plus accepted current initialization after either
outcome. The artifact name is
`ubuntu-readahead-study-slot-<slot>-block-<block>-ra-<128|1024>-<run-id>-<attempt>`.
The same five fixed files are retained for seven days, with hidden files and
overwrite disabled; entry-recovery stays not-run with its empty stream. Raw
Chrome logs, profiles, private scratch and browser wildcards remain excluded.
Keep the run, attempt, exact head/tree and artifact digests with the assignment
and safe runner/image/toolchain metadata.

Report all six assigned outcomes first: include unavailable admission, missing
records, timeout, no-CDP, truncation, cancellation, cleanup and restore failures.
A timeout means not ready within the unchanged 20-second native readiness budget,
not a successful 20-second startup. A slot without CDP version stays in the arm's
outcome table even if it cannot enter a complete software stratum.

Then compare only joint observed ImageVersion, actual Chrome, kernel, original
RA and visible queue configuration strata supported in both arms, including
visible queue class and rotational attributes. Do not substitute image README
versions for runtime versions. Numeric device identities are local to a VM and
do not establish common physical devices; queue attributes do not prove physical
media or topology. Different software/original-RA/visible-queue configurations
are explicit confounding, rather than an identifiable RA comparison.

Within a shared stratum, compare first owned listener and verified readiness,
root D observations, closed wait kinds, device completed reads/sectors/readMs,
read bytes and bytes per completed read, submitted process reads/faults, reclaim
and observed cgroup policies. These shared device windows are non-atomic, and
cumulative request readMs is neither wall time nor Chrome-exclusive latency.
Fewer requests in a shorter window alone cannot distinguish different request
granularity from less background I/O; ancestor, VM and host limits remain unknown.
Report read amplification and reclaim tradeoffs even if readiness improves.

A request-granularity interpretation needs verified RA change, fewer completed
requests/less page waiting and better readiness, with the byte/reclaim tradeoff.
If controls run quickly, the slow condition was not reproduced. No corresponding
input/readiness change means no demonstrated effect on the dominant path;
worse amplification, reclaim or latency remains contrary evidence. All success
does not prove a historical Azure IOPS cap, a repair or broad reliability. An
inconclusive result cannot authorize another slot or dispatch. This research
never replaces ordinary full official-tools and entry-recovery acceptance.
