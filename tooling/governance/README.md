# Commit governance

- `commit-grammar.ts` owns frozen commit types/scopes, branch prefixes and pure
  branch validation through the shared strict version predicates.
- `commit-validation.ts` owns raw-message commitlint execution, repository/config
  resolution and process failure versus message rejection.
- `commit-events.ts` constructs requests and resolves branch evidence from supplied
  event/environment values. Its zero-SHA rule also serves forced-push selection.
- `check-commits.ts` owns the Git/history audit command, actual record framing and
  topology, commit validation and current PR-template loading.
- `commit-footer.ts` supplies the local commitlint `footer-leading-blank`
  rule. It checks original message lines, preserves body labels without a
  preceding blank line, and requires separation before reserved footer syntax.
  A separated generic trailer can begin a group of adjacent footer lines.

Root commitlint configuration consumes pure grammar and the pure footer rule.
These modules do not publish or alter Git history. Ancestor [tooling rules](../AGENTS.md) apply.
