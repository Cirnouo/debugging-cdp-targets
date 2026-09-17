# External adapters

`local-data.mjs` owns Skill-relative paths, LOCALAPPDATA state/cache paths,
atomic records, empty state-directory cleanup, and the per-user named-pipe
lock. `official-cli.mjs` owns the isolated npm runtime, exact package inspection,
hidden subprocesses, official daemon client, and tool invocation I/O.
`windows-target.mjs` owns loopback probes, Windows helper calls, process
presence, local CDP HTTP, and target process launch.
`AGENTS.md` defines adapter safety rules.
