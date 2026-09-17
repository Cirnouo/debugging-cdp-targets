# Runtime tests

`cdp-session.test.mjs` owns runtime policy, state transitions, parser, portable
entry, loopback, and Windows helper regression tests. `ci-config.test.mjs`,
`governance.test.mjs`,
`commit-checks.test.mjs`, `repository-audit.test.mjs`,
`distribution-audit.test.mjs`, `script-checks.test.mjs`, and
`toolchain-config.test.mjs` own the behavior and configuration of the Task 3
governance and verification modules. Tests import internal modules directly and
remain outside the installable Skill payload. `AGENTS.md` defines test rules.

Run the focused runtime suite with `node --test tests/cdp-session.test.mjs` and
the complete suite with `pnpm test`. The coverage gate is
`pnpm test:coverage`.
