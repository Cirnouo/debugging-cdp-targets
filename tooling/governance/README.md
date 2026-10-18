# Commit governance

- `commit-grammar.ts` owns frozen commit types/scopes, branch prefixes and pure
  branch validation through the shared strict version predicates.
- `commit-validation.ts` owns raw-message commitlint execution, repository/config
  resolution and process failure versus message rejection.

The root `check-commits.ts` owns Git/event/topology selection. Root commitlint
configuration consumes only pure grammar. These modules do not publish or alter
Git history. Ancestor [tooling rules](../AGENTS.md) apply.
