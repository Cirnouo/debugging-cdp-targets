# Git hooks

This directory owns developer-side Git policy entry points.

- `commit-msg` skips only a merge proven by `MERGE_HEAD`, then invokes commitlint.
- `pre-commit` invokes lint-staged with its default stash and partial-staging
  protections intact. Its 4096-character batches leave space for Windows command
  quoting and the pnpm-generated executable launcher.
- `pre-push` clears Git's repository routing variables before invoking the complete
  non-writing push verification suite, so disposable Git fixtures remain independent.
- `_` is Husky-managed internal support and is not maintained by this repository.

The ignored `_` directory must be generated separately in every clone or linked
worktree after the [trusted installation sequence](../docs/policies/supply-chain.md#installation-and-scan-order).
Follow the [local hook policy](../docs/policies/quality.md#local-git-hook-initialization)
to verify the effective hook path and real `pre-push` entry before pushing.
