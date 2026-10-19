# Tooling regressions

- `governance/` separates supplied commit events and pure grammar from actual
  Git/history audits, real commitlint execution and controlled process boundaries.
- `quality/` owns pure text/YAML policy and import-isolation regressions.
- [licenses/](licenses/README.md) checks bundled notices and reviewed input boundaries.
- [distribution/](distribution/README.md) checks complete thin-payload assembly and output effects.
- [releases/](releases/README.md) separates pure release-note behavior and import
  isolation from the complete publication transaction with controlled I/O.
- [submissions/](submissions/README.md) owns direct Markdown scanner observations
  and supplied current PR-template/Issue-form policy outcomes.

The safe default and coverage commands explicitly select
`governance/commit-events.test.ts`, `governance/commit-grammar.test.ts`,
`governance/commit-history.test.ts`, `governance/commit-validation.test.ts`,
`quality/text-policy.test.ts`, `releases/release-notes.test.ts` and
`releases/publication.test.ts`, `submissions/markdown.test.ts`,
`submissions/pull-requests.test.ts`, `submissions/issue-forms.test.ts`,
`licenses/bundled-notices.test.ts` and `distribution/thin-plugin-payloads.test.ts` once each.
They retain root regressions and exclude interactive/smoke entrypoints.
Ancestor [test rules](../AGENTS.md) apply.
