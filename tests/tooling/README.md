# Tooling regressions

- `governance/` separates pure commit grammar from real commitlint execution and
  controlled process-boundary assertions.

The safe default and coverage commands explicitly select
`governance/commit-grammar.test.ts` and `governance/commit-validation.test.ts`.
They retain root regressions and exclude interactive/smoke entrypoints.
Ancestor [test rules](../AGENTS.md) apply.
