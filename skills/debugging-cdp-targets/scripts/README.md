# Runtime source

`cdp-session.mjs` is the only executable Node entry. `hide-mcp-console.cjs`
is an internal preload that limits unwanted console windows in the official
CLI subprocess tree. `windows-cdp-helper.ps1` provides process snapshots and
normal window close requests.

`interface/` owns parsing and output. `application/` owns use cases.
`domains/` owns session, target, and bridge policy. `adapters/` owns external
I/O. `shared/` owns shared constants, errors, and value helpers.
`AGENTS.md` defines the runtime's implementation rules.
