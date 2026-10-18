# Commit governance

- `commit-grammar.ts` owns frozen commit types/scopes, branch prefixes and pure
  branch validation through the shared strict version predicates.
- `commit-validation.ts` owns raw-message commitlint execution, repository/config
  resolution and process failure versus message rejection.
- `commit-events.ts` constructs requests and resolves branch evidence from supplied
  event/environment values. Its zero-SHA rule also serves forced-push selection.
- `check-commits.ts` owns the Git/history audit command, actual record framing and
  topology, commit validation and current PR-template loading.

Root commitlint configuration consumes only pure grammar. These modules do not
publish or alter Git history. Ancestor [tooling rules](../AGENTS.md) apply.
