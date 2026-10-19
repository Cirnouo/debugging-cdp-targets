# Literal submission evidence

`unwrapped-squash-message.json` preserves a malformed squash message as negative
input for strict body-length validation, including a formerly exempt identity.

`wrapped-body-label-squash.json` preserves the complete original PR description
and GitHub-wrapped squash message as UTF-8 text without normalizing their bytes.
The message puts an ordinary body label at a line boundary; actual-commit audit
regressions distinguish it from explicit trailers without rewriting history.
Its historical prose does not exempt a current PR from the current template.

`current-pr-body.md` is a literal compliant current PR body with checklist
selections, conditional N/A reasons, evidence, an ordinary body label and Issue
references. CLI regressions preserve raw event bytes while checking the current
template, raw title and predicted squash header independently. Variants include
long review prose, wide tables, fenced evidence and adjacent trailer-looking text;
actual commits still receive complete strict validation. Its declared checks are
synthetic fixture input.

These are controlled literal inputs, not an implementation of submission policy.
The governance suite reads their original bytes; the fixture declarations do not
establish actual executed checks. Ancestor [test rules](../../AGENTS.md) apply.
