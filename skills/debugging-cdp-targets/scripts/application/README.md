# Application workflows

`commands.mjs` owns public action dispatch, the mutation lock, Start, Status,
and real adapter wiring. `session-lifecycle.mjs` owns Resume, guarded Invoke,
Stop transitions, missing-target reconciliation, and Start rollback.
`target.mjs` owns target inspection and startup environment checks.
`bridge.mjs` owns package resolution and daemon lifecycle orchestration.
`AGENTS.md` defines workflow rules.
