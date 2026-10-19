# Submission value regressions

- `markdown.test.ts` directly checks lazy checklist wrapping, all five structure
  stops, literal TAP without section splitting, selected H3 depth with deeper
  headings, and actual-space versus comment-mask paragraph provenance.
- `pull-requests.test.ts` checks template-derived sections, checklist order
  and placement, selection and conditional N/A rules, placeholder paragraphs,
  Unicode and fenced evidence. Structural examples in code, quotes, or comments
  cannot satisfy missing sections/checks. Current PR CLI fixtures also verify
  template rejection independently of header checks and full raw actual-commit
  validation without altering history.
- `issue-forms.test.ts` validates literal GitHub form bodies against the current
  YAML, including label-only classification, required and optional answers,
  exact dropdown options, H3 order/duplicates, fake structural headings, and
  unsupported or malformed configuration. Mutated YAML fixtures prove that
  labels and field requirements remain derived from the supplied source.

The safe default and coverage commands select each suite once. Scanner observations
remain separate from PR policy outcomes; supplied form policy retains its complete
YAML-profile cases. Literal commit and PR CLI evidence lives in
[submission fixtures](../../fixtures/submissions/README.md) and is consumed by
[governance tests](../governance/README.md). Root feedback/workflow suites and their
HTTP preload retain their current entry. Ancestor [test rules](../../AGENTS.md) apply.
