# Runtime tests

`cdp-session.test.mjs` owns runtime policy, state transitions, parser, portable
entry, loopback, and Windows helper regression tests. Tests import internal
modules directly and remain outside the installable Skill payload.
`AGENTS.md` defines test rules.

Run `node --test tests/cdp-session.test.mjs`. The coverage gate is
`node --experimental-test-coverage --test-coverage-lines=52 --test-coverage-branches=71 --test-coverage-functions=61 --test tests/cdp-session.test.mjs`.
