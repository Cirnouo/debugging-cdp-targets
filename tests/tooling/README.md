# Tooling regressions

- `governance/` separates pure commit grammar from real commitlint execution and
  controlled process-boundary assertions.
- `quality/` owns pure text/YAML policy and import-isolation regressions.

The safe default and coverage commands explicitly select
`governance/commit-grammar.test.ts`, `governance/commit-validation.test.ts` and
`quality/text-policy.test.ts`.
They retain root regressions and exclude interactive/smoke entrypoints.
Ancestor [test rules](../AGENTS.md) apply.
