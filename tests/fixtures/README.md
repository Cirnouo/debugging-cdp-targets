# Test fixtures

`connection-directory-runtime.ts` exports createDirectoryRuntimeFixture, deferred,
tick and route for the connection lifetime, operation evidence and directory
admission suites. It composes real Core/DataDirectoryRegistry over controlled
ControllerHost/router/official boundaries, keeping Application private and all
setup/support/teardown assertions and expectCleanupFailure cleanup branches.
Regression-case assertion bodies remain in the three suites. This support differs
from target-host.ts's real createTargetHost fake; neither fixture copies the other.
The reviewed intermediate root location precedes the final
`fixtures/gateway/connection-directory-runtime.ts` relocation in the maintained
[content plan](../../.superpowers/plans/2026-10-18-repository-content-reorganization.md).
That later move must update suite imports and both affected fixture maps together;
core-runtime.ts stays at its current location until its own migration.

`target-host.ts` exports createTargetHostFixture, the shared controlled target-host
I/O boundary for the Gateway profile and launch suites. It preserves synthetic
process/listener evidence, async profile availability, argv observations and
close-emitted exit cleanup without launching a real child. Its current root
fixture location precedes the separately planned fixture-family migration.

`deployment-lock.ts` is a test-only ordinary Node child using the independently
verified original native loader closure. Parent-owned fixed acquire/release
commands exercise exactly the fixture operation/use files, with no GUI or
production control endpoint; IPC disconnection closes its owned descriptors.

`deployment-state-reader.ts` holds its own installation-use descriptor while a
separate writer replaces selections. It reports complete admitted identities or
explicit rejected concurrent evidence, and normally exits after the final sample.

`core-runtime.ts` composes the actual reusable Core with one explicit test
registration, attached client and request-scoped facilities. It supplies private
controller/control/invoke/cleanup conveniences without restoring a production
stdio entry or implicit owner.

`http-gateway.ts` exposes that actual Core through the production SDK HTTP adapter
in a test-owned child. Calls use explicit registration bearers; start/restart
require command-line `--allow-gui`. Source mode runs on the supported contributor
Node and verifies the installed complete official package. The sealed build
uses only its colocated App resources, verifies official and ordinary Node
inputs and refuses a different Node executable. It has no worktree or old Plugin
fallback. Stdin EOF
is explicit test teardown: normal Core cleanup precedes HTTP closure. This
private fixture lifecycle is not a production App/Plugin entry or control IPC.
The sealed receipt/builder contract belongs to
[tooling/native-fixture-seal.ts](../../tooling/native-fixture-seal.ts); source
HTTP regression, sealed native execution and actual GUI App acceptance are
separate evidence.

`issue-feedback-http.ts` replaces only subprocess `fetch` with a private fake
GitHub boundary for the actual CI entry test. It records request methods/routes
in a disposable transcript and cannot send network traffic; the test confirms
feedback publication precedes an invalid exit without printing body or token.

[submissions/](submissions/README.md) owns literal current PR bodies and original
squash-message evidence used by governance and commitlint regressions.

`fake-cdp-target.ts` starts a browser-level loopback CDP endpoint for process ownership tests.
`native-close-runtime.ts` composes the real Core, explicit registration/request
facilities, lifecycle/controller, Windows launcher, platform adapter, target host
and data-directory registry.
Only helper spawn/stdio, native snapshot/port/endpoint reads and MCP transport
I/O are simulated. Accepted Close removes the fixture listener while retaining
the actual native application observer; matching handle receipts or launch
observer exit evidence drive real retirement. A registered upstream disposal
gate holds the temporary directory lease after exit. Cleanup releases the gate
and supplies separate matching launch-observer root/resource exit evidence even
after assertions fail. Tests may defer native resource completion independently
from root exit to verify operation and directory release barriers.
Its private operation view reads the real Core admin registry; it neither
publishes diagnostic entry identity nor fabricates Hook delivery.
It never launches GUI or signals a real process.

`native-child.ts` records exact argv/cwd/env and ignored standard input for a disposable process.
`native-resource-child.ts` coordinates an owned Node root, a child that outlives
it, and a grandchild created after root exit through temporary file barriers.
Descendants use detached, hidden, shell-false launches with ignored stdio, and
finish through their own ordinary exit paths. Root release waits until independent
native root/child handles are retained. A thirty-second ordinary self-exit fallback
prevents permanent fixture orphans after coordination failure; cleanup never uses
elapsed time or a final marker as exit evidence. It opens no GUI.
`native-resource-ready.ts` publishes the root/middle/late PID-ready barriers only
after a private file in the same owned directory has been fully written and closed,
then renamed to the final ready name. Readers keep their single strict PID read;
other coordination markers retain their existing protocol.
`native-resource-ready-preload.ts` holds only the PID-ready filesystem write
boundary for the actual producer regression. Its controlled spawn boundary
launches no detached descendants, so readiness ordering is exercised without
unrelated process creation.

`native-resource-cleanup.ts` retains independent native root/child witnesses before
root release and reuses a retained late-descendant witness. Failure cleanup sends
ordinary file signals, waits for all three actual handle exit receipts, then
disposes observation and removes only a checked owned temporary directory.
Monitor abandonment and receiver exit cannot discard these independent witnesses.
`native-resource-witness.ps1` retains an actual owned child process handle before
fixture release and supplies its identity and ordinary native exit receipt.
It emits controlled compile/inspect/armed/wait/exit progress and numeric failure
receipts; invalid PID zero is rejected before compilation or native inspection.
`native-resource-witness.ts` drains both witness pipes with bounded protocol
retention, strictly validates PID text and the complete owned identity, and keeps
witness close codes/signals separate from actual fixture exit receipts. Safe
failures never include raw streams, executable paths, command arguments or errors.
Timely SPAWN records and later safe evidence distinguish the existing helper's
positive int32 `witnessPid` from target `ownedPid`; missing/invalid helper PIDs
remain null and never participate in target identity or exit success. A
SPAWN record includes `spawned:true` only when that existing PID supplies OS
spawn evidence; `spawned:false` means unconfirmed, not proof that no app exists.
The returned ChildProcess object alone cannot establish a successful OS spawn.
A matching terminal failure after an accepted exit retains both the actual application exit
and the helper's disposal-failure evidence without accepting overall success.
`native-resource-log.ts` emits timely lifecycle BEGIN/END/FAILURE records for the
nine native resource variants, correlated by fixture UUID and monotonic elapsed
time. Each safe record is limited to 4 KiB, and each fixture to 128 records and
128 KiB, reserving a limitation notice and summary. Counters expose truncation,
write failure and incomplete execution. Sink failures cannot block cleanup or
replace body/cleanup errors; hard crashes and unavailable output cannot guarantee
console persistence. These diagnostics strengthen future attribution without
establishing the cause or repair of any historical witness failure.
Existing witness completion is observed without extra waiting. Pending or rejected
witnesses, failed cleanup and unhandled fixture failure latch incomplete evidence;
post-summary callbacks stay incomplete. Expected body errors with successful
cleanup remain complete. A summary alone never substitutes for actual exit evidence.
`native-resource-boundary.ps1` replaces only job-accounting and completion-port
P/Invoke boundaries in an in-memory copy of the maintained C# helper. It exercises
lost/stale notifications, timeout/error distinctions and cancellation, including
non-cancellable acquisition settlement. No real application is launched.
`native-resource-identity.ps1` uses its own process identity and duplicated handles
to exercise adoption failures, foreign-job rejection, stale monitor identity and
receiver-local disposal. Kernel object comparison avoids confusing a reused
numeric handle slot with the original process object.
`native-resource-handoff.ps1` connects two hidden, same-integrity disposable
PowerShell processes through the existing authenticated pipe primitives. Its
creator pulls only job-assignment rights, creates the hidden Node fixture, and
hands the original process observation handle back to the monitor. Variants cover
receiver exit before adoption and a lost created packet with creator-then-job
settlement. These controls do not request UAC or prove actual elevated acceptance.
`normal-close-window.cs` supplies raw owned Win32 windows, including an ordinary
GUI and a visible, unowned, zero-area layered tool event target deliberately
ordered first. It records each WM_CLOSE destination and exits its message loop
normally through GUI Close or a five-second safety timer. Variants retain
minimized, transparent/NOACTIVATE, frameless and multiple GUI compatibility while
excluding zero-area, tool, disabled and owned windows. Window ordering and safety
timer setup failures produce bounded type/native-code evidence and normal exit
before readiness rather than an unscheduled cleanup wait.
`normal-close-window.ps1` compiles and owns that fixture, calls the actual native
RequestClose and handle wait, and always observes process exit before returning.
Direct invocation requires `-AllowGui`; without it the script returns a visible
successful skip before compiling or creating resources, regardless of CI/env.
The authorized interactive test forwards that parameter. Compile-only helpers
and the native user32 I/O seam fixture do not open GUI and need no authorization.
`normal-close-boundary.cs` models only user32 operations for deterministic
enumeration/property failures and stale HWND/PID/visibility, including loss while
reading every ordinary exclusion. Its message sink
rejects unexpected message arguments and records delivery; process identity,
selection, revalidation and receipts still execute the maintained C# methods.
`normal-close-boundary.ps1` replaces exactly the user32 extern declarations in
a temporary in-memory compilation, refusing missing/ambiguous declarations.
It requires no additional native compiler and adds no production test APIs.
`official-child.ts` is a private JSON-RPC process for official-child lifecycle
tests. It records initialization/list/call and EOF/TERM boundaries and can hold
work or resist normal protocol shutdown to exercise the owned Server reaper.
It is never the original official package and never launches a browser.

`owned-native-fixtures.ts` retains private native identities before readiness
observation. Cleanup normally Closes every retained fixture, including failed
readiness acquisitions, and removes ownership only after actual exit evidence.
Its Close wrapper coordinates the anchor controller and remaining target cleanup
without duplicate successful requests; uncertain cleanup retains a retry identity.
`target-exit-reference.ts` runs one self-exiting private Node child with detached,
ignored stdio and an initially unreferenced handle. Its observing subprocess
proves actual-exit waits retain the event loop, one cancellation preserves another
waiter, and cancelling all waits leaves the fixture alive without retaining the observer.
`native-window.cs` supplies a visible, self-closing disposable WinForms window.
It can expose a loopback discovery fixture for ownership/readiness tests; this
endpoint does not implement browser tools. Permission/PID markers are test-only.
Its optional delayed normal close checks unlimited native handle waits.
Optional `DCT_TEST_WINDOW_TITLE` sets its synthetic title for Unicode observer
stdout regression tests; ordinary fixtures keep the default title.
Optional `DCT_TEST_WINDOW_X`, `DCT_TEST_WINDOW_Y`, `DCT_TEST_WINDOW_WIDTH` and
`DCT_TEST_WINDOW_HEIGHT` together set explicit opaque native window bounds for the
owned screenshot anchor. `DCT_TEST_WINDOW_NO_EXPIRY=true` disables only its fixture
timer so the probe can retain the anchor through capture and cleanup; the owner
must normally Close it and await actual exit in finally. Other fixtures retain
the existing default geometry and expiry timer.
The explicit elevation smoke can optionally restrict only this fixture's own process
DACL to Administrators/SYSTEM, producing a real medium-integrity limited-query
denial without changing files, user settings or other processes.
`compile-native-window.ps1` compiles it with ordinary/elevated manifests and
checks native permission detection without changing compatibility settings;
manifest inspection alone does not launch an elevated process or validate UAC.
Its Windows PowerShell JSON stdout is BOM-free UTF-8, including Unicode 8.3 paths;
the fixture references Windows' existing System.Drawing for explicit geometry.
`snapshot-limited-access.ps1` denies the legacy MainModule path property while
testing native limited-query identity of its own disposable process.
`windows-close-denial.ps1` calls the production native helper against an explicitly
owned elevation-smoke fixture and records either a UIPI close-request return code
or a thrown limited-query access denial. It is used only by the opt-in
`smoke/windows-elevation.ts` modes; the return-code probe does not itself prove
the production helper's returned-access-denied elevation branch executed.
