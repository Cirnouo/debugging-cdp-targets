# Git hooks

This directory owns developer-side Git policy entry points.

- `commit-msg` skips only a merge proven by `MERGE_HEAD`, then invokes commitlint.
- `pre-commit` invokes lint-staged with its default stash and partial-staging
  protections intact.
- `pre-push` invokes the complete non-writing push verification suite.
- `_` is Husky-managed internal support and is not maintained by this repository.
