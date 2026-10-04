# Test fixtures

`fake-cdp-target.ts` starts a browser-level loopback CDP endpoint for process ownership tests.
`hook-gateway.ts` composes the production gateway/SDK with fake process, CDP and
upstream I/O for isolated Codex model-context tests. Its local HTTP exit trigger
and target identity files exist only in the temporary integration fixture.

`native-child.ts` records exact argv/cwd/env and ignored standard input for a disposable process.
`native-window.cs` supplies a visible, self-closing disposable WinForms window.
It can expose a loopback discovery fixture for ownership/readiness tests; this
endpoint does not implement browser tools. Permission/PID markers are test-only.
`compile-native-window.ps1` compiles it with ordinary/elevated manifests and
checks native permission detection without changing compatibility settings.
`snapshot-limited-access.ps1` denies the legacy MainModule path property while
testing native limited-query identity of its own disposable process.
