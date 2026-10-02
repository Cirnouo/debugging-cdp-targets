# Test fixtures

`fake-cdp-target.ts` starts a browser-level loopback CDP endpoint for process ownership tests.
`hook-gateway.ts` composes the production gateway/SDK with fake process, CDP and
upstream I/O for isolated Codex model-context tests. Its local HTTP exit trigger
and target identity files exist only in the temporary integration fixture.
