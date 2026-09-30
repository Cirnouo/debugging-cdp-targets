# Commits, branches, and scope evolution

## Branches

The trunk is `main`. Work branches use exactly one of `feat/`, `fix/`,
`hotfix/`, `chore/`, `docs/`, `refactor/`, `test/`, `ci/`, or `codex/`, followed
by a lowercase kebab-case topic. Release branches use `release/<semver>`; only
release branches may use SemVer dots and prerelease/build separators. Do not
rewrite shared history.

## Commits

Every non-merge commit uses `<type>(<scope>)!: <subject>`, where `!` appears only
for a breaking change. Allowed types are `build`, `chore`, `ci`, `docs`, `feat`,
`fix`, `perf`, `refactor`, `revert`, `style`, and `test`. The single required
lowercase scope is one of `skill`, `session`, `target`, `devtools`, `windows`,
`obsidian`, `distribution`, `testing`, `tooling`, `governance`, `dependencies`,
or `release`.

`obsidian` is retained for historical validation only; new application-specific
behavior is outside the current design. Plugin packaging uses `distribution`;
official Server transport uses `devtools`.

Headers are at most 100 characters. Subjects are non-empty, begin in lowercase,
and do not end with a period. A body or footer follows a blank line; a footer
also follows a blank line after a body. Body and footer lines are at most 100
characters. A breaking change may use `!`, a `BREAKING CHANGE:` footer, or both.
Only Git-topology-proven merge commits are ignored.

Keep each commit coherent, stage only files owned by the task, and preserve
unrelated worktree changes. Review the staged diff and run the applicable
focused checks before committing.

Do not push, tag, publish, modify a remote, open a pull request, or change
repository settings without explicit authorization.

## Scope evolution

Add a scope only for a durable domain or cross-cutting responsibility expected
to recur. Never add one for a file, issue, person, temporary feature, or one-off
migration. Add, remove, or rename a scope in a `chore(governance): ...` change
that updates the shared grammar, this policy, the glossary/context, and relevant
directory documentation. Never rewrite historical commits for a scope change.

When a request changes scope, update the governing plan or task brief before
implementation when one exists. Record durable architecture decisions in an
ADR and user-visible behavior in the changelog. Do not fold unrelated cleanup,
speculative compatibility, or future extension work into the current change.
