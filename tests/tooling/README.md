# Tooling regressions

- `governance/` separates supplied commit events and pure grammar from actual
  Git/history audits, real commitlint execution and controlled process boundaries.
- `quality/` owns pure text/YAML policy and import-isolation regressions.
- [releases/](releases/README.md) separates pure release-note behavior and import
  isolation from the complete publication transaction with controlled I/O.

The safe default and coverage commands explicitly select
`governance/commit-events.test.ts`, `governance/commit-grammar.test.ts`,
`governance/commit-history.test.ts`, `governance/commit-validation.test.ts`,
`quality/text-policy.test.ts`, `releases/release-notes.test.ts` and
`releases/publication.test.ts` once each.
They retain root regressions and exclude interactive/smoke entrypoints.
Ancestor [test rules](../AGENTS.md) apply.
