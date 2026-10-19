# Submission policy and Issue feedback

- `markdown.ts` scans submission sections at a selected heading depth,
  logical wrapped checkbox labels, adjacent continuations, and content paragraphs.
  Paragraphs retain their text and whether it includes literal code or quoted
  content. Shared line readers identify headings/checklists without rescanning
  literal output as Markdown structure.
  Fences, indented code, quotes, and comments cannot supply structural headings
  or checklists; code and quoted content can supply evidence beyond starter prose.
- `pull-requests.ts` validates current PR section order, canonical checklist
  labels/placement, selections, conditional N/A reasons, and evidence by reading
  the supplied current template. The CLI loads `.github/PULL_REQUEST_TEMPLATE.md`;
  the low-level Git range/message builder remains independent of that template.
- `issue-forms.ts` parses supplied current Issue form YAML and derives classification
  labels, H3 field order, required responses, and exact single-choice dropdown options.
  It returns skipped, valid, or invalid body diagnostics; malformed or unsupported
  forms throw a distinct configuration error. Ordinary unlabeled Issues are exempt.
  This pure policy has no CLI or local submission hook.

- `issue-feedback.ts` owns the injected recoverable Issue feedback transaction:
  trusted event/live identity, complete comment discovery, stale snapshots and
  confirmed diagnostic label/comment changes share one expected snapshot.
- `github-issues.ts` owns fixed public GitHub REST, bounded requests, redirect
  refusal, token headers and sanitized failures.
- `publish-issue-feedback.ts` is the invoked CI entry. It reads event/form files
  and credentials, awaits the transaction, and fails invalid content only after
  feedback completes. It has no package command or local hook.

The three value validators consume supplied strings and labels. The scanner
retains literal provenance; each policy owns its distinct template semantics.
Governance loads the current PR template. The publisher loads module-rooted form
YAML and credentials; the transaction receives context/forms/request explicitly.
Ancestor [tooling rules](../AGENTS.md) apply.
