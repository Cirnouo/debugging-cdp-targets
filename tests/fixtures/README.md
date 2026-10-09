# Test fixtures

`mcp-instructions-entry.ts` connects only the production MCP entry adapter with
an empty official catalog and read-only status. It retains initialization and
discovery evidence, fails on every tools/call, and imports no runtime, router,
process manager or upstream. Instruction consumption never launches a target.

`issue-feedback-http.ts` replaces only subprocess `fetch` with a private fake
GitHub boundary for the actual CI entry test. It records request methods/routes
in a disposable transcript and cannot send network traffic; the test confirms
feedback publication precedes an invalid exit without printing body or token.

`unwrapped-squash-message.json` preserves a malformed squash message as negative
input for strict body-length validation, including a formerly exempt identity.

`wrapped-body-label-squash.json` preserves the complete original PR description
and GitHub-wrapped squash message as UTF-8 text without normalizing their bytes.
The message puts an ordinary body label at a line boundary; commit and PR audit
regressions distinguish it from explicit trailers without rewriting history.
Its historical prose does not exempt a current PR from the current template.

`current-pr-body.md` is a literal compliant current PR body with checklist
selections, conditional N/A reasons, evidence, an ordinary body label and Issue
trailers. CLI regressions preserve its raw bytes while checking the template and
complete commitlint message; its declared checks are synthetic fixture input.

`fake-cdp-target.ts` starts a browser-level loopback CDP endpoint for process ownership tests.
`hook-gateway.ts` composes the production gateway/SDK with fake process, CDP and
upstream I/O for isolated Codex and Claude model-context tests. Each fake target
has an independent child exit event; normal Close emits that actual fixture exit
before reporting success. Its local HTTP triggers select a target by PID or
release the controlled second launch. Target identity files and triggers exist
only in the temporary integration fixture.
The Post scenario returns the original successful upstream result, then schedules
actual fixture exit with one setImmediate milestone. Runtime validation and SDK
success response finish before that exit; cleanup is ready for the next host Hook
I/O. The host smokes verify both the original successful result and exact
PostToolUse delivery without a fixed delay or target polling.
`hook-gateway-events.ts` parses compact Hook JSON inside actual host context
wrappers, validates event identity/action and rejects full result, configuration
or tool-schema payloads. Nested expected exits must retain their own identities,
match the parent operation ID and have completed cleanup. Primitive native failure
evidence is allowed; tool names/counts and complete message/cause text are rejected.
It also checks default lifecycle/status summaries before
test adapters can strip fields.
Its test-only smoke wait reads empty Hook responses at 100ms intervals using
the existing 15-second readiness polling budget and returns the first nonempty
batch intact. It checks that budget before another read and after a read returns;
late responses cannot satisfy readiness. Each pending RPC retains its separate
existing timeout. It rejects malformed nonempty responses immediately; it never
filters by expected identity, discards unrelated events, or reads another
response after delivery. The smoke's identity/count/cleanup and subsequent
empty-Hook assertions still validate that batch.

`native-child.ts` records exact argv/cwd/env and ignored standard input for a disposable process.
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
