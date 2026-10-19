# Submission regressions

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

- `issue-feedback.test.ts` exercises the actual REST/transaction/publisher through
  fake HTTP: ownership, pagination, stale fences, partial failure/rerun recovery,
  sanitized errors, local-I/O import isolation and zero-request admission failure.
  The controlled publisher child proves awaited label-before-comment publication,
  module-rooted forms from unrelated cwd, and invalid exit without body/token logs.
- `issue-workflow.test.ts` parses the actual workflow for trusted same-SHA checkout,
  reviewed Actions/toolchain, minimal writer permission, prerequisite gate,
  step-scoped token and diagnostic-label recursion exclusion.

The safe default and coverage commands select all five suites once. Literal commit
and PR CLI evidence plus the HTTP preload live in
[submission fixtures](../../fixtures/submissions/README.md); governance also consumes
the literal evidence. Ancestor [test rules](../../AGENTS.md) apply.
