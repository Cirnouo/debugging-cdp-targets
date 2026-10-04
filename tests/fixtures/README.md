# Test fixtures

`unwrapped-squash-message.json` preserves a malformed squash message as negative
input for strict body-length validation, including a formerly exempt identity.

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

`native-child.ts` records exact argv/cwd/env and ignored standard input for a disposable process.
`target-exit-reference.ts` runs one self-exiting private Node child with detached,
ignored stdio and an initially unreferenced handle. Its observing subprocess
proves actual-exit waits retain the event loop, one cancellation preserves another
waiter, and cancelling all waits leaves the fixture alive without retaining the observer.
`native-window.cs` supplies a visible, self-closing disposable WinForms window.
It can expose a loopback discovery fixture for ownership/readiness tests; this
endpoint does not implement browser tools. Permission/PID markers are test-only.
Its optional delayed normal close checks unlimited native handle waits. The
explicit elevation smoke can optionally restrict only this fixture's own process
DACL to Administrators/SYSTEM, producing a real medium-integrity limited-query
denial without changing files, user settings or other processes.
`compile-native-window.ps1` compiles it with ordinary/elevated manifests and
checks native permission detection without changing compatibility settings;
manifest inspection alone does not launch an elevated process or validate UAC.
`snapshot-limited-access.ps1` denies the legacy MainModule path property while
testing native limited-query identity of its own disposable process.
`windows-close-denial.ps1` calls the production native helper against an explicitly
owned elevation-smoke fixture and records either a UIPI close-request return code
or a thrown limited-query access denial. It is used only by the opt-in
`smoke/windows-elevation.ts` modes; the return-code probe does not itself prove
the production helper's returned-access-denied elevation branch executed.
